// Turns the test-suite Results into one LangSmith experiment (POST /api/v1/datasets/upload-experiment).
// The dataset "mira-baseline" is created on the first upload; each run of the suite becomes a new
// experiment on it, so LangSmith's comparison view shows every run side by side.
// row_id is fixed per test_id, so the same test lines up across experiments.

const cfg = $('Config').first().json;
const ROW_IDS = __ROW_IDS__;
const SUITE = __SUITE__;

const results = $('Results').all().map((i) => i.json).filter((r) => r.test_id !== 'chat');
const now = new Date().toISOString();
const r4 = (x) => Math.round(x * 1e4) / 1e4; // LangSmith: max 4 decimals
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const bool = (b) => (b ? 1 : 0);

const rows = results.map((r) => {
  const scores = [
    { key: 'pass', score: bool(r.verdict === 'PASS'), comment: r.checks.join('\n') },
    { key: 'checks_passed', score: r.checks_total ? r.checks_passed / r.checks_total : 1, comment: `${r.checks_passed}/${r.checks_total}` },
    { key: 'route_correct', score: bool(r.route === r.expected_route), comment: `expected ${r.expected_route}, got ${r.route}` },
    { key: 'tokens', score: r.tokens },
  ];
  if (r.groundedness !== null) scores.push({ key: 'groundedness', score: r.groundedness });
  if (r.judge_score !== null && r.judge_score !== undefined) {
    scores.push({ key: 'judge_score', score: r.judge_score, comment: r.unsupported_claims.join('\n') || 'no unsupported claims' });
    scores.push({ key: 'judge_material_claims', score: r.judge_material });
  }
  return {
    row_id: ROW_IDS[r.test_id],
    inputs: { test_id: r.test_id, query: r.query },
    expected_outputs: { route: r.expected_route },
    actual_outputs: { route: r.route, status: r.status, verdict: r.verdict, response: r.response },
    evaluation_scores: scores.map((s) => ({ ...s, score: r4(s.score) })),
    start_time: r.started_at ?? now,
    end_time: r.ended_at ?? now,
    run_name: `Mira ${r.test_id}`,
    run_metadata: { test_id: r.test_id, langsmith_trace_id: r.langsmith_trace_id, model: cfg.model, judge_model: SUITE.judge ? cfg.judgeModel : null },
  };
});

const pick = (key) => rows.flatMap((x) => x.evaluation_scores.filter((s) => s.key === key).map((s) => s.score));
const passed = pick('pass').filter((s) => s === 1).length;
const summary = [
  { key: 'pass_rate', score: rows.length ? passed / rows.length : 0, comment: `${passed}/${rows.length} tests passed` },
  { key: 'route_accuracy', score: mean(pick('route_correct')) ?? 0 },
  { key: 'avg_groundedness', score: mean(pick('groundedness')) ?? 0 },
  { key: 'total_tokens', score: pick('tokens').reduce((a, b) => a + b, 0) },
];
const judged = pick('judge_score');
if (judged.length) summary.push({ key: 'avg_judge_score', score: mean(judged), comment: 'advisory – LLM judge' });

const starts = rows.map((x) => x.start_time).sort();
const ends = rows.map((x) => x.end_time).sort();
const stamp = now.slice(0, 16).replace('T', ' ');

return [{
  json: {
    body: {
      experiment_name: `${SUITE.name} ${stamp}`,
      experiment_description: `${SUITE.description} · ${passed}/${rows.length} passed · model ${cfg.model} · as-of ${cfg.asOfDate}`,
      dataset_name: 'mira-baseline',
      dataset_description: 'Mira baseline tests T1–T12 (eval_mira_inputs.txt) + X1 out-of-scope case.',
      experiment_start_time: starts[0] ?? now,
      experiment_end_time: ends[ends.length - 1] ?? now,
      experiment_metadata: { workflow: SUITE.name, model: cfg.model, judge_model: SUITE.judge ? cfg.judgeModel : null, n8n_execution_id: $execution.id },
      summary_experiment_scores: summary.map((s) => ({ ...s, score: r4(s.score) })),
      results: rows,
    },
  },
}];
