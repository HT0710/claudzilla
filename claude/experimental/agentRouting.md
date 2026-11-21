# Agent routing

Picks, per task, whether to delegate to a subagent and at which model and effort.

Delegate when it saves main-chat tokens or context, not by default. Moving work to a subagent on the same model saves nothing. Aim for the best work quality per token spent.

When to delegate:

- Do it yourself when the task is small or needs this conversation's context that a handoff prompt would have to repeat.
- Path known: stay inline. Reads of a known path, and a grep inside one known file, never get delegated.
- A lookup past the inline search limit in the core rules goes to `atlas` on haiku at effort low. Not in the agent list: `Explore`. A hook blocks the third search of a turn with no Agent call.
- A trace, meaning following calls or imports across files, goes to `atlas` from its first step. A file the trace reaches is not a known path, except one you will edit.
- Delegate when the work reads much and returns little, splits into parallel parts, or is a bounded edit you can fully specify.
- This section counts as the user asking, so the Agent tool's "do not spawn unless the user asks" does not apply here.
- Delegate live UI trials, such as tmux sessions or repeated clicks, and work expected to dump screens or logs into context.
- Break delegated work into separate tasks, one agent each. Keep parts in one agent only when they depend on each other or share context.
- Launch independent agents in one message. Wait for one only when the next prompt needs its result.
- Check what comes back by reading the cited `file:line`. Never re-run the agent's search yourself. An empty or weak result means retry one level up, such as haiku to sonnet.
- Before retrying one level up, ask the same agent (SendMessage) to check its result with a test, build or command when one exists.

Naming:

Give each subagent a playful, random character name: 1 to 3 words in kebab case, at most 24 characters. Switch styles from one agent to the next, for example an animal, a title, fantasy, a sci-fi codename, food, nature, an epithet or a one-word nickname. Invent your own, and never reuse a name this session. When a hook gives start letters, begin each new name with the next one. Pass it as the Agent call's `name` parameter: the tool accepts it though its schema does not list it.

Now and then, about 1 in 10, make the name an easter egg: a nod to a famous figure from history, myth, science, the arts, sport or today, ideally one that fits the job (`sisyphus-the-retrier` for a retry, `usain-bolted` for a quick finish). For living people, alter the name with a pun or short form (`taylor-swiftly`), give only kind traits, and skip politicians, religious leaders and anyone known mainly for controversy.

When agent teams are on, pass no `name`: a named spawn would become a teammate.

Which model:

- For each Agent call, set `model` and `effort` to the lowest that does the job well. These instructions authorize setting `effort`.
- Run code search, a large doc, or many files read for a short answer on haiku. Ask for file:line quotes so the answer can be checked. Move it to sonnet only if the result comes back thin. A file you will edit or plan from stays inline, because you need its exact text.
- Keep each haiku agent's input under 100K tokens; split a bigger read across agents.
- Run implementation whose design is settled, in a written plan or agreed in chat, on sonnet. The brief states the agreed design and the check that proves it done. Move it to opus only if its review fails. Task size or step count is not a reason to start on opus.
- A rule that names a model for a role, such as `code-reviewer.md` reviews on opus, still wins.

Effort defaults:

- Haiku runs at low, except in the superpowers roles below that set another effort. Sonnet runs at medium, except as `brainstorming` builder check.
- Work that already belongs on opus runs at high for process work such as debugging, and at xhigh for refactors. This line sets effort, not the model.
- A task that fails at every effort needs a better brief, not a higher level.

In superpowers skills:

This table replaces the model choice in `subagent-driven-development` (its Model Selection section) and `executing-plans`, and sets the spec and plan roles for `brainstorming` and `writing-plans`. Set both `model` and `effort` on every dispatch, because the skill templates leave effort out.

| role | model | effort |
|---|---|---|
| implementer with a settled plan, final-review fix wave | sonnet | medium |
| scoped re-review, a fresh agent per fix round | haiku | high |
| per-task reviewer, a fresh agent per task, then one second pass (SendMessage to the same agent, text below) | haiku | high |
| per-task spec checker, a fresh agent per task launched with the reviewer (prompt below) | haiku | high |
| per-task reviewer on a high-risk diff, such as concurrency or a shared contract; no second pass, and the spec checker still runs | opus | high |
| fix rounds 4 and 5, after a stuck implementer | opus | high |
| final whole-branch review (`caveman:cavecrew-reviewer`, see `superpowers.md`) | opus | high |
| `dispatching-parallel-agents` agent, which finds and fixes its own problem | sonnet | medium |
| `brainstorming` builder check, a fresh agent that reads the spec and the code it cites before the user approves the spec | sonnet | high |
| plan writer, from a settled spec, and its fix round (SendMessage to the same agent) | haiku | xhigh |
| plan reviewer, a fresh agent that reads the spec, plan and code before the user sees the plan; its prompt says a spec that contradicts itself is its own finding with both spec lines, never a side picked | opus | high |
| plan re-check, scoped to the reviewer's findings | sonnet | medium |

A scoped re-review brief names each fix that changes code other callers share, such as a helper, a hook or a default, and asks the reviewer to check what each other caller now does. A re-review reads only the fix diff, so it misses a regression in shared code unless the brief names it.

Per-task reviewer second pass, sent once the first review is back, before you act on it:

```text
Second pass. Assume 1 Important bug remains in the changed code. Hunt only:
(a) state the change writes or clobbers that a caller or a later run reads: globals, $@, env, files, logs, cache keys.
(b) empty, null or error paths: what gets written or logged then?
(c) each brief requirement or controller ruling you have not yet tied to a specific line: find the line, or report it as missing.
Check the code in ONE message: send every read (`sed -n` on the changed ranges, no whole-file Read) and every small run that proves a bug as parallel tool calls together. No follow-up calls.
Reply only with new Critical or Important findings, one line each with file:line, or "No new findings."
```

Per-task spec checker, sent in the same message as the reviewer, with the inputs filled in:

```text
You are a spec checker for one task, not a code reviewer. Read-only: no edits, no subagents.
1. Read the brief and the diff file once each. Do not judge code quality.
2. List every requirement: each brief requirement, each controller ruling, each global constraint, each spec-intent sentence from the brief or the inputs below. One row each.
3. For each, find the diff line that meets it and quote it briefly. If no line meets it, or a line meets only part of it, say so.
Reply ONLY with a markdown table: `# | requirement (short) | status | file:line | note`, where status is MET, PARTIAL, MISSING or CANNOT-VERIFY. Then one line per PARTIAL or MISSING row: `Important: <file:line> <what is missing>`.
Inputs:
Brief: <path>
Diff: <path>
Controller rulings: <list>
Global constraints: <list>
```

Re-grade each Critical or Important finding from the haiku agents (both reviewer passes, the spec checker, a scoped re-review) before a fix round, because they rate many Minor items as Important. For their findings this re-grade replaces the adjudicate-at-cap rule in `fix-loop.md`.

- Keep it Important when it breaks the brief, a ruling or a global constraint, when a probe shows wrong behavior, or when it names a wrong output or a swallowed error at a file:line you confirm by reading.
- A finding labeled plan-mandated stays Important and goes to the human, as `fix-loop.md` says.
- Otherwise ledger it as `Task <N>: minor (deferred, regraded): <finding>, <why it fails the test>` and leave it out of the fix round.
- A re-review counts as approved when every prior finding is ADDRESSED and every new Important fails this test.
- Treat the spec checker's CANNOT-VERIFY rows like the reviewer's ⚠️ items.
