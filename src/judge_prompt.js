// Fact-Check Judge – a second, stronger LLM (Config.judgeModel) compares what the specialist model WROTE (its raw JSON output, not
// the code-rendered tables) with exactly the data it was given, and lists unsupported claims with a
// severity. The 1–5 score is computed in code from those severities (see Judge: Score).

const cfg = $('Config').first().json;

const SYSTEM_PROMPT = `ROLE
You are the Fact-Check Judge for Mira, a project intelligence assistant for PMs/TPMs. You check the NARRATIVE an agent wrote against the DATA it was given and list claims the DATA does not support. You do not rewrite anything.

INPUT
- REQUEST: what the PM asked (context only – never quote it as a claim).
- DATA: exactly what the agent saw.
- NARRATIVE: the agent's own output (JSON). Only text in NARRATIVE can be a claim – never quote REQUEST.

BEFORE YOU FLAG
- Find the DATA line the claim contradicts, or confirm the fact is absent from DATA. If you cannot, do not flag it.
- Text copied or paraphrased from the project description, risk register or task board is supported.

HOW TO READ THE DATA
- A task marked OVERDUE, listed under "Overdue", or shown as "Nd late" IS overdue, whatever its status ("In Progress" and overdue are compatible).
- "Linked tasks" or "At risk (Txxx)" next to a milestone means that task is part of that milestone, so "milestone X is at risk because Txxx is overdue/blocked" is supported.
- The task board has no completion dates and no results – only statuses and due dates.

FLAG (unsupported)
- material: contradicts DATA (wrong status, date, owner, count; calling a Done task overdue; a task "due soon" that DATA puts outside the due-soon window), a milestone, task, person, tool or budget fact that does not exist in DATA, a false generalisation ("all tasks are overdue"), or an invented dependency between items DATA does not link.
- minor: an outcome or timing stated as fact that DATA cannot show – e.g. "completed on schedule/on time", "findings will improve X", "the team is on track".

DO NOT FLAG
- Hedged or conditional statements about possible risks or consequences ("could delay", "may impact", "if not addressed") – risk descriptions are forward-looking by nature.
- Recommendations, next steps, priorities and urgency ("needs immediate attention").
- Paraphrases that keep the meaning; restating facts that are in DATA.

EXAMPLES
"T006 is overdue, which may delay the gap analysis report" – DATA lists T006 as overdue and linked to that milestone → not flagged.
"Cost overruns could occur if contingency is not planned" → not flagged (hedged risk).
"Both reports were completed on time" – DATA has no completion dates → minor.
"This affects the security review milestone" – no such milestone in DATA → material.
"All Sprint 2 tasks are overdue" – two are Done → material.

OUTPUT
Return JSON matching the provided schema. Quote each claim briefly, exactly as written in NARRATIVE. Return an empty list if nothing is unsupported.`;

const RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'judge_output',
    strict: true,
    schema: {
      type: 'object', additionalProperties: false,
      required: ['claims_checked', 'unsupported_claims', 'summary'],
      properties: {
        claims_checked: { type: 'integer' },
        unsupported_claims: {
          type: 'array',
          items: {
            type: 'object', additionalProperties: false, required: ['claim', 'reason', 'severity'],
            properties: { claim: { type: 'string' }, reason: { type: 'string' }, severity: { type: 'string', enum: ['minor', 'material'] } },
          },
        },
        summary: { type: 'string' },
      },
    },
  },
};

return $input.all().map(({ json: out }) => {
  // Judge the specialist's own words (its JSON output) against its own input; the Orchestrator is skipped.
  // Only data-based answers are judged: Fallback is fixed text and the Clarifier states no project facts
  // (its output is covered by code checks), so both are skipped.
  const specialist = out.trace.children.find((c) => c.run_type === 'llm' && c.name !== 'Orchestrator');
  const data = specialist?.inputs?.messages?.find((m) => m.role === 'user')?.content ?? 'none';
  const judged = !['fallback', 'clarifier'].includes(out.route);
  let narrative = judged ? specialist?.outputs?.choices?.[0]?.message?.content ?? null : null;
  // The risk ranking is computed by code; the model's internal priority_rank only confuses the judge.
  if (narrative && out.route === 'risk') {
    try {
      const n = JSON.parse(narrative);
      Object.values(n.assessment?.risks ?? {}).forEach((r) => delete r.priority_rank);
      narrative = JSON.stringify(n);
    } catch (e) { /* judge the raw text */ }
  }
  return {
    json: {
      ...out,
      judge_skipped: !narrative,
      judge_started_at: new Date().toISOString(),
      openaiRequest: {
        model: cfg.judgeModel || cfg.model,
        temperature: 0,
        max_tokens: narrative ? 900 : 50,
        response_format: RESPONSE_FORMAT,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `REQUEST:\n${out.query}\n\nDATA:\n${data}\n\nNARRATIVE:\n${narrative ?? '(none – not a data-based answer, nothing to check)'}` },
        ],
      },
    },
  };
});
