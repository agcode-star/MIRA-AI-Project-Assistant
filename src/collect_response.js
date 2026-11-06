// Joins whichever agent branch ran for this request and nests the Orchestrator call into its trace,
// so LangSmith shows one trace per request: Orchestrator → specialist → checks.

const orch = $('Orchestrator: Route').all();

return $input.all().map((item, i) => {
  const out = item.json;
  const o = orch[i].json;
  const ou = o.orchestrator_run.outputs?.usage ?? {};
  const usage = {
    input_tokens: out.usage.input_tokens + (ou.prompt_tokens ?? 0),
    output_tokens: out.usage.output_tokens + (ou.completion_tokens ?? 0),
    total_tokens: out.usage.total_tokens + (ou.total_tokens ?? 0),
  };
  return {
    json: {
      ...out,
      route: o.route,
      intent: o.intent,
      decision: o.decision,
      usage,
      trace: {
        ...out.trace,
        start_time: o.orchestrator_started_at,
        tags: [...new Set([...out.trace.tags, `route:${o.route}`])],
        metadata: { ...out.trace.metadata, route: o.route, intent: o.intent, gate: o.decision.gate, total_tokens: usage.total_tokens },
        children: [o.orchestrator_run, ...out.trace.children],
      },
    },
  };
});
