"""Builds the importable n8n workflow JSON files in workflows/ from src/*.js and Resources/.

Usage:  python build_workflows.py
"""
import json
import uuid
from pathlib import Path

ROOT = Path(__file__).parent
SRC = ROOT / "src"
RES = ROOT / "Resources"
OUT = ROOT / "workflows"


def nid():
    return str(uuid.uuid4())


def js(name):
    return (SRC / name).read_text(encoding="utf-8")


def embed(text):
    """Escape text for a JS template literal."""
    return text.replace("\\", "\\\\").replace("`", "\\`").replace("${", "\\${")


def knowledge_base_js():
    code = js("knowledge_base.js")
    for placeholder, file in [
        ("__PROJECT_DESCRIPTION__", "project_description.txt"),
        ("__TIMELINE_CSV__", "project_timeline.csv"),
        ("__RISKS_CSV__", "project_risks.csv"),
        ("__TASKS_CSV__", "sample_task_board.csv"),
    ]:
        code = code.replace(placeholder, embed((RES / file).read_text(encoding="utf-8").strip()))
    return code


# ---------- Node factories ----------

def manual_trigger(name, pos):
    return {"id": nid(), "name": name, "type": "n8n-nodes-base.manualTrigger", "typeVersion": 1,
            "position": pos, "parameters": {}}


def set_node(name, pos, fields):
    assignments = [{"id": nid(), "name": k, "value": v, "type": t} for k, v, t in fields]
    return {"id": nid(), "name": name, "type": "n8n-nodes-base.set", "typeVersion": 3.4, "position": pos,
            "parameters": {"assignments": {"assignments": assignments}, "options": {}}}


def code_node(name, pos, code):
    return {"id": nid(), "name": name, "type": "n8n-nodes-base.code", "typeVersion": 2, "position": pos,
            "parameters": {"jsCode": code}}


def sticky(name, pos, content, width=600, height=200):
    return {"id": nid(), "name": name, "type": "n8n-nodes-base.stickyNote", "typeVersion": 1, "position": pos,
            "parameters": {"width": width, "height": height, "content": content}}


def config_node(pos):
    return set_node("Config", pos, [
        ("model", "gpt-4o-mini", "string"),
        ("judgeModel", "gpt-4o", "string"),
        ("langsmithProject", "mira", "string"),
        ("langsmithEndpoint", "https://api.smith.langchain.com", "string"),
        ("asOfDate", "2026-04-24", "string"),
        ("projectStartDate", "2026-03-30", "string"),
        ("upcomingWindowDays", 14, "number"),
        ("dueSoonDays", 7, "number"),
        ("temperature", 0.2, "number"),
        ("maxTokens", 3000, "number"),
    ])


def openai_node(name, pos):
    return {"id": nid(), "name": name, "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2, "position": pos,
            "parameters": {"method": "POST", "url": "https://api.openai.com/v1/chat/completions",
                           "authentication": "predefinedCredentialType", "nodeCredentialType": "openAiApi",
                           "sendBody": True, "specifyBody": "json",
                           "jsonBody": "={{ JSON.stringify($json.openaiRequest) }}",
                           "options": {"response": {"response": {"fullResponse": True}}}}}


def langsmith_node(name, pos):
    return {"id": nid(), "name": name, "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2, "position": pos,
            "parameters": {"method": "POST", "url": "={{ $('Config').first().json.langsmithEndpoint }}/runs/batch",
                           "authentication": "genericCredentialType", "genericAuthType": "httpHeaderAuth",
                           "sendBody": True, "specifyBody": "json",
                           "jsonBody": "={{ JSON.stringify($json.batch) }}", "options": {}}}


def langsmith_post(name, pos, path, body):
    """POST to a LangSmith REST path; failures are logged but never stop the chat reply."""
    return {"id": nid(), "name": name, "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2, "position": pos,
            "onError": "continueRegularOutput",
            "parameters": {"method": "POST", "url": f"={{{{ $('Config').first().json.langsmithEndpoint }}}}{path}",
                           "authentication": "genericCredentialType", "genericAuthType": "httpHeaderAuth",
                           "sendBody": True, "specifyBody": "json", "jsonBody": body, "options": {}}}


def if_node(name, pos, left, right):
    """True (output 0) when `left` (an expression) is not equal to `right`."""
    return {"id": nid(), "name": name, "type": "n8n-nodes-base.if", "typeVersion": 2.2, "position": pos,
            "parameters": {"conditions": {
                "options": {"caseSensitive": True, "leftValue": "", "typeValidation": "strict", "version": 2},
                "conditions": [{"id": nid(), "leftValue": left, "rightValue": right,
                                "operator": {"type": "string", "operation": "notEquals"}}],
                "combinator": "and"}, "options": {}}}


def experiment_js(test_ids, judge):
    """Experiment uploader with a fixed row_id per test, so tests line up across LangSmith experiments."""
    row_ids = {t: str(uuid.uuid5(uuid.NAMESPACE_URL, f"mira-baseline/{t}")) for t in test_ids}
    suite = {"name": "mira-judged" if judge else "mira-complete", "judge": judge,
             "description": "Full Mira workflow" + (" + gpt-4o Fact-Check Judge (advisory)" if judge else "")}
    return (js("langsmith_experiment.js").replace("__ROW_IDS__", json.dumps(row_ids))
            .replace("__SUITE__", json.dumps(suite)))


def test_cases_js(test_ids, with_route=False, judge_min=None):
    return (js("test_cases.js").replace("__TEST_IDS__", json.dumps(test_ids))
            .replace("__WITH_ROUTE__", "true" if with_route else "false")
            .replace("__JUDGE_MIN__", json.dumps(judge_min)))


def eval_results_js(format_node=None):
    """Scorer reading a format node's outputs (step workflows) or its own input (full Mira loop)."""
    if format_node:
        outputs = f"$('{format_node}').all().map((i) => i.json)"
        trace_ids = "$('LangSmith: Build Trace').all().map((i) => i.json.trace_id)"
    else:
        outputs = "$input.all().map((i) => i.json)"
        trace_ids = "outputs.map((o) => o.langsmith_trace_id)"
    return js("eval_results.js").replace("__OUTPUTS__", outputs).replace("__TRACE_IDS__", trace_ids)


def chain(*names):
    return {a: {"main": [[{"node": b, "type": "main", "index": 0}]]} for a, b in zip(names, names[1:])}


def save(filename, name, nodes, connections):
    wf = {"name": name, "nodes": nodes, "connections": connections, "pinData": {},
          "settings": {"executionOrder": "v1"}, "tags": []}
    path = OUT / filename
    path.write_text(json.dumps(wf, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"wrote {path.relative_to(ROOT)} ({len(nodes)} nodes)")


# ---------- Steps ----------

def step2():
    nodes = [
        manual_trigger("Run Knowledge Base", [0, 0]),
        config_node([220, 0]),
        code_node("Knowledge Base", [440, 0], knowledge_base_js()),
        code_node("Self-Check", [660, 0], js("self_check.js")),
        sticky("Setup Notes", [140, -280],
               "## Mira – Step 2: Knowledge Base\n"
               "No credentials needed. Click **Execute workflow**.\n"
               "- **Knowledge Base** → embedded project data + computed `facts` (counts, overdue, blocked, milestones, sprints, workload).\n"
               "- **Self-Check** → should say **ALL 13 CHECKS PASSED**.\n"
               "- Change `asOfDate` in **Config** to simulate a different 'today'.",
               width=640, height=220),
    ]
    save("02_knowledge_base.json", "Mira – Step 2: Knowledge Base",
         nodes, chain("Run Knowledge Base", "Config", "Knowledge Base", "Self-Check"))


def step3():
    names = ["Run Planner Tests", "Config", "Knowledge Base", "Test Cases", "Planner: Build Prompt",
             "OpenAI: Planner Agent", "Planner: Format Output", "LangSmith: Build Trace", "LangSmith: Log Trace",
             "Test Results"]
    x = lambda i: [i * 220, 0]
    nodes = [
        manual_trigger(names[0], x(0)),
        config_node(x(1)),
        code_node(names[2], x(2), knowledge_base_js()),
        code_node(names[3], x(3), test_cases_js(["T1", "T2", "T9"])),
        code_node(names[4], x(4), js("planner_prompt.js")),
        openai_node(names[5], x(5)),
        code_node(names[6], x(6), js("planner_format.js")),
        code_node(names[7], x(7), js("langsmith_trace.js")),
        langsmith_node(names[8], x(8)),
        code_node(names[9], x(9), eval_results_js("Planner: Format Output")),
        sticky("Setup Notes", [600, -320],
               "## Mira – Step 3: Planner Agent (T1, T2, T9)\n"
               "1. **OpenAI: Planner Agent** → select your *OpenAI* credential.\n"
               "2. **LangSmith: Log Trace** → select your *LangSmith* Header Auth credential (from Step 1).\n"
               "3. **Execute workflow** → open **Test Results**: each test shows PASS/FAIL, checks, and the rendered `response` (Markdown).\n"
               "4. LangSmith project **mira** → 3 traces tagged `planner` + T1/T2/T9, each with *Planner Agent* (llm) and *Grounding Check* runs.\n"
               "Edit **Test Cases** to try your own requests.",
               width=760, height=250),
    ]
    save("03_planner_agent.json", "Mira – Step 3: Planner Agent", nodes, chain(*names))


def step4():
    names = ["Run Risk Tests", "Config", "Knowledge Base", "Test Cases", "Risk Assessor: Build Prompt",
             "OpenAI: Risk Assessor", "Risk Assessor: Format Output", "LangSmith: Build Trace", "LangSmith: Log Trace",
             "Test Results"]
    x = lambda i: [i * 220, 0]
    nodes = [
        manual_trigger(names[0], x(0)),
        config_node(x(1)),
        code_node(names[2], x(2), knowledge_base_js()),
        code_node(names[3], x(3), test_cases_js(["T3", "T4", "T7"])),
        code_node(names[4], x(4), js("risk_prompt.js")),
        openai_node(names[5], x(5)),
        code_node(names[6], x(6), js("risk_format.js")),
        code_node(names[7], x(7), js("langsmith_trace.js")),
        langsmith_node(names[8], x(8)),
        code_node(names[9], x(9), eval_results_js("Risk Assessor: Format Output")),
        sticky("Setup Notes", [600, -340],
               "## Mira – Step 4: Risk Assessor (T3, T4, T7)\n"
               "1. **OpenAI: Risk Assessor** → select your *OpenAI* credential.\n"
               "2. **LangSmith: Log Trace** → select your *LangSmith* Header Auth credential.\n"
               "3. **Execute workflow** → open **Test Results** for PASS/FAIL, checks and the rendered `response`.\n"
               "4. LangSmith project **mira** → 3 traces tagged `risk` + T3/T4/T7 (*Risk Assessor* llm + *Grounding Check*).\n"
               "The model may only rate/link register risks by ID; risk text, mitigations and ranking come from code.",
               width=780, height=260),
    ]
    save("04_risk_assessor.json", "Mira – Step 4: Risk Assessor", nodes, chain(*names))


def step5():
    names = ["Run Status Tests", "Config", "Knowledge Base", "Test Cases", "Status Reporter: Build Prompt",
             "OpenAI: Status Reporter", "Status Reporter: Format Output", "LangSmith: Build Trace", "LangSmith: Log Trace",
             "Test Results"]
    x = lambda i: [i * 220, 0]
    nodes = [
        manual_trigger(names[0], x(0)),
        config_node(x(1)),
        code_node(names[2], x(2), knowledge_base_js()),
        code_node(names[3], x(3), test_cases_js(["T5", "T6", "T10"])),
        code_node(names[4], x(4), js("status_prompt.js")),
        openai_node(names[5], x(5)),
        code_node(names[6], x(6), js("status_format.js")),
        code_node(names[7], x(7), js("langsmith_trace.js")),
        langsmith_node(names[8], x(8)),
        code_node(names[9], x(9), eval_results_js("Status Reporter: Format Output")),
        sticky("Setup Notes", [600, -340],
               "## Mira – Step 5: Status Reporter (T5, T6, T10)\n"
               "1. **OpenAI: Status Reporter** → select your *OpenAI* credential.\n"
               "2. **LangSmith: Log Trace** → select your *LangSmith* Header Auth credential.\n"
               "3. **Execute workflow** → open **Test Results** for PASS/FAIL, checks and the rendered `response`.\n"
               "4. LangSmith project **mira** → 3 traces tagged `status` + T5/T6/T10.\n"
               "Scope, counts, task tables and RAG come from code; the model writes only the narrative.",
               width=780, height=260),
    ]
    save("05_status_reporter.json", "Mira – Step 5: Status Reporter", nodes, chain(*names))


def chat_trigger(name, pos):
    return {"id": nid(), "name": name, "type": "@n8n/n8n-nodes-langchain.chatTrigger", "typeVersion": 1.1,
            "position": pos, "webhookId": nid(), "parameters": {"options": {}}}


def loop_node(name, pos):
    """Loop Over Items (batch size 1). Output 0 = done (all results), output 1 = next item."""
    return {"id": nid(), "name": name, "type": "n8n-nodes-base.splitInBatches", "typeVersion": 3, "position": pos,
            "parameters": {"batchSize": 1, "options": {}}}


def switch_node(name, pos, field, routes):
    """Switch on an exact string match of `field`; one named output per (value, label)."""
    rules = [{"conditions": {"options": {"caseSensitive": True, "leftValue": "", "typeValidation": "strict", "version": 2},
                             "conditions": [{"id": nid(), "leftValue": f"={{{{ $json.{field} }}}}", "rightValue": value,
                                             "operator": {"type": "string", "operation": "equals"}}],
                             "combinator": "and"},
              "renameOutput": True, "outputKey": label} for value, label in routes]
    return {"id": nid(), "name": name, "type": "n8n-nodes-base.switch", "typeVersion": 3.2, "position": pos,
            "parameters": {"rules": {"values": rules}, "options": {}}}


def link(connections, src, dst, out=0):
    outs = connections.setdefault(src, {"main": []})["main"]
    while len(outs) <= out:
        outs.append([])
    outs[out].append({"node": dst, "type": "main", "index": 0})


MIRA_TESTS = ["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8", "T9", "T10", "T11", "T12", "X1"]

LOOP_BACK_JS = """// Loop-back: re-emit this request's response with its LangSmith trace ID (the API reply itself is not needed).
const traceIds = $('LangSmith: Build Trace').all().map((i) => i.json.trace_id);
return $('__RESPONSE_NODE__').all().map((i, k) => {
  const { trace, ...rest } = i.json;
  return { json: { ...rest, langsmith_trace_id: traceIds[k], started_at_trace: trace.start_time, ended_at_trace: trace.end_time } };
});
"""


def with_checks(name):
    """Agent code prefixed with the shared narrative checks library."""
    return js("lib_narrative_checks.js") + js(name)


def mira(judge=False):
    """The complete Mira workflow: chat + test suite → Orchestrator → 6 agents + Fallback
    (+ Fact-Check Judge on every response when judge=True, Step 8)."""
    response_node = "Judge: Score" if judge else "Collect Response"
    agents = [  # (route value, label, prompt js, format code, y)
        ("clarifier", "Clarifier", "clarifier_prompt.js", js("clarifier_format.js"), 0),
        ("planner", "Planner", "planner_prompt.js", js("planner_format.js"), 220),
        ("risk", "Risk Assessor", "risk_prompt.js", js("risk_format.js"), 440),
        ("status", "Status Reporter", "status_prompt.js", js("status_format.js"), 660),
        ("milestone", "Milestone Tracker", "milestone_prompt.js", with_checks("milestone_format.js"), 880),
        ("comms", "Stakeholder Comms", "comms_prompt.js", with_checks("comms_format.js"), 1100),
    ]
    agent_name = {"Planner": "Planner Agent"}
    nodes = [
        chat_trigger("Chat with Mira", [0, 0]),
        manual_trigger("Run Test Suite", [0, 220]),
        code_node("Requests", [220, 110], test_cases_js(MIRA_TESTS, with_route=True, judge_min=0 if judge else None)),
        config_node([440, 110]),
        code_node("Knowledge Base", [660, 110], knowledge_base_js()),
        code_node("Queue Requests", [880, 110], "// Hand the requests (not the knowledge base) to the loop.\nreturn $('Requests').all();\n"),
        loop_node("Loop Over Requests", [1100, 110]),
        code_node("Results", [1320, -160], eval_results_js()),
        code_node("Orchestrator: Build Prompt", [1320, 330], js("orchestrator_prompt.js")),
        openai_node("OpenAI: Orchestrator", [1540, 330]),
        code_node("Orchestrator: Route", [1760, 330], js("orchestrator_route.js")),
        switch_node("Route to Agent", [1980, 330], "route",
                    [(r, label) for r, label, *_ in agents] + [("fallback", "Fallback")]),
        code_node("Fallback", [2640, 1320], js("fallback.js")),
        code_node("Collect Response", [2860, 660], js("collect_response.js")),
        code_node("LangSmith: Build Trace", [3080, 660], js("langsmith_trace.js")),
        langsmith_node("LangSmith: Log Trace", [3300, 660]),
        code_node("Next Request", [3520, 660], LOOP_BACK_JS.replace("__RESPONSE_NODE__", response_node)),
        code_node("LangSmith: Build Feedback", [1540, -160], js("langsmith_feedback.js")),
        langsmith_post("LangSmith: Post Feedback", [1760, -160], "/api/v1/feedback", "={{ JSON.stringify($json) }}"),
        if_node("Test Suite?", [1980, -160], "={{ $('Results').first().json.test_id }}", "chat"),
        code_node("LangSmith: Build Experiment", [2200, -260], experiment_js(MIRA_TESTS, judge)),
        langsmith_post("LangSmith: Upload Experiment", [2420, -260], "/api/v1/datasets/upload-experiment",
                       "={{ JSON.stringify($json.body) }}"),
        code_node("Chat Reply", [2200, -60],
                  "// Chat: reply with the response text (the Chat Trigger shows the last node's `output`).\n"
                  "return $('Results').all().map((i) => ({ json: { output: i.json.output } }));\n"),
    ]
    if judge:  # Judge sits between Collect Response and LangSmith; trace/log nodes move right.
        nodes += [code_node("Judge: Build Prompt", [3080, 660], js("judge_prompt.js")),
                  openai_node("OpenAI: Judge", [3300, 660]),
                  code_node("Judge: Score", [3520, 660], js("judge_score.js"))]
        for n in nodes:
            if n["name"] in ("LangSmith: Build Trace", "LangSmith: Log Trace", "Next Request"):
                n["position"] = [n["position"][0] + 660, n["position"][1]]
    conn = {}
    for a, b in [("Chat with Mira", "Requests"), ("Run Test Suite", "Requests"), ("Requests", "Config"),
                 ("Config", "Knowledge Base"), ("Knowledge Base", "Queue Requests"),
                 ("Queue Requests", "Loop Over Requests"), ("Orchestrator: Build Prompt", "OpenAI: Orchestrator"),
                 ("OpenAI: Orchestrator", "Orchestrator: Route"), ("Orchestrator: Route", "Route to Agent"),
                 *([("Collect Response", "Judge: Build Prompt"), ("Judge: Build Prompt", "OpenAI: Judge"),
                    ("OpenAI: Judge", "Judge: Score"), ("Judge: Score", "LangSmith: Build Trace")] if judge
                   else [("Collect Response", "LangSmith: Build Trace")]),
                 ("LangSmith: Build Trace", "LangSmith: Log Trace"),
                 ("LangSmith: Log Trace", "Next Request"), ("Next Request", "Loop Over Requests"),
                 ("Results", "LangSmith: Build Feedback"), ("LangSmith: Build Feedback", "LangSmith: Post Feedback"),
                 ("LangSmith: Post Feedback", "Test Suite?"),
                 ("LangSmith: Build Experiment", "LangSmith: Upload Experiment")]:
        link(conn, a, b)
    link(conn, "Loop Over Requests", "Results", out=0)
    link(conn, "Loop Over Requests", "Orchestrator: Build Prompt", out=1)
    link(conn, "Test Suite?", "LangSmith: Build Experiment", out=0)
    link(conn, "Test Suite?", "Chat Reply", out=1)

    for idx, (route, label, prompt_js, format_code, y) in enumerate(agents):
        name = agent_name.get(label, label)
        build, call, fmt = f"{label}: Build Prompt", f"OpenAI: {name}", f"{label}: Format Output"
        nodes += [code_node(build, [2200, y], js(prompt_js)), openai_node(call, [2420, y]),
                  code_node(fmt, [2640, y], format_code)]
        link(conn, "Route to Agent", build, out=idx)
        link(conn, build, call)
        link(conn, call, fmt)
        link(conn, fmt, "Collect Response")
    link(conn, "Route to Agent", "Fallback", out=len(agents))
    link(conn, "Fallback", "Collect Response")

    nodes += [
        sticky("Setup Notes", [-40, -500],
               "## Mira – Project Intelligence Assistant\n"
               "**Credentials:** select *OpenAI* on the **OpenAI:** nodes and *LangSmith* Header Auth on the 3 **LangSmith:** HTTP nodes "
               "(Log Trace, Post Feedback, Upload Experiment).\n"
               "- **Run Test Suite** → runs all 12 baseline tests (T1–T12) + X1 through the router; open **Results** for PASS/FAIL per test. "
               "Each run is uploaded as a LangSmith **experiment** on dataset **mira-baseline** (Datasets & Experiments → compare runs).\n"
               "- **Chat with Mira** → click *Open chat* and ask anything; the reply comes from **Chat Reply**.\n"
               "- Scores (pass, route, groundedness, judge) are also attached to every trace as **feedback**.\n"
               "- LangSmith project **mira** → one trace per request: *Orchestrator* → specialist → checks.",
               width=900, height=300),
        sticky("Routing", [1300, 560],
               "### Orchestrator = router + insufficiency gate\n"
               "LLM classifies intent and whether the request is about the project on file.\n"
               "**Code** applies the gate: on-file data → specialist; self-sufficient plan request → Planner; "
               "otherwise → **Clarifier**. Out of scope → **Fallback** (no LLM).",
               width=640, height=200),
    ]
    if judge:
        nodes.append(sticky("Fact-Check Judge", [3060, 900],
                            "### Fact-Check Judge (Step 8)\n"
                            "A second, stronger model (gpt-4o) compares every data-based response with exactly the data its agent saw and lists "
                            "unsupported claims (wrong status, invented dependency, false generalisation). Score 1–5 is shown "
                            "to the PM and logged to LangSmith. **Advisory only** (measured ~50% precision on material claims): pass/fail is decided by the deterministic checks. Judge model: Config.judgeModel.",
                            width=640, height=180))
        save("08_mira_judged.json", "Mira – Project Intelligence Assistant (with Fact-Check Judge)", nodes, conn)
    else:
        save("07_mira_complete.json", "Mira – Project Intelligence Assistant", nodes, conn)


HISTORY = [  # results/history/runN.json, in order (see PLAN.md run log)
    ("Step 6 run 1 – router, 10 tests", 6, "First Orchestrator + router suite (T1–T7, T9, T10, X1)"),
    ("Step 6 run 2 – use-case enum, quote enum, date parser", 6, "Fixes for T3 generic rationales, T7 copied quotes, T10 date check"),
    ("Step 7 run 3 – + Milestone Tracker, Stakeholder Comms", 7, "Full suite T1–T12 + X1; T12 paraphrased task names"),
    ("Step 7 run 4 – baseline", 7, "Exact task names printed by code; 13/13 deterministic baseline"),
    ("Step 8 run 1 – judge v1 (gpt-4o-mini)", 8, "Judge gates the test; ~9% precision on human review"),
    ("Step 8 run 2 – judge v2 calibrated (gpt-4o-mini)", 8, "Judge sees only the model narrative + calibration rules; ~0% precision"),
    ("Step 8 run 3 – judge v3 (gpt-4o)", 8, "Stronger judge, material claims gate; ~67% material precision"),
    ("Step 8 run 4 – judge v3 + milestone fixes", 8, "Linked tasks + invented-milestone check; judge inconsistent → made advisory"),
]


def history():
    """One-off workflow uploading the recorded suite runs as LangSmith experiments (Step 8)."""
    import re
    tests = re.findall(r"test_id: '(\w+)', query: '((?:[^'\\]|\\.)*)', route: '(\w+)'", js("test_cases.js"))
    queries = {t: q.replace("\\'", "'") for t, q, _ in tests}
    routes = {t: r for t, _, r in tests}
    runs = []
    for i, (name, step, desc) in enumerate(HISTORY, 1):
        rec = json.loads((ROOT / "results" / "history" / f"run{i}.json").read_text(encoding="utf-8"))
        results = [{k: v for k, v in r.items() if k != "output"} for r in rec["results"]]
        runs.append({"name": name, "step": step, "description": desc, "captured_at": rec["captured_at"],
                     "queries": queries, "routes": routes, "results": results})
    row_ids = {t: str(uuid.uuid5(uuid.NAMESPACE_URL, f"mira-baseline/{t}")) for t in MIRA_TESTS}
    code = (js("langsmith_history.js").replace("__ROW_IDS__", json.dumps(row_ids))
            .replace("__RUNS__", json.dumps(runs, ensure_ascii=False)))
    names = ["Upload History", "Config", "History Runs", "LangSmith: Upload Experiment"]
    nodes = [
        manual_trigger(names[0], [0, 0]),
        config_node([220, 0]),
        code_node(names[2], [440, 0], code),
        langsmith_post(names[3], [660, 0], "/api/v1/datasets/upload-experiment", "={{ JSON.stringify($json.body) }}"),
        sticky("Setup Notes", [0, -300],
               "## Mira – Step 8: LangSmith experiment history (run once)\n"
               "1. **LangSmith: Upload Experiment** → select your *LangSmith* Header Auth credential.\n"
               "2. **Execute workflow** → 8 experiments (Step 6 run 1 → Step 8 run 4) are added to dataset **mira-baseline**.\n"
               "3. LangSmith → *Datasets & Experiments* → **mira-baseline** → select experiments → **Compare**.\n"
               "Running it twice uploads duplicates – delete them in LangSmith if that happens.",
               width=760, height=230),
    ]
    save("09_langsmith_history.json", "Mira – Step 8: LangSmith Experiment History", nodes, chain(*names))


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    step2()
    step3()
    step4()
    step5()
    mira()
    mira(judge=True)
    history()
