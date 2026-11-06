// Clarifier – renders the clarification request, checks that every required checklist item was
// either acknowledged as known or asked for, and describes the trace.

const requests = $('Clarifier: Build Prompt').all();

const HEADING = {
  plan: '## More information needed before I can build a plan',
  risk: '## More information needed before I can assess risks',
  status: '## No task data available',
  milestone: '## No timeline or task data to track',
  comms: '## More information needed before I can draft the update',
};
const LEAD = {
  plan: '',
  risk: '',
  status: "I can't produce a status report from the request alone – there are no task statuses, owners or due dates to report on.",
  milestone: "I can't flag milestones or deadline risks without a timeline and task due dates.",
  comms: '',
};
const FOOTER = {
  plan: '_No plan was generated, to avoid inventing scope, milestones or dates that you have not provided._',
  risk: '_No risks were listed, to avoid inventing project-specific risks without project data._',
  status: '_No task statuses, counts or progress percentages were generated._',
  milestone: '_No milestones or dates were generated._',
  comms: '_No email was drafted, to avoid inventing progress or results._',
};
const list = (items) => (items.length ? items.map((x) => `- ${x}`).join('\n') : '- _None._');
const stems = (s) => String(s).toLowerCase().replace(/[^a-z ]+/g, ' ').split(' ').filter((w) => w.length > 3).map((w) => w.slice(0, 5));

// Each checklist item must be covered by the known or missing lists (stem match on its key words).
function coverageCheck(checklist, c) {
  const covered = new Set(stems([...c.known_information, ...c.missing_information].join(' ')));
  const uncovered = checklist.filter((item) => !stems(item).some((s) => covered.has(s)));
  return { checked: checklist.length, covered: checklist.length - uncovered.length, uncovered };
}

return $input.all().map((item, i) => {
  const req = requests[i].json;
  const body = item.json.body ?? item.json;
  const headers = item.json.headers ?? {};
  const finishedAt = new Date().toISOString();
  const intent = req.clarify_for;

  let c;
  try { c = JSON.parse(body.choices?.[0]?.message?.content ?? ''); } catch (e) { c = null; }
  c = c ?? { reason: 'The request does not contain enough information.', known_information: [], missing_information: req.checklist, questions: [] };
  const coverage = coverageCheck(req.checklist, c);

  const markdown = [
    HEADING[intent],
    LEAD[intent],
    c.reason,
    '**What I have so far**', list(c.known_information),
    '**What is missing**', list(c.missing_information),
    '**Please answer these questions**',
    c.questions.map((q, k) => `${k + 1}. ${q}`).join('\n'),
    FOOTER[intent],
    '---',
    `Checklist coverage: ${coverage.covered}/${coverage.checked} required items addressed` +
      (coverage.uncovered.length ? `\n${coverage.uncovered.map((u) => `- ⚠ not asked: ${u}`).join('\n')}` : ' ✅'),
  ].filter(Boolean).join('\n\n');

  const latencyMs = Number(headers['openai-processing-ms']) || (Date.parse(finishedAt) - Date.parse(req.started_at));
  const llmEnd = new Date(Date.parse(req.started_at) + latencyMs).toISOString();
  const usage = body.usage ?? {};

  return {
    json: {
      test_id: req.test_id,
      query: req.query,
      checks: req.checks,
      agent: req.agent,
      status: 'NEEDS_CLARIFICATION',
      uses_project_data: false,
      coverage,
      grounding: null,
      markdown,
      usage: { input_tokens: usage.prompt_tokens ?? 0, output_tokens: usage.completion_tokens ?? 0, total_tokens: usage.total_tokens ?? 0 },
      trace: {
        name: 'Mira',
        start_time: req.started_at,
        end_time: finishedAt,
        inputs: { query: req.query },
        outputs: { status: 'NEEDS_CLARIFICATION', response: markdown },
        tags: ['mira', 'clarifier', req.test_id].filter(Boolean),
        metadata: { test_id: req.test_id, agent: req.agent, clarify_for: intent, checklist_coverage: coverage.covered / coverage.checked },
        children: [
          {
            name: req.agent,
            run_type: 'llm',
            start_time: req.started_at,
            end_time: llmEnd,
            inputs: { messages: req.openaiRequest.messages },
            outputs: body,
            model: req.openaiRequest.model,
            temperature: req.openaiRequest.temperature,
          },
          {
            name: 'Checklist Coverage',
            run_type: 'chain',
            start_time: llmEnd,
            end_time: finishedAt,
            inputs: { checklist: req.checklist },
            outputs: coverage,
          },
        ],
      },
    },
  };
});
