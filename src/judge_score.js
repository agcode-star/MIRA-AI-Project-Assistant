// Fact-Check Judge – computes the 1–5 score from the judged claims' severities (deterministic, so the
// score always matches the list), attaches the verdict to the response as a "Fact check" line, and
// adds the judge call to the trace and its tokens to the request total.

const requests = $('Judge: Build Prompt').all();

// 5 = none · 4 = one minor · 3 = one material or 2+ minor · 2 = 2–3 material · 1 = 4+ material
function score(claims) {
  const material = claims.filter((c) => c.severity === 'material').length;
  const minor = claims.length - material;
  if (material >= 4) return 1;
  if (material >= 2) return 2;
  if (material === 1 || minor >= 2) return 3;
  return minor === 1 ? 4 : 5;
}

return $input.all().map((item, i) => {
  const { openaiRequest, judge_started_at: startedAt, judge_skipped: skipped, ...out } = requests[i].json;
  const body = item.json.body ?? item.json;
  const headers = item.json.headers ?? {};
  const finishedAt = new Date().toISOString();

  let j = null;
  try { j = JSON.parse(body.choices?.[0]?.message?.content ?? ''); } catch (e) { j = null; }
  if (skipped) j = { claims_checked: 0, unsupported_claims: [], summary: 'Not a data-based answer – nothing to fact-check.' };
  const claims = j?.unsupported_claims ?? [];
  const judgeScore = skipped || !j ? null : score(claims);

  const line = skipped ? 'Fact check (LLM judge): n/a – no project facts stated'
    : !j ? '⚠ Fact check unavailable.'
    : `Fact check (LLM judge): ${judgeScore}/5` + (claims.length
      ? ` – ${claims.length} unsupported claim(s)\n${claims.map((c) => `- ⚠ (${c.severity}) “${c.claim}” – ${c.reason}`).join('\n')}`
      : ' ✅');
  const markdown = `${out.markdown}\n\n${line}`;

  const u = body.usage ?? {};
  const latencyMs = Number(headers['openai-processing-ms']) || (Date.parse(finishedAt) - Date.parse(startedAt));
  const usage = {
    input_tokens: out.usage.input_tokens + (u.prompt_tokens ?? 0),
    output_tokens: out.usage.output_tokens + (u.completion_tokens ?? 0),
    total_tokens: out.usage.total_tokens + (u.total_tokens ?? 0),
  };

  return {
    json: {
      ...out,
      markdown,
      judge: j ? { ...j, score: judgeScore, skipped } : null,
      judge_score: judgeScore,
      judge_skipped: skipped,
      unsupported_count: claims.length,
      usage,
      trace: {
        ...out.trace,
        end_time: finishedAt,
        outputs: { ...out.trace.outputs, response: markdown },
        metadata: { ...out.trace.metadata, judge_score: judgeScore, unsupported_claims: claims.length, total_tokens: usage.total_tokens },
        children: [...out.trace.children, {
          name: 'Fact-Check Judge',
          run_type: 'llm',
          start_time: startedAt,
          end_time: new Date(Date.parse(startedAt) + latencyMs).toISOString(),
          inputs: { messages: openaiRequest.messages },
          outputs: body,
          model: openaiRequest.model,
          temperature: openaiRequest.temperature,
        }],
      },
    },
  };
});
