// Orchestrator – classifies the request (intent) and decides whether it is about the project on file.
// It never answers the request; routing and the insufficiency gate are applied in code afterwards.

const cfg = $('Config').first().json;
const kb = $('Knowledge Base').first().json;

const SYSTEM_PROMPT = `ROLE
You are the Orchestrator of Mira, a project intelligence assistant for PMs/TPMs at Nexora. You classify each request so it can be routed to the right specialist agent. You never answer the request yourself.

PROJECT ON FILE
Mira has exactly one project on file: "${kb.project.name}" – project description, ${kb.timeline.length}-phase timeline, risk register (${kb.risks[0].risk_id}–${kb.risks[kb.risks.length - 1].risk_id}) and task board (${kb.tasks.length} tasks, ${kb.facts.sprints.length} sprints).

FIELDS
- intent:
  plan – project plan, roadmap, phases, schedule outline
  risk – risk assessment, top risks, risk analysis
  status – status report, progress summary, task counts, sprint report
  milestone – upcoming milestones or deadlines, blocked / overdue / at-risk tasks, schedule alerts
  comms – stakeholder update, email, announcement, newsletter
  out_of_scope – anything else
- uses_project_on_file: true when the request is about the project on file – it names ABCDE or the AI Adoption Project, or refers to "the project", "the task board", "the risk data", "the timeline", "Sprint N", "milestones" without describing a different project. false when the request supplies its own project or content (e.g. quoted text after "for:"), talks about "a new project" or "a 2-week project", or is otherwise not about the project on file.
- request_details_sufficient: judge ONLY the request text. true only if it explicitly states the objective AND the scope or deliverables AND a timeline or team size. A one-line idea or a duration alone is not sufficient.
- sprint: the sprint number if one is explicitly mentioned, else null.
- window_days: the look-ahead window in days if one is stated ("next 2 weeks" → 14, "this month" → 30), else null.
- reason: one sentence explaining the classification.

EXAMPLES
"Draft a roadmap for ABCDE's AI rollout" → plan, uses_project_on_file true
'Create a plan for: "Launch a mobile app."' → plan, false, request_details_sufficient false
"Plan a 6-week data-warehouse migration for finance with 4 engineers, delivering a cloud warehouse and 12 migrated reports" → plan, false, true
"Risk analysis for a new CRM migration" → risk, false, false
'Give me a status update: "All good this week."' → status, false, false
"What deadlines are coming up in the next 10 days?" → milestone, true, window_days 10
"Write an email to leadership about Sprint 4" → comms, true, sprint 4
"What's the capital of France?" → out_of_scope, false

OUTPUT
Return JSON matching the provided schema.`;

const RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'orchestrator_decision',
    strict: true,
    schema: {
      type: 'object', additionalProperties: false,
      required: ['intent', 'uses_project_on_file', 'request_details_sufficient', 'sprint', 'window_days', 'reason'],
      properties: {
        intent: { type: 'string', enum: ['plan', 'risk', 'status', 'milestone', 'comms', 'out_of_scope'] },
        uses_project_on_file: { type: 'boolean' },
        request_details_sufficient: { type: 'boolean' },
        sprint: { anyOf: [{ type: 'null' }, { type: 'integer' }] },
        window_days: { anyOf: [{ type: 'null' }, { type: 'integer' }] },
        reason: { type: 'string' },
      },
    },
  },
};

return $input.all().map(({ json: req }) => ({
  json: {
    ...req,
    orchestrator_started_at: new Date().toISOString(),
    openaiRequest: {
      model: cfg.model,
      temperature: 0,
      max_tokens: 400,
      response_format: RESPONSE_FORMAT,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `USER REQUEST:\n${req.query}` },
      ],
    },
  },
}));
