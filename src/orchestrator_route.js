// Orchestrator – parses the classification and applies the routing rules and insufficiency gate in code:
//   out_of_scope                         → Fallback
//   about the project on file            → specialist agent
//   plan with a self-sufficient request  → Planner
//   anything else                        → Clarifier (never generate from too little information)

const requests = $('Orchestrator: Build Prompt').all();
const AGENT = { plan: 'planner', risk: 'risk', status: 'status', milestone: 'milestone', comms: 'comms' };

return $input.all().map((item, i) => {
  const { openaiRequest, ...req } = requests[i].json;
  const body = item.json.body ?? item.json;
  const headers = item.json.headers ?? {};
  const finishedAt = new Date().toISOString();

  let d;
  try { d = JSON.parse(body.choices?.[0]?.message?.content ?? ''); } catch (e) { d = null; }
  d = d ?? { intent: 'out_of_scope', uses_project_on_file: false, request_details_sufficient: false, sprint: null, window_days: null, reason: 'Orchestrator output could not be parsed.' };

  let route, gate;
  if (d.intent === 'out_of_scope') { route = 'fallback'; gate = 'out of scope'; }
  else if (d.uses_project_on_file) { route = AGENT[d.intent]; gate = 'project data on file'; }
  else if (d.intent === 'plan' && d.request_details_sufficient) { route = 'planner'; gate = 'request states objective, scope and timeline/team'; }
  else { route = 'clarifier'; gate = d.intent === 'plan' ? 'request lacks objective, scope or timeline/team' : `no project data for a ${d.intent} request`; }

  const latencyMs = Number(headers['openai-processing-ms']) || (Date.parse(finishedAt) - Date.parse(req.orchestrator_started_at));
  return {
    json: {
      ...req,
      route,
      intent: d.intent,
      uses_project_on_file: d.uses_project_on_file,
      sprint: d.sprint,
      window_days: d.window_days,
      decision: { ...d, route, gate },
      orchestrator_run: {
        name: 'Orchestrator',
        run_type: 'llm',
        start_time: req.orchestrator_started_at,
        end_time: new Date(Date.parse(req.orchestrator_started_at) + latencyMs).toISOString(),
        inputs: { messages: openaiRequest.messages },
        outputs: body,
        model: openaiRequest.model,
        temperature: openaiRequest.temperature,
      },
    },
  };
});
