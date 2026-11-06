// Baseline test dataset (eval_mira_inputs.txt) with machine-checkable expectations.
// Emits one item per test listed in RUN – or, when started from the Chat Trigger, the chat message.

const incoming = $input.first()?.json ?? {};
if (incoming.chatInput) {
  return [{ json: { test_id: 'chat', query: incoming.chatInput, session_id: incoming.sessionId ?? null, checks: [] } }];
}

const RUN = __TEST_IDS__;
const WITH_ROUTE = __WITH_ROUTE__; // full Mira workflow: also check the Orchestrator's route
const JUDGE_MATERIAL_MAX = __JUDGE_MIN__; // with the Fact-Check Judge: advisory max material claims (null = no judge)

// Check types: status (value or list of accepted values) | judge_material_max | judge_min | phase_count | field (output field equals value) | grounded_min |
// mentions_all / mentions_any / not_mentions (case-insensitive, in rendered output)
// route: the agent the Orchestrator should pick (checked only when WITH_ROUTE).
const TESTS = [
  { test_id: 'T1', query: 'Generate a project plan for the AI Adoption Project at ABCDE Ltd. Use the provided project description.', route: 'planner',
    checks: [{ type: 'status', value: 'PLAN' }, { type: 'phase_count', value: 8 }, { type: 'grounded_min', value: 0.9 }] },
  { test_id: 'T2', query: 'Generate a project plan for: "We want to build a chatbot."', route: 'clarifier',
    checks: [{ type: 'status', value: 'NEEDS_CLARIFICATION' }, { type: 'mentions_all', value: ['scope', 'timeline', 'team'] }] },
  { test_id: 'T3', query: 'Generate a risk assessment for the AI Adoption Project at ABCDE Ltd. Use the provided project description.', route: 'risk',
    checks: [{ type: 'status', value: 'ASSESSMENT' }, { type: 'field', field: 'risk_count', value: 10 }, { type: 'grounded_min', value: 0.9 },
      { type: 'field', field: 'review_issue_count', value: 0 },
      { type: 'mentions_any', value: ['logistics', 'route', 'forecast', 'delivery', 'inventory'] }] },
  { test_id: 'T4', query: 'Generate a risk assessment for: "New project starting soon."', route: 'clarifier',
    checks: [{ type: 'status', value: 'NEEDS_CLARIFICATION' }, { type: 'mentions_all', value: ['scope', 'timeline'] },
      { type: 'not_mentions', value: ['R01', 'R02', 'Data Quality', 'Likelihood'] }] },
  { test_id: 'T5', query: 'Generate a weekly status report using the sample task board data for Sprint 3.', route: 'status',
    checks: [{ type: 'status', value: 'REPORT' }, { type: 'field', field: 'scope', value: 'Sprint 3' },
      { type: 'field', field: 'counts', value: 'Done 0 · In Progress 2 · Blocked 0 · To Do 2' },
      { type: 'mentions_all', value: ['Shortlist AI use cases', 'Define success criteria for each use case', 'Vendor evaluation for ML platform', 'Legal review of data usage'] },
      { type: 'grounded_min', value: 0.9 }] },
  { test_id: 'T6', query: 'Generate a weekly status report for: "Things are going fine."', route: 'clarifier',
    checks: [{ type: 'status', value: ['NO_DATA', 'NEEDS_CLARIFICATION'] }, { type: 'mentions_all', value: ['no task data'] },
      { type: 'not_mentions', value: ['%', 'T0'] }] },
  { test_id: 'T7', query: 'What are the top 3 risks for the ABCDE Ltd project based on the risk data?', route: 'risk',
    checks: [{ type: 'status', value: 'TOP_RISKS' }, { type: 'field', field: 'risk_count', value: 3 },
      { type: 'field', field: 'assessed_count', value: 10 }, { type: 'grounded_min', value: 0.9 },
      { type: 'field', field: 'review_issue_count', value: 0 }] },
  { test_id: 'T8', query: 'Which tasks are blocked or at risk of missing their deadline based on the task board?', route: 'milestone',
    checks: [{ type: 'status', value: 'ALERTS' }, { type: 'field', field: 'blocked', value: 'T024' }, { type: 'field', field: 'overdue', value: 'T006' },
      { type: 'mentions_all', value: ['T024', 'Security review of AI infrastructure', 'T006'] }, { type: 'grounded_min', value: 0.9 }] },
  { test_id: 'T9', query: 'Generate a project plan for a 2-week project with no details provided.', route: 'clarifier',
    checks: [{ type: 'status', value: 'NEEDS_CLARIFICATION' }, { type: 'mentions_all', value: ['scope', 'goal', 'deliverable'] }] },
  { test_id: 'T10', query: 'Summarize the current project status: how many tasks are done, in progress, and to do?', route: 'status',
    checks: [{ type: 'status', value: 'REPORT' }, { type: 'field', field: 'scope', value: 'Whole project' },
      { type: 'field', field: 'counts', value: 'Done 5 · In Progress 3 · Blocked 1 · To Do 16' }, { type: 'grounded_min', value: 0.9 }] },
  { test_id: 'T11', query: 'What milestones are coming up in the next 2 weeks based on the timeline?', route: 'milestone',
    checks: [{ type: 'status', value: 'ALERTS' }, { type: 'field', field: 'upcoming_count', value: 2 },
      { type: 'mentions_all', value: ['Current systems audit report', 'Gap analysis report'] }, { type: 'grounded_min', value: 0.9 }] },
  { test_id: 'T12', query: 'Generate a stakeholder update email summarizing Sprint 2 progress.', route: 'comms',
    checks: [{ type: 'status', value: 'EMAIL' }, { type: 'field', field: 'scope', value: 'Sprint 2' },
      { type: 'mentions_all', value: ['Audit existing data infrastructure', 'Map current logistics workflows', 'Identify data gaps'] },
      { type: 'not_mentions', value: ['Shortlist AI use cases', 'Legal review of data usage', 'Security review', 'Vendor evaluation', 'T007', 'T024', 'T025'] },
      { type: 'grounded_min', value: 0.9 }] },
  // Extra robustness case (not in the baseline dataset).
  { test_id: 'X1', query: 'What is the weather in Paris tomorrow?', route: 'fallback',
    checks: [{ type: 'status', value: 'OUT_OF_SCOPE' }] },
];

return TESTS.filter((t) => RUN.includes(t.test_id)).map(({ route, ...t }) => ({
  json: {
    ...t,
    checks: [
      ...(WITH_ROUTE && route ? [{ type: 'field', field: 'route', value: route }] : []),
      ...t.checks,
      ...(JUDGE_MATERIAL_MAX !== null ? [{ type: 'judge_material_max', value: JUDGE_MATERIAL_MAX, advisory: true }] : []),
    ],
  },
}));
