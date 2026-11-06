// Status Reporter – resolves the report scope (a sprint or the whole project) in code, computes
// every number for that scope, and builds the OpenAI request. The model only writes the narrative
// and may cite only task IDs that are in scope (enum-constrained per request).

const cfg = $('Config').first().json;
const kb = $('Knowledge Base').first().json;
const f = kb.facts;
const STATUSES = ['Done', 'In Progress', 'Blocked', 'To Do'];

const SYSTEM_PROMPT = `ROLE
You are the Status Reporter inside Mira, a project intelligence assistant for PMs/TPMs at Nexora. You write the narrative of a weekly status report from task-board facts that have already been computed for you, and you refuse to report when there is no task data.

INPUT
- USER REQUEST: what the PM asked for.
- TASK DATA (optional): <scope> (what the report covers), <facts> (counts and completion already computed), <tasks_in_scope>, and <context> (carried-over, blocked and due-soon tasks, upcoming milestones). If TASK DATA is absent, the only information you have is the USER REQUEST text.

DECISION – choose exactly one status
1. TASK DATA is absent → status "NO_DATA". A sentence like "things are going fine" is not task data. Never produce statuses, counts, percentages or task names.
2. TASK DATA is present → status "REPORT".

RULES FOR A REPORT (hallucination guardrails)
- The counts, completion percentage, task tables and RAG status are rendered by code. Do not restate a number unless it appears in <facts>; never estimate or round progress.
- Only call a task overdue, blocked or due soon if <facts> or its Flags say so. A Done task is never overdue. Never generalise ("all tasks are overdue") – name the tasks.
- The only milestones are those listed under "Upcoming milestones" in <context>. A task is not a milestone – never invent one (e.g. "security review milestone").
- Refer to tasks by ID and name exactly as given (e.g. "T007 Shortlist AI use cases"). Never mention a task that is not in TASK DATA.
- headline: one sentence capturing the state of the scope (e.g. what is on track and what needs attention).
- summary: 2–3 sentences for a PM audience.
- highlights: progress worth reporting (done or advancing tasks). Each item cites the task_ids it is about.
- concerns: overdue, blocked or due-soon work and why it matters (link to upcoming milestones where relevant). Each item cites task_ids.
- next_week_focus: the 2–4 most important things to move next, each citing task_ids.
- decisions_needed: escalations or decisions the PM should raise (e.g. unblocking a blocked task). Empty array if none.

RULES FOR NO_DATA
- Set report to null.
- message: one sentence stating that no task data is available, so no status can be reported.
- what_to_provide: the information needed – e.g. task list with statuses, owners, due dates, sprint or reporting period, blockers, and milestones.

OUTPUT
Return JSON matching the provided schema. Unused branch must be null.`;

// The Orchestrator decides this (uses_project_on_file); the regex is the fallback for the standalone step workflows.
const usesTaskBoard = (q) => /task board|task data|tasks|sprint\s*\d|project status|ABCDE|AI Adoption/i.test(q);

const sprintNo = (s) => Number(String(s).replace(/\D/g, ''));
function resolveScope(q, sprint) {
  if (sprint) return { type: 'sprint', sprint: `Sprint ${sprint}` };
  const m = q.match(/sprint\s*(\d+)/i);
  if (m) return { type: 'sprint', sprint: `Sprint ${m[1]}` };
  if (/this sprint|current sprint|weekly/i.test(q)) return { type: 'sprint', sprint: f.current_sprint };
  return { type: 'project', sprint: null };
}

const counts = (ts) => Object.fromEntries(STATUSES.map((s) => [s, ts.filter((t) => t.status === s).length]));
const overdueIds = new Set(f.overdue_tasks.map((t) => t.task_id));
const line = (t) => `${t.task_id} | ${t.task_name} | ${t.status} | ${t.assignee} | ${t.priority} | ${t.sprint} | due ${t.due_date} (${t.days_until_due >= 0 ? `in ${t.days_until_due}d` : `${-t.days_until_due}d late`})${overdueIds.has(t.task_id) ? ' | OVERDUE' : ''} | ${t.description}`;

// Every number the report may contain is computed here.
function buildScope(scope) {
  const inScope = scope.type === 'sprint' ? kb.tasks.filter((t) => t.sprint === scope.sprint) : kb.tasks;
  const c = counts(inScope);
  const carriedOver = scope.type === 'sprint'
    ? kb.tasks.filter((t) => t.status !== 'Done' && sprintNo(t.sprint) < sprintNo(scope.sprint)) : [];
  const ids = new Set(inScope.map((t) => t.task_id));
  const outside = (ts) => ts.filter((t) => !ids.has(t.task_id));
  const context = {
    carried_over: carriedOver,
    blocked_elsewhere: outside(kb.tasks.filter((t) => t.status === 'Blocked')),
    due_soon_elsewhere: outside(kb.tasks.filter((t) => f.due_soon_tasks.some((d) => d.task_id === t.task_id))),
  };
  const allowed = [...new Set([...inScope, ...context.carried_over, ...context.blocked_elsewhere, ...context.due_soon_elsewhere].map((t) => t.task_id))];
  const flagged = (pred) => inScope.filter(pred).map((t) => t.task_id);
  return {
    label: scope.type === 'sprint' ? scope.sprint : 'Whole project',
    type: scope.type,
    sprint: scope.sprint,
    task_ids: inScope.map((t) => t.task_id),
    status_counts: c,
    total: inScope.length,
    completion_pct: inScope.length ? Math.round((c.Done / inScope.length) * 100) : 0,
    overdue_ids: flagged((t) => overdueIds.has(t.task_id)),
    blocked_ids: flagged((t) => t.status === 'Blocked'),
    due_soon_ids: flagged((t) => f.due_soon_tasks.some((d) => d.task_id === t.task_id)),
    context_ids: {
      carried_over: context.carried_over.map((t) => t.task_id),
      blocked_elsewhere: context.blocked_elsewhere.map((t) => t.task_id),
      due_soon_elsewhere: context.due_soon_elsewhere.map((t) => t.task_id),
    },
    allowed_task_ids: allowed,
    found: inScope.length > 0,
  };
}

const flags = (ids) => (ids.length ? `${ids.length} (${ids.join(', ')})` : '0');

function taskDataBlock(s) {
  const byId = new Map(kb.tasks.map((t) => [t.task_id, t]));
  const rows = (ids) => (ids.length ? ids.map((id) => line(byId.get(id))).join('\n') : 'none');
  // A milestone's linked tasks are those due inside its phase (same rule as the Milestone Tracker),
  // so any task→milestone dependency the narrative states is backed by data.
  const phaseOf = new Map(kb.timeline.map((p) => [p.phase, p]));
  const linked = (m) => kb.tasks.filter((t) => t.due_date >= phaseOf.get(m.phase).start_date && t.due_date <= phaseOf.get(m.phase).end_date)
    .map((t) => `${t.task_id} ${t.status}`).join(', ') || 'none';
  const ms = f.upcoming_milestones.map((m) => `\n- ${m.milestone} (Phase ${m.phase}, due ${m.due_date}; linked tasks: ${linked(m)})`).join('') || ' none';
  return `TASK DATA – ${kb.project.name}\n` +
    `<scope>\n${s.label} · as of ${f.as_of_date} (week ${f.current_week} of ${f.total_weeks}, ${f.current_phase}; current sprint ${f.current_sprint})\n</scope>\n` +
    `<facts>\nTasks in scope: ${s.total}\n${STATUSES.map((st) => `${st}: ${s.status_counts[st]}`).join('\n')}\nCompletion: ${s.completion_pct}%\n` +
    `Overdue in scope: ${flags(s.overdue_ids)}\nBlocked in scope: ${flags(s.blocked_ids)}\n` +
    `Due within ${cfg.dueSoonDays} days in scope: ${flags(s.due_soon_ids)}\n</facts>\n` +
    `<tasks_in_scope>\nTask | Name | Status | Assignee | Priority | Sprint | Due | Flags | Description\n${rows(s.task_ids)}\n</tasks_in_scope>\n` +
    `<context>\nCarried over from earlier sprints (not done): \n${rows(s.context_ids.carried_over)}\n` +
    `Blocked outside scope: \n${rows(s.context_ids.blocked_elsewhere)}\n` +
    `Due within ${cfg.dueSoonDays} days outside scope: \n${rows(s.context_ids.due_soon_elsewhere)}\n` +
    `Upcoming milestones (${f.upcoming_window}) – the ONLY milestones; use their exact names:${ms}\n</context>`;
}

function responseFormat(allowedIds) {
  const strings = { type: 'array', items: { type: 'string' } };
  const cited = {
    type: 'array',
    items: {
      type: 'object', additionalProperties: false, required: ['text', 'task_ids'],
      properties: { text: { type: 'string' }, task_ids: { type: 'array', items: { type: 'string', enum: allowedIds } } },
    },
  };
  return {
    type: 'json_schema',
    json_schema: {
      name: 'status_output',
      strict: true,
      schema: {
        type: 'object', additionalProperties: false, required: ['status', 'no_data', 'report'],
        properties: {
          status: { type: 'string', enum: ['REPORT', 'NO_DATA'] },
          no_data: {
            anyOf: [{ type: 'null' }, {
              type: 'object', additionalProperties: false, required: ['message', 'what_to_provide'],
              properties: { message: { type: 'string' }, what_to_provide: strings },
            }],
          },
          report: {
            anyOf: [{ type: 'null' }, {
              type: 'object', additionalProperties: false,
              required: ['headline', 'summary', 'highlights', 'concerns', 'next_week_focus', 'decisions_needed'],
              properties: {
                headline: { type: 'string' }, summary: { type: 'string' },
                highlights: cited, concerns: cited, next_week_focus: cited, decisions_needed: cited,
              },
            }],
          },
        },
      },
    },
  };
}

return $input.all().map(({ json: req }) => {
  const scope = (req.uses_project_on_file ?? usesTaskBoard(req.query)) ? buildScope(resolveScope(req.query, req.sprint)) : null;
  const hasData = Boolean(scope?.found);
  const userContent = `USER REQUEST:\n${req.query}\n\n` +
    (hasData ? taskDataBlock(scope) : 'TASK DATA: none provided.');
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userContent },
  ];
  return {
    json: {
      ...req,
      agent: 'Status Reporter',
      uses_project_data: hasData,
      scope,
      started_at: new Date().toISOString(),
      openaiRequest: {
        model: cfg.model,
        temperature: Number(cfg.temperature),
        max_tokens: Number(cfg.maxTokens),
        response_format: responseFormat(hasData ? scope.allowed_task_ids : kb.tasks.map((t) => t.task_id)),
        messages,
      },
    },
  };
});
