// Mira Knowledge Base: embedded project data + deterministic FACTS.
// Code computes counts, filters and dates so the LLM agents never have to.
// To use another project, replace the four data blocks below.

const cfg = $('Config').first().json;

// ---------- Embedded project data (generated from Resources/) ----------
const PROJECT_NAME = 'AI Adoption Project – ABCDE Ltd.';
const PROJECT_DESCRIPTION = `__PROJECT_DESCRIPTION__`;
const TIMELINE_CSV = `__TIMELINE_CSV__`;
const RISKS_CSV = `__RISKS_CSV__`;
const TASKS_CSV = `__TASKS_CSV__`;

// ---------- Helpers ----------
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((v) => v.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((v) => v.trim() !== '')) rows.push(row);
  const [header, ...body] = rows;
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

const DAY = 86400000;
const toDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const fmt = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => new Date(d.getTime() + n * DAY);
const daysBetween = (a, b) => Math.round((b - a) / DAY);
const countBy = (arr, key) => arr.reduce((acc, x) => ({ ...acc, [x[key]]: (acc[x[key]] ?? 0) + 1 }), {});

const asOf = toDate(cfg.asOfDate);
const projectStart = toDate(cfg.projectStartDate);
const upcomingEnd = addDays(asOf, Number(cfg.upcomingWindowDays));
const dueSoonEnd = addDays(asOf, Number(cfg.dueSoonDays));
const STATUSES = ['Done', 'In Progress', 'Blocked', 'To Do'];

// ---------- Timeline: week numbers -> calendar dates ----------
const timeline = parseCsv(TIMELINE_CSV).map((p) => {
  const start = addDays(projectStart, (Number(p.start_week) - 1) * 7);
  const end = addDays(projectStart, Number(p.end_week) * 7 - 1);
  const status = end < asOf ? 'Completed (by schedule)' : start > asOf ? 'Upcoming' : 'Current';
  return {
    phase: Number(p.phase),
    phase_name: p.phase_name,
    start_week: Number(p.start_week),
    end_week: Number(p.end_week),
    start_date: fmt(start),
    end_date: fmt(end),
    schedule_status: status,
    key_activities: p.key_activities.split(';').map((s) => s.trim()).filter(Boolean),
    milestones: p.milestones_deliverables.split(';').map((s) => s.trim()).filter(Boolean),
  };
});

// Each milestone is due at the end of its phase.
const milestones = timeline.flatMap((p) => p.milestones.map((m) => ({
  milestone: m,
  phase: p.phase,
  phase_name: p.phase_name,
  due_week: p.end_week,
  due_date: p.end_date,
  days_from_as_of: daysBetween(asOf, toDate(p.end_date)),
})));

// ---------- Project outcome phrases ----------
// Short verbatim phrases from the description (goals, use cases, capabilities). Agents cite these
// from a fixed list instead of free-text quoting, so a citation can never be invented.
const LEAD = /^(and|or|including|include|includes|the company aims to|aims to|by leveraging|by|to|of|with|is embarking on an ai adoption initiative to|key goals include|this project will focus on|beginning with|followed by|will)\s+/i;
const outcomePhrases = [...new Set(PROJECT_DESCRIPTION.split('\n').slice(1).join(' ')
  .split(/[.;,]|\s+and\s+(?=[a-z]+ing\b|improv|reduc|lower|minim|uncov|drive|enhanc)/)
  .map((s) => { let t = s.trim(), prev; do { prev = t; t = t.replace(LEAD, ''); } while (t !== prev); return t; })
  .filter((s) => { const n = s.split(/\s+/).length; return n >= 2 && n <= 9 && !/ABCDE|^This|^The /.test(s); }))];
const USE_CASES = ['demand forecasting', 'route optimization', 'inventory management', 'customer support']
  .filter((u) => PROJECT_DESCRIPTION.toLowerCase().includes(u));

// ---------- Risks ----------
const risks = parseCsv(RISKS_CSV);

// ---------- Tasks ----------
const tasks = parseCsv(TASKS_CSV).map((t) => {
  const due = toDate(t.due_date);
  return { ...t, days_until_due: daysBetween(asOf, due) };
});
const open = (t) => t.status !== 'Done';

const statusCounts = Object.fromEntries(STATUSES.map((s) => [s, tasks.filter((t) => t.status === s).length]));
const unknownStatuses = tasks.filter((t) => !STATUSES.includes(t.status)).map((t) => `${t.task_id}: ${t.status}`);

const sprintNames = [...new Set(tasks.map((t) => t.sprint))]
  .sort((a, b) => Number(a.replace(/\D/g, '')) - Number(b.replace(/\D/g, '')));
const sprints = sprintNames.map((name) => {
  const ts = tasks.filter((t) => t.sprint === name);
  const dues = ts.map((t) => t.due_date).sort();
  return {
    sprint: name,
    first_due: dues[0],
    last_due: dues[dues.length - 1],
    task_count: ts.length,
    status_counts: Object.fromEntries(STATUSES.map((s) => [s, ts.filter((t) => t.status === s).length])),
    task_ids: ts.map((t) => t.task_id),
  };
});
// Current sprint = first sprint whose last due date has not passed.
const currentSprint = (sprints.find((s) => toDate(s.last_due) >= asOf) ?? sprints[sprints.length - 1]).sprint;

const brief = (t) => ({
  task_id: t.task_id, task_name: t.task_name, status: t.status, assignee: t.assignee,
  priority: t.priority, sprint: t.sprint, due_date: t.due_date, days_until_due: t.days_until_due,
});

const blocked = tasks.filter((t) => t.status === 'Blocked').map((t) => ({ ...brief(t), description: t.description }));
const overdue = tasks.filter((t) => open(t) && toDate(t.due_date) < asOf).map(brief);
const dueSoon = tasks.filter((t) => open(t) && t.status !== 'Blocked'
  && toDate(t.due_date) >= asOf && toDate(t.due_date) <= dueSoonEnd).map(brief);

const workload = Object.entries(countBy(tasks.filter(open), 'assignee'))
  .map(([assignee, open_tasks]) => ({
    assignee,
    open_tasks,
    open_high_priority: tasks.filter((t) => open(t) && t.assignee === assignee && t.priority === 'High').length,
    in_progress: tasks.filter((t) => t.status === 'In Progress' && t.assignee === assignee).map((t) => t.task_id),
  }))
  .sort((a, b) => b.open_tasks - a.open_tasks);

const currentWeek = Math.floor(daysBetween(projectStart, asOf) / 7) + 1;
const currentPhase = timeline.find((p) => p.schedule_status === 'Current') ?? null;

const facts = {
  as_of_date: fmt(asOf),
  project_start_date: fmt(projectStart),
  current_week: currentWeek,
  total_weeks: Math.max(...timeline.map((p) => p.end_week)),
  current_phase: currentPhase ? `Phase ${currentPhase.phase}: ${currentPhase.phase_name}` : 'None (outside timeline)',
  current_sprint: currentSprint,
  total_tasks: tasks.length,
  status_counts: statusCounts,
  completion_pct: Math.round((statusCounts.Done / tasks.length) * 100),
  blocked_tasks: blocked,
  overdue_tasks: overdue,
  due_soon_tasks: dueSoon,
  due_soon_window: `${fmt(asOf)} to ${fmt(dueSoonEnd)}`,
  upcoming_milestones: milestones.filter((m) => m.days_from_as_of >= 0 && toDate(m.due_date) <= upcomingEnd),
  upcoming_window: `${fmt(asOf)} to ${fmt(upcomingEnd)}`,
  next_milestones_after_window: milestones.filter((m) => toDate(m.due_date) > upcomingEnd).slice(0, 2),
  sprints,
  workload,
  risk_count: risks.length,
  risk_categories: risks.map((r) => `${r.risk_id} ${r.category}`),
  data_warnings: unknownStatuses.map((s) => `Unrecognised task status: ${s}`),
};

return [{
  json: {
    project: { name: PROJECT_NAME, description: PROJECT_DESCRIPTION.trim(), outcome_phrases: outcomePhrases, use_cases: USE_CASES },
    timeline,
    milestones,
    risks,
    tasks,
    facts,
  },
}];
