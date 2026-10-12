# evals

Dev-only, not installed. Measures which model + effort each workflow role needs by running real `claude -p` child sessions on your subscription; `total_cost_usd` is a list-price estimate, good for comparing cells only. CI runs just the offline self-test: `bash tests/evals.test.sh`.

## Sweep

`S=evals/results/<date>`. Every step resumes: after a rate-limit stop (exit 3), wait and re-run the same command.

| stage | command |
|---|---|
| A screen | `node evals/run.mjs --out $S` |
| B confirm | `node evals/report.mjs $S/rows.jsonl --stage-b > $S/b.txt && node evals/run.mjs --only $S/b.txt --runs 5 --out $S` |
| replays | `node evals/replays.mjs > $S/ref.txt` |
| references | `node evals/run.mjs --root evals/replays --only $S/ref.txt --out $S/ref` |
| plan reference | `echo 'plan/ratelimit opus max' > $S/pref.txt && node evals/run.mjs --only $S/pref.txt --out $S/ref` |
| C replay | `node evals/report.mjs $S/rows.jsonl --stage-c > $S/c.txt && node evals/run.mjs --root evals/replays --only $S/c.txt --runs 2 --out $S` |
| judge | `node evals/judge.mjs $S/rows.jsonl $S/ref/rows.jsonl` |
| report | `node evals/report.mjs $S/rows.jsonl` writes `$S/report.md` and `$S/picks.json` |

- Apply picks by hand in a reviewed commit: `effort:` in `claude/skills/pr/SKILL.md`, the agent table in `claude/rules/superpowers.md`, the main-session effort in `settings.base.json`.
- `evals/replays/` is gitignored: replay prompts are your recorded Agent calls, local paths included.
- Each child leaves a transcript in `~/.claude/projects/-tmp-eval-*`. The judge reads them: delete them only after judging.
- `run.mjs` without `--only` runs every case on every cell, and importing it starts that sweep.
