// Scores each agent output against its test's expectations (see Test Cases node).

const outputs = __OUTPUTS__;
const traceIds = __TRACE_IDS__;

function evaluate(check, out) {
  const text = out.markdown.toLowerCase();
  switch (check.type) {
    case 'status':
      return [[].concat(check.value).includes(out.status), `status ${out.status}`];
    case 'phase_count':
      return [out.phase_count === check.value, `${out.phase_count} phases`];
    case 'field':
      return [out[check.field] === check.value, `${check.field} = ${JSON.stringify(out[check.field])}`];
    case 'judge_material_max': {
      if (out.judge_skipped) return [true, 'fact-check n/a'];
      const claims = out.judge?.unsupported_claims ?? [];
      const material = claims.filter((c) => c.severity === 'material').length;
      return [out.judge_score !== null && material <= check.value, `fact-check ${out.judge_score ?? '–'}/5 · ${material} material, ${claims.length - material} minor`];
    }
    case 'judge_min':
      if (out.judge_skipped) return [true, 'fact-check n/a'];
      return [(out.judge_score ?? 0) >= check.value, `fact-check ${out.judge_score ?? '–'}/5${out.unsupported_count ? ` (${out.unsupported_count} unsupported)` : ''}`];
    case 'grounded_min': {
      const score = out.grounding?.score ?? 0;
      return [score >= check.value, `groundedness ${(score * 100).toFixed(0)}%`];
    }
    case 'mentions_all': {
      const missing = check.value.filter((term) => !text.includes(term.toLowerCase()));
      return [missing.length === 0, missing.length ? `missing: ${missing.join(', ')}` : `mentions ${check.value.join(', ')}`];
    }
    case 'mentions_any': {
      const hit = check.value.filter((term) => text.includes(term.toLowerCase()));
      return [hit.length > 0, hit.length ? `mentions ${hit.join(', ')}` : `none of: ${check.value.join(', ')}`];
    }
    case 'not_mentions': {
      const found = check.value.filter((term) => text.includes(term.toLowerCase()));
      return [found.length === 0, found.length ? `should not mention: ${found.join(', ')}` : 'no forbidden terms'];
    }
    default:
      return [false, `unknown check ${check.type}`];
  }
}

return outputs.map((out, i) => {
  // Advisory checks (the LLM judge, ~50% measured precision) are shown as INFO and never decide the verdict.
  const results = (out.checks ?? []).map((c) => {
    const [pass, detail] = evaluate(c, out);
    return `${c.advisory ? 'INFO' : pass ? 'PASS' : 'FAIL'} – ${c.type}: ${detail}${c.advisory && !pass ? ' (review)' : ''}`;
  });
  const failed = results.filter((r) => r.startsWith('FAIL')).length;
  const graded = results.filter((r) => !r.startsWith('INFO')).length;
  return {
    json: {
      test_id: out.test_id,
      verdict: results.length === 0 ? 'NO CHECKS' : failed === 0 ? 'PASS' : 'FAIL',
      checks: results,
      checks_passed: graded - failed,
      checks_total: graded,
      status: out.status,
      tokens: out.usage.total_tokens,
      route: out.route,
      expected_route: (out.checks ?? []).find((c) => c.type === 'field' && c.field === 'route')?.value ?? null,
      groundedness: out.grounding?.score ?? null,
      judge_score: out.judge_score,
      judge_material: out.judge_skipped ? null : (out.judge?.unsupported_claims ?? []).filter((c) => c.severity === 'material').length,
      query: out.query,
      started_at: out.started_at_trace ?? null,
      ended_at: out.ended_at_trace ?? null,
      unsupported_claims: (out.judge?.unsupported_claims ?? []).map((c) => c.claim),
      langsmith_trace_id: traceIds[i],
      response: out.markdown,
      output: out.markdown, // shown as the reply when Mira runs from the Chat Trigger
    },
  };
});
