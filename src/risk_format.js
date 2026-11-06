// Risk Assessor – parses the model output, verifies it against the risk register and task board,
// ranks risks in code (likelihood × impact, model rank as tie-break), renders Markdown,
// and describes the LangSmith trace for this request.

const kb = $('Knowledge Base').first().json;
const requests = $('Risk Assessor: Build Prompt').all();

const SCORE = { High: 3, Medium: 2, Low: 1 };
const register = new Map(kb.risks.map((r) => [r.risk_id, r]));
const tasksById = new Map(kb.tasks.map((t) => [t.task_id, t]));
const phases = new Map(kb.timeline.map((p) => [p.phase, p]));

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9%]+/g, ' ').trim();

// Quote must appear as a contiguous word sequence in the source, tolerating inflection only
// ("reduce" ≈ "reducing"): each word is compared on its first 5 letters.
const stems = (s) => norm(s).split(' ').filter(Boolean).map((w) => w.slice(0, 5));
function quoteInSource(quote, source) {
  const q = stems(quote), src = stems(source);
  if (!q.length) return false;
  for (let i = 0; i + q.length <= src.length; i++) {
    if (q.every((w, j) => src[i + j] === w)) return true;
  }
  return false;
}
const cell = (s) => String(s ?? '').replace(/\|/g, '/').replace(/\n/g, ' ');
const list = (items) => (items.length ? items.map((x) => `- ${x}`).join('\n') : '- _None._');

// Every assessed risk must exist in the register exactly once, cite the description verbatim,
// and link only to real tasks and phases.
function groundingCheck(a, req) {
  const issues = [];
  let checked = 0, grounded = 0;
  const seen = new Set();

  for (const r of a.risks) {
    checked++;
    const problems = [];
    if (!register.has(r.risk_id)) problems.push('not in register');
    if (seen.has(r.risk_id)) problems.push('duplicate');
    seen.add(r.risk_id);
    if (!quoteInSource(r.evidence_quote, req.source_text)) problems.push(`quote not in description → “${r.evidence_quote}”`);
    const unknownTasks = r.related_task_ids.filter((id) => !tasksById.has(id));
    if (unknownTasks.length) problems.push(`unknown tasks ${unknownTasks.join(', ')}`);
    if (!phases.has(r.exposed_phase)) problems.push(`unknown phase ${r.exposed_phase}`);
    if (problems.length) issues.push(`${r.risk_id}: ${problems.join(', ')}`);
    else grounded++;
  }
  const missing = kb.risks.map((r) => r.risk_id).filter((id) => !seen.has(id));
  if (missing.length) issues.push(`register risks not assessed: ${missing.join(', ')}`);

  return { checked, grounded, score: checked ? grounded / checked : 1, issues };
}

// Review checks: ratings must agree with the task board (a blocked or overdue linked task means the
// risk is already showing); next steps must be a real action, not the register text or a bare phase
// reference; and their deadline must not already be in the past.
const overdueIds = new Set(kb.facts.overdue_tasks.map((t) => t.task_id));
const currentPhase = kb.timeline.find((p) => p.schedule_status === 'Current')?.phase ?? 1;
const phaseWords = new Set(kb.timeline.flatMap((p) => norm(p.phase_name).split(' ')).concat(['before', 'by', 'phase', 'start', 'of', 'the']));
function reviewCheck(risks) {
  const allCases = kb.project.use_cases.length;
  const undifferentiated = risks.filter((r) => r.affected_use_cases.length >= allCases).length;
  const domain = !risks.some((r) => r.affected_use_cases.length) ? ['no risk is tied to a logistics use case']
    : undifferentiated > risks.length / 2 ? [`${undifferentiated}/${risks.length} risks list every use case – not differentiated`] : [];
  return domain.concat(risks.flatMap((r) => {
    const issues = [];
    const live = r.related_task_ids.filter((id) => tasksById.get(id)?.status === 'Blocked' || overdueIds.has(id));
    if (r.likelihood === 'Low' && live.length) issues.push(`${r.risk_id}: likelihood Low but linked task ${live.join(', ')} is blocked/overdue`);
    const words = norm(r.next_step).split(' ').filter(Boolean);
    const content = words.filter((w) => !phaseWords.has(w) && !/^\d+$/.test(w));
    const mitigation = new Set(norm(register.get(r.risk_id)?.mitigation_strategy).split(' '));
    const copied = words.length && words.filter((w) => mitigation.has(w)).length / words.length > 0.8;
    if (content.length < 5) issues.push(`${r.risk_id}: next step is not an action (“${r.next_step}”)`);
    else if (copied) issues.push(`${r.risk_id}: next step copies the register mitigation`);
    if (r.next_step_before_phase < currentPhase) issues.push(`${r.risk_id}: next step deadline Phase ${r.next_step_before_phase} has already passed`);
    return issues;
  }));
}

const useCases = (r) => (r.affected_use_cases.length ? r.affected_use_cases.join(', ') : 'Organisation-wide');
const nextStep = (r) => `${r.next_step} _(before ${phaseLabel(r.next_step_before_phase)})_`;

// Deterministic ranking: score desc, then impact, then the model's priority_rank.
function rank(risks) {
  return [...risks]
    .map((r) => ({ ...r, score: SCORE[r.likelihood] * SCORE[r.impact] }))
    .sort((x, y) => y.score - x.score || SCORE[y.impact] - SCORE[x.impact] || x.priority_rank - y.priority_rank)
    .map((r, i) => ({ ...r, rank: i + 1 }));
}

const signals = (r) => (r.related_task_ids.length
  ? r.related_task_ids.map((id) => `${id} ${tasksById.get(id)?.task_name ?? '?'} (${tasksById.get(id)?.status ?? '?'})`).join('; ')
  : '—');
const phaseLabel = (n) => (phases.has(n) ? `Phase ${n}: ${phases.get(n).phase_name}` : `Phase ${n}`);

function renderAssessment(status, a, ranked, grounding, review) {
  const top = status === 'TOP_RISKS';
  const shown = top ? ranked.slice(0, Math.max(1, a.requested_count)) : ranked;
  const f = kb.facts;
  const header = [
    `# ${top ? `Top ${shown.length} Risks` : 'Risk Assessment'} — ${kb.project.name}`,
    `_Generated by Mira · as of ${f.as_of_date} (week ${f.current_week}, ${f.current_phase}) · Sources: project_risks.csv, project_description.txt, sample_task_board.csv, project_timeline.csv_`,
    '## Summary', a.summary,
  ];

  const body = top
    ? shown.map((r) => {
      const reg = register.get(r.risk_id);
      return [
        `### ${r.rank}. ${r.risk_id} — ${reg.category}: ${reg.risk_challenge}`,
        `**Likelihood:** ${r.likelihood} · **Impact:** ${r.impact} · **Score:** ${r.score}/9 · **Most exposed:** ${phaseLabel(r.exposed_phase)} · **Owner:** ${r.owner_role}`,
        `**Why it matters now:** ${r.rationale}`,
        `_Threatens: “${r.evidence_quote}” · Use cases affected: ${useCases(r)}_`,
        `**Impact if it happens (register):** ${reg.impact}`,
        `**Live signals on the task board:** ${signals(r)}`,
        `**Mitigation (register):** ${reg.mitigation_strategy}`,
        `**Recommended next step:** ${nextStep(r)}`,
      ].join('\n\n');
    })
    : [
      '## Risk register (ranked by likelihood × impact)',
      ['| # | ID | Category | Risk | L | I | Score | Use cases affected | Most exposed | Live signals | Owner |',
        '|---|---|---|---|---|---|---|---|---|---|---|',
        ...shown.map((r) => {
          const reg = register.get(r.risk_id);
          return `| ${r.rank} | ${r.risk_id} | ${cell(reg.category)} | ${cell(reg.risk_challenge)} | ${r.likelihood} | ${r.impact} | ${r.score} | ${cell(useCases(r))} | ${cell(phaseLabel(r.exposed_phase))} | ${cell(signals(r))} | ${r.owner_role} |`;
        })].join('\n'),
      '## Why each risk matters & what to do',
      shown.map((r) => {
        const reg = register.get(r.risk_id);
        return `**${r.rank}. ${r.risk_id} ${reg.category}** — ${r.rationale}  \n` +
          `_Threatens: “${r.evidence_quote}”_  \n` +
          `Impact (register): ${reg.impact}  \n` +
          `Mitigation (register): ${reg.mitigation_strategy}  \n` +
          `Next step: ${nextStep(r)}`;
      }).join('\n\n'),
    ];

  return [
    ...header,
    ...body,
    '---',
    `Grounding check: ${grounding.grounded}/${grounding.checked} risks traced to the register and source` +
      (grounding.issues.length ? `\n${grounding.issues.map((i) => `- ⚠ ${i}`).join('\n')}` : ' ✅'),
    `Review checks (task-board consistency, actionable next steps):` +
      (review.length ? `\n${review.map((i) => `- ⚠ ${i}`).join('\n')}` : ' ✅'),
  ].join('\n\n');
}

function renderClarification(c) {
  return [
    '## More information needed before I can assess risks',
    c.reason,
    '**What I have so far**', list(c.known_information),
    '**What is missing**', list(c.missing_information),
    '**Please answer these questions**',
    c.questions.map((q, i) => `${i + 1}. ${q}`).join('\n'),
    '_No risks were listed, to avoid inventing project-specific risks without project data._',
  ].join('\n\n');
}

return $input.all().map((item, i) => {
  const req = requests[i].json;
  const body = item.json.body ?? item.json;
  const headers = item.json.headers ?? {};
  const finishedAt = new Date().toISOString();
  const content = body.choices?.[0]?.message?.content ?? '';

  let output = null, parseError = null;
  try { output = JSON.parse(content); } catch (e) { parseError = e.message; }

  let markdown, grounding = null, review = [], ranked = [], shownCount = 0;
  const status = output?.status ?? 'ERROR';
  if (!output) {
    markdown = `⚠ Risk Assessor returned unparseable output (${parseError}).\n\n${content}`;
  } else if (status !== 'NEEDS_CLARIFICATION' && output.assessment) {
    // Schema returns { R01: {...}, R02: {...} }; flatten to a list keyed by risk_id.
    const a = { ...output.assessment, risks: Object.entries(output.assessment.risks).map(([risk_id, r]) => ({ risk_id, ...r })) };
    grounding = groundingCheck(a, req);
    review = reviewCheck(a.risks);
    ranked = rank(a.risks);
    shownCount = status === 'TOP_RISKS' ? Math.min(ranked.length, Math.max(1, a.requested_count)) : ranked.length;
    markdown = renderAssessment(status, a, ranked, grounding, review);
  } else {
    markdown = renderClarification(output.clarification ?? { reason: 'Insufficient detail.', known_information: [], missing_information: [], questions: [] });
  }

  // Model latency from OpenAI's header gives accurate per-call timing even when items run in sequence.
  const latencyMs = Number(headers['openai-processing-ms']) || (Date.parse(finishedAt) - Date.parse(req.started_at));
  const llmEnd = new Date(Date.parse(req.started_at) + latencyMs).toISOString();
  const usage = body.usage ?? {};
  const topRisks = ranked.slice(0, shownCount).map((r) => `${r.risk_id} (${r.likelihood}/${r.impact})`);

  return {
    json: {
      test_id: req.test_id,
      query: req.query,
      checks: req.checks,
      agent: req.agent,
      status,
      uses_project_data: req.uses_project_data,
      risk_count: shownCount,
      assessed_count: ranked.length,
      top_risks: topRisks,
      grounding,
      review,
      review_issue_count: review.length,
      markdown,
      usage: { input_tokens: usage.prompt_tokens ?? 0, output_tokens: usage.completion_tokens ?? 0, total_tokens: usage.total_tokens ?? 0 },
      trace: {
        name: 'Mira',
        start_time: req.started_at,
        end_time: finishedAt,
        inputs: { query: req.query },
        outputs: { status, response: markdown },
        tags: ['mira', 'risk', req.test_id].filter(Boolean),
        metadata: { test_id: req.test_id, agent: req.agent, status, uses_project_data: req.uses_project_data, groundedness: grounding?.score ?? null, as_of_date: kb.facts.as_of_date },
        children: [
          {
            name: req.agent,
            run_type: 'llm',
            start_time: req.started_at,
            end_time: llmEnd,
            inputs: { messages: req.openaiRequest.messages },
            outputs: body,
            model: req.openaiRequest.model,
            temperature: req.openaiRequest.temperature,
          },
          {
            name: 'Grounding Check',
            run_type: 'chain',
            start_time: llmEnd,
            end_time: finishedAt,
            inputs: { status, uses_project_data: req.uses_project_data },
            outputs: grounding ? { ...grounding, review, ranking: ranked.map((r) => `${r.rank}. ${r.risk_id} score ${r.score}`) } : { skipped: 'no assessment generated' },
          },
        ],
      },
    },
  };
});
