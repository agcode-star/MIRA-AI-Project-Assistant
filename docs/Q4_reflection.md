# Q4 — Reflection and Next Steps

## 1. What the traces showed
LangSmith traces and experiments across 10 recorded test-suite runs revealed failures that the final pass/fail alone would have hidden:
- **The model follows the letter of a rule, not its intent.**
  - Asked for a risk assessment, it rated 3 of 10 risks.
  - Asked for evidence, it quoted the risk register back as evidence.
  - Asked for a next step "before Phase 3", it copied the prompt's example into all 10 risks.
  - Asked to name tasks exactly, it still paraphrased them.

  Each was fixed by **constraining the output** rather than rewriting the prompt: a keyed schema per risk, an enum of description phrases, a phase enum, and task names printed by code.
- **Grounding checks catch numbers, IDs and dates, but not claims.** A Sprint 2 report claimed "all tasks are overdue" (two were Done) while scoring 6/6 grounded. Other claim-level errors:
  - invented milestones ("security review milestone");
  - guessed dependencies;
  - in the final run, tasks due in 8 and 11 days called "due soon".
- **The LLM judge needs judging too.** Human review of its flags measured **≈ 9% precision** (gpt-4o-mini), **≈ 0%** after prompt calibration, and **≈ 33–67%** with gpt-4o, which still scored identical sentences differently across runs. Gating releases on it would have failed good outputs. It now runs as an advisory signal.
- **Cost and latency profile.** Median latency is 4.4 s; plans and risk assessments take 12–15 s. ≈ $0.0007 per request. The judge is ≈ 8× the cost of Mira, and part of that is wasted on answers with nothing to judge.

## 2. Improvement plan (priority order)
1. **Targeted claim checks in code** for the error classes the traces revealed: "due soon / this week" against the due-soon set; task ↔ milestone naming; "all/none" generalisations.
2. **Human-in-the-loop review step.** The PM approves or edits before an output is shared, and each edit is captured as a correction linked to the trace.
3. **Live data and multi-project support.** A Jira/Trello connector, project selection in the Orchestrator, and chat memory so answers to the Clarifier's questions flow into the plan.
4. **Judge economics.** Skip clarifier and fallback answers, sample about 20% of chat traffic, and recalibrate on a labelled set of claims.
5. **Product gaps noticed in outputs:**
   - Open questions in plans are empty.
   - Escalation of blocked tasks is inconsistent.
   - Top-3 risks differ slightly between the full assessment and the top-3 request.
   - Audience-specific stakeholder updates (leadership / engineering / client) are not yet built.

## 3. From evaluation to fine-tuning
The evaluation setup already produces the data that fine-tuning would need:
- **Dataset:** every LangSmith trace stores the exact input, the model's JSON output and its scores. Traces flagged by checks or the judge, then corrected by a PM, become *(input → corrected output)* pairs. Clean, high-scoring traces become positive examples.
- **Candidate:** the Risk Assessor's rationales and next steps. That's where most "generic" and "copied mitigation" issues appeared, and outputs vary most from run to run.
- **Gate:** a fine-tuned gpt-4o-mini is deployed only if it beats the prompted model on the `mira-baseline` experiment, compared side by side in LangSmith, at no loss of groundedness.
- **When not to fine-tune:** most fixes so far came from schemas and code, which are cheaper and more transparent. Fine-tuning is worth it only once ≥ 100–200 reviewed corrections exist and prompts stop improving results.

## 4. Privacy and data protection
- **Data involved:**
  - client project data (confidential);
  - employee names and workload from the task board (personal data under UK GDPR; Nexora is London-based).
- **LLM provider:**
  - OpenAI API data is not used for training by default.
  - For production, request zero data retention or use a regional deployment (Azure OpenAI EU/UK).
  - Send only the slice of data each agent needs. Code already does this.
- **Tracing is the biggest exposure:** traces store full prompts and outputs. To reduce it:
  - redact or pseudonymise assignee names before logging;
  - use LangSmith's EU region or self-hosting;
  - restrict project access;
  - keep the short retention (currently ~14 days).
- **Governance:**
  - a DPA with each vendor;
  - a record of processing;
  - client consent in the contract for AI-assisted reporting.
- **Human approval:** nothing goes to a client without PM approval.

## 5. Rolling out to 10 PMs/TPMs
1. **Pilot with 2 PMs (4 weeks)** on live projects. Mandatory review before sharing. Measure time saved and errors; turn every reported error into a test case.
2. **Enable:** a 45-minute onboarding session, a one-page "how to ask Mira" guide (with capabilities and limits), pilot PMs as champions, and a Slack support channel.
3. **Expand in waves** of 3–4 PMs every two weeks, with go/no-go based on the error rate (≤ 1 material error per 10 outputs) and PM rating (≥ 4/5).
4. **Operate:**
   - LangSmith dashboards for usage, cost, latency, groundedness and judge flags;
   - a weekly review of flagged traces;
   - a regression suite that must pass 100% before any prompt or model change;
   - a monthly steering review with the CTO.

**Lesson:** the biggest gains came from deciding **what the model is not allowed to do**: code owns the facts, schemas own the shape, and the model owns only the wording. Observability made each failure visible, and evaluation made each fix provable.
