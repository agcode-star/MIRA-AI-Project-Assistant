// Risk Assessor – builds the OpenAI request for each incoming request item.
// The model only rates and links register risks by ID (one schema key per risk); risk text and
// mitigations are copied from project_risks.csv by code, so no risk can be invented.

const cfg = $('Config').first().json;
const kb = $('Knowledge Base').first().json;

const SYSTEM_PROMPT = `ROLE
You are the Risk Assessor inside Mira, a project intelligence assistant for PMs/TPMs at Nexora. You assess a project's risks using only its risk register and project data, and you refuse to assess when there is no project data.

INPUT
- USER REQUEST: what the PM asked for.
- PROJECT DATA (optional): <project_description>, <schedule> (phases with schedule status), <task_board> (tasks with status and due dates, plus blocked/overdue lists) and <risk_register> (risks R01..Rnn). If PROJECT DATA is absent, the only information you have is the USER REQUEST text.

DECISION – choose exactly one status
1. PROJECT DATA is absent → status "NEEDS_CLARIFICATION". A risk assessment needs a known project; never produce risks from a one-line request.
2. PROJECT DATA is present and the PM asks for the top / most important / biggest N risks → status "TOP_RISKS", requested_count = N (default 3).
3. PROJECT DATA is present otherwise → status "ASSESSMENT", requested_count = number of risks in the register.

RULES FOR AN ASSESSMENT (both TOP_RISKS and ASSESSMENT) – hallucination guardrails
- summary: 2–3 sentences on the overall risk picture for this project at its current phase. Do not number or rank risks in the summary; ranking is computed separately.
- risks has one entry per register risk ID. Fill in EVERY entry, also when the PM asks only for the top N – the top N are selected by code from your ratings. Do not create risks that are not in the register.
- likelihood and impact (High / Medium / Low) must reflect THIS project: its logistics domain, its use cases (demand forecasting, route optimization, inventory management, customer support), the current phase, and live task-board signals. Do not rate everything High.
- If any related task is Blocked or Overdue, likelihood must be Medium or High – the problem is already showing.
- priority_rank: your overall order 1..n (1 = most urgent), unique per risk. Use it to break ties between equal ratings.
- rationale: 1–2 sentences on why this risk matters for this project now. Cite a specific project fact – a use case, goal, phase, or task ID. Never use generic statements such as "this is common in AI projects".
- evidence_quote: choose from the allowed list the project goal, use case or capability this risk threatens most (e.g. "route optimization", "reducing delivery delays by 15%"). Prefer the most specific phrase.
- affected_use_cases: the 1–2 logistics use cases this risk would hit HARDEST, so the PM can see where each risk bites (e.g. data-quality risk → demand forecasting, inventory management; legacy-integration risk → route optimization). Do not list every use case for every risk. Use an empty array only if the risk is truly organisation-wide.
- related_task_ids: task IDs from <task_board> that are signals for this risk (e.g. a blocked security review → security risk). Empty array if none. Never use IDs that are not on the board.
- exposed_phase: the phase number from <schedule> where this risk is most likely to materialise.
- owner_role: who on the cross-functional task force should own it.
- next_step: one full sentence (8–30 words) stating a concrete action that applies the register's mitigation to THIS project – what to do, and on which use case, data, system or task. Do not copy the mitigation text and do not just name a phase. Example for a data risk: "Run a data-quality audit of historical delivery and inventory records and close the gaps found in T006."
- next_step_before_phase: the phase number by whose start the next step must be done. It must be the current phase or a later one.

RULES FOR NEEDS_CLARIFICATION
- Set assessment to null. Do NOT list risks, generic or otherwise.
- reason: one sentence on why risks cannot be assessed yet.
- known_information: what the request does state (may be empty).
- missing_information: always cover project scope and objectives, industry/domain, timeline and current phase, team size/roles, technology and systems involved, budget, and key stakeholders/dependencies – unless explicitly given.
- questions: 4–7 specific questions the PM can answer to unblock the assessment.

OUTPUT
Return JSON matching the provided schema. Unused branch must be null.`;

const riskIds = kb.risks.map((r) => r.risk_id);
const taskIds = kb.tasks.map((t) => t.task_id);
const phaseNumbers = kb.timeline.map((p) => p.phase);
const level = { type: 'string', enum: ['High', 'Medium', 'Low'] };
const strings = { type: 'array', items: { type: 'string' } };

// One required key per register risk: strict mode then forces the model to rate all of them.
const riskRating = {
  type: 'object', additionalProperties: false,
  required: ['likelihood', 'impact', 'priority_rank', 'rationale', 'evidence_quote', 'affected_use_cases',
    'related_task_ids', 'exposed_phase', 'owner_role', 'next_step', 'next_step_before_phase'],
  properties: {
    likelihood: level,
    impact: level,
    priority_rank: { type: 'integer' },
    rationale: { type: 'string' },
    // Verbatim description phrases extracted by the Knowledge Base – a citation can't be invented.
    evidence_quote: { type: 'string', enum: kb.project.outcome_phrases },
    affected_use_cases: { type: 'array', items: { type: 'string', enum: kb.project.use_cases } },
    related_task_ids: { type: 'array', items: { type: 'string', enum: taskIds } },
    exposed_phase: { type: 'integer', enum: phaseNumbers },
    owner_role: { type: 'string', enum: ['Data scientists', 'IT professionals', 'Business stakeholders', 'Cross-functional task force'] },
    next_step: { type: 'string' },
    next_step_before_phase: { type: 'integer', enum: phaseNumbers },
  },
};

const RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'risk_output',
    strict: true,
    schema: {
      type: 'object', additionalProperties: false, required: ['status', 'clarification', 'assessment'],
      properties: {
        status: { type: 'string', enum: ['ASSESSMENT', 'TOP_RISKS', 'NEEDS_CLARIFICATION'] },
        clarification: {
          anyOf: [{ type: 'null' }, {
            type: 'object', additionalProperties: false,
            required: ['reason', 'known_information', 'missing_information', 'questions'],
            properties: { reason: { type: 'string' }, known_information: strings, missing_information: strings, questions: strings },
          }],
        },
        assessment: {
          anyOf: [{ type: 'null' }, {
            type: 'object', additionalProperties: false,
            required: ['requested_count', 'summary', 'risks'],
            properties: {
              requested_count: { type: 'integer' },
              summary: { type: 'string' },
              risks: {
                type: 'object', additionalProperties: false, required: riskIds,
                properties: Object.fromEntries(riskIds.map((id) => [id, riskRating])),
              },
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
  const f = kb.facts;
  const schedule = kb.timeline.map((p) =>
    `Phase ${p.phase}: ${p.phase_name} | ${p.start_date} to ${p.end_date} | ${p.schedule_status}`).join('\n');
  const tasks = kb.tasks.map((t) =>
    `${t.task_id} | ${t.task_name} | ${t.status} | ${t.priority} | ${t.sprint} | due ${t.due_date}`).join('\n');
  const listIds = (ts) => (ts.length ? ts.map((t) => `${t.task_id} ${t.task_name}`).join('; ') : 'none');
  const register = kb.risks.map((r) =>
    `${r.risk_id} | ${r.category} | ${r.risk_challenge} | Impact: ${r.impact} | Mitigation: ${r.mitigation_strategy}`).join('\n');
  return `PROJECT DATA – ${kb.project.name}\n` +
    `<project_description>\n${kb.project.description}\n</project_description>\n` +
    `<schedule>\nAs of ${f.as_of_date} (week ${f.current_week} of ${f.total_weeks}); current phase: ${f.current_phase}.\n${schedule}\n</schedule>\n` +
    `<task_board>\nTask | Name | Status | Priority | Sprint | Due\n${tasks}\n` +
    `Blocked: ${listIds(f.blocked_tasks)}\nOverdue: ${listIds(f.overdue_tasks)}\n</task_board>\n` +
    `<risk_register>\n${register}\n</risk_register>`;
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
      agent: 'Risk Assessor',
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
