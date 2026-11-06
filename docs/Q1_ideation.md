# Q1 — Ideation: AI agents for PM/TPM productivity at Nexora

**Context.** Nexora runs several client projects at once with a small PM/TPM team. Three recurring jobs consume most PM time and are done inconsistently:
- **Writing plans and risk registers:** 3–4 h per project, with no standard format.
- **Compiling status reports and stakeholder updates:** 1–2 h per week per project.
- **Spotting slipping milestones:** today this happens in retrospectives, too late to act.

Each use case below is a candidate for an agentic assistant. All three are implemented in Mira for the ABCDE Ltd. AI Adoption Project.

---

## Use case 1: Project kick-off pack (plan + risk assessment)

| | |
|---|---|
| **Pain point** | Turning a client brief into a phased plan and a risk matrix takes 3–4 h per project. Quality depends on who writes it: some projects have detailed risk matrices, others have none. Plans drift from what the client actually asked for. |
| **Agentic solution** | **Orchestrator** classifies the request and checks it has enough detail → **Planner Agent** builds the plan, phases, milestones and success metrics strictly from the description and timeline → **Risk Assessor** rates every register risk for likelihood and impact, links it to live task signals, and proposes a next step. If the brief is too vague, a **Clarifier** asks for scope, goals, timeline and team instead of inventing a plan. |
| **Inputs** | Project description, timeline (phases, weeks, milestones), risk register (category, impact, mitigation), and optionally the task board for live signals. |
| **Outputs** | A standard-format Markdown plan with a source quote for every objective. A risk matrix ranked by likelihood × impact, with affected use cases, owner and next step. A grounding score, so the PM knows what to review. |
| **Success metrics** | 1. **Time to first draft:** 3–4 h → under 15 min including PM review.<br>2. **Groundedness:** ≥ 95% of plan items and risk rationales traceable to the source data (checked automatically).<br>3. **Coverage and consistency:** 100% of projects have a risk matrix in the standard format; PM edit rate under 20% of items. |
| **Knowledge base** | Project brief, timeline and risk register per project. Nexora plan and risk templates. A library of past risk registers for similar domains (logistics, AI adoption) to suggest missing risks. |

## Use case 2: Weekly status report and stakeholder update

| | |
|---|---|
| **Pain point** | Each week PMs copy task-board data into a status report (1–2 h), then rewrite it for each audience. Numbers get miscounted, and slippage is softened or left out. |
| **Agentic solution** | **Status Reporter:** code computes counts, sprint scope, overdue, blocked and due-soon tasks and the RAG status; the LLM writes only the headline, concerns, focus and decisions. **Stakeholder Comms** drafts a professional email limited to the requested sprint, naming tasks exactly. Both are routed by the Orchestrator from a natural-language request ("status for Sprint 3", "update email for Sprint 2"). |
| **Inputs** | Task board export (CSV or Jira/Trello API): ID, name, status, assignee, priority, sprint, due date, description. Timeline milestones. Requested scope and audience. |
| **Outputs** | Weekly status report: RAG, counts, tasks by status, watch list, concerns, focus for next week, escalations. Stakeholder email: subject, completed, in progress, issues and impact, next steps, asks. |
| **Success metrics** | 1. **Report preparation time:** 1–2 h → under 10 min per project per week.<br>2. **Count accuracy:** 100% of counts and task IDs match the board (code-checked on every report).<br>3. **Adoption:** ≥ 80% of weekly reports and stakeholder updates generated with Mira, with PM satisfaction ≥ 4/5. |
| **Knowledge base** | Live task board.  Milestone list. Stakeholder directory (audience, preferred detail level). Report and email templates. |

## Use case 3: Proactive milestone and deadline alerts

| | |
|---|---|
| **Pain point** | Missed milestones are discovered in retrospectives. Nobody systematically cross-checks the timeline against task progress, so a blocked Sprint calendar. security review or an overdue data-gap analysis goes unnoticed until it delays a phase. |
| **Agentic solution** | **Milestone Tracker:** code links each milestone to the tasks due within its phase and applies explicit risk rules (Blocked / Overdue / At risk / Due soon) against an as-of date. The LLM explains why each milestone is at risk and proposes actions and escalations with owners. It can run on a schedule (e.g. every Monday) and post to Slack or email. |
| **Inputs** | Timeline (phases, dates, milestones). Task board. As-of date. Alert window (e.g. next 14 days). Due-soon threshold (e.g. 7 days). |
| **Outputs** | Milestones due in the window with status and linked tasks. Blocked and at-risk tasks with reasons. Recommended actions per owner. Escalations. |
| **Success metrics** | 1. **Lead time:** at-risk milestones flagged ≥ 7 days before their due date (vs. at retrospective today).<br>2. **Recall of known blockers:** 100% of Blocked and Overdue tasks surfaced (e.g. T024, T006 in the test data).<br>3. **Missed milestones:** fewer milestones slipping without a prior alert, target −50% within two quarters. |
| **Knowledge base** | Timeline. Task board. Dependency information (milestone ↔ task links). Escalation paths and owners. |

---

**Why agents rather than one prompt.** Each job needs different data, rules and output formats. A router sends each request to one specialist, so every agent stays small, testable and grounded in only the data it needs. Shared code computes the facts all agents rely on, so reports agree with each other.
