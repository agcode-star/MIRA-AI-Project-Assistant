// Milestone Tracker – computes, in code, the milestones due in the window, links each milestone to
// the tasks due inside its phase, and classifies every open task's deadline risk. The model only
// writes the narrative and recommended actions, citing flagged task IDs (enum-constrained).

const cfg = $('Config').first().json;
const kb = $('Knowledge Base').first().json;
const f = kb.facts;
const DAY = 86400000;
const toMs = (s) => Date.parse(`${s}T00:00:00Z`);
const asOf = toMs(f.as_of_date);
const dueSoonDays = Number(cfg.dueSoonDays);

const SYSTEM_PROMPT = `ROLE
You are the Milestone Tracker inside Mira, a project intelligence assistant for PMs/TPMs at Nexora. You explain upcoming milestones and deadline risks from facts that have already been computed for you, and recommend concrete actions.

INPUT
- USER REQUEST and TRACKER DATA: <window>, <milestones_in_window> (with linked tasks and status), <next_milestones>, <flagged_tasks> (blocked, overdue, at risk, due soon – with the reason).

RULES (hallucination guardrails)
- The milestone and task tables are rendered by code. Mention only milestones and tasks that appear in TRACKER DATA, with their names exactly as given. Never invent milestones, dates or tasks.
- Do not state a number or date unless it appears in TRACKER DATA.
- headline: one sentence answering the PM's question directly.
- summary: 2–3 sentences: what is coming up, what threatens it, and how serious it is.
- actions: 2–5 concrete actions (owner + what to do), each citing the task_ids it addresses. Address every Blocked and Overdue task.
- escalations: decisions or help the PM must ask for (e.g. resourcing a blocked task). Empty array if none.

OUTPUT
Return JSON matching the provided schema.`;

const byId = new Map(kb.tasks.map((t) => [t.task_id, t]));
const overdueIds = new Set(f.overdue_tasks.map((t) => t.task_id));

// Deadline risk for every open task, from fixed rules.
function taskRisk(t) {
  if (t.status === 'Done') return null;
  if (t.status === 'Blocked') return { level: 'Blocked', reason: `blocked – ${t.description.split('BLOCKED:')[1]?.trim() ?? 'see description'}` };
  if (overdueIds.has(t.task_id)) return { level: 'Overdue', reason: `${-t.days_until_due}d past due and still ${t.status}` };
  if (t.days_until_due <= dueSoonDays && t.status === 'To Do') return { level: 'At risk', reason: `due in ${t.days_until_due}d and not started` };
  if (t.days_until_due <= dueSoonDays) return { level: 'Due soon', reason: `due in ${t.days_until_due}d, in progress` };
  return null;
}

function buildTracker(windowDays) {
  const windowEnd = asOf + windowDays * DAY;
  const flagged = kb.tasks.map((t) => ({ t, risk: taskRisk(t) })).filter((x) => x.risk)
    .map(({ t, risk }) => ({ task_id: t.task_id, task_name: t.task_name, assignee: t.assignee, priority: t.priority,
      sprint: t.sprint, status: t.status, due_date: t.due_date, days_until_due: t.days_until_due, risk: risk.level, reason: risk.reason }));
  const flaggedIds = new Set(flagged.map((x) => x.task_id));

  // A milestone is linked to the tasks due inside its phase; it is at risk if any of them is overdue or blocked.
  const phaseOf = new Map(kb.timeline.map((p) => [p.phase, p]));
  const enrich = (m) => {
    const p = phaseOf.get(m.phase);
    const linked = kb.tasks.filter((t) => toMs(t.due_date) >= toMs(p.start_date) && toMs(t.due_date) <= toMs(p.end_date));
    const threats = linked.filter((t) => t.status === 'Blocked' || overdueIds.has(t.task_id));
    const open = linked.filter((t) => t.status !== 'Done');
    return {
      ...m,
      linked_task_ids: linked.map((t) => t.task_id),
      status: !linked.length ? 'No linked tasks' : threats.length ? 'At risk' : open.length ? 'In progress' : 'Tasks done',
      threat_ids: threats.map((t) => t.task_id),
    };
  };
  const inWindow = kb.milestones.filter((m) => m.days_from_as_of >= 0 && toMs(m.due_date) <= windowEnd).map(enrich);
  const next = kb.milestones.filter((m) => toMs(m.due_date) > windowEnd).slice(0, 2).map(enrich);
  const linkedIds = [...inWindow, ...next].flatMap((m) => m.linked_task_ids);
  return {
    window_days: windowDays,
    window: `${f.as_of_date} to ${new Date(windowEnd).toISOString().slice(0, 10)}`,
    milestones_in_window: inWindow,
    next_milestones: next,
    flagged,
    allowed_task_ids: [...new Set([...flaggedIds, ...linkedIds])],
  };
}

function trackerBlock(tr) {
  const ms = (list) => (list.length ? list.map((m) =>
    `${m.milestone} | Phase ${m.phase}: ${m.phase_name} | due ${m.due_date} (in ${m.days_from_as_of}d) | ${m.status}` +
    ` | linked tasks: ${m.linked_task_ids.map((id) => `${id} ${byId.get(id).task_name} (${byId.get(id).status})`).join('; ') || 'none'}`).join('\n') : 'none');
  const tasks = tr.flagged.map((x) => `${x.task_id} | ${x.task_name} | ${x.assignee} | ${x.priority} | ${x.status} | due ${x.due_date} | ${x.risk}: ${x.reason}`).join('\n') || 'none';
  return `TRACKER DATA – ${kb.project.name}\n` +
    `<window>\nAs of ${f.as_of_date} (week ${f.current_week}, ${f.current_phase}); milestone window ${tr.window_days} days: ${tr.window}; task due-soon window ${dueSoonDays} days\n</window>\n` +
    `<milestones_in_window>\n${ms(tr.milestones_in_window)}\n</milestones_in_window>\n` +
    `<next_milestones>\n${ms(tr.next_milestones)}\n</next_milestones>\n` +
    `<flagged_tasks>\nTask | Name | Owner | Priority | Status | Due | Risk\n${tasks}\n</flagged_tasks>`;
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
      name: 'milestone_output',
      strict: true,
      schema: {
        type: 'object', additionalProperties: false, required: ['headline', 'summary', 'actions', 'escalations'],
        properties: { headline: { type: 'string' }, summary: { type: 'string' }, actions: cited, escalations: cited },
      },
    },
  };
}

return $input.all().map(({ json: req }) => {
  const tracker = buildTracker(Number(req.window_days) || Number(cfg.upcomingWindowDays));
  const ids = tracker.allowed_task_ids.length ? tracker.allowed_task_ids : kb.tasks.map((t) => t.task_id);
  return {
    json: {
      ...req,
      agent: 'Milestone Tracker',
      uses_project_data: true,
      tracker,
      started_at: new Date().toISOString(),
      openaiRequest: {
        model: cfg.model,
        temperature: Number(cfg.temperature),
        max_tokens: 1200,
        response_format: responseFormat(ids),
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `USER REQUEST:\n${req.query}\n\n${trackerBlock(tracker)}` },
        ],
      },
    },
  };
});
