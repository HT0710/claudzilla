#!/usr/bin/env python3
"""Per-run routing behaviour from rows.jsonl: searches and reads before the first Agent call, total inline calls, spawns."""
import json, sys

for line in open(sys.argv[1]):
    r = json.loads(line)
    tools = []
    if r.get("transcript"):
        for l in open(r["transcript"]):
            try:
                o = json.loads(l)
            except ValueError:
                continue
            c = o.get("message", {}).get("content") if o.get("type") == "assistant" else None
            if isinstance(c, list):
                tools += [b["name"] for b in c if b.get("type") == "tool_use"]
    first = tools.index("Agent") if "Agent" in tools else len(tools)
    pre = sum(t in ("Grep", "Glob", "Read") for t in tools[:first])
    inline = sum(t in ("Grep", "Glob", "Read") for t in tools)
    cfg = r.get("config", "").rsplit("-", 1)[-1]
    print(f'{r["case"].split("/")[-1]:13} {cfg:4} #{r["run"]} {r["status"]:5} agents={tools.count("Agent")} pre_agent={pre} inline={inline} '
          f'denials={r.get("denials", 0)} ${r.get("cost", 0):.2f} {r.get("ms", 0) / 1000:.0f}s '
          + " ".join(f"{m.split('-')[1]}=${v:.3f}" for m, v in r.get("costByModel", {}).items()))
