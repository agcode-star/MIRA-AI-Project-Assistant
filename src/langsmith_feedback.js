// Attaches the evaluation scores to each request's LangSmith trace as feedback (POST /api/v1/feedback,
// one item per score), so traces can be filtered by score in LangSmith – for chat requests too.
// Every request gets at least the "route" feedback, so the chain always continues to the reply.

const bool = (b) => (b ? 1 : 0);

return $input.all().flatMap(({ json: r }) => {
  const isTest = r.test_id !== 'chat';
  const fb = (key, score, comment, value) => ({
    json: {
      run_id: r.langsmith_trace_id,
      trace_id: r.langsmith_trace_id,
      key,
      ...(score === undefined ? {} : { score: Math.round(score * 1e4) / 1e4 }), // LangSmith: max 4 decimals
      ...(value === undefined ? {} : { value }),
      ...(comment ? { comment } : {}),
      feedback_source: { type: 'api', metadata: { source: 'mira-n8n', test_id: r.test_id } },
    },
  });
  const items = [fb('route', isTest && r.expected_route ? bool(r.route === r.expected_route) : undefined,
    isTest && r.expected_route ? `expected ${r.expected_route}` : null, r.route)];
  if (isTest && r.checks_total) items.push(fb('pass', bool(r.verdict === 'PASS'), r.checks.join('\n')));
  if (r.groundedness !== null) items.push(fb('groundedness', r.groundedness));
  if (r.judge_score !== null && r.judge_score !== undefined) {
    items.push(fb('judge_score', r.judge_score, r.unsupported_claims.join('\n') || 'no unsupported claims'));
    items.push(fb('judge_material_claims', r.judge_material));
  }
  return r.langsmith_trace_id ? items : [];
});
