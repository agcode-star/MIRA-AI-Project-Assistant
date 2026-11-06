# Mira — AI-Powered Project Intelligence Assistant
### n8n multi-agent workflow + LangSmith observability — Research & Build Plan

---

## 1. Research findings

### 1.1 What is being graded (from the Problem Statement)

| Area | Points | What it takes |
|---|---|---|
| Q1 Ideation | 15 | 2–3 PM/TPM use cases, each with pain point, solution, I/O, 3 metrics, knowledge base |
| Q2 Build Mira | 45 | Design 10 · Core capabilities 12 · Extended capability 8 · Observability 5 · Baseline tests 5 · Cost/eval 5 |
| Q3 Program Charter | 25 | Vision, scope, success criteria, timeline, risks, stakeholders, decision-making, rollout |
| Q4 Reflection | 15 | Trace findings, improvements, eval/fine-tuning link, privacy, rollout to 10 PMs |

**Mandatory:** multi-agent design, a documented orchestration pattern, prompt engineering, grounding in the data, and evaluation/observability.
**Core capabilities:** Project Plan, Risk Assessment, Weekly Status Report.
**Extended (at least one):** Milestone Alerts, Stakeholder Update, Resource Allocation, Competitive Analysis.
**Submission:** workflow JSON on GitHub with a README, screenshots (canvas, Mira running, traces), architecture diagram, all 12 test results, 1–2 page writeup, and a slide deck.

### 1.2 Source data (in `Resources/`)

| File | Contents | Notes |
|---|---|---|
| `project_description.txt` | 2-paragraph scope | Same as `ABCDE Ltd Introduction..txt` |
| `project_timeline.csv` | 8 phases, weeks 1–24 | Same as the timeline PDF |
| `project_risks.csv` | R01–R10 with category, impact, mitigation | The `.docx` has the same risks with slightly fuller mitigations |
| `sample_task_board.csv` | T001–T025, Sprints 1–10, due 2026-04-07 → 2026-08-04 | Primary data for status |
| `eval_mira_inputs.txt` | T1–T12 test prompts | Becomes the Langfuse dataset |

**⚠ Discrepancy found:** the problem statement says the task board has *"3 Done, 3 In Progress, 1 Blocked"*. The CSV actually has:

| Status | Count | Tasks |
|---|---|---|
| Done | **5** | T001–T005 |
| In Progress | 3 | T006, T007, T025 |
| Blocked | 1 | T024 (Security review) |
| To Do | 16 | the rest |

T10 says *"counts must match actual data"*, so Mira reports the CSV counts. The writeup should call out the mismatch.

**⚠ The project needs a "today".** Every date is in Apr–Aug 2026, so with the real date (Oct 2026) every task looks overdue. T8 ("at risk of missing deadline") and T11 ("next 2 weeks") need a configurable **as-of date**.
- The data implies Week 1 starts on **Mon 2026-03-30**: Sprint 1 tasks are due Apr 7–10 (inside weeks 1–2) and Sprint 2 tasks are due Apr 18–21 (inside weeks 3–4).
- The proposed default as-of date is **2026-04-24** (end of week 4, Sprint 2/3 boundary). This matches the board: T006 is overdue, T007 and T025 are in progress, and Sprint 3 is starting.

### 1.3 Observability options for n8n Cloud

- **LangSmith via environment variables** is n8n's only built-in tracing, and it is **self-hosted only** ([n8n docs](https://docs.n8n.io/advanced-ai/langchain/langsmith/)). n8n Cloud does not allow environment variables, so it isn't available here.
- **LangSmith via REST API** works on Cloud. HTTP Request nodes POST complete runs to `https://api.smith.langchain.com/runs/batch` with an `x-api-key` header ([trace-with-api](https://docs.langchain.com/langsmith/trace-with-api)). Each request becomes one trace: a root `chain` run with a child run per agent (`llm` runs carry tokens, cost and latency).
- **Langfuse** has no native n8n tracing either ([langfuse docs](https://langfuse.com/integrations/no-code/n8n)). Not used.
- **n8n Evaluations** (built in, works on Cloud): Evaluation Trigger, a dataset in an n8n Data Table, then Set Metrics (Correctness / Categorization / custom). Starter allows one evaluation workflow, which is enough ([docs](https://docs.n8n.io/advanced-ai/evaluations/metric-based-evaluations/)).

### 1.4 Decisions (confirmed)

| Category | Choice | Why |
|---|---|---|
| Platform | **n8n Cloud**, delivered as importable workflow JSON | The user already has n8n Cloud; JSON is the required submission format |
| LLM | **OpenAI gpt-4o-mini** | Course default; cheap; JSON mode for the router |
| Data | **Embedded in a "Knowledge Base" Code node** | Cloud has no local file access; the JSON stays self-contained so anyone importing it gets the same data |
| LLM call style | HTTP Request to OpenAI Chat Completions (with the n8n OpenAI credential) | Returns the `usage` token counts, which are forwarded to LangSmith for cost. The AI Agent node hides token usage |
| Tracing | **LangSmith REST** from n8n | The user prefers LangSmith; this is the only way to use it on Cloud |
| Evaluation | **n8n Evaluations** + LangSmith traces | Native test runner for the 12 baseline inputs |
| As-of date | **2026-04-24**, configurable in the Config node | Week 1 = 2026-03-30 |

---

## 2. Proposed architecture

**Pattern: Router / Dispatcher + deterministic data layer**

```
 Chat Trigger (n8n chat UI)   ·   Webhook (eval runner)
                  │
        ┌─────────▼──────────┐
        │  Context Loader    │  Code node: reads the 4 files, parses CSVs, computes FACTS
        │  (no LLM)          │  (status counts, per-sprint lists, overdue/blocked,
        └─────────┬──────────┘   week→date map, upcoming milestones vs as-of date)
                  │
        ┌─────────▼──────────┐
        │ Orchestrator Agent │  gpt-4o-mini → JSON {intent, uses_project_data, sprint,
        │ (router + gate)    │   sufficient_info, missing_fields[]}
        └─────────┬──────────┘
     insufficient │  Switch on intent
   ┌──────────────┼──────────────┬───────────────┬────────────────┬──────────────┐
   ▼              ▼              ▼               ▼                ▼              ▼
Clarifier     Planner        Risk Assessor   Status Reporter  Milestone       Stakeholder
(asks for     (description   (risks.csv +    (task board      Tracker ★       Comms ★
 scope, goals, + timeline)    description)    FACTS)          (timeline +     (sprint-filtered
 timeline,                                                     board FACTS)    tasks, audience)
 team size)
   └──────────────┴──────────────┴───────────────┴────────────────┴──────────────┘
                  │
        ┌─────────▼──────────┐
        │ Output Formatter   │  Markdown reply + "Sources used" footer
        └─────────┬──────────┘
                  ▼
        LangSmith Logger (HTTP → /runs/batch)
        trace "Mira" (tags=intent)     ├─ chain: knowledge-base
                                       ├─ llm: orchestrator (tokens, cost)
                                       └─ llm: <specialist> (tokens, cost)
   ★ = extended capability
```

**Design principles**
1. **Code computes, the LLM writes.** Counts, sprint filters, overdue checks and date windows are computed in a Code node and passed to agents as FACTS. This makes T5, T8, T10, T11 and T12 correct by construction, which is the strongest anti-hallucination measure available.
2. **Explicit insufficiency gate.** The orchestrator decides `sufficient_info` before any specialist runs. Vague requests (T2, T4, T6, T9) go to a Clarifier that asks for missing fields and never generates a plan.
3. **Every prompt follows ROLE / INPUT / OUTPUT / RULES / VAGUE-INPUT-RULE** (from the playbook), with cited IDs (R0x, T0xx, Phase n) so groundedness can be checked.
4. **One responsibility per agent.** Each specialist can be tested on its own before it is wired into the router.

**Stack:** n8n Cloud · OpenAI `gpt-4o-mini` · LangSmith via REST · n8n Evaluations · data embedded in the workflow.

**Why the agents have no tools:** the Knowledge Base node already supplies all grounded facts. Letting agents call tools to fetch data would add nondeterminism and more chances to hallucinate.

### Test-case → mechanism map

| Test | Route | What guarantees a pass |
|---|---|---|
| T1 | Planner | Description + timeline injected; rule: no goals beyond the description |
| T2, T9 | Clarifier | Gate: no scope/goals/deliverables → ask scope, timeline, team size |
| T3 | Risk | risks.csv + description; logistics/AI only |
| T4 | Clarifier | Gate: no project details |
| T5 | Status | FACTS filtered to Sprint 3, by status, real task names |
| T6 | Clarifier / Status | "No task data provided": never fabricate % or statuses |
| T7 | Risk | Ranks only R01–R10 and cites the IDs |
| T8 | Milestone Tracker | FACTS: blocked list (T024) + overdue/due-soon vs as-of date |
| T10 | Status | Counts from code: 5 / 3 / 1 / 16 |
| T11 | Milestone Tracker | FACTS: timeline phases ending within as-of date + 14 days |
| T12 | Stakeholder Comms | FACTS filtered to `sprint == Sprint 2` only |

---

## 3. Step-by-step build plan (each step = one importable JSON in `workflows/`, verified before the next)

| # | Step | Deliverable | Done when |
|---|---|---|---|
| 0 | **Accounts & credentials** | n8n credentials: *OpenAI* (API key) and *LangSmith* (Header Auth: `x-api-key`) | Both credentials saved in n8n |
| 1 ✅ | **Smoke test** `01_smoke_test_langsmith.json` | Trigger → OpenAI → LangSmith | Trace in LangSmith project `mira` shows the root run + child llm run with **tokens and cost** |
| 2 ✅ | **Knowledge Base** `02_knowledge_base.json` | Code node with embedded data + computed FACTS | Output shows counts 5/3/1/16, T024 blocked, week→date map, upcoming milestones |
| 3 ✅ | **Planner Agent** `03_planner_agent.json` | Strict-JSON agent + grounding check + trace + auto-scored tests | T1 grounded plan (18/18); T2 and T9 ask for clarification. Known gap: T1 open questions empty → Step 8 fix |
| 4 ✅ | **Risk Assessor** `04_risk_assessor.json` | Schema-forced rating of every register risk; register text, mitigations and L×I ranking from code; grounding + task-board consistency checks | T3, T4, T7 pass. Run 1: T7 FAIL (model rated 3/10 risks, quoted the register as evidence; T3 rated blocked R09 "Low") → fixed with keyed schema + prompt rules + consistency check. Run 2: all PASS, but 9/10 grounded ("reduce" vs "reducing") and next steps copied the register → inflection-tolerant quote match + specificity check. Run 3: 10/10 grounded and ✅, but every next step was the bare prompt example "before Phase 3: Use Case Selection" (model gamed the check) → split into `next_step` action + `next_step_before_phase` enum, stricter actionability check, review issues now fail the test. Run 4: all PASS, 10/10. Open for Step 8: R06 rationale claims budget is "managed effectively" (no budget data → needs LLM-as-judge); T3 vs T7 top-3 vary across runs |
| 5 ✅ | **Status Reporter** `05_status_reporter.json` | Scope (sprint/project) + counts, tables, RAG in code; LLM narrative cites scoped task IDs; numbers check | T5, T6, T10 pass first run, 7/7 and 8/8 grounded. Open for Step 8: no escalation proposed for blocked T024; number words ("four") not checked |
| 6 ✅ | **Orchestrator + Router** `06_mira_orchestrator.json` | Chat Trigger + test suite → Loop Over Items → Orchestrator (LLM intent + on-file flag, code gate) → Switch → Clarifier / Planner / Risk / Status / Fallback → one nested trace per request | T1–T7, T9, T10 + X1 pass through the router. Chat run 1: routing + Switch + chat reply OK; Sprint 2 report claimed "all tasks are overdue" (2 were Done) and grounding still 6/6 (claim-level error) → scoped overdue/blocked/due-soon counts added to facts + prompt rule; Step 8 LLM-as-judge for claims. HTML `<sub>` not rendered in chat → italics. Suite run 1: 7/10 PASS. T3 FAIL (no logistics terms – rationales generic) → `affected_use_cases` enum + column + review check; T7 FAIL 8/10 (free-text quotes copied the register again) → `evidence_quote` is now an enum of 20 verbatim description phrases extracted by the KB; T10 FAIL 7/8 (“April 26, 2026” flagged – check too narrow) → dates in any format validated against real data dates. Suite run 2: 9/10 – T10 flagged "7 days" (the due-soon window; check too strict) → config windows allowed; T3 tagged every risk with all 4 use cases → prompt + "not differentiated" review check. Open for Step 8: T5 claimed the audit milestone depends on T007/T025 (claim error) |
| 7 ✅ | **Extended: Milestone Tracker + Stakeholder Comms** `07_mira_complete.json` | Milestone window from the Orchestrator (`window_days`), milestone↔task linking and deadline-risk rules in code; Sprint-scoped email with in-scope task enum + out-of-scope name check; shared narrative-checks library | T8, T11, T12 pass; full suite T1–T12 + X1. Suite run 3: 12/13 – T8, T11 pass first time; T12 FAIL (email paraphrased task names: "Audit of existing data infrastructure") → code prints exact task names from cited task_ids. Suite run 4: **13/13 PASS, 100% grounded** (baseline). Still visible to a human reader: T5 "gap analysis report is overdue" (only T006 is), "T008/T009 due soon" (8d/11d), T10 "legal review milestone" (none exists), T7 next step cites T010 wrongly, T3 vs T7 rate R09 differently, T1 open questions empty, no escalation for blocked T024 |
| 8 ✅ | **Evaluation** `08_mira_judged.json` | 8a: Fact-Check Judge (2nd LLM call vs. the exact data each agent saw) on every response → score shown to PM, logged to LangSmith, `judge_min ≥ 4` test check. Run once for the *before* numbers, then fix. 8b: **LangSmith evaluation** (replaces n8n Evaluations, per the original requirement): every suite run is uploaded as an experiment on dataset `mira-baseline` (`/api/v1/datasets/upload-experiment`, fixed row_id per test) with scores pass / checks_passed / route_correct / groundedness / judge_score / tokens; every request (chat too) gets the same scores as trace feedback (`/api/v1/feedback`); `09_langsmith_history.json` uploads the 8 recorded runs (Step 6 run 1 → Step 8 run 4) so the comparison view shows the whole history | Judge catches the claim errors above; fixes raise judge scores; LangSmith experiment comparison across runs. **Run 1 (judge v1): 5/13 PASS** – but human review of the 34 flagged claims found only ~3 true positives (**judge precision ≈ 9%**): it flagged hedged risk language (17), "T006 overdue" as contradicting "In Progress" (3), milestone↔task links given in the data (6), code-rendered lines (5), and X1 scored 5/5 while listing the query; it also missed T10 "security review milestone". True positives: T12 "completed on schedule" (no completion dates exist), T12 "will support logistics optimization", T5 "critical for upcoming milestones" (borderline). → **Judge v2**: judges only the model-written JSON narrative (not code-rendered Markdown), calibration rules + examples (hedged risks OK, In Progress can be overdue, linked tasks = dependency), per-claim severity with the score computed in code, fallback = n/a. Mira fixes for the true positives: comms "no on-schedule/outcome claims", status "only listed milestones". **Run 2 (judge v2, gpt-4o-mini): 6/13 PASS** – Mira fixes held (no "on schedule", no invented milestone) but the judge flagged 31 claims with ~0–1 true positives: objectives copied verbatim from the description, hedged risks (despite the rule), the Clarifier's own reason, the user's request, "overdue by 3d" that the data states. Calibration by prompt failed → it is a judge-model capability limit. → **Judge v3**: `judgeModel` = gpt-4o (stronger than the generator), only *material* claims gate the test (minor ones are reported), data-based routes only (Clarifier/Fallback = n/a), "point to the contradicting DATA line or do not flag". **Run 3 (judge v3, gpt-4o): 10/13 PASS.** Material flags 3 → 2 true positives (**material precision ≈ 67%**, vs ≈9% / ≈0% with gpt-4o-mini): T10 "security review milestone" (invented – prompt rule had not held), T5 "T006 may impact the audit/gap reports" (Status Reporter was never given milestone↔task links – the claim was a guess). FP: T7 R09 (judge confused by the model's internal priority_rank). Minor flags still noisy (T3: 10 hedged risks) → reported only. Fixes: Status Reporter now receives each milestone's linked tasks + "only these milestones, exact names"; code check rejects "X milestone" phrases that name no real milestone (grounding failure); judge no longer sees priority_rank. **Run 4 (judge v3): 10/13 PASS** – fixes held (T10 invented milestone gone, T7 judge FP gone). Material flags: T12 "gap analysis report due for the current systems audit" (✅ real: merges two milestones), T5 (❌ data now links T006 to both milestones; the identical sentence in T10 scored 5/5 – judge inconsistency), T3 (❌ pedantic plural). Two-run material precision ≈ 50% and inconsistent across identical claims → **decision: judge is advisory (INFO, shown to PM + LangSmith), pass/fail stays on deterministic checks**. Comms prompt: milestones are separate, exact names. **07 + LangSmith eval run (2026-11-02): 13/13 PASS, 100% grounded**; 34 feedback items posted; experiment `mira-complete 2026-11-02 17:55` created on dataset `mira-baseline` (externally managed, trace_tier shortlived ≈14-day retention → screenshot early). Human-review misses (not caught by checks): T5 calls T008/T009 (8d/11d) "due within the next week"; T10 focus line calls T006 "the gap analysis report". **08 + LangSmith eval run (2026-11-02): 13/13 PASS (deterministic), avg judge 3.5/5**; experiment `mira-judged 2026-11-02 18:32`, 49 feedback items incl. judge_score. Judge review – material flags 6: ✅ T5 "T008/T009 due soon" (8d/11d; the error checks missed), ✅ T8 "both issues risk the 04-26 milestones" (T024 is linked to the 06-07 milestone), ≈ T7 "integration critical at this phase" (opinion), ❌ T5 + T12 "T006 impacts audit/gap report" (data links T006 to both – same claim judged differently in earlier runs), ❌ T7 "security threat given current tasks" (T024 blocked supports it). Material precision 2–3/6 ≈ 33–50%; missed T10 "Complete the gap analysis report (T006)". Minor flags T3 2/2 noise. Confirms: judge = advisory signal that surfaces real errors for review; deterministic checks gate. **09 history upload (2026-11-02): 8/8 experiments created** – dataset `mira-baseline` now holds 10 experiments (Step 6 run 1 → mira-judged). First attempt failed: LangSmith rejects scores with >4 decimals (422) and historical timestamps before the dataset existed (500) → scores rounded, history timestamped at upload time with original run time in metadata. |
| 9 ✅ | **Docs & submission** | README (diagram, results, cost), screenshots, docs/Q1–Q4, slide deck (claude.ai artifact), GitHub repo github.com/agcode-star/MIRA-AI-Project-Assistant | Pushed 2026-11-06 |

### Data findings from Step 2 (for the writeup)
- **Task board ≠ problem statement:** 5 Done, not 3 (see 1.2).
- **Task board runs about 5 weeks ahead of the timeline.** The last task (T023 closure report) is due 2026-08-04, but Phase 8 (Monitoring & Review) runs 2026-08-31 → 09-13. The status agents report each source as-is and don't try to reconcile them.
- **Workload is perfectly even:** 4 open tasks per assignee. A Resource Allocation Advisor would have little to say, which supports choosing **Milestone Tracker + Stakeholder Comms** as the extended capabilities.
- At as-of 2026-04-24: Phase 2 is current, the current sprint is Sprint 3, T006 is overdue, T007/T025 are due 04-28, T024 is blocked, and the next milestones are the Phase 2 reports (due 04-26).

### Production metrics (draft)
1. **Plan groundedness:** % of plan milestones traceable to the description/timeline.
2. **Risk relevance:** % of risks citing an R-ID or a project-specific factor.
3. **Status accuracy:** % of counts and task IDs matching the CSV (checked automatically).
4. **Clarification precision:** % of vague inputs correctly refused (T2, T4, T6, T9 type).
5. Cost and latency per request (from Langfuse).

---
