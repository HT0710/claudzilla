# Agent routing

Picks, per task, whether to delegate to a subagent and at which model and effort.

Delegate when it saves main-chat tokens or context, not by default. Moving work to a subagent on the same model saves nothing. Aim for the best work quality per token spent.

When to delegate:

- Do it yourself when the task is small or needs this conversation's context that a handoff prompt would have to repeat.
- Path known: stay inline. Reads of a known path, and a grep inside one known file, never get delegated.
- A lookup past the inline search limit in the core rules goes to `caveman:cavecrew-investigator` on haiku at effort low. Not in the agent list: `Explore`. A hook blocks the third search of a turn with no Agent call.
- Delegate when the work reads much and returns little, splits into parallel parts, or is a bounded edit you can fully specify.
- This section counts as the user asking, so the Agent tool's "do not spawn unless the user asks" does not apply here.
- Delegate live UI trials, such as tmux sessions or repeated clicks, and work expected to dump screens or logs into context.
- Break delegated work into separate tasks, one agent each. Keep parts in one agent only when they depend on each other or share context.
- Check what comes back by reading the cited `file:line`. Never re-run the agent's search yourself. An empty or weak result means retry one level up, such as haiku to sonnet.
- Before retrying one level up, ask the same agent (SendMessage) to check its result with a test, build or command when one exists.

Which model:

- For each Agent call, set `model` and `effort` to the lowest that does the job well. These instructions authorize setting `effort`.
- Run code search, a large doc, or many files read for a short answer on haiku. Ask for file:line quotes so the answer can be checked. Move it to sonnet only if the result comes back thin. A file you will edit or plan from stays inline, because you need its exact text.
- Keep each haiku agent's input under 100K tokens; split a bigger read across agents.
- Run implementation whose design is settled, in a written plan or agreed in chat, on sonnet. The brief states the agreed design and the check that proves it done. Move it to opus only if its review fails. Task size or step count is not a reason to start on opus.
- A rule that names a model for a role, such as code reviews on opus, still wins.

Effort defaults:

- Haiku runs at low and sonnet at medium.
- Work that already belongs on opus runs at high for process work such as debugging, and at xhigh for refactors and plans. This line sets effort, not the model.
- A task that fails at every effort needs a better brief, not a higher level.
