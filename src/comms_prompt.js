// Stakeholder Comms – drafts a stakeholder update email for a sprint (or the whole project).
// Code fixes the scope and every number; the model may cite only in-scope task IDs (enum), so
// tasks from other sprints cannot leak into the email.

const cfg = $('Config').first().json;
const kb = $('Knowledge Base').first().json;
const f = kb.facts;
const STATUSES = ['Done', 'In Progress', 'Blocked', 'To Do'];

const SYSTEM_PROMPT = `ROLE
You are the Stakeholder Comms agent inside Mira, a project intelligence assistant for PMs/TPMs at Nexora. You draft concise, professional stakeholder update emails from facts that have already been computed for you.

INPUT
- USER REQUEST and UPDATE DATA: <scope>, <facts> (counts and completion already computed), <tasks_in_scope>, <related_milestones>.

RULES (hallucination guardrails)
- Write ONLY about the tasks in <tasks_in_scope>. Never mention tasks, plans or work from other sprints, and do not preview future sprints.
- Every bullet must cite the task_ids it is about. Code prints the exact task name in front of each bullet, so the bullet text is only the update itself (e.g. "completed on schedule; findings feed the gap analysis report") – do not repeat or paraphrase the task name. Never invent tasks, owners, dates or results.
- Do not state a number, percentage or date unless it appears in UPDATE DATA.
- Each milestone in <related_milestones> is separate – name it exactly as listed and never merge two into one (e.g. not "the gap analysis report due for the systems audit").
- The board has statuses and due dates only – no completion dates and no results. Never say a task finished "on schedule", "on time" or "early", and never state outcomes as fact ("findings will improve X"); say what is done, in progress or overdue.
- Tone: professional, clear, non-technical, honest about slippage – no hype. Short paragraphs and bullets.
- subject: specific, under 12 words, naming the scope.
- greeting_name: who the email is addressed to (from the request, else "team").
- opening: 1–2 sentences with the headline message.
- completed / in_progress / issues / next_steps: bullets, each citing task_ids. issues covers overdue or blocked work and its impact on related milestones; empty array if none. next_steps covers only the remaining in-scope work.
- asks: decisions or support needed from stakeholders; empty array if none.
- closing: one sentence.

OUTPUT
Return JSON matching the provided schema.`;

const sprintNo = (s) => Number(String(s).replace(/\D/g, ''));
const overdueIds = new Set(f.overdue_tasks.map((t) => t.task_id));
const toMs = (s) => Date.parse(`${s}T00:00:00Z`);

function resolveScope(q, sprint) {
  if (sprint) return `Sprint ${sprint}`;
  const m = q.match(/sprint\s*(\d+)/i);
  return m ? `Sprint ${m[1]}` : null;
}

function buildScope(sprint) {
  const inScope = sprint ? kb.tasks.filter((t) => t.sprint === sprint) : kb.tasks;
  const c = Object.fromEntries(STATUSES.map((s) => [s, inScope.filter((t) => t.status === s).length]));
  const dues = inScope.map((t) => t.due_date).sort();
  // Milestones whose phase overlaps the scope's due dates.
  const phases = kb.timeline.filter((p) => inScope.some((t) => toMs(t.due_date) >= toMs(p.start_date) && toMs(t.due_date) <= toMs(p.end_date)));
  const milestones = kb.milestones.filter((m) => phases.some((p) => p.phase === m.phase));
  const ids = new Set(inScope.map((t) => t.task_id));
  return {
    label: sprint ?? 'Whole project',
    sprint,
    task_ids: inScope.map((t) => t.task_id),
    status_counts: c,
    total: inScope.length,
    completion_pct: inScope.length ? Math.round((c.Done / inScope.length) * 100) : 0,
    overdue_ids: inScope.filter((t) => overdueIds.has(t.task_id)).map((t) => t.task_id),
    period: dues.length ? `${dues[0]} to ${dues[dues.length - 1]}` : null,
    milestones,
    out_of_scope_names: kb.tasks.filter((t) => !ids.has(t.task_id)).map((t) => t.task_name),
    found: inScope.length > 0,
  };
}

function updateBlock(s) {
  const byId = new Map(kb.tasks.map((t) => [t.task_id, t]));
  const rows = s.task_ids.map((id) => byId.get(id)).map((t) =>
    `${t.task_id} | ${t.task_name} | ${t.status} | ${t.assignee} | due ${t.due_date}${overdueIds.has(t.task_id) ? ` | OVERDUE by ${-t.days_until_due}d` : ''} | ${t.description}`).join('\n');
  const ms = s.milestones.map((m) => `${m.milestone} (Phase ${m.phase}: ${m.phase_name}, due ${m.due_date})`).join('; ') || 'none';
  return `UPDATE DATA – ${kb.project.name}\n` +
    `<scope>\n${s.label}${s.period ? ` (tasks due ${s.period})` : ''} · as of ${f.as_of_date}\n</scope>\n` +
    `<facts>\nTasks in scope: ${s.total}\n${STATUSES.map((st) => `${st}: ${s.status_counts[st]}`).join('\n')}\n` +
    `Completion: ${s.completion_pct}%\nOverdue: ${s.overdue_ids.length}${s.overdue_ids.length ? ` (${s.overdue_ids.join(', ')})` : ''}\n</facts>\n` +
    `<tasks_in_scope>\nTask | Name | Status | Owner | Due | Flags | Description\n${rows}\n</tasks_in_scope>\n` +
    `<related_milestones>\n${ms}\n</related_milestones>`;
}

function responseFormat(ids) {
  const cited = {
    type: 'array',
    items: {
      type: 'object', additionalProperties: false, required: ['text', 'task_ids'],
      properties: { text: { type: 'string' }, task_ids: { type: 'array', items: { type: 'string', enum: ids } } },
    },
  };
  return {
    type: 'json_schema',
    json_schema: {
      name: 'comms_output',
      strict: true,
      schema: {
        type: 'object', additionalProperties: false,
        required: ['subject', 'greeting_name', 'opening', 'completed', 'in_progress', 'issues', 'next_steps', 'asks', 'closing'],
        properties: {
          subject: { type: 'string' }, greeting_name: { type: 'string' }, opening: { type: 'string' },
          completed: cited, in_progress: cited, issues: cited, next_steps: cited, asks: cited,
          closing: { type: 'string' },
        },
      },
    },
  };
}

return $input.all().map(({ json: req }) => {
  const scope = buildScope(resolveScope(req.query, req.sprint));
  return {
    json: {
      ...req,
      agent: 'Stakeholder Comms',
      uses_project_data: scope.found,
      scope,
      started_at: new Date().toISOString(),
      openaiRequest: {
        model: cfg.model,
        temperature: Number(cfg.temperature),
        max_tokens: 1200,
        response_format: responseFormat(scope.found ? scope.task_ids : kb.tasks.map((t) => t.task_id)),
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `USER REQUEST:\n${req.query}\n\n${scope.found ? updateBlock(scope) : 'UPDATE DATA: none – the requested sprint has no tasks.'}` },
        ],
      },
    },
  };
});
