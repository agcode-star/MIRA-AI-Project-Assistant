// Stakeholder Comms – assembles the email (the "at a glance" line comes from code), verifies that
// no out-of-scope task, number or date slipped in, and describes the LangSmith trace.

const kb = $('Knowledge Base').first().json;
const requests = $('Stakeholder Comms: Build Prompt').all();
const f = kb.facts;
const byId = new Map(kb.tasks.map((t) => [t.task_id, t]));

// Exact task names come from the board via task_ids, so the email always names the real tasks.
const bullets = (items) => items.map((x) => {
  const names = x.task_ids.map((id) => byId.get(id)?.task_name).filter(Boolean);
  return `- ${names.length ? `**${names.join(', ')}** – ` : ''}${x.text}`;
}).join('\n');
const section = (title, items) => (items.length ? `**${title}**\n\n${bullets(items)}` : null);

function allowedFacts(s) {
  const nums = new Set([s.total, s.completion_pct, s.overdue_ids.length, ...Object.values(s.status_counts),
    ...s.task_ids.map((id) => Math.abs(byId.get(id).days_until_due)), ...s.milestones.map((m) => m.phase)]);
  for (const id of s.task_ids) for (const m of `${byId.get(id).task_name} ${byId.get(id).description}`.matchAll(/\d+/g)) nums.add(Number(m[0]));
  if (s.sprint) nums.add(Number(s.sprint.replace(/\D/g, '')));
  const dates = new Set([f.as_of_date, ...s.task_ids.map((id) => byId.get(id).due_date), ...s.milestones.map((m) => m.due_date)]);
  return { ids: new Set(s.task_ids), nums, pcts: new Set([s.completion_pct]), dates, forbiddenNames: s.out_of_scope_names };
}

return $input.all().map((item, i) => {
  const req = requests[i].json;
  const s = req.scope;
  const body = item.json.body ?? item.json;
  const headers = item.json.headers ?? {};
  const finishedAt = new Date().toISOString();

  let e = null, parseError = null;
  try { e = JSON.parse(body.choices?.[0]?.message?.content ?? ''); } catch (err) { parseError = err.message; }

  let markdown, grounding = null, status;
  if (!s.found) {
    status = 'NO_DATA';
    markdown = `## No tasks found for ${s.label}\n\nThe task board has no tasks in ${s.label}, so there is nothing to report to stakeholders. Please check the sprint number.`;
  } else if (!e) {
    status = 'ERROR';
    markdown = `⚠ Stakeholder Comms returned unparseable output (${parseError}).`;
  } else {
    status = 'EMAIL';
    const items = [
      { where: 'subject', text: e.subject }, { where: 'opening', text: e.opening }, { where: 'closing', text: e.closing },
      ...['completed', 'in_progress', 'issues', 'next_steps', 'asks'].flatMap((k) => e[k].map((x, n) => ({ where: `${k}[${n + 1}]`, ...x }))),
    ];
    grounding = checkNarrative(items, allowedFacts(s), f.as_of_date.slice(0, 4));
    const c = s.status_counts;
    const glance = `${c.Done} of ${s.total} tasks done (${s.completion_pct}%)` +
      (c['In Progress'] ? ` · ${c['In Progress']} in progress` : '') + (c.Blocked ? ` · ${c.Blocked} blocked` : '') +
      (c['To Do'] ? ` · ${c['To Do']} not started` : '') +
      (s.overdue_ids.length ? ` · overdue: ${s.overdue_ids.map((id) => `${byId.get(id).task_name} (${-byId.get(id).days_until_due}d)`).join(', ')}` : '');
    markdown = [
      `**To:** ${e.greeting_name === 'team' ? 'Project stakeholders' : e.greeting_name}  \n**Subject:** ${e.subject}`,
      '---',
      `Hi ${e.greeting_name},`,
      e.opening,
      `**${s.label} at a glance:** ${glance}`,
      section('Completed', e.completed),
      section('In progress', e.in_progress),
      section('Issues & impact', e.issues),
      section('Next steps', e.next_steps),
      section('Support needed', e.asks),
      e.closing,
      'Best regards,  \n[Your name]',
      '---',
      `_Drafted by Mira from sample_task_board.csv · as of ${f.as_of_date} · scope: ${s.label} only._  \n` +
        `Grounding check: ${grounding.grounded}/${grounding.checked} email parts verified (only ${s.label} tasks, numbers and dates match the data)` +
        (grounding.issues.length ? `\n${grounding.issues.map((x) => `- ⚠ ${x}`).join('\n')}` : ' ✅'),
    ].filter(Boolean).join('\n\n');
  }

  const latencyMs = Number(headers['openai-processing-ms']) || (Date.parse(finishedAt) - Date.parse(req.started_at));
  const llmEnd = new Date(Date.parse(req.started_at) + latencyMs).toISOString();
  const usage = body.usage ?? {};

  return {
    json: {
      test_id: req.test_id,
      query: req.query,
      checks: req.checks,
      agent: req.agent,
      status,
      uses_project_data: s.found,
      scope: s.label,
      grounding,
      markdown,
      usage: { input_tokens: usage.prompt_tokens ?? 0, output_tokens: usage.completion_tokens ?? 0, total_tokens: usage.total_tokens ?? 0 },
      trace: {
        name: 'Mira',
        start_time: req.started_at,
        end_time: finishedAt,
        inputs: { query: req.query },
        outputs: { status, response: markdown },
        tags: ['mira', 'comms', req.test_id].filter(Boolean),
        metadata: { test_id: req.test_id, agent: req.agent, scope: s.label, groundedness: grounding?.score ?? null, as_of_date: f.as_of_date },
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
            inputs: { scope: s.label },
            outputs: grounding ?? { skipped: status },
          },
        ],
      },
    },
  };
});
