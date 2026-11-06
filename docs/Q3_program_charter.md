# Q3 — Program Charter: Mira, AI Project Intelligence Assistant

| | |
|---|---|
| **Program** | Mira: AI-powered project intelligence for Nexora PMs/TPMs |
| **Sponsor** | CTO, Nexora Pvt. Ltd. |
| **Program owner** | AI PM/TPM (author) |
| **Duration** | 16 weeks: pilot to team-wide rollout |
| **Status** | Prototype complete: 13/13 baseline tests passed, LangSmith observability live |

## 1. Vision
Every Nexora PM/TPM can get a grounded, standard-format plan, risk assessment, status report, milestone alert or stakeholder update in minutes, freeing their time for decisions and stakeholders rather than document assembly. Mira never invents a task, risk or milestone that is not in the project data.

## 2. Problem and objectives
**Problem:** Nexora's PMs face five recurring problems:
- Too few PMs to cover all the concurrent projects.
- Plans take 3–4 h each.
- Risk assessments are inconsistent.
- Status reports take 1–2 h a week.
- Milestones are missed because nobody gets a proactive alert.

**Objectives:**
1. Cut document preparation time by ≥ 70%.
2. Standardise plan, risk, status and update formats across all projects.
3. Flag at-risk milestones at least 7 days before they are due.
4. Keep every generated output traceable to the source data, verified automatically.

## 3. Scope
| In scope | Out of scope (this program) |
|---|---|
| The 5 capabilities: plan, risk assessment, weekly status, milestone alerts, stakeholder updates | Autonomous actions: Mira never updates tickets or sends emails without a PM |
| Chat interface in n8n; scheduled weekly alerts | Resource allocation advisor, competitive analysis (backlog) |
| Task board integration (CSV → Jira/Trello API); one knowledge base per project | Fine-tuned models (Phase 3 option, see Q4) |
| LangSmith tracing, evaluation and cost monitoring | Client-facing access to Mira |
| Onboarding of 10 PMs/TPMs | Non-PM teams |

## 4. Success criteria
| Area | KPI | Target | Measured by |
|---|---|---|---|
| Productivity | Time to first draft (plan / status report) | 3–4 h → ≤ 15 min; 1–2 h → ≤ 10 min | PM time logs, before and after |
| Quality | Groundedness of generated outputs | ≥ 95% (prototype: 100%) | Deterministic checks → LangSmith feedback |
| Quality | Baseline regression suite pass rate | 100% before every release | LangSmith experiments on `mira-baseline` |
| Accuracy | Status counts and task IDs matching the board | 100% | Code checks on every report |
| Trust | Material errors found in PM review | ≤ 1 per 10 outputs | Review sample + judge flags |
| Adoption | Weekly active PMs / reports generated with Mira | 8 of 10 PMs; ≥ 80% of reports | n8n executions, LangSmith traces |
| Satisfaction | PM rating | ≥ 4 / 5 | Monthly survey + thumbs-up/down feedback in traces |
| Cost | LLM cost per request | ≤ $0.01 (prototype ≈ $0.0007) | LangSmith cost tracking |

## 5. Timeline and milestones
| Phase | Weeks | Activities | Exit criterion (go/no-go) |
|---|---|---|---|
| **0. Prototype** ✅ | done | Multi-agent workflow, 5 capabilities, 12 baseline tests, LangSmith | 13/13 pass, 100% grounded |
| **1. Harden** | 1–4 | Live Jira/Trello connector; multi-project knowledge base; chat memory for clarifications; targeted claim checks (e.g. due-soon); PII redaction in traces; skip judge on non-data answers | Regression suite 100%; security review passed |
| **2. Pilot** | 5–8 | 2 PMs, 2–3 live projects; PM reviews every output before sharing (human in the loop); collect corrections | Time saving ≥ 50%; ≤ 1 material error per 10 outputs; PM rating ≥ 4 |
| **3. Expand** | 9–12 | Onboard all 10 PMs; scheduled Monday milestone alerts to Slack/email; audience-specific updates (leadership / engineering / client) | ≥ 8 weekly active PMs |
| **4. Operate and improve** | 13–16 | Monthly evaluation review; grow the test dataset from real corrections; decide on fine-tuning (Q4) | KPIs met for 4 consecutive weeks → steady state |

## 6. Risks
| # | Risk | L | I | Mitigation | Owner |
|---|---|---|---|---|---|
| 1 | Hallucinated or misleading claims reach a client | M | H | Code-computed facts and enums; grounding checks; advisory judge; PM review required before sharing; regression suite | Program owner |
| 2 | Confidential client or personal data leaks via LLM or tracing | L | H | OpenAI API (no training on API data); LangSmith redaction of names; retention limits; access control; DPA review | Security / DPO |
| 3 | Low adoption, as PMs keep their old templates | M | M | Co-design templates with pilot PMs; show time saved; champions; outputs match Nexora formats | Program owner + PM lead |
| 4 | Task board data is incomplete or stale, so reports are wrong | M | M | Data-quality warnings in outputs; Mira states the as-of date and the source; PMs own board hygiene | PM team |
| 5 | Model or provider changes break behaviour | M | M | Pinned model version; regression suite on every change; LangSmith comparison before switching | Engineering |
| 6 | Over-reliance: PMs stop checking outputs | M | H | Grounding and judge scores shown in every output; "review required" policy; periodic audits | PM lead |
| 7 | Cost growth with usage or the judge | L | L | Judge on a sample only; cost dashboards and alerts in LangSmith | Engineering |

## 7. Stakeholders
| Stakeholder | Interest | Role (RACI) |
|---|---|---|
| CTO (sponsor) | Productivity, consistency, risk | **A**: approves scope, budget, go/no-go |
| AI PM/TPM (program owner) | Delivery of Mira | **R**: roadmap, evaluation, rollout |
| PMs/TPMs (10 users) | Less admin, better visibility | **C** (design, pilot) → **I** (releases); pilot PMs are co-owners of templates |
| Engineering / ML (2 engineers, part-time) | Build, integrations, reliability | **R**: connectors, workflow, monitoring |
| Security & Data Protection | GDPR, client confidentiality | **C**: sign-off on data flows and tracing |
| Client stakeholders (e.g. ABCDE Ltd.) | Accurate, timely updates | **I**: receive PM-approved outputs only |

## 8. Decision-making and governance
- **Steering:** a monthly 30-minute review (CTO, program owner, PM lead, security). They decide phase gates using the exit criteria in §5.
- **Weekly working session:** program owner, engineers and pilot PMs review LangSmith traces flagged by checks or the judge, and agree fixes.
- **Release rule:** no prompt, model or workflow change goes live unless the `mira-baseline` regression suite passes 100%. The LangSmith experiment comparison is attached to the change.
- **Quality escalation:** a material error reported by a PM becomes a new test case within one week.
- **Decision rights:**
  - program owner: prompts and templates;
  - engineering: integrations;
  - security: data handling;
  - CTO: scope and budget.

## 9. Rollout plan
1. **Pilot (2 PMs):** live projects, mandatory review before sharing, weekly feedback, and corrections captured as test cases.
2. **Enablement:** a 45-minute onboarding session, a one-page prompt guide ("what Mira can and can't do"), and a Slack channel for support. Pilot PMs act as champions.
3. **Staged expansion:** add 3–4 PMs every two weeks, with go/no-go based on KPIs and error rate.
4. **Integrations:** a Jira/Trello connector per project; Monday milestone alerts to the PM's Slack channel.
5. **Measurement:** baseline PM time before onboarding, then measure at weeks 4 and 8. Track adoption and errors in LangSmith dashboards.
6. **Steady state:** monthly evaluation review, test dataset grown from real usage, and a quarterly decision on new capabilities (resource allocation, audience-specific updates) and fine-tuning.

**Budget (indicative):**
- LLM: ≈ $3–30 per month for 10 PMs.
- LangSmith team plan.
- n8n Cloud plan.
- About 0.5 FTE engineering for 12 weeks, plus program owner time.
