// Verifies Knowledge Base FACTS against values hand-counted from the ABCDE Ltd CSVs.
// Specific to the provided sample data; update the expectations if the data changes.

const kb = $input.first().json;
const f = kb.facts;
const ids = (list) => list.map((t) => t.task_id ?? t.milestone).join(', ');

const checks = [
  ['Total tasks = 25', f.total_tasks === 25, f.total_tasks],
  ['Done = 5', f.status_counts.Done === 5, f.status_counts.Done],
  ['In Progress = 3', f.status_counts['In Progress'] === 3, f.status_counts['In Progress']],
  ['Blocked = 1', f.status_counts.Blocked === 1, f.status_counts.Blocked],
  ['To Do = 16', f.status_counts['To Do'] === 16, f.status_counts['To Do']],
  ['Blocked task is T024', ids(f.blocked_tasks) === 'T024', ids(f.blocked_tasks)],
  ['T006 is overdue', f.overdue_tasks.some((t) => t.task_id === 'T006'), ids(f.overdue_tasks)],
  ['Risks = 10 (R01–R10)', kb.risks.length === 10, kb.risks.length],
  ['Timeline phases = 8', kb.timeline.length === 8, kb.timeline.length],
  ['Current week = 4', f.current_week === 4, f.current_week],
  ['Current sprint = Sprint 3', f.current_sprint === 'Sprint 3', f.current_sprint],
  ['Sprint 2 has 3 tasks (T004–T006)', ids(f.sprints.find((s) => s.sprint === 'Sprint 2').task_ids.map((task_id) => ({ task_id }))) === 'T004, T005, T006',
    f.sprints.find((s) => s.sprint === 'Sprint 2').task_ids.join(', ')],
  ['No unrecognised statuses', f.data_warnings.length === 0, f.data_warnings.join('; ') || 'none'],
];

const results = checks.map(([check, pass, actual]) => ({ check, result: pass ? 'PASS' : 'FAIL', actual: String(actual) }));
const failed = results.filter((r) => r.result === 'FAIL').length;

return [{
  json: {
    summary: failed === 0 ? `ALL ${results.length} CHECKS PASSED` : `${failed} of ${results.length} CHECKS FAILED`,
    as_of_date: f.as_of_date,
    results,
  },
}];
