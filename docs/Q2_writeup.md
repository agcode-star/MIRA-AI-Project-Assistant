# Q2 — Building Mira: design, implementation, evaluation and cost

*Full detail, diagram and screenshots are in the [README](../README.md); the run-by-run build log is in [PLAN.md](../PLAN.md).*

## 1. Design

**Platform and tools.**
- **n8n Cloud** hosts the workflow, delivered as importable JSON.
- **OpenAI gpt-4o-mini** runs all agents. gpt-4o is used only for the optional fact-check judge.
- **LangSmith** handles tracing, feedback and experiments, called via its REST API because n8n Cloud cannot use the LangSmith environment variables.
- The four project files are embedded in a Knowledge Base code node, so the workflow is self-contained and reproducible.

**Orchestration pattern: Router / Dispatcher with a deterministic data layer.**
- PM requests are heterogeneous, so a sequential pipeline would run every agent on every request.
- A router runs exactly one specialist per request. That means one LLM call instead of five, lower cost and latency, and agents that can be tested in isolation.
- The **Orchestrator** (LLM, strict JSON) classifies intent, whether the request concerns the project on file, whether the details are sufficient, plus sprint and time window.
- A **code gate** then routes:
  - out of scope → Fallback (no LLM);
  - project data on file → the specialist;
  - a self-contained plan request with enough detail → Planner;
  - anything else → **Clarifier**.

**Agents:**
- Core: Planner, Risk Assessor, Status Reporter.
- Extended: **Milestone Tracker** and **Stakeholder Comms**.
- Support: Clarifier and Fallback.

Each agent is three nodes: Build Prompt (code) → OpenAI (strict `json_schema`) → Format Output (code + checks).

**Key design principle: code computes, the LLM writes.**
- Counts, sprint filters, overdue/blocked/due-soon flags, date windows, milestone↔task links, risk ranking and every table are produced in code. The model writes only the narrative.
- Schemas use **enums to restrict what the model can say**. Task IDs are limited to the in-scope tasks, every register risk must be rated, and evidence quotes come from a list of verbatim phrases taken from the project description.
- No tools or RAG are used: the knowledge base fits in context and code selects the relevant slice for each request.

## 2. Implementation

| Capability | Agent | Grounding mechanism |
|---|---|---|
| Project plan | Planner | Every objective, scope item, metric and governance item carries a verbatim source quote; quotes are verified |
| Risk assessment | Risk Assessor | All 10 register risks rated (keyed schema); live task signals; L×I ranking in code; next step must be an action, not the register's mitigation |
| Weekly status | Status Reporter | Scope, counts, RAG and tables in code; the narrative may cite only scoped task IDs and listed milestones |
| ★ Milestone alerts | Milestone Tracker | Milestone↔task linking and Blocked/Overdue/At risk/Due soon rules in code |
| ★ Stakeholder update | Stakeholder Comms | Sprint-scoped task enum; exact task names printed by code; out-of-scope names rejected |
| Vague input | Clarifier | Per-intent checklist; coverage verified; never produces a plan |

**Observability:**
- **Traces:** one LangSmith trace per request, with the tree Orchestrator → specialist → checks → judge. Model, tokens and latency are attached, so LangSmith computes cost.
- **Feedback:** evaluation scores are attached to each trace.
- **Experiments:** every test-suite run is uploaded as an experiment on dataset `mira-baseline`.

**Baseline testing:** **13/13 PASS** across T1–T12 plus an out-of-scope test X1, with **100% groundedness** and **100% routing accuracy**. Highlights:
- T10 counts match the CSV: Done 5 · In Progress 3 · Blocked 1 · To Do 16. The problem statement says "3 Done", but the data has 5.
- T8 identifies T024 as blocked.
- T12 contains only Sprint 2 tasks.

## 3. Evaluation strategy and metrics

There are three layers. Only the first two decide pass/fail:
1. **Test expectations:** expected route, status, exact counts, scope, and required or forbidden mentions.
2. **Deterministic grounding checks** on every answer, live chat included: quotes, IDs, numbers and dates in any format, invented milestones, out-of-scope tasks, actionable next steps, checklist coverage.
3. **LLM Fact-Check Judge** (gpt-4o): finds claim-level errors. **Advisory only.**

**Metrics tracked in LangSmith:**
- `pass_rate` and `route_accuracy`
- `groundedness` (share of narrative items verified against the data)
- `judge_score` (1–5) and `judge_material_claims`
- tokens, cost and latency

**Observations:**
- **Pass rate across 10 recorded experiments:** 70% → 90% → 92% → 100%. Every persistent failure was fixed by *constraining the output* (schemas, enums, code-rendered names), not by adding prompt instructions.
- **Judge precision on material claims:**
  - gpt-4o-mini: ≈ 9%, then ≈ 0% after prompt calibration;
  - gpt-4o: ≈ 33–67%, and identical claims were scored differently across runs.
- The judge did catch real errors the code missed. For example, T5 called tasks due in 8 and 11 days "due soon". So it is kept as a **review signal, not a gate**.
- **Remaining weakness:** claim-level errors that neither numbers nor IDs reveal. The next step is targeted deterministic checks, e.g. a "due soon" claim checked against the due-soon set.

## 4. Cost and latency

| | Tokens | Cost |
|---|---|---|
| **Per project plan** (T1) | 3,406 | **≈ $0.0008** |
| Full risk assessment | 8,711 | ≈ $0.002 |
| Status report | ~2,600–3,800 | ≈ $0.0004–0.0009 (measured in LangSmith: $0.0004 for the T5 Status Reporter call) |
| Full 13-test suite | 39,216 | ≈ $0.009 |
| + gpt-4o judge, full suite | +22,314 | + ≈ $0.07 (≈ 8× Mira itself) |

**Latency:** median 4.4 s per request; 12–15 s for full plans and risk assessments.

**At team scale (10 PMs, ~4,400 requests a month):** ≈ $3/month, or ≈ $28/month with the judge on every request. LLM cost is negligible next to the 3–4 h per plan and 1–2 h per report it replaces. The judge should run on a sample, and should be skipped for clarifier and fallback answers.
