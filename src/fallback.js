// Fallback – deterministic reply for out-of-scope requests (no LLM call).

const CAPABILITIES = [
  '**Project plan** – e.g. "Generate a project plan for the AI Adoption Project at ABCDE Ltd."',
  '**Risk assessment** – e.g. "What are the top 3 risks for the ABCDE Ltd project?"',
  '**Weekly status report** – e.g. "Generate a weekly status report for Sprint 3."',
  '**Milestone & deadline alerts** – e.g. "Which tasks are blocked or at risk of missing their deadline?"',
  '**Stakeholder update email** – e.g. "Draft a stakeholder update for Sprint 2."',
];

return $input.all().map(({ json: req }) => {
  const status = 'OUT_OF_SCOPE';
  const markdown = [
    "## That's outside what I can help with\n\nI'm Mira, a project intelligence assistant for the AI Adoption Project at ABCDE Ltd.",
    '**I can help with**', CAPABILITIES.map((c) => `- ${c}`).join('\n'),
  ].join('\n\n');
  const now = new Date().toISOString();
  return {
    json: {
      test_id: req.test_id,
      query: req.query,
      checks: req.checks,
      agent: 'Fallback',
      status,
      uses_project_data: false,
      grounding: null,
      markdown,
      usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
      trace: {
        name: 'Mira',
        start_time: now,
        end_time: now,
        inputs: { query: req.query },
        outputs: { status, response: markdown },
        tags: ['mira', 'fallback', req.test_id].filter(Boolean),
        metadata: { test_id: req.test_id, agent: 'Fallback', status },
        children: [],
      },
    },
  };
});
