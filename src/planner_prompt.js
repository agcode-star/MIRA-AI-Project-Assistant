// Planner Agent – builds the OpenAI request for each incoming request item.
// Project data is attached only when the request refers to the ABCDE Ltd project, so the
// agent cannot borrow ABCDE facts to "fill in" a vague request about some other project.

const cfg = $('Config').first().json;
const kb = $('Knowledge Base').first().json;

const SYSTEM_PROMPT = `ROLE
You are the Planner Agent inside Mira, a project intelligence assistant for PMs/TPMs at Nexora. You turn project information into a structured project plan, and you refuse to plan when the information is insufficient.

INPUT
- USER REQUEST: what the PM asked for.
- PROJECT DATA (optional): <project_description> and <project_timeline> for a project on file. If PROJECT DATA is absent, the only information you have is the USER REQUEST text.

DECISION – choose exactly one status
1. PROJECT DATA is present → status "PLAN", built only from PROJECT DATA.
2. PROJECT DATA is absent → judge the USER REQUEST alone. It is sufficient ONLY if it explicitly states ALL of:
   (a) the objective / goals, (b) the scope or main deliverables, and (c) a timeline or team size.
   If any of these is missing → status "NEEDS_CLARIFICATION". A one-line idea ("build a chatbot") or a duration with no content ("a 2-week project") is NOT sufficient.

RULES FOR A PLAN (hallucination guardrails)
- objectives, scope, success_metrics, governance: include only items explicitly stated in the source. Each item's source_quote must be an exact, verbatim phrase copied from the source text. Never add goals, KPIs, technologies, budgets, vendors, or people that are not in the source.
- phases: copy every phase from <project_timeline> exactly – same number, name, weeks, dates, key activities and milestones/deliverables. Do not add, merge, split, rename or re-date phases.
- executive_summary: 2–3 sentences using only facts from the source.
- assumptions: things you had to assume to present the plan (keep minimal).
- open_questions: information a PM still needs that the source does NOT provide (e.g. budget, team size/named owners, tooling, which departments pilot first). Do not answer them yourself.
- If the source is internally inconsistent, say so in open_questions.

RULES FOR NEEDS_CLARIFICATION
- Set plan to null. Do NOT produce phases, milestones, or a draft plan.
- reason: one sentence on why a plan cannot be produced yet.
- known_information: what the request does state (may be empty).
- missing_information: always cover project scope, goals/objectives, key deliverables, timeline, team size/roles, and constraints (budget, technology, stakeholders) – unless explicitly given.
- questions: 4–7 specific questions the PM can answer to unblock planning.

OUTPUT
Return JSON matching the provided schema. Unused branch must be null.`;

const sourced = {
  type: 'object', additionalProperties: false, required: ['text', 'source_quote'],
  properties: { text: { type: 'string' }, source_quote: { type: 'string' } },
};
const strings = { type: 'array', items: { type: 'string' } };

const RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'planner_output',
    strict: true,
    schema: {
      type: 'object', additionalProperties: false, required: ['status', 'clarification', 'plan'],
      properties: {
        status: { type: 'string', enum: ['PLAN', 'NEEDS_CLARIFICATION'] },
        clarification: {
          anyOf: [{ type: 'null' }, {
            type: 'object', additionalProperties: false,
            required: ['reason', 'known_information', 'missing_information', 'questions'],
            properties: { reason: { type: 'string' }, known_information: strings, missing_information: strings, questions: strings },
          }],
        },
        plan: {
          anyOf: [{ type: 'null' }, {
            type: 'object', additionalProperties: false,
            required: ['project_name', 'executive_summary', 'objectives', 'scope', 'success_metrics', 'governance', 'phases', 'assumptions', 'open_questions'],
            properties: {
              project_name: { type: 'string' },
              executive_summary: { type: 'string' },
              objectives: { type: 'array', items: sourced },
              scope: { type: 'array', items: sourced },
              success_metrics: { type: 'array', items: sourced },
              governance: { type: 'array', items: sourced },
              phases: {
                type: 'array',
                items: {
                  type: 'object', additionalProperties: false,
                  required: ['phase_number', 'name', 'start_week', 'end_week', 'start_date', 'end_date', 'key_activities', 'milestones_deliverables'],
                  properties: {
                    phase_number: { type: 'integer' }, name: { type: 'string' },
                    start_week: { type: 'integer' }, end_week: { type: 'integer' },
                    start_date: { type: 'string' }, end_date: { type: 'string' },
                    key_activities: strings, milestones_deliverables: strings,
                  },
                },
              },
              assumptions: strings,
              open_questions: strings,
            },
          }],
        },
      },
    },
  },
};

// The Orchestrator decides this (uses_project_on_file); the regex is the fallback for the standalone step workflows.
const refersToProject = (q) => /ABCDE|AI Adoption Project/i.test(q);

function projectDataBlock() {
  const phases = kb.timeline.map((p) => [
    `Phase ${p.phase}: ${p.phase_name} | Weeks ${p.start_week}-${p.end_week} | ${p.start_date} to ${p.end_date}`,
    `  Key activities: ${p.key_activities.join('; ')}`,
    `  Milestones/deliverables: ${p.milestones.join('; ')}`,
  ].join('\n')).join('\n');
  return `PROJECT DATA – ${kb.project.name}\n<project_description>\n${kb.project.description}\n</project_description>\n` +
    `<project_timeline>\nWeek 1 starts ${kb.facts.project_start_date}.\n${phases}\n</project_timeline>`;
}

return $input.all().map(({ json: req }) => {
  const usesProjectData = req.uses_project_on_file ?? refersToProject(req.query);
  const userContent = `USER REQUEST:\n${req.query}\n\n` +
    (usesProjectData ? projectDataBlock() : 'PROJECT DATA: none provided.');
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userContent },
  ];
  return {
    json: {
      ...req,
      agent: 'Planner Agent',
      uses_project_data: usesProjectData,
      source_text: usesProjectData ? kb.project.description : req.query,
      started_at: new Date().toISOString(),
      openaiRequest: {
        model: cfg.model,
        temperature: Number(cfg.temperature),
        max_tokens: Number(cfg.maxTokens),
        response_format: RESPONSE_FORMAT,
        messages,
      },
    },
  };
});
