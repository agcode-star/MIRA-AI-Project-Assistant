// Reusable: converts each item's `trace` descriptor into a LangSmith /runs/batch payload.
// Descriptor: { name, start_time, end_time, inputs, outputs, tags, metadata,
//               children: [{ name, run_type, start_time, end_time, inputs, outputs, model?, temperature? }] }

const cfg = $('Config').first().json;

// UUID v7 (time-ordered), which LangSmith expects for run IDs.
function uuidv7(ms) {
  const r = (n) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  const ts = ms.toString(16).padStart(12, '0');
  const variant = '89ab'[Math.floor(Math.random() * 4)];
  return `${ts.slice(0, 8)}-${ts.slice(8, 12)}-7${r(3)}-${variant}${r(3)}-${r(12)}`;
}

// LangSmith dotted_order segment: YYYYMMDDTHHMMSSffffffZ + run id
const dottedTs = (iso) => iso.replace(/[-:]/g, '').replace('.', '').replace('Z', '000Z');

function usageMetadata(outputs) {
  const u = outputs?.usage ?? {};
  return { input_tokens: u.prompt_tokens ?? 0, output_tokens: u.completion_tokens ?? 0, total_tokens: u.total_tokens ?? 0 };
}

return $input.all().map(({ json }) => {
  const t = json.trace;
  const rootStart = Date.parse(t.start_time);
  const traceId = uuidv7(rootStart);
  const rootDotted = dottedTs(t.start_time) + traceId;

  const root = {
    id: traceId,
    trace_id: traceId,
    dotted_order: rootDotted,
    name: t.name,
    run_type: 'chain',
    inputs: t.inputs,
    outputs: t.outputs,
    start_time: t.start_time,
    end_time: t.end_time,
    session_name: cfg.langsmithProject,
    tags: t.tags,
    extra: { metadata: { ...t.metadata, n8n_execution_id: $execution.id } },
  };

  // Children start strictly after the root (+1 ms each) so dotted_order stays monotonic.
  const children = (t.children ?? []).map((c, idx) => {
    const startMs = Math.max(Date.parse(c.start_time), rootStart + idx + 1);
    const start = new Date(startMs).toISOString();
    const end = new Date(Math.max(Date.parse(c.end_time), startMs)).toISOString();
    const id = uuidv7(startMs);
    const run = {
      id,
      trace_id: traceId,
      parent_run_id: traceId,
      dotted_order: `${rootDotted}.${dottedTs(start)}${id}`,
      name: c.name,
      run_type: c.run_type,
      inputs: c.inputs,
      outputs: c.outputs,
      start_time: start,
      end_time: end,
      session_name: cfg.langsmithProject,
    };
    if (c.run_type === 'llm') {
      run.outputs = { ...c.outputs, usage_metadata: usageMetadata(c.outputs) };
      run.extra = {
        metadata: { ls_provider: 'openai', ls_model_name: c.model, ls_model_type: 'chat', ls_temperature: c.temperature },
        invocation_params: { model: c.model, temperature: c.temperature },
      };
    }
    return run;
  });

  return { json: { test_id: json.test_id, trace_id: traceId, batch: { post: [root, ...children] } } };
});
