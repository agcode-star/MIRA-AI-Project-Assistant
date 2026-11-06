// Clarifier – asks for the missing information instead of generating output from too little input.
// The checklist of required information depends on what the PM asked for (intent).

const cfg = $('Config').first().json;

const CHECKLIST = {
  plan: ['project scope', 'goals / objectives', 'key deliverables', 'timeline or deadline', 'team size and roles', 'constraints (budget, technology, stakeholders)'],
  risk: ['project scope and objectives', 'industry / domain', 'timeline and current phase', 'team size and roles', 'technology and systems involved', 'budget', 'key stakeholders and dependencies'],
  status: ['task list with statuses', 'task owners', 'due dates', 'sprint or reporting period', 'blockers', 'milestones'],
  milestone: ['project timeline with milestones and dates', 'task list with statuses', 'due dates', 'task owners', 'look-ahead window'],
  comms: ['audience', 'topic or reporting period', 'key updates and task progress', 'issues or asks', 'tone and format'],
};
const TASK = { plan: 'a project plan', risk: 'a risk assessment', status: 'a status report', milestone: 'milestone and deadline alerts', comms: 'a stakeholder update' };

const SYSTEM_PROMPT = `ROLE
You are the Clarifier inside Mira, a project intelligence assistant for PMs/TPMs at Nexora. The Orchestrator has decided that the request does not contain enough information to produce the requested output. Your job is to explain what is missing and ask the PM precise questions. You never produce the output itself – no plan, phases, risks, statuses, counts or percentages.

INPUT
- USER REQUEST, the requested output, and a REQUIRED INFORMATION checklist.

RULES
- reason: one sentence on why the output cannot be produced yet, naming the request.
- known_information: facts the request explicitly states (may be empty). Do not infer.
- missing_information: every checklist item that the request does not explicitly provide, using the checklist wording.
- questions: 4–7 specific questions, one per missing item where possible, that the PM can answer in a sentence.

OUTPUT
Return JSON matching the provided schema.`;

const strings = { type: 'array', items: { type: 'string' } };
const RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'clarifier_output',
    strict: true,
    schema: {
      type: 'object', additionalProperties: false,
      required: ['reason', 'known_information', 'missing_information', 'questions'],
      properties: { reason: { type: 'string' }, known_information: strings, missing_information: strings, questions: strings },
    },
  },
};

return $input.all().map(({ json: req }) => {
  const intent = CHECKLIST[req.intent] ? req.intent : 'plan';
  const userContent = `USER REQUEST:\n${req.query}\n\nREQUESTED OUTPUT: ${TASK[intent]}\n\n` +
    `REQUIRED INFORMATION:\n${CHECKLIST[intent].map((c) => `- ${c}`).join('\n')}`;
  return {
    json: {
      ...req,
      agent: 'Clarifier',
      clarify_for: intent,
      checklist: CHECKLIST[intent],
      started_at: new Date().toISOString(),
      openaiRequest: {
        model: cfg.model,
        temperature: Number(cfg.temperature),
        max_tokens: 800,
        response_format: RESPONSE_FORMAT,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userContent },
        ],
      },
    },
  };
});
