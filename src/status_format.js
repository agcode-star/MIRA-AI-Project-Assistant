// Status Reporter – parses the model narrative, verifies every task ID and number in it against
// the computed facts, renders the report (counts, tables and RAG come from code), and describes
// the LangSmith trace for this request.

const kb = $('Knowledge Base').first().json;
const cfg = $('Config').first().json;
const requests = $('Status Reporter: Build Prompt').all();
const f = kb.facts;
const STATUSES = ['Done', 'In Progress', 'Blocked', 'To Do'];

const byId = new Map(kb.tasks.map((t) => [t.task_id, t]));
const overdueIds = new Set(f.overdue_tasks.map((t) => t.task_id));
const cell = (s) => String(s ?? '').replace(/\|/g, '/').replace(/\n/g, ' ');
const list = (items) => (items.length ? items.map((x) => `- ${x}`).join('\n') : '- _None._');
const timing = (t) => (t.status === 'Done' ? 'Done'
  : t.status === 'Blocked' ? `⛔ Blocked · due in ${t.days_until_due}d`
  : t.days_until_due < 0 ? `⚠ ${-t.days_until_due}d overdue` : t.days_until_due === 0 ? 'Due today' : `Due in ${t.days_until_due}d`);

// RAG from fixed rules, so the overall status never depends on the model's tone.
function rag(scope) {
  const watched = [...scope.task_ids, ...scope.context_ids.carried_over].map((id) => byId.get(id));
  const overdue = watched.filter((t) => overdueIds.has(t.task_id));
  const blocked = watched.filter((t) => t.status === 'Blocked');
  const reasons = [];
  let level = 'Green';
  const lateHigh = overdue.filter((t) => t.priority === 'High' && -t.days_until_due > 7);
  const blockedSoon = blocked.filter((t) => t.days_until_due <= Number(cfg.dueSoonDays));
  if (lateHigh.length || blockedSoon.length) {
    level = 'Red';
    lateHigh.forEach((t) => reasons.push(`${t.task_id} is high priority and more than 7 days overdue`));
    blockedSoon.forEach((t) => reasons.push(`${t.task_id} is blocked and due within ${cfg.dueSoonDays} days`));
  } else if (overdue.length || blocked.length) {
    level = 'Amber';
    overdue.forEach((t) => reasons.push(`${t.task_id} ${t.task_name} is ${-t.days_until_due}d overdue`));
    blocked.forEach((t) => reasons.push(`${t.task_id} ${t.task_name} is blocked (due ${t.due_date})`));
  } else reasons.push('no overdue or blocked tasks');
  return { level, reasons };
}
const RAG_ICON = { Green: '🟢', Amber: '🟠', Red: '🔴' };

// Numbers the narrative may use: computed counts/percentages, task timings and numbers that
// appear in the source task text (e.g. KPIs "15%", "3 distribution centers").
function allowedNumbers(scope) {
  const nums = new Set([scope.total, f.total_tasks, f.current_week, f.total_weeks,
    ...Object.values(scope.status_counts), ...Object.values(f.status_counts),
    scope.context_ids.carried_over.length, scope.context_ids.blocked_elsewhere.length,
    scope.context_ids.due_soon_elsewhere.length, f.upcoming_milestones.length,
    scope.overdue_ids.length, scope.blocked_ids.length, scope.due_soon_ids.length,
    f.overdue_tasks.length, f.blocked_tasks.length, f.due_soon_tasks.length,
    Number(cfg.dueSoonDays), Number(cfg.upcomingWindowDays)]);
  const pcts = new Set([scope.completion_pct, f.completion_pct]);
  for (const id of scope.allowed_task_ids) {
    const t = byId.get(id);
    nums.add(Math.abs(t.days_until_due));
    for (const m of `${t.task_name} ${t.description}`.matchAll(/(\d+)(%?)/g)) (m[2] ? pcts : nums).add(Number(m[1]));
  }
  for (const m of kb.project.description.matchAll(/(\d+)%/g)) pcts.add(Number(m[1]));
  const dates = new Set([f.as_of_date, ...scope.allowed_task_ids.map((id) => byId.get(id).due_date),
    ...f.upcoming_milestones.map((m) => m.due_date)]);
  return { nums, pcts, dates };
}

// Dates in the narrative ("2026-04-26", "April 26, 2026", "26 April") must be real dates from the data.
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH = '(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?';
const DATE_PATTERNS = [
  [/\b(\d{4})-(\d{2})-(\d{2})\b/g, (m) => [m[1], m[2], m[3]]],
  [new RegExp(`\\b${MONTH}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?`, 'gi'), (m) => [m[3], MONTHS.indexOf(m[1].toLowerCase()) + 1, m[2]]],
  [new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH}(?:,?\\s+(\\d{4}))?`, 'gi'), (m) => [m[3], MONTHS.indexOf(m[2].toLowerCase()) + 1, m[1]]],
];
function extractDates(text) {
  const found = [];
  let rest = text;
  for (const [re, parts] of DATE_PATTERNS) {
    rest = rest.replace(re, (...m) => {
      const [y, mo, d] = parts(m);
      found.push({ raw: m[0], iso: `${y ?? f.as_of_date.slice(0, 4)}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}` });
      return ' ';
    });
  }
  return { found, rest };
}

// "X milestone" phrases must name a real milestone: the word right before "milestone" must occur in a
// milestone name, or be generic ("upcoming milestones", "the Phase 2 milestones").
const milestoneWords = new Set(kb.milestones.flatMap((m) => m.milestone.toLowerCase().split(/[^a-z0-9]+/)));
const GENERIC = new Set(['the', 'a', 'an', 'these', 'those', 'both', 'two', 'its', 'their', 'our', 'upcoming', 'next', 'key',
  'current', 'phase', 'project', 'related', 'linked', 'this', 'that', 'any', 'other', 'and', 'of', 'for', 'to', 'two', 'all']);
function inventedMilestones(text) {
  return [...text.matchAll(/((?:[A-Za-z0-9'-]+\s+){1,3})milestones?\b/gi)]
    .filter((m) => {
      const head = m[1].toLowerCase().trim().split(/\s+/).pop().replace(/'s$/, '');
      return !GENERIC.has(head) && !milestoneWords.has(head) && !/^\d+$/.test(head);
    })
    .map((m) => m[0].trim());
}

function groundingCheck(report, scope) {
  const allowed = new Set(scope.allowed_task_ids);
  const { nums, pcts, dates } = allowedNumbers(scope);
  const items = [
    { where: 'headline', text: report.headline, task_ids: [] },
    { where: 'summary', text: report.summary, task_ids: [] },
    ...['highlights', 'concerns', 'next_week_focus', 'decisions_needed']
      .flatMap((k) => report[k].map((x, i) => ({ where: `${k}[${i + 1}]`, ...x }))),
  ];
  const issues = [];
  let grounded = 0;
  for (const it of items) {
    const problems = [];
    const ids = [...new Set([...(it.text.match(/\bT\d{3}\b/g) ?? []), ...it.task_ids])];
    const outOfScope = ids.filter((id) => !allowed.has(id));
    if (outOfScope.length) problems.push(`task not in scope: ${outOfScope.join(', ')}`);
    inventedMilestones(it.text).forEach((m) => problems.push(`no such milestone: “${m}”`));
    const { found, rest } = extractDates(it.text);
    found.filter((d) => !dates.has(d.iso)).forEach((d) => problems.push(`unsupported date “${d.raw}”`));
    const stripped = rest.replace(/\bT\d{3}\b/g, ' ').replace(/\b(sprint|phase|week|q)\s*\d+/gi, ' ');
    for (const m of stripped.matchAll(/(\d+(?:\.\d+)?)\s*(%|percent)?/g)) {
      const n = Number(m[1]);
      if (m[2] ? !pcts.has(n) : !nums.has(n)) problems.push(`unsupported ${m[2] ? 'percentage' : 'number'} “${m[0].trim()}”`);
    }
    if (problems.length) issues.push(`${it.where}: ${problems.join(', ')}`);
    else grounded++;
  }
  return { checked: items.length, grounded, score: items.length ? grounded / items.length : 1, issues };
}

function taskTable(ids) {
  return ['| ID | Task | Owner | Priority | Sprint | Due | Timing |', '|---|---|---|---|---|---|---|',
    ...ids.map((id) => byId.get(id)).map((t) =>
      `| ${t.task_id} | ${cell(t.task_name)} | ${t.assignee} | ${t.priority} | ${t.sprint} | ${t.due_date} | ${timing(t)} |`)].join('\n');
}

const citedList = (items) => (items.length
  ? items.map((x) => `- ${x.text}${x.task_ids.length ? ` _(${x.task_ids.join(', ')})_` : ''}`).join('\n')
  : '- _None._');

function renderReport(report, scope, r, grounding) {
  const c = scope.status_counts;
  const progress = ['| Status | Tasks |', '|---|---|', ...STATUSES.map((s) => `| ${s} | ${c[s]} |`), `| **Total** | **${scope.total}** |`].join('\n');
  const byStatus = STATUSES.filter((s) => c[s] > 0).map((s) =>
    `### ${s} (${c[s]})\n\n${taskTable(scope.task_ids.filter((id) => byId.get(id).status === s))}`);
  const ctx = scope.context_ids;
  const context = [
    ctx.carried_over.length ? `**Carried over from earlier sprints (not done)**\n\n${taskTable(ctx.carried_over)}` : null,
    ctx.blocked_elsewhere.length ? `**Blocked outside this scope**\n\n${taskTable(ctx.blocked_elsewhere)}` : null,
    ctx.due_soon_elsewhere.length ? `**Due within ${cfg.dueSoonDays} days outside this scope**\n\n${taskTable(ctx.due_soon_elsewhere)}` : null,
  ].filter(Boolean);
  return [
    `# Weekly Status Report — ${scope.label}`,
    `_Generated by Mira · as of ${f.as_of_date} (week ${f.current_week} of ${f.total_weeks}, ${f.current_phase}) · Source: sample_task_board.csv_`,
    `**Overall status: ${RAG_ICON[r.level]} ${r.level}** — ${r.reasons.join('; ')}`,
    `**${report.headline}**`,
    '## Summary', report.summary,
    '## Progress',
    `${progress}\n\nCompletion: **${scope.completion_pct}%** (${c.Done} of ${scope.total} done)` +
      (scope.type === 'sprint' ? ` · Whole project: ${f.completion_pct}% (${f.status_counts.Done} of ${f.total_tasks} done)` : ''),
    '## Tasks by status', ...byStatus,
    ...(context.length ? ['## Watch list', ...context] : []),
    '## Highlights', citedList(report.highlights),
    '## Concerns & blockers', citedList(report.concerns),
    '## Focus for next week', citedList(report.next_week_focus),
    '## Decisions / escalations needed', citedList(report.decisions_needed),
    '---',
    `Grounding check: ${grounding.grounded}/${grounding.checked} narrative items verified (task IDs in scope, numbers match the task board)` +
      (grounding.issues.length ? `\n${grounding.issues.map((i) => `- ⚠ ${i}`).join('\n')}` : ' ✅'),
  ].join('\n\n');
}

function renderNoData(nd, req) {
  const notFound = req.scope && !req.scope.found ? `${req.scope.label} has no tasks on the task board. ` : '';
  return [
    '## No task data available',
    `${notFound}I can't produce a status report from the request alone – there are no task statuses, owners or due dates to report on.`,
    nd.message,
    '**To generate the report, please provide**', list(nd.what_to_provide),
    '_No task statuses, counts or progress percentages were generated._',
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

  let markdown, grounding = null, r = null;
  const status = output?.status ?? 'ERROR';
  const scope = req.scope;
  if (!output) {
    markdown = `⚠ Status Reporter returned unparseable output (${parseError}).\n\n${content}`;
  } else if (status === 'REPORT' && output.report && scope?.found) {
    grounding = groundingCheck(output.report, scope);
    r = rag(scope);
    markdown = renderReport(output.report, scope, r, grounding);
  } else {
    markdown = renderNoData(output.no_data ?? { message: 'No task data was provided.', what_to_provide: [] }, req);
  }

  // Model latency from OpenAI's header gives accurate per-call timing even when items run in sequence.
  const latencyMs = Number(headers['openai-processing-ms']) || (Date.parse(finishedAt) - Date.parse(req.started_at));
  const llmEnd = new Date(Date.parse(req.started_at) + latencyMs).toISOString();
  const usage = body.usage ?? {};
  const counts = grounding ? STATUSES.map((s) => `${s} ${scope.status_counts[s]}`).join(' · ') : null;

  return {
    json: {
      test_id: req.test_id,
      query: req.query,
      checks: req.checks,
      agent: req.agent,
      status,
      uses_project_data: req.uses_project_data,
      scope: grounding ? scope.label : null,
      counts,
      rag: r?.level ?? null,
      grounding,
      markdown,
      usage: { input_tokens: usage.prompt_tokens ?? 0, output_tokens: usage.completion_tokens ?? 0, total_tokens: usage.total_tokens ?? 0 },
      trace: {
        name: 'Mira',
        start_time: req.started_at,
        end_time: finishedAt,
        inputs: { query: req.query },
        outputs: { status, response: markdown },
        tags: ['mira', 'status', req.test_id].filter(Boolean),
        metadata: { test_id: req.test_id, agent: req.agent, status, scope: scope?.label ?? null, uses_project_data: req.uses_project_data, groundedness: grounding?.score ?? null, as_of_date: f.as_of_date },
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
            inputs: { status, scope: scope?.label ?? null },
            outputs: grounding ? { ...grounding, rag: r, counts } : { skipped: 'no report generated' },
          },
        ],
      },
    },
  };
});
