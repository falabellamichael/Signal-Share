import json
import sys

sys.stdout.reconfigure(encoding='utf-8')

log_path = r"C:\Users\Falab\.gemini\antigravity\brain\df958440-7dbf-49cf-b4db-87a9e7204aa8\.system_generated\logs\transcript.jsonl"

steps = []
with open(log_path, "r", encoding="utf-8") as f:
    for line in f:
        try:
            steps.append(json.loads(line))
        except Exception:
            pass

for s in steps:
    idx = s.get("step_index", -1)
    if 220 <= idx <= 238:
        source = s.get("source", "")
        stype = s.get("type", "")
        content = s.get("content", "")
        tool_calls = s.get("tool_calls", [])
        
        print(f"Step {idx} | Source: {source} | Type: {stype}")
        if content:
            print(f"Content: {content.strip()}")
        if tool_calls:
            print(f"Tool Calls: {json.dumps(tool_calls, indent=2)}")
        print("=" * 60)
