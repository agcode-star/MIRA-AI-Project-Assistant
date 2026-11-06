// One-off: uploads the recorded test-suite runs (Steps 6–8, results/history/) to LangSmith as experiments on
// dataset "mira-baseline", so the experiment comparison view shows the whole improvement history.
// Scores are re-derived from each run's recorded check lines. LangSmith resolves examples as of the
// experiment start, so runs are timestamped at upload time (in their original order, 2 min apart) and the
// original run time is kept in metadata. Latency was not recorded then: each row gets a nominal 1 s.

const ROW_IDS = __ROW_IDS__;
const RUNS = __RUNS__;

const r4 = (x) => (x === null ? null : Math.round(x * 1e4) / 1e4); // LangSmith: max 4 decimals
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const bool = (b) => (b ? 1 : 0);
const num = (re, s) => { const m = s.match(re); return m ? Number(m[1]) : null; };

return RUNS.map((run, k) => {
  const end = Date.now() - (RUNS.length - k) * 120000;
  const rows = run.results.map((r, i) => {
    const lines = r.checks ?? [];
    const routeLine = lines.find((l) => / field: route = /.test(l));
    const groundLine = lines.find((l) => /groundedness \d+%/.test(l));
    const judgeLine = lines.find((l) => /fact-check/.test(l));
    const realFails = lines.filter((l) => l.startsWith('FAIL') && !/judge_/.test(l));
    let scores = [
      { key: 'pass', score: bool(r.verdict === 'PASS'), comment: lines.join('\n') },
      { key: 'pass_deterministic', score: bool(realFails.length === 0), comment: 'verdict re-scored without the LLM-judge check (judge made advisory in Step 8)' },
      { key: 'tokens', score: r.tokens },
    ];
    if (routeLine) scores.push({ key: 'route_correct', score: bool(routeLine.startsWith('PASS')), comment: routeLine });
    if (groundLine) scores.push({ key: 'groundedness', score: num(/groundedness (\d+)%/, groundLine) / 100 });
    if (r.judge_score !== null && r.judge_score !== undefined) {
      scores.push({ key: 'judge_score', score: r.judge_score, comment: (r.unsupported_claims ?? []).join('\n') || 'no unsupported claims' });
      const material = judgeLine ? num(/(\d+) material/, judgeLine) : null;
      if (material !== null) scores.push({ key: 'judge_material_claims', score: material });
    }
    scores = scores.map((s) => ({ ...s, score: r4(s.score) }));
    const start = end - (run.results.length - i) * 2000;
    return {
      row_id: ROW_IDS[r.test_id],
      inputs: { test_id: r.test_id, query: run.queries[r.test_id] },
      expected_outputs: { route: run.routes[r.test_id] },
      actual_outputs: { route: r.route, status: r.status, verdict: r.verdict, response: r.response },
      evaluation_scores: scores,
      start_time: new Date(start).toISOString(),
      end_time: new Date(start + 1000).toISOString(),
      run_name: `Mira ${r.test_id}`,
      run_metadata: { test_id: r.test_id, langsmith_trace_id: r.langsmith_trace_id, historical: true },
    };
  });
  const pick = (key) => rows.flatMap((x) => x.evaluation_scores.filter((s) => s.key === key).map((s) => s.score));
  const passed = pick('pass').filter((s) => s === 1).length;
  let summary = [
    { key: 'pass_rate', score: passed / rows.length, comment: `${passed}/${rows.length} tests passed (as recorded)` },
    { key: 'pass_rate_deterministic', score: mean(pick('pass_deterministic')), comment: 'without the LLM-judge check' },
    { key: 'route_accuracy', score: mean(pick('route_correct')) ?? 0 },
    { key: 'avg_groundedness', score: mean(pick('groundedness')) ?? 0 },
    { key: 'total_tokens', score: pick('tokens').reduce((a, b) => a + b, 0) },
  ];
  const judged = pick('judge_score');
  if (judged.length) summary.push({ key: 'avg_judge_score', score: mean(judged) });
  summary = summary.map((s) => ({ ...s, score: r4(s.score) }));
  return {
    json: {
      body: {
        experiment_name: `${String(k + 1).padStart(2, '0')} ${run.name}`,
        experiment_description: `${run.description} · ${passed}/${rows.length} passed · historical import`,
        dataset_name: 'mira-baseline',
        dataset_description: 'Mira baseline tests T1–T12 (eval_mira_inputs.txt) + X1 out-of-scope case.',
        experiment_start_time: rows[0].start_time,
        experiment_end_time: rows[rows.length - 1].end_time,
        experiment_metadata: { historical: true, step: run.step, captured_at: run.captured_at },
        summary_experiment_scores: summary,
        results: rows,
      },
    },
  };
});
