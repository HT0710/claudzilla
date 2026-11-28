# claudzilla guide

This file is the user guide for claudzilla. You can read it here, or type `/claudzilla` in Claude to open it in a pane. Type `/claudzilla <topic>` to jump to one section; in the pane, each section shows its topic name under its title. Each section stands alone.

## Get started

### What claudzilla is
<!-- topic: start -->

[Claude Code](https://code.claude.com/docs/en/how-claude-code-works) is an AI coding agent. It runs in your terminal: you describe a task, and Claude reads your files, edits code and runs commands to do it.

[claudzilla](https://github.com/HT0710/claudzilla) is a layer of configuration on top of Claude Code. It makes Claude a steadier partner for real work, and adds a bit of fun on the side. Its parts are rules that Claude follows, the *guard* (a hook that checks Claude's git commands and its "done" claims), skills for common workflows, and plugins that change what you see. Its files live in a *clone*, `~/claudzilla` by default, and the installer sets them up in `~/.claude`, the folder where Claude Code reads your configuration.

What changes compared with stock Claude Code:

- **Replies:** short, with the answer first. Each claim carries a `file:line` reference or a command, or is marked *unverified*.
- **Changes:** Claude investigates, proposes one fix, and waits for your `go` before a multi-file or risky edit. It changes only what the task needs.
- **Proof:** Claude says "fixed" only after the check ran. The guard sends an unchecked "done" back to be checked.
- **Git:** the guard asks you before a force-push or a command that discards work, and blocks commits on `main`.
- **Permissions:** sessions start in Manual mode, so Claude asks before it edits files or runs commands. Recent versions of stock Claude Code start in auto mode, where a classifier reviews most actions instead of asking you.
- **Screen:** if you installed them, the status line, the margin, the ballot card, the folio dividers and the herald toasts.
- **Subagents:** Claude decides for each task whether to hand parts of it to subagents. This is Steward, on by default.
- **A bit of fun:** every part has a name and a story. Meet them in *Worlds* (`/claudzilla bestiary`).

A Full install includes every part; a Custom install includes the parts you kept. Sections about an optional part say "if you installed" it.

If you are new to terminals, Claude Code's [terminal guide](https://code.claude.com/docs/en/terminal-guide) shows how to open one and start Claude Code. Then follow *Run your first task* (`/claudzilla first`).

If you already use Claude Code, skip *Talk to Claude* and read the rest of *Work with Claude* for the claudzilla changes, then start at *On your screen*.

### Run your first task
<!-- topic: first -->

To see how claudzilla works, take one small fix from question to checked result.

1. Open a terminal in your project folder, for example with `cd /path/to/your/project`. If you are new to terminals, see Claude Code's [terminal guide](https://code.claude.com/docs/en/terminal-guide).
2. Type `claude` and press **Enter**. The first time, Claude Code asks you to log in through your browser.
3. The first time you open a folder, Claude Code asks whether you trust it. Accept only for a folder you know: once trusted, the folder's own settings can allow commands and add plugin marketplaces. Claude Code saves your answer for the project, except in your home folder, where it asks each time.
4. Type one small task, with the result you want, and press **Enter**. For example: `the test in tests/test_math.py fails; find out why`.
5. Claude reads files to investigate; reading needs no approval. When it wants to run a command, such as the test, a permission prompt asks first. Read what it wants to run, then select **Yes**.
6. Read the reply. The answer comes first, then the evidence as `file:line` references, then one proposed fix. *Read a reply* (`/claudzilla replies`) explains each part.
7. Type `go` and press **Enter**. Claude proposes a fix and waits for this before it edits.
8. Select **Yes** when the permission prompt asks to edit the file. Claude makes the edit, runs the check, such as the test, and reports the result.

Claude says "fixed" only after the check ran. If it claims done without one, the guard sends the claim back to be checked.

To stop Claude at any point, press **Esc**. To leave Claude Code, type `/exit`. Claude Code's [quickstart](https://code.claude.com/docs/en/quickstart) covers install and login in more detail.

### Key terms
<!-- topic: words -->

These words come up in Claude Code and in this guide. Each one names a single idea.

- **Session:** one conversation with Claude, tied to the folder you started it in. `/clear` starts a new one; `claude -c` continues the last one in this folder; `/resume` picks an older one.
- **Tool:** an action Claude can take, such as reading a file, editing code or running a shell command.
- **Permission prompt:** Claude Code's question before Claude acts. In Manual mode, which claudzilla sets, it asks before most edits, commands and network access. Reading needs no prompt. See *Approve actions* (`/claudzilla approve`).
- **Skill:** a file of instructions for one kind of task, such as debugging. Claude loads it when the task fits, or you run it with `/skill-name`. See *Use skills* (`/claudzilla skills`).
- **Hook:** a script Claude Code runs at a fixed point, such as before a tool runs or when Claude stops. The guard is a hook.
- **Rule file (`CLAUDE.md`):** a markdown file of instructions that Claude Code loads at the start of every session. claudzilla's rules live in `~/.claude/CLAUDE.md` and `~/.claude/rules/`. A project can add its own `CLAUDE.md`.
- **Plugin:** a package of skills, hooks and other parts that installs as one unit. claudzilla installs superpowers and, if you installed them, its own plugins (such as the margin and the ballot card), caveman and ponytail.
- **Mode (caveman, ponytail):** if you installed them, caveman makes replies terse and ponytail keeps code changes to the smallest one that works. Both start at the `ultra` level. Say `stop caveman`, `stop ponytail` or `normal mode` to turn them off.
- **Subagent:** a helper Claude starts for one task. It works in its own context and returns a summary, so a large search does not fill yours.
- **Transcript:** a session saved as a file under `~/.claude/projects/`. Claude Code reads it back when you resume the session.

**Context** is the most important thing to manage. It is everything Claude holds for the current session: your messages, its replies, every file it read and every command output, plus rule files and loaded skills. Context has a limit. As it fills, Claude starts to forget earlier instructions and makes more mistakes. Near the limit, Claude Code compacts it: it summarizes the conversation to free space, and details you gave only in chat can be lost. To keep context useful:

- Run `/clear` between unrelated tasks.
- Run `/context` to see what uses the space.
- If you installed the status line, watch its `ctx` meter.

*Manage context* (`/claudzilla context`) has more. Claude Code's [glossary](https://code.claude.com/docs/en/glossary) defines more terms. For the names claudzilla gives its own parts, such as `herald` or `atlas`, see *Bestiary* (`/claudzilla bestiary`).

## Work with Claude

### Talk to Claude
<!-- topic: talk -->

Claude is a tool you direct. You set the goal, Claude does the work, and you check the result. The more precise your prompt, the fewer corrections you need.

- **Say the result you want**, and how you will know it worked.
- **Point at the file or paste the error.** Type `@` and a path to reference a file. Paste the exact error text.
- **Give one task at a time.** Finish it, or run `/clear`, before you start an unrelated one.
- **Answer its decisions.** When a reply ends with options and a recommendation, type `go` to accept, or name your choice, such as `1B`. See *Read a reply* (`/claudzilla replies`).
- **Stop it when it drifts.** Press **Esc** to stop Claude mid-action. It keeps the context, so you can redirect it. To undo its changes, see *Stop and undo* (`/claudzilla undo`).

Prompts, before and after:

- Instead of `fix the login bug`, try `users report that login fails after session timeout. check the auth flow in src/auth/, especially token refresh. write a failing test that reproduces the issue, then fix it`.
- Instead of `add tests for foo.py`, try `write a test for foo.py covering the edge case where the user is logged out. avoid mocks.`
- Instead of `why does ExecutionFactory have such a weird api?`, try `look through ExecutionFactory's git history and summarize how its api came to be`.

Common mistakes:

- **Mixing tasks in one session.** Context fills with unrelated work. Run `/clear` between tasks.
- **Correcting over and over.** After two failed corrections, run `/clear` and write a better first prompt with what you learned.
- **Exploring without a goal.** "Look into this" makes Claude read many files and fill context. Say what question to answer and where to look.

Claude Code's [best practices](https://code.claude.com/docs/en/best-practices) cover prompting in depth.

### Read a reply
<!-- topic: replies -->

claudzilla's rules shape every reply so you can scan it instead of reading it all. A reply that needs a choice looks like this:

```md
**TL;DR** — the token check uses `<`; it should use `<=`.

### Decision — fix

Expired tokens still pass for one second. Pick how much to change.

| **#** | **option** | **tradeoff** |
|---|---|---|
| **A** | change `<` to `<=` | one line |
| **B** | rewrite the check | more to test |

**Recommend: A**
- **Why:** only the comparison is wrong (`auth/mw.go:42`).
- **Gives up:** the check stays hard to read.

**Next:** say "go" and I'll change line 42.
```

- **TL;DR** (short for "too long; didn't read"): a reply over ten lines, not counting code, that has a table, header, divider or decision opens with a labelled answer in 30 words or fewer. Other replies open with the answer, unlabelled.
- **Headers and tables:** headers split each part; a table appears only when you compare items down a column, such as files and their status; otherwise it is a list. Its header row is bold, and so is its `#` column when it has one.
- **Evidence:** a claim carries a `file:line` reference (file and line number) or the command that showed it. A claim Claude did not check is marked *unverified*; treat it as a guess.
- **Example:** a decision, or a new idea the answer depends on, comes with one concrete example, such as a sample line or a before and after. Claude skips it when the table already shows code, numbers or a mock, when the choice is a plain yes or no, or in a short reply.
- **Decision:** one or two sentences say what needs deciding and why it matters now. Options `A`, `B` follow in a table. Then `**Recommend:**` gives one pick, a **Why:** line with its source, and a **Gives up:** line naming the pick's cost. With several decisions, they are numbered: `Decision 1`, `Decision 2`.
- **Picks:** with two or more choices, a `**Picks:**` line lists the recommended answers, such as `1B, 2A`.
- **File links:** a code span with the path of an existing file, such as `src/app.ts:42` or `src/app.ts:42:7`, is a link. A relative path also links from the repo root after Claude runs `cd` into a subfolder. Click it to see the lines around it in the margin's Explorer tab, but only in the fullscreen terminal; elsewhere a click does what the terminal does. Your terminal's own link click, such as ctrl+click, opens the file; Claude Code does not. Needs the folio and margin parts. Without the margin, a click shows a toast saying so.
- **Run and Copy:** once the reply has finished, each code block sits in a card with a Copy button. A `bash`, `sh`, `zsh`, `shell` or `console` block also gets Run: click it once and it reads `Run? click again`, click again within 3 seconds and folio runs the block in a shell, with no Claude turn and the prompt box left alone. The output streams into the card in its colours, and `Stop` ends the command; Hide and the output's Copy appear once it ends. After the first run, `Run again` takes one click. Claude reads the output next turn, as with a typed `!`. Hide takes the output off the card, but Claude keeps it. A card with a line wider than itself also gets Wrap, which wraps the code, or the output on a shell card; Unwrap puts the lines back. A run cannot ask for input, so `sudo` or `ssh` prompts fail; use a typed `!` for those. Needs the folio part.
- **Prompt card:** your typed prompt shows as a card at the right edge, with its send time under it when the session transcript has it. In the fullscreen terminal, when a tool row follows, the card joins the rail. The `shared.prompt` colour sets the card's colour. Needs the folio part.
- **Short tool rows:** in the fullscreen terminal every finished read, search, fetch, command, edit, task stop, message to an agent and MCP call folds into one row with a count per kind, even a single call, such as `◼ Edited (1 file)  +12 −3` or `◼ Read (2 files) · Ran (3 commands) · Edited (1 file)  +1 −1`. A command that writes files adds `Edited (N files)` beside `Ran`. The `◼` mark turns to `◻` when the row is open, and takes the colour of the worst call in the run: blue and blinking while a call runs, red when one failed, gray when one was interrupted, green when all are done. A failed call adds `· 1 failed`, and an open row shows the first three lines of its error text. Click a folded row to list its calls and files, and click a file to open it in margin's Explorer at the edit. A running call reads `● Fetching (example.com)` with a blinking dot, and a single call that fails draws `● Write (a.txt)  failed` with up to three lines of its error under a `└`. A permission denial shows only its reason. A command that writes files and then fails draws `● Ran (make)  failed  +1 −1`, with its error output under the row. Off the fullscreen terminal each edit keeps one row, such as `● Updated (a.txt)  +12 −3`, and a fetch reads `● Fetched (example.com)  200 · 577 B`. Every tool row sits 2 columns in, and a `│` rail runs down the left edge from your prompt or Claude's text through the rows that follow, until the next reply. An agent draws `◆ done     sleepy-lynx (Fix the tests)  in 12s`, with its name first; a call with no name keeps `builder (Fix the tests)`. It forks off the rail with `├─`, or `╰─` when it is the last row under the rail. A background agent's launch row forks with `├┄` and reads `◇ working`, and its finish row forks with a solid `├─` once the agent is done. A skill loaded into the chat sits on the rail as a node, such as `✦ loaded   caveman-help (caveman)`, with the `✦` in place of the `│`. A skill that runs as its own agent draws like an agent row, such as `├─✦ done     review (superpowers)`. A row that is still going adds `as haiku medium` for the model and effort. A background command's finish notification folds to `◼ Ran (1 command)  done · 3s`, or `failed` or `stopped`, and a click shows the command. ctrl+o shows the full rows everywhere. To keep diffs in the chat, set `{"folio": {"hideEditDiff": false}}` in `claudzilla.json`. Needs the folio part.
- **Next:** the last line, the single next action. When nothing is left to do after a piece of work, the reply ends with `Nothing pending.` instead.
- **Dividers:** a heavy line frames a reply that has a TL;DR. A thin line follows the TL;DR and comes before the Picks or Next line, but only one when nothing sits between them. A dotted line marks a change of group: what Claude found, what to choose, what to do.

To answer, type one of these and press **Enter**, or write a question or correction in your own words:

- `go` accepts every recommendation in the reply.
- `1B` picks option B of Decision 1.
- `go, but 2B` accepts the rest and changes one pick.

If you installed the ballot plugin, the ballot card numbers the options so a digit answers. See *The ballot card* (`/claudzilla ballot`).

### How a task runs
<!-- topic: flow -->

claudzilla's rules give every task the same order of steps. Each step has a reason, and the order tells you when Claude needs your answer.

1. **Investigate.** Claude reads the code and traces a problem to its root cause, so the fix hits the cause, not a symptom. Before it calls odd code a bug, it checks whether the code is deliberate.
2. **Propose one fix.** The reply lists the options with their tradeoffs and recommends one with its evidence, so you choose with the facts in front of you. See *Read a reply* (`/claudzilla replies`).
3. **Wait for `go`.** Before it edits, Claude stops, so you decide before anything changes. One `go` covers the agreed changes through the check; new work needs a new `go`.
4. **Make the smallest change.** Every changed line traces to your request, so the change is small enough to review. Claude leaves nearby code alone and lists related problems under `Not covered:` instead. If you installed ponytail, it keeps the change to the smallest one that works.
5. **Run the check.** For a bug, Claude writes a test that reproduces it, then makes the test pass, so "fixed" means a test proved it. A trivial one-line change needs no test. Multi-step work comes as a plan of `[step] → verify: [check]` lines.
6. **Report the result.** Claude says "done" or "fixed" only after a check ran. If it claims done without one, the guard sends the claim back. See *Git and safety* (`/claudzilla guard`).

A trivial edit, or one you state exactly, skips steps 1 to 3: Claude makes it at once and confirms it landed. For example: `in README.md, change "colour" to "color"`. If such an edit spans several files or is risky, Claude still investigates and waits for `go`.

Claude decides for each task whether to hand parts of it to subagents. This is Steward (`steward`), on by default from v1.9. Turn it off in *Experimental features* (`/claudzilla labs`).

Some rules apply only to certain files:

- **Python:** these rules load once Claude reads a `.py`, `.pyi`, `.ipynb`, `pyproject.toml` or `requirements` file. An existing project keeps its own tools. New code uses `uv` for packages, `pyproject.toml` for dependencies, `ruff check --fix` and `ruff format` for lint and formatting, and `pytest` for tests.
- **Comments:** if the project has a comment style, Claude matches it. Otherwise it writes a comment only to explain a reason the code cannot show, and never history such as "was X, now Y": git holds that.
- **Writing:** docs, memory, commits, PRs, issues and outside messages get plain, full sentences: one idea per bullet, under 40 words, no arrows or nested parentheses. Chat replies stay terse. `/rule-review` counts slips in its `writing` row.

Claude Code's [common workflows](https://code.claude.com/docs/en/common-workflows) show how to explore code, fix bugs and refactor with Claude.

### Approve actions
<!-- topic: approve -->

Claude Code asks before Claude acts. These questions are *permission prompts*, and the *permission mode* decides which actions get one. claudzilla's rules shape what Claude tries to do; only permission prompts, modes, permission rules and hooks, such as the guard, decide what Claude Code allows.

claudzilla sets `permissions.defaultMode` to `default`, which Claude Code calls *Manual mode*. The line under the prompt shows `⏸ manual mode on`. Claude reads files in your project without asking, and asks before it edits a file, runs a command that is not read-only, or reaches the network, so you see each action before it happens. Stock Claude Code v2.1.283 and later starts in auto mode instead.

> **Keep Manual mode:** on Pro, Max and Team plans, Claude Code may ask once whether to switch your default to auto mode. Decline to keep Manual mode.

When a permission prompt appears:

- Read what Claude wants to run or change, then select **Yes** or **No**. **Esc** is the same as **No**.
- **Yes, and don't ask again** saves a rule. For a command, the rule holds in later sessions in this repository; for file edits, it lasts until the session ends.
- Run `/permissions` to see or remove the rules you saved.

Press **Shift+Tab** to change the mode of the current session. From Manual mode, it cycles to accept edits, then plan, then auto when auto mode is available, and back to Manual.

| mode | runs without asking | use it to |
|---|---|---|
| Manual (`default`) | reads | review every action |
| accept edits | reads, file edits, and `mkdir`, `touch`, `rm`, `rmdir`, `mv`, `cp`, `sed` in your project | review edits afterwards with `git diff` |
| plan | reads; edits are blocked | explore and agree on a plan first |
| auto | most actions, each reviewed by a second model, the *classifier* | long tasks with fewer prompts |

In plan mode, Claude researches and writes a plan but does not edit until you approve it. Enter it with **Shift+Tab**, or start a single prompt with `/plan`. When the plan is ready, select **Yes, manually approve edits** to approve and review each edit, or **No, keep planning** to say what to change.

To start every session in another mode, see *Customize claudzilla* (`/claudzilla customize`). Claude Code's [permission modes](https://code.claude.com/docs/en/permission-modes) page has the full detail.

### Use skills
<!-- topic: skills -->

A *skill* is a file of instructions for one kind of task, such as debugging or writing a plan. Claude loads a skill when the task fits, or you run one by typing `/` and its name, such as `/superpowers:brainstorming`. A skill makes Claude follow a set method instead of improvising one. claudzilla installs the superpowers plugin, whose skills cover debugging, test-first coding, plans and reviews. claudzilla's rules adjust them to its reply style: no "I'm using the … skill" line, and progress and end reports use the same short format as any other reply.

Claude uses these skills without asking when the task fits:

| when | skill |
|---|---|
| a bug, a failing test or unexpected behaviour | `systematic-debugging`: finds the root cause, proposes the fix, fixes on `go` |
| writing non-trivial code | `test-driven-development`: writes a failing test first |
| before it says "done" after edits | `verification-before-completion`: runs a check |
| before it says "done" after changing an app, CLI, server, UI or plugin | `run` (built in): launches it and uses the changed part, because passing tests alone can miss a broken app |
| you pass on code review feedback | `receiving-code-review` |
| you ask to push, open a pull request or merge, and the branch had no review yet | `requesting-code-review`: an agent reviews the branch first |

A review also checks the traps listed in your repo's `REVIEW.md`, if it has one. The reviewer reads it from the branch the work merges into, so a branch cannot weaken the checks that judge it. claudzilla's own `REVIEW.md` is an example.

With caveman, a refactor or a migration runs `caveman:safe-refactor` or `caveman:migration`; with ponytail, asking what's next runs `ponytail:ponytail-debt`.

When your prompt contains words such as "bug", "error" or "crash", the guard reminds Claude to use the debugging skill.

For bigger steps, Claude suggests a skill and waits. The reply names it on the **Recommend:** line, or ends with `say "go" and I'll run <name>`. Type `go` to run it. For example: `brainstorming`, then `writing-plans`, for a new feature; `subagent-driven-development` to carry out a plan; `finishing-a-development-branch` when a branch is done.

When `brainstorming` or `blueprint` has options for you, it asks its questions as Decisions, so the ballot card lets you answer with a number.

Some skills hand tasks to *subagents*: helpers that each work in their own context and return a summary. They keep your context small, but their requests count toward the same usage limits. Every subagent gets a short name. Claude picks one, and a hook (`claude/hooks/agent-name.mjs`) fills one in when the name is missing or already used this session. The same hook hands Claude random start letters for the next names, so the same task doesn't get the same name every session.

claudzilla adds these skills of its own:

- **`pr`:** Claude runs it before it opens or edits a pull request: pre-PR checks, then the description template. The guard blocks a pull request without it.
- **`blueprint`:** designs a feature or change before any build. It asks only what it must, writes a short spec, and waits for your go before planning. It is part of the Chancery experiment, off by default: run `/claudzilla experimental chancery on` to use it in place of `brainstorming`.
  - **Switch:** while Chancery is off, the guard stops Claude from calling `blueprint`. While it is on, the guard stops Claude from calling `superpowers:brainstorming`. Typing either skill yourself still runs it.
- **`/rule-review`:** counts how often each claudzilla rule slipped, from your local transcripts. Only you run it; a weekly summary appears at startup. It shares the counts, never the text, as a GitHub issue only after you say yes.
- **`claudzilla-report` and `claudzilla-compact`:** run by `/claudzilla report` and `/claudzilla compact`. See *Report a problem* and *Manage context*.

If you installed caveman (terse replies), `/caveman` turns it on, `/caveman status` shows its mode, and `stop caveman` turns it off. If you installed ponytail (smallest change), `/ponytail lite`, `/ponytail full` or `/ponytail ultra` sets its level, and `stop ponytail` turns it off. `normal mode` turns both off. ponytail's band over the prompt box (cost, tokens, reuse per task) starts hidden: `/ponytail band on` shows it, and its board needs **Task board** (`ledger`) turned on in `/config`. claudzilla sets both the first time it installs or updates ponytail, then leaves them, so your choice stays through updates.

Claude Code's [skills](https://code.claude.com/docs/en/skills) page explains how skills load.

### Manage context
<!-- topic: context -->

*Context* is everything Claude holds for the current session: your messages, its replies, the files it read, command output, rule files and loaded skills. It has a limit. As it fills, each turn costs more, and Claude starts to forget earlier instructions and makes more mistakes. Near the limit, Claude Code compacts it: it summarizes the conversation, and details you gave only in chat can be lost.

To see how full context is:

- If you installed the status line, its `ctx` meter shows the share used and the token count, such as `150k`.
- Run `/context` to see what uses the space.

To keep context small:

- **Clear between tasks.** Run `/clear` before unrelated work; it costs nothing. To find the old session later, run `/rename` first.
- **Compact with a focus.** To keep going on the same task with less context, run `/compact` with what to keep, such as `/compact Focus on code samples and API usage`. Compacting reads the whole conversation, so on a large context it is a large request.
- **Delegate big searches.** A subagent reads many files in its own context and returns a summary. See *Use skills* (`/claudzilla skills`).
- **Come back later.** `claude -c` reopens the last session in this folder; `/resume` picks another one.

claudzilla also tells you when to compact. Once context passes the `compactNudge` threshold, 150,000 tokens by default, a reply that finishes a task or subtask can end with one **Compact** line: how many tokens are re-sent every turn, what finished, and what to run. That is `/claudzilla compact` when the next step needs decisions settled earlier, `/claudzilla handoff` when it needs only the last few turns, a plan or committed work, or `/clear` when the finished work and the next are unrelated. The line never shows on two replies in a row. Mid-task it stays quiet; past four times the threshold it can come on any reply that is not mid-task. The line reads `optional` at first, `suggest` at twice the threshold and `recommend` at four times.

`/claudzilla compact` has Claude draft a `/compact` line that names what to keep and what to drop, and puts it in your prompt box: check it, then press Enter. The draft stays under about 1,500 characters: when a session settled more decisions than fit, Claude appends them to a notes file and the draft names that file, so the next compact reuses it.

If you installed the herald plugin, a toast says the same at each step and every 30 minutes while context stays past the threshold; after 30 minutes with no message, the reminder stays under the prompt until you send one. When you step away past the threshold on a 1-hour prompt cache, herald also puts `/claudzilla compact` in your empty prompt box 15 minutes before the cache goes cold: press Enter when you are back to compact while the cache is still cheap to read. Past twice the threshold, if you have not come back 5 minutes before cold, it compacts by itself; `coldCompact` sets that multiple (`4` waits for four times, `0` never compacts). The herald plugin also turns off Claude Code's own idle compaction, which would otherwise compact first, from 200,000 tokens.

`/claudzilla handoff` writes a note from this session, clears it, and sends the note as the first prompt, so a new session starts small. Text after it, such as `/claudzilla handoff fix the failing test`, follows the note as your first ask. Its first reply ends with the old session's last offer as its **Next:** line, so `go` picks the work back up.

When your ask needs more, the new session searches the old transcript by line number. A session that itself started from a handoff passes the chain on: its note lists each earlier session with its goal and transcript, so Claude can search an older one too. A long chain keeps the first session and the last five.

Herald offers it when the cache went cold past the threshold: it puts `/claudzilla handoff` in an empty prompt box when the cache goes cold, and shows a line under the prompt on the first key you type after that, also in a session you reopened with `claude --resume`. Empty the prompt box while that line shows and `/claudzilla handoff` comes back as a dim suggestion: press Tab to take it.

If you installed the ballot plugin, a reply that ends with the Compact line and no **Next:** offers its command as the dim suggestion. With the Baton experiment on, the reply can instead offer the same job in a fresh session after `/claudzilla handoff`. When that row is recommended or picked, or the reply has no Decision, it ends with a **Next:** line holding the command, which ballot suggests the same way. Either way it carries no Compact line (see *Experimental features*).

To change the threshold, or set it to `0` to turn it off, see *Customize claudzilla* (`/claudzilla customize`).

The rewind menu can also summarize part of a conversation; see *Stop and undo* (`/claudzilla undo`). Claude Code's [interactive context simulation](https://code.claude.com/docs/en/context-window) shows how context fills during a session.

### Stop and undo
<!-- topic: undo -->

You can stop Claude at any point and take back what it changed.

**Stop.** Press **Esc** to stop Claude in the middle of a turn. Claude keeps the work done so far and waits, so you can redirect it. On a permission prompt, **Esc** declines the action.

**Rewind.** Claude Code saves a *checkpoint* of Claude's file edits at each prompt you send. To go back, press **Esc** twice with an empty prompt, or run `/rewind`. Select the prompt to return to, then choose:

- **Restore code and conversation:** undo both.
- **Restore code:** undo the file changes and keep the conversation.
- **Restore conversation:** go back in the conversation and keep the files.
- **Summarize from here:** compress the later conversation to free context.

If you installed the margin, the `⟲ rewind` button on its History tab opens the same menu. See *The margin* (`/claudzilla margin`).

> **Rewind cannot undo:** files changed by shell commands, such as `rm`, `mv` or `cp`; most edits made by subagents; and changes made outside Claude Code.

**Use git as the safety net.** Checkpoints are for quick recovery in one session; git keeps history for good. When you work with Claude step by step, it leaves its changes uncommitted until you say `commit`, so say it when a step works.

**Discard work.** A command that throws away uncommitted work, such as `git reset --hard`, `git clean -f`, `git checkout -- <file>`, `git restore <file>` or `git stash drop`, stops at a permission prompt. The prompt lists what the command would lose, such as the changed files or the stash entry. If an earlier command in the same line could change that list, the prompt says `could not check` instead. Pick Yes to run it, or No to stop Claude. You can also run a command yourself: type it at the prompt after `!`, for example `! git restore src/app.py`.

> **Not checked:** a `!` command runs directly, without going through Claude, so the guard does not check it.

Claude Code's [checkpointing](https://code.claude.com/docs/en/checkpointing) page covers rewind in full.

### Git and safety
<!-- topic: guard -->

The *guard* is a hook: it checks each git and GitHub command Claude runs, before it runs, and each reply when Claude finishes. Rewind cannot undo a git command, so the guard turns claudzilla's git rules into checks that hold even when Claude forgets a rule.

> **A guardrail, not security:** if the guard itself fails, the command goes through.

A force-push, or a command that discards work such as `git reset --hard`, waits for you: the permission prompt lists what it would lose, and you pick Yes to run it or No to stop Claude. A simple discard, such as `git checkout -- <file>` or `git reset --hard` with no ref, runs without asking when it would lose nothing or when the repo sits in the temp folder, such as a test repo. See *Stop and undo* (`/claudzilla undo`).

By default, the guard blocks these and tells Claude what to do instead:

| Claude tries to | instead, Claude |
|---|---|
| commit on `main` or `master` | creates a branch first, named `<type>/<short-slug>` |
| push or open a PR before verification | runs `verification-before-completion`, then a check |
| open or edit a PR without the `pr` skill | runs the `pr` skill: checks and description template |
| commit with a subject that is not Conventional Commits | starts it with `feat:`, `fix:`, `refactor:`, `chore:`, `docs:` or `test:`, in 50 characters or fewer |
| put a Claude session link in a commit or PR | removes the link |
| commit a staged `.env` file | unstages it |
| add a worktree inside the repository | puts it at `../<repo>-<slug>` |

On each commit, the guard also reminds Claude, without blocking, when the message body has a line over 72 characters, a `Verify:` line with no result, or more than 2 staged files with no `Why:` or `Impact:` line. Set `commitBody` to `off` to stop it.

When Claude edited files and its reply says "done", "fixed" or "passing" with no command run after the last edit, the guard sends the reply back: Claude must run a check, such as the tests, and report the output.

Claude also never pushes, opens a PR or tags unless you ask. Before a push, it regroups its commits into one logical change each. If you installed the byline plugin, it removes session links and the "Generated with Claude Code" line from the commit trailer and PR footer that Claude Code asks Claude to write.

If you installed the ledger plugin and two sessions work in one folder, Claude pauses before it edits a file that the other session edited in the last 30 minutes. The other session gets a message, Claude re-reads the file, and it waits or asks you only when both changes touch the same lines.

> **Prompt injection:** text in a file, web page or command output that tries to give Claude instructions. The guard does not stop it. Your defense is the permission prompt, so read each command before you approve it. Trust only folders you know: once trusted, a folder's settings can allow commands.

Each blocked action in the table can be set to `deny`, `remind` or `off`, and the done check to `now`, `flag` or `off`. The force-push and discard holds take `ask` (the default), or the same three; `deny` brings back the old block. For a solo repository that commits straight to `main`, put `{"rulesGuard":{"allowMain":true}}` in `.claude/claudzilla.local.json`. See *Customize claudzilla* (`/claudzilla customize`). If the guard blocked something you need, see *Fix common problems* (`/claudzilla stuck`).

## On your screen

### The status line
<!-- topic: hud -->

If you installed the status line (the `hud` part), it fills the bottom of the screen, under the prompt. It shows where Claude works, how full context and your usage limits are, and what Claude is running, so you can check them without typing a command. If you did not install it, run `~/claudzilla/install.sh --add hud` in a terminal.

From top to bottom:

- **Top row:** the folder, the git branch, and uncommitted changes: `!3` files changed and `?2` new files git does not track. The Git tab in margin shows the lines added and removed. On the right: the email of the account you are logged in with, masked to the first and last letter before `@` (`a…h@gmail.com`), and the claudzilla version.
- **Two thin lines** frame the meters: the top one shows the time, the bottom one the date.
- **`ctx` meter:** how full context is, as a percentage, and the token count, such as `150k`.
- **`cch` meter:** how long the prompt cache stays warm, as the share of its time used and the minutes left, such as `55m`. The prompt cache holds the conversation so far, so the next message reads it back at a fraction of the full price; it lasts 5 minutes or 1 hour after each request. The meter starts at 0% after each reply. Its bar stays full and changes colour as the cache cools, from blue to orange at 100% and `cold`: the next message then pays again for the whole conversation, so a cold cache is a good moment to `/compact` or `/clear`. Before the first reply it shows 0% and `hot`.
- **`5h` and `wk` meters:** how much of your 5-hour and weekly usage limits you used, and the time until each resets, such as `2h13m` or `3d4h`. Claude Code sends these only to a Claude subscription login, such as Pro, Max or Team, after the first reply of a session; until they arrive, also after a `/login` mid-session, a logged-in session shows them as `--%` and `--`, and on an API-key login the two rows do not show, and spend takes their place.
- **API-key login:** a session billed to `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN`, or one with no Claude account, shows its spend instead of the `5h` and `wk` meters. The login tag takes the email's place: the host of `ANTHROPIC_BASE_URL`, such as `openrouter.ai`, or `api key`. The right column's first row reads `$1.24 here  $4.80 today  $96.40 month`, with the hourly rate and the cost per day at the right edge. The second row is a 24-hour spend chart from `24h ago` to `now`, with a `╎` at local midnight. Spend is kept in `claudzilla-spend.tsv` in the config dir (`$CLAUDE_CONFIG_DIR`, else `~/.claude`), per profile and shared by all its sessions, so `today` and `month` add up across them. On `openrouter.ai`, `today` and `month` show what OpenRouter billed the key instead, from its `/api/v1/key` endpoint. That covers every machine and app on the key. `month` follows OpenRouter's UTC month, but `today` starts at local midnight: it counts from the key's first billed total read after midnight, and shows the ledger's estimate until that read. A background fetch refreshes them at most once a minute for all sessions of the profile, and the status line never waits for it. The ledger's estimate returns when the last fetch is over 10 minutes old.
- **Bottom row:** the model and the effort level, such as `high`; the last skill Claude loaded; and `◇ thinking` when Claude was thinking in the last 30 seconds. On the right: the session name, the first 8 characters of the session id, and the time since the session started, such as `up 42m`.

The meters sit in two columns, `ctx` over `cch` on the left and `5h` over `wk` on the right; on a terminal too narrow for two columns they stack, one per row. Each meter bar runs from blue to orange: the cells past about two thirds of the bar are orange. The `cch` bar instead is solid and one colour. The status line redraws every 30 seconds and on Claude Code's own events.

> **Your email is masked:** only the first and last letter before `@` and the domain show, enough to tell your accounts apart. Anyone who sees your screen, a screen share or a screenshot sees that much.

On a narrow terminal, the top row drops the version first, then drops the email's domain, then the rest of the email, then the changes and the branch, and finally cuts the folder from the left. The bottom row drops thinking, then the skill, the compact time and date, the session id, the session name, and the model last.

To use fewer rows, set `hud.layout` in `~/.claude/claudzilla.json`. With `{"hud":{"layout":"compact"}}`, the two thin lines go, the time and date move to the right side of the bottom row, and all four meters sit on one row with `cch` first, for 3 rows in total. An API-key login shows its spend text in place of `5h` and `wk`, then the 24-hour chart, which takes the rest of the row. Under about 109 columns, or about 127 on an API-key login, the meters keep their two columns or stack as usual.

With `{"hud":{"layout":"minimal"}}`, the status line is one row: the folder, branch, changes, model and effort on the left, and the meters on the right; an API-key login shows `$1.24 here  $96.40 month` after `ctx` instead of `5h` and `wk`. `cch` comes first and counts down the minutes the cache stays warm, such as `40m`, in the same colours as its bar: `0m` once cold, `--` before the first reply. The email, version, time, date, session, skill and thinking do not show. On a narrow terminal the bars shrink and then go, then the row drops the model version and the `wk` meter. An API-key login then drops the month, then the `here` label. Next go the changes, the reset times and token count, the model and the branch. An API-key login then drops its spend, and then the `5h` and `cch` meters go. Last, the folder is cut from the left.

`full`, the default, is the 6-row layout. The change shows within a second. Before v1.9 the compact layout was `{"hud":{"compact":true}}`; the installer changes it to `"layout":"compact"` on update.

To change the status line colours, see *Customize claudzilla* (`/claudzilla customize`).

The installer offers the MesloLGS NF font, which draws the symbols. If you said no, the status line and the margin rail use basic symbols every font has: `■ □` instead of `▰ ▱` in the meters, `›` instead of `⎇` for the branch, and `▸` instead of `⚑` for the skill, and letters such as `o` and `g` for the rail tabs. To switch later, run `CLAUDZILLA_FONT=yes ~/claudzilla/install.sh`, then set MesloLGS NF as your terminal font. If you see boxes instead of symbols, see *Fix common problems* (`/claudzilla stuck`).

What to do with it:

- When `ctx` runs high, compact or clear. See *Manage context* (`/claudzilla context`).
- When `5h` or `wk` nears 100%, check its reset time and plan around it. See *Usage and cost* (`/claudzilla limits`).
- Check the branch before you ask Claude to commit.

Claude Code's [status line](https://code.claude.com/docs/en/statusline) page explains how a status line works.

### The margin
<!-- topic: margin -->

If you installed the margin, it is a pane with a narrow rail of four icons down its right edge: Overview, History, Explorer and Git. Hover the rail and it widens to show each tab's name. It shows how Claude read your request and what it is doing, and it lets you move around a long chat without scrolling. The Guide button at the foot of the rail opens this guide at its start, or keeps your place if it is already open. The Worlds button under it, or alt+w, opens the guide on *Lore*, the first page of *Worlds*. If you did not install it, run `~/claudzilla/install.sh --add margin` in a terminal.

To open or close the margin, type `/margin`, or press a tab's key (see the key table). A new session opens it if you left it open, and the first session opens it too; on a terminal under 144 columns it waits for room (110 once you have opened it yourself); a tab key shows it at any width. In the fullscreen layout, on a terminal 110 columns or wider, it docks beside the chat; otherwise it opens over the prompt. It opens on the Overview tab; click a tab's icon or name, or press its key, to switch. Each tab key opens the margin on that tab, switches to it when another tab shows, and closes the margin when that tab already shows. The key letter is underlined in the tab name on the widened rail. On macOS, alt is the Option key, and your terminal must send it as Meta; see [Option key shortcuts on macOS](https://code.claude.com/docs/en/terminal-config#enable-option-key-shortcuts-on-macos).

**Overview** shows a status row at the bottom of the tab: whether Claude is `working`, `done` or `stopped`, or `waiting` when its turn ended with background agents still running. Its glyph moves while the turn runs. The middle counts the whole turn from your prompt, such as `for 1m 23s`, then `in 4m 12s at 16:27` when done or `after 2m 10s at 16:27` when stopped. The tab holds:

- **SESSION:** the whole chat in one sentence, written by the same Opus read as TOPIC, up to 4 rows.
- **TOPIC:** what your latest prompts are about. After each prompt, while the tab shows, Opus groups your prompts, and only your prompts, into topics. A session with no prompt of its own, run by another session, uses the messages that session sent it instead. Press `show all` to open a TOPICS modal that lists every topic, newest first. While the first read runs, SESSION and TOPIC each hold one faint line, such as `naming the thread…`, until the read returns topics. While a later read runs, SESSION and TOPIC keep their text, the SESSION header shows `skimming the story so far…`, and the TOPIC header shows `naming the thread…` in place of `show all`. If the read fails, the SESSION header shows `update failed`, or the TOPIC header when there is no summary.
- **ASK:** how Claude read your request. After each prompt, ASK, TAKE and PLAN show faint lines, and USED too when last turn used anything, such as `parsing the ask…`, until Claude's report arrives. If you stop the turn before Claude reports, last turn's report and USED come back.
- **TAKE:** Claude's reaction to your ask before it starts: `✓` fine, `!` concern, `✗` against, `?` unsure, a word or two on how sure Claude is, and a reason that says what it will do or doubt. On a question, the reason names what Claude will check or doubt, never the answer.
- **PLAN:** its steps: `✓` done, `●` in progress, `○` pending.
  - Agents Claude starts hang under their step: `○` planned, `◌` working, `✓` done, `✗` failed, `■` stopped. Each agent's colour follows its type, the same in USED; the mark keeps its state colour. A named agent shows its description faint in a column after the names. Past 3, the earlier ones fold into `… N earlier` right under the step, with a count for each state, then the 2 newest; click it to see them all, `… less` to fold them. Click an agent to open its transcript (its row lights blue); click it again or press **Esc** to go back.
- **USED:** under PLAN, one row per kind Claude used this turn (files, memory, web, skills, other) with a count, a dim `+N` for subagent calls, and the last names: Claude's own first, then dim the ones only subagents used. Grep, Glob and every MCP tool except claudzilla's own count as other. A file a Bash search or read reaches, such as `cat a.md` or `grep x a.ts`, counts under files or memory like a Read; a folder or pattern counts nothing. Press a row to open a modal for that kind. It lists a tree by reader, `Claude` first and then each agent in its colour, latest read first. Each reader shows `N total` at its right and its 3 newest names, and `show all` opens its full list in a stacked modal. A name has `×N` for a re-read and then the source (such as `grep`, `bash` or an MCP server) at the right, each in its own column, and `N total` counting uses. The modal is only as wide as its rows. Web pages nest under the search that led to them. Press a file, memory or skill row to open it in the Explorer tab, or a web page to follow the link. USED hides when PLAN would keep fewer than 3 rows.

Hover a step or agent row to see its status in a card; an agent's card also shows its description, then its type in its colour, its model (such as `haiku 5.5`) and its effort. Hover SESSION, TOPIC, ASK, TAKE, PLAN or USED to see a one-sentence card saying what it is.

From the moment you submit until Claude reports, the status row shows `planning` and `… steps`. While Claude waits on background agents with no new report, last turn's report shows dimmed. The count reads `N/M steps`. The current step is lit blue. When PLAN runs past the pane's last row, it scrolls in place: the wheel moves it, and the list follows the step in progress, near the top with one row of the step before it. Once you wheel it yourself, it stays put until a new step starts at least 5 seconds after your last scroll. The next prompt starts it at the top again. Claude fills ASK, TAKE and PLAN by calling a hidden `intent` tool at the start of each turn. TOPIC, ASK, TAKE and PLAN are written in the language you write in; the labels stay in English. Check ASK first: if Claude misread you, press **Esc** and correct it. Each report and each topics read uses a little of your usage limits; see *Usage and cost* (`/claudzilla limits`). To turn the reports off, set the margin's `intent` option to off in `/config`; it applies from the next session.

**History** lists this chat's prompts, newest first:

- Click a prompt to scroll the chat to it.
- `↻` puts the prompt back in the prompt box, to edit or send again.
- `⟲ rewind` opens the `/rewind` menu. See *Stop and undo* (`/claudzilla undo`).
- `⤓ latest` scrolls the chat to its newest row.
- `⟲ rewind` and `⤓ latest` show once there is a prompt; with History empty they are hidden.
- A dim prompt was rewound or compacted, or is not drawn in the chat yet. A compacted prompt still jumps while the chat shows it; the others do not. `↻` works on all of them.

**Explorer** is a read-only file browser. It opens on your project folder, as a tree you expand by clicking folders; click a file to read it whole, with scroll bars. A `.md` file opens drawn as Markdown. Its tables draw as a grid when they fit the pane, and as a list that keeps each column name when they do not. The switch left of the search button shows its source at the same place, and a line link, a CHANGES click, an edit press or find opens the source too. The path at the top links each folder to its own page; when it is too long, the `…` at its start opens the project folder. The arrows go back and forward through what you opened. On a file or folder page, click the last part of the path to open Recent: the files you viewed, newest first, split into `today` and `earlier`, at most 8, each with its icon, name, folder, git letter and age. Type a name to filter, step with Down and Up, and press Enter or click a row to open it; click the open file's row, or press Escape, to close Recent. A folder page has no open file, so every row there opens its file. The info button on a file shows a card on hover, or stays when you click it, with the file's git state, its added and removed line counts, when Claude last edited it, its type and its line count. Press a line number to copy `path:line`, or drag over several to copy a range. The menu button copies the path, mentions the file to Claude, opens it in your editor, or wraps long lines. On a file, the search button opens find: type to find text, turn on Match case, Whole word or a regular expression, and press Enter or the ‹ › buttons to step through matches, which also show on the scroll bar; ✕ ends find. On a folder page, the search button searches file and folder names (in a repo it uses git's file list, so `.gitignore` applies). Down and Up step through the results, and Enter opens the lit one, or the top one when none is lit. The file reloads when Claude changes it. Folder rows show how many items they hold, and file and folder rows show their age, which for a folder is its newest change; the ages come from a scan capped at 5000 files and stay blank without it. The lines at each indent level light up when the pointer is over them, and a press in the indent hits the row. In a repo, the tree shows git's status letter at the far right of each changed file, and a dot on a closed folder that holds changes, white when its files show different letters. An open file shows its uncommitted changes inline, with deleted lines as red rows and added or changed lines in green, and marks them on the scroll bar. The reload that picks up an edit marks it too, and its added rows flash and fade. The menu's Show git diff setting hides the git rows and bar marks, but not those reload marks. Click a changed file under CHANGES in the Git tab to open it at its first change; a deleted file does not open. Click a file link in Claude's reply to open it here with that line lit; the margin opens if it was closed. Press an edit's file row in the chat (needs the folio part) to open the file at that edit: its added rows flash and fade, and a toast says so when the file changed since the edit. See *Read a reply* (`/claudzilla replies`).

**Git** starts with the session folder's branch. A mark after its name shows only when the branch needs you: `↓` to pull, `↕` when it has diverged, `✗` when origin deleted it. A faint `⧉` after the name means the session runs in a linked worktree. Hover the name for its upstream and stashes, and click it for a tree of every local branch. When the repository has a linked worktree, the tree's `worktrees` view lists each one with its branch, sync and uncommitted files. The age at the right is the last fetch: click it to run `git fetch origin`. While the tab shows, margin also fetches on its own once the last fetch is 15 minutes old. In the `worktrees` view, `? changed` means git could not read that worktree.

A rebase or merge in progress gets its own row with what it waits on, such as `✗ 1 conflict`. Click it to see each step and the files to fix, and to continue, skip or abort. Skip and abort ask on the first click and run on the second.

When `gh` is set up for a GitHub repo, the next row shows the branch's pull request: its number, its base, its CI state and an `open`, `draft`, `merged` or `closed` pill. Hover it for the base, checks and changes; click it for the description (drawn as Markdown: headings, lists, code and links), checks, commits and files, with `github`, `copy` and `rerun` actions. Two open PRs from one branch, or PRs coming into a base branch, share one summary row.

In a details panel, a long list shows three rows and `show all`, which opens the whole list over it. Click a file in a panel's list to open it in the Explorer tab. Press Esc, click its `✕`, or click the row that opened it to close it.

Next come the changed files under CHANGES and recent commits under COMMITS. The tab redraws after each tool call and each prompt. A list with more rows than fit shows `── ↑ N more ──` at its top, which goes back to the start, and `↓ N more` at its end, which turns the page. COMMITS shows `↓ more` without a count, because it loads in pages.

Each changed file shows git's two status letters and its line counts: the first, dim, is what is staged, and the second, bright, is what is not; untracked and conflicted files show both bright, in one colour. Hover it for the same in words, and click it to open the file in the Explorer tab.

Each commit shows its subject and age; unpushed commits are bright and counted as `↑N` in the header. Hover one for its id, author, branches, tags and size. Click it for its message and files, with `copy` for its id and, once pushed, `github` for its page on GitHub, GitLab, Codeberg or SourceHut.

The mouse wheel scrolls each list. The `⇕` rule between CHANGES and COMMITS sets how the rows are shared: drag it or turn the wheel over it, and each side keeps at least one row; click it to move it to the top, and click it there to move it to the bottom. The [margin README](https://github.com/HT0710/claudzilla/blob/main/plugins/margin/README.md) has the full detail.

### The ballot card
<!-- topic: ballot -->

If you installed the ballot card, it appears over the prompt box when a reply asks you to choose. It turns the reply's decision into numbered answers, so one key answers instead of a typed reply. If you did not install it, run `~/claudzilla/install.sh --add ballot` in a terminal.

The ballot card appears after a reply with one `Decision` table of two or more options; see *Read a reply* (`/claudzilla replies`). The table's heading becomes the question and each option a numbered row. The recommended row is blue; when the reply gives a `Why:`, it shows under the rows. The last row is always `go ahead, except…`.

```text
╭─────────────────────────────────╮
│ How to finish the branch?       │
│                                 │
│ 1: merge to main locally        │
│ 2: push + PR                    │
│ 3: keep the branch as-is        │
│ 4: go ahead, except…            │
│                                 │
│ Why: PR, merge once CI is green │
╰─────────────────────────────────╯
```

**To answer:**

- Type a row's digit into the empty prompt, then pause. The option's id and text, such as `2: push + PR`, go into the prompt box. Press **Enter** to send.
- The recommended answer waits dim in the empty prompt. Press **→** or **Tab**, then **Enter**, to send it. When the Next or Picks line says more than the pick, such as `say go and I'll run X` or `B, fixes 1–3`, that waits instead.
- Pick `go ahead, except…` to get `go, but ` in the prompt box, then type your changes, such as `go, but 2B`.
- Press **alt+k** to move into the ballot card, on the recommended row. **Arrow keys** move between rows, **Enter** puts the answer in the prompt box, and **Esc** goes back without one. Without the claudzilla key, `ctrl+x tab` does the same. On macOS, alt is the Option key, and your terminal must send it as Meta; see [Option key shortcuts on macOS](https://code.claude.com/docs/en/terminal-config#enable-option-key-shortcuts-on-macos).
- Or ignore the ballot card and type your own answer.

The ballot card hides while Claude works and goes once you send any prompt. When a reply has nothing to choose, such as a `**Picks:**` line, a Next line that says `say go`, or a **Compact** line with no Next, no ballot card appears. The same goes for a reply whose Picks or `say B and I'll X` names a different option than its Decision recommends: only the dim answer, such as `1B, 2A` or `go`, waits in the prompt box.

An answer you send speaks in your voice, so the history reads as you wrote it: Claude's `show you the diff` comes back as `show me the diff`, and `your branch` as `my branch`. The ballot card's rows read the same way. Code and double-quoted text stay as written.

The [ballot README](https://github.com/HT0710/claudzilla/blob/main/plugins/ballot/README.md) has the full detail.

### Other plugins
<!-- topic: plugins -->

If you installed them, three more plugins also run.

**folio** draws the reply's frame and divider lines at your chat's width, so they never wrap, and links file paths to the margin.

**herald** toasts claudzilla update progress, usage limits passing 50, 75 and 90%, and when to compact. When another open session ends a turn with no background agents still running, or waits on a permission or a question, it toasts that for 10 seconds, such as `! claudzilla-35 waits on you · Bash permission · ⎇ main`. To change how long a herald toast shows, or turn one off, put its kind under `herald` in `~/.claude/claudzilla.json`, such as `{"herald":{"waiting":0}}`. The kinds and their times are in [CONFIGURATION.md](https://github.com/HT0710/claudzilla/blob/main/CONFIGURATION.md#guard-hook-config).

**ledger** pauses Claude's first edit of a file that another live session edited in the last 30 minutes, and tells that session.

For the names and what each one does, see [BESTIARY.md](https://github.com/HT0710/claudzilla/blob/main/BESTIARY.md).

## Settings and cost

### Usage and cost
<!-- topic: limits -->

Every request to Claude uses *tokens*: the text it reads, writes and thinks. On a Claude subscription, usage counts against two limits at once: a rolling 5-hour session limit and a weekly limit. Both are shared across all models. When one runs out, Claude Code stops sending requests until the reset time in the message, such as `You've hit your session limit · resets 3:45pm`.

#### See your usage

- Run `/usage` to see your plan limits and when they reset.
- If you installed the status line, its `5h` and `wk` meters show the same, with the time to each reset. See *The status line* (`/claudzilla hud`).
- If you installed the `herald` part, a toast shows when the 5-hour or weekly limit passes 50%, 75% and 90%, such as `5-hour usage 77% · resets in 2h10m`. Each point shows once per limit window, even across sessions.
- Run `/claudzilla cost` to see what this session cost. `/claudzilla cost <session-id>` reports one session.
- Run `/claudzilla cost all --since <date>` for totals and per-group lines of the sessions started since that date, split by Steward (agent routing) on and off.
- The `all` report covers the current project by default. Add `--project all` for every project.
- Every dollar amount is an API list price. A subscription is not billed per token, so your real bill differs.
- The cost log keeps its rows after Claude Code deletes old transcripts.
- The log fills automatically only while Steward is on. `/claudzilla cost` works for everyone and reads the transcripts it can find.

#### What uses more

- **Model:** claudzilla starts sessions on Opus (`opus[1m]`). Sonnet handles most coding tasks well and costs less. Run `/model` to switch.
- **Effort:** higher effort means deeper reasoning and more tokens; lower effort is faster and cheaper. Run `/effort` to change it.
- **Context:** each turn sends the whole context again, so a long session costs more per turn. See *Manage context* (`/claudzilla context`).

#### What claudzilla adds

Each of these costs tokens; here is how to turn it off.

- **Intent reports:** if you installed the margin, Claude calls a hidden `intent` tool at the start of each turn. To stop it, set the margin's `intent` option to off in `/config`; it applies from the next session.
- **Topics:** while the margin's Overview tab shows, an Opus request at low effort sorts your prompts into topics after each prompt. Switch to another tab or close the margin to stop it.
- **Done check:** when Claude says "done" with no check after its last edit, the guard sends the reply back, and Claude takes another turn to run a check. To get a note on the next prompt instead, put `{"rulesGuard":{"rules":{"doneClaim":"flag"}}}` in `~/.claude/claudzilla.json`, or use `"off"`. See *Customize claudzilla* (`/claudzilla customize`).

Two parts save tokens: caveman shortens replies, and rtk shortens command output. Claude Code's [costs](https://code.claude.com/docs/en/costs) page has more ways to reduce usage.

### Customize claudzilla
<!-- topic: customize -->

You change claudzilla through a few files of your own.

#### Two rules first

- **Which file wins.** For settings, `~/.claude/settings.overrides.json` wins over claudzilla's settings and over `~/.claude/settings.json`. The installer merges it, so run `~/claudzilla/install.sh` after you edit it. For the guard, a later file wins: `~/.claude/claudzilla.json` (this machine), then `<repo>/.claude/claudzilla.json` (shared, commit it), then `<repo>/.claude/claudzilla.local.json` (yours only). The guard reads them on each prompt. It skips a bad value and tells Claude about it on your next prompt.
- **Never edit the linked files.** `~/.claude/CLAUDE.md`, `~/.claude/rules/`, the hooks, claudzilla's skills and `~/.claude/agents/atlas.md` are links into the clone at `~/claudzilla`. An edit there is an uncommitted change in the clone, so any release that changes the same part waits, and you get only a notice.

#### What to change

In this list, `env`, `permissions` and `model` go in `~/.claude/settings.overrides.json`; the guard settings go under `rulesGuard` in a guard file. I want to:

- **Change the reply style:** set `CAVEMAN_DEFAULT_MODE` to `caveman` for less terse replies, or `off` (if you installed caveman).
- **Set how strictly Claude keeps changes small:** set `PONYTAIL_DEFAULT_MODE` to `full` to stop Claude pushing back on parts of a request, `lite` to build what you asked, or `off` (if you installed ponytail).
- **Get fewer permission prompts:** set `permissions.defaultMode` to `acceptEdits` or `auto`. See *Approve actions* (`/claudzilla approve`).
- **Use another model or effort:** run `/model` or `/effort` in a session. A default that `/model` or `/effort` saves lasts only until the next update; for every session, set `model` or `effortLevel` in `settings.overrides.json`, such as `"model": "sonnet"`.
- **Loosen a guard rule:** set it under `rules`. Values: blocks take `deny`, `remind` or `off`; `doneClaim` takes `now`, `flag` or `off`; skill reminders take `remind` or `off`; reply format checks take `flag` or `off`; `specExclude` takes `on` or `off`. The rule names are in [CONFIGURATION.md](https://github.com/HT0710/claudzilla/blob/main/CONFIGURATION.md#guard-hook-config).
- **Commit to `main` in a solo repository:** put `{"rulesGuard":{"allowMain":true}}` in `<repo>/.claude/claudzilla.local.json`.
- **Stop auto-update:** put `{"rulesGuard":{"autoUpdate":false}}` in `~/.claude/claudzilla.json`; you still get the notice. If preview moved your clone to a release branch, that notice also shows the command to return to the newest tag on `main`.
- **Change other guard settings:** `compactNudge` (the context size, in tokens, at which Claude suggests compacting; `0` turns it off), `coldCompact` (how many times `compactNudge` the context must reach before claudzilla compacts by itself while you are away, `2` by default; `0` never), `reviewNudge`, `autoUpdate` and `trace` (`false` stops the local trace; machine file only) sit next to `rules`, not inside it.
- **Recolour claudzilla:** put a `palette` key in `~/.claude/claudzilla.json`. Each colour is `#rrggbb`; any other value keeps its default. The status line changes at once, the plugins after `/reload-plugins` or in a new session. The margin names each ignored key in a toast.
- **Try a new behaviour early:** turn on an experimental feature. See *Experimental features* (`/claudzilla labs`).
- **Add your own instructions:** write them in `~/.claude/CLAUDE.local.md`. claudzilla's rules load it in every session on this machine.
- **Change keys:** run `/keybindings` to open `~/.claude/keybindings.json`. To free **alt+i**, **alt+w**, **alt+o**, **alt+h**, **alt+e**, **alt+g** or **alt+k**, set it to `null` in the `Chat` block. Changes apply without a restart.

#### Examples

`~/.claude/settings.overrides.json`:

```json
{
  "env": { "CAVEMAN_DEFAULT_MODE": "caveman", "PONYTAIL_DEFAULT_MODE": "full" },
  "permissions": { "defaultMode": "acceptEdits" },
  "model": "sonnet"
}
```

A guard file, such as `~/.claude/claudzilla.json`. If the file already has other keys, such as `install`, keep them.

```json
{ "rulesGuard": { "rules": { "pushVerify": "remind", "doneClaim": "flag" }, "compactNudge": 300000 } }
```

A palette in `~/.claude/claudzilla.json`. Every table and every key is optional.

```json
{
  "palette": {
    "shared": { "label": "#a396d2", "action": "#5d9678" },
    "hud": { "rampHot": "#ffaa5a" },
    "margin": { "ahead": "#d4b860", "types": { "fix": "#e06c75" } }
  }
}
```

The key names in each table:

- `shared`, colours that two or more parts use: `label`, `faint`, `idle`, `action`, `dirty`, `churn`, `muted`, `lit`, `prompt`, `flash`. Folio, primer and ballot read only this table.
- `hud`, the status line: `rampLow`, `rampHigh`, `rampHot`, `track`, `note`, `cwdLow`, `cwdHigh`, `profile`, `version`, `divider`, `sweep`, `model`, `skill`, `thinking`, `clock`, `session`.
- `margin`: `compacted`, `latest`, `ahead`, `behind`, `card`, `hairline`, `faded`, and three tables: `pill` (`green`, `gray`, `purple`, `red`, `yellow`, `blue`, `cyan`), `types` (`feat`, `fix`, `refactor`, `perf`, `docs`, `test`; these also colour the branch prefix in the status line) and `status` (`M`, `A`, `D`, `U`, `R`, `C`, `?`).

### Experimental features
<!-- topic: labs -->

An experimental feature is new behaviour that may change or be removed. Most are off until you turn them on. Steward (agent routing) is on by default, and you can turn it off. Once it proves itself, it moves into the normal rules.

#### Switch one on or off

- **List them:** run `/claudzilla experimental`.
- **Turn one on or off:** run `/claudzilla experimental <id> on` or `/claudzilla experimental <id> off`.
- **When it applies:** from the next session, or after `/clear`.

#### The features

- **Chancery** (`chancery`): off by default; run `/claudzilla experimental chancery on` to turn it on. Claude designs features with the `blueprint` skill instead of `brainstorming`, and keeps each job's spec and plan in one folder under `docs/chancery/`.
  - **Guard:** the guard blocks Claude's call to whichever skill is off: `blueprint` while Chancery is off, `superpowers:brainstorming` while it is on. This starts at the next tool call, while the rule text applies from the next session.
- **Baton** (`baton`): off by default; run `/claudzilla experimental baton on` to turn it on.
  - **Offer:** once context passes the `compactNudge` threshold, Claude can offer to continue the same job in a fresh session after `/claudzilla handoff`.
  - **Suggestion:** if you installed the ballot plugin, it puts that command in your empty prompt box as a dim suggestion. Tab takes it, Enter sends it.
- **Steward** (`steward`, called `agentRouting` before v1.9): on by default from v1.9; run `/claudzilla experimental steward off` to turn it off. Claude decides for each task whether to hand the work to a subagent. It picks the cheapest model and effort that does the job. Tracing code across files, such as following calls or imports, goes to a search subagent from the first step.
  - **Search limit:** with the feature on, the third search in one turn without a subagent call is refused with a note to delegate. Reads of a known file and a grep inside one known file stay allowed. The limit starts or stops at the next tool call, while the rule text applies from the next session. Scripts that run without the Agent tool: set `EVAL_ROUTING=off`, or turn the feature off.
  - **Superpowers skills:** subagent-driven development and parallel agents use a fixed model and effort per role. Implementers run on Sonnet, and the final review and stuck fixes run on Opus.
  - **Reviews:** each task gets a Haiku review at high effort, a second pass that hunts for a missed bug, and a Haiku spec checker that ties each requirement to a line. Re-reviews after a fix run on Haiku too, and their brief names any fix to shared code so the reviewer checks its other callers.
  - **Re-grade:** Claude re-checks each Important finding from these Haiku agents. A finding with no broken requirement and no shown wrong behavior becomes Minor and is noted, not fixed.
  - **Cost:** it may start more subagents. A saving has not been measured yet.
  - **Proven when:** the cost per completed task drops while the pass rate stays the same, measured over real sessions.

### Shortcuts
<!-- topic: keys -->

Press a key at the prompt. Items marked "if installed" work only with that part.

| press | does |
|---|---|
| Esc | stop Claude, or decline a prompt |
| Esc Esc | open the rewind menu (empty prompt) |
| Shift+Tab | change the permission mode |
| → or Tab | put the dim suggestion in the prompt |
| alt+i | open or close this guide |
| alt+w | open this guide on *Worlds* |
| alt+o | margin: Overview tab (if installed) |
| alt+h | margin: History tab |
| alt+e | margin: Explorer tab |
| alt+g | margin: Git tab |
| alt+k | move into the ballot card (if installed) |

On macOS, alt is the Option key, and your terminal must send it as Meta; see [Option key shortcuts on macOS](https://code.claude.com/docs/en/terminal-config#enable-option-key-shortcuts-on-macos). To change keys, see *Customize claudzilla* (`/claudzilla customize`). Claude Code's [interactive mode](https://code.claude.com/docs/en/interactive-mode) page lists all its keys.

### What runs on its own
<!-- topic: background -->

claudzilla does some things without being asked. This list names each one, so none of them surprises you. Settings named here are explained in *Customize claudzilla* (`/claudzilla customize`).

- **Auto-update:** when a session starts or you run `/clear`, a background job checks for a new claudzilla release, at most once an hour. If you installed the herald plugin, each open session also runs that check every 15 minutes, so a session you leave open gets a toast about a new release too. If there is one, it updates the clone at `~/claudzilla` and runs the installer again; restart Claude to apply it. Your own edits in the clone stay through the update, and the notice after it says so. If the release changes a file in the same part as one you edited, such as the same plugin or `claude/hud`, or the clone has local commits, it skips the update and shows a notice instead. To get only the notice, put `{"rulesGuard":{"autoUpdate":false}}` in `~/.claude/claudzilla.json`. To follow the newest `release/*` branch instead of the newest release, put `{"rulesGuard":{"autoUpdate":"preview"}}` there; it gets work that has not been reviewed yet. `true` switches a clone that preview moved back to the newest tag on `main`, and `false` only shows a notice with the command to do so.
- **Transcript reads by the guard:** the guard reads the end of the current session's transcript, the saved file of the session, to measure context and to see whether a check ran. It keeps its notes in a temporary file for each session.
- **Rule counts:** at startup, if the last `/rule-review` report is missing or a week old, a background job scans your transcripts in `~/.claude/projects/` and saves counts in `~/.claude/claudzilla-reports/`. When rules slipped, the next session shows a one-line summary once. The counts leave your machine only if you say yes in `/rule-review`. To stop the scan and the summary, put `{"rulesGuard":{"reviewNudge":false}}` in `~/.claude/claudzilla.json`.
- **Command rewriting:** if you installed rtk, a hook passes each shell command Claude runs through rtk, which shortens the output Claude reads. Run `rtk gain` in a terminal to see the tokens it saved.
- **Lines added to each prompt:** the guard tells Claude your terminal width, so its tables fit. If you use the margin, it also reminds Claude to send its intent report, and tells Claude on the next prompt when a reply skipped it; the margin's `intent` option turns both off. Past the `compactNudge` threshold it adds the compact reminder, and a prompt with words such as "bug" or "code review" gets a reminder to use the matching skill, unless it only asks to write or add failing tests; `compactNudge` `0` and the rules `debugTrigger` and `reviewTrigger` set to `off` drop them. To drop the width line, put `{"rulesGuard":{"rules":{"tableWidth":"off"}}}` in `~/.claude/claudzilla.json`.
- **Plans kept out of git:** when Claude writes a spec or plan under `docs/chancery/` or `docs/superpowers/` in a repository that tracks no files in that folder, the guard adds that folder to the repository's `.git/info/exclude` file. Git then ignores those files, so they stay out of your commits. To stop it, put `{"rulesGuard":{"rules":{"specExclude":"off"}}}` in `~/.claude/claudzilla.json`.
- **Settings reset on update:** each update runs the installer again, which puts claudzilla's values back in `~/.claude/settings.json`, such as the model or effort level that a `/model` or `/effort` pick saved. Put lasting choices in `~/.claude/settings.overrides.json`.
- **Local trace:** the guard and other claudzilla parts write what they did to `~/.claude/claudzilla-trace/` on your machine. Nothing is uploaded. To turn it off, put `{"rulesGuard":{"trace":false}}` in `~/.claude/claudzilla.json`. See *Report a problem* (`/claudzilla bugs`).
- **Messages between sessions:** if you installed the ledger plugin, a session about to edit a file that another session edited recently sends that session a message. An idle session wakes to read it, which starts one short turn there.
- **Your email:** if you installed the status line, it shows the email of the account you are logged in with, masked to the first and last letter before `@` and the domain. Anyone who sees your screen sees that much.
- **Agent teams:** claudzilla turns this experimental Claude Code feature off. It lets Claude start *teammates*: separate Claude sessions that work in parallel and message each other. A team uses far more tokens than one session, and while it is on, a subagent that Claude names can start as a teammate instead. To try it, put `{"env":{"CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS":"1"}}` in `~/.claude/settings.overrides.json`, then run `~/claudzilla/install.sh`. See Claude Code's [agent teams](https://code.claude.com/docs/en/agent-teams) page.
- **Prompt suggestions and away recap:** claudzilla turns off these two Claude Code features. Each sends a hidden request that re-reads the whole conversation: the dim suggested next prompt after each reply, and the one-line recap when you come back. Suggestions from claudzilla's own parts, such as ballot's pick, still show, and `/recap` still writes a recap on demand. To get one back, put `{"promptSuggestionEnabled":true}` or `{"awaySummaryEnabled":true}` in `~/.claude/settings.overrides.json`, then run `~/claudzilla/install.sh`; a `/config` toggle is reset on the next update.

## Get help

### Fix common problems
<!-- topic: stuck -->

Find the problem you see, then follow its steps.

#### The guard blocked a command

The block message tells Claude what to do instead, such as create a branch before it commits, and Claude usually does that next. *Git and safety* (`/claudzilla guard`) lists each block. If you need the blocked command, run it yourself: type `!` and the command at the prompt, such as `! git push`. To change a rule for good, see *Customize claudzilla* (`/claudzilla customize`).

#### "Done" got sent back

Claude said "done", "fixed" or "passing" with no check after its last edit, so the guard sent the reply back. Wait: Claude runs a check, such as the tests, and reports the output. If the reply made no such claim, Claude answers `no claim`, and you can ignore it.

#### An update failed

The notice reads `claudzilla: auto-update to <version> failed - ask Claude to debug it`, with the path of the log. Ask Claude to debug the claudzilla update: it gets the log path and the command to try again. A notice that says `update <version> skipped (local changes)` means the release changes files next to ones you edited in the clone at `~/claudzilla`, and `(local commits)` means the clone has commits of its own. Ask Claude to update: it brings your changes onto the release; see *Customize claudzilla* (`/claudzilla customize`).

#### Boxes instead of symbols

The status line and margin draw their symbols with the MesloLGS NF font. The installer adds the font, but your terminal keeps its own font, such as SF Mono in macOS Terminal, until you change it. Set MesloLGS NF as your terminal font. If it is not installed, run `CLAUDZILLA_FONT=yes ~/claudzilla/install.sh` first. To use basic symbols in both instead, run `CLAUDZILLA_FONT=no ~/claudzilla/install.sh`.

#### A plugin misbehaves

Run `/plugin`, press **Tab** to reach the Installed tab, select the plugin and press **Space** to turn it off. The installer turns the plugins it installed back on when it runs again, such as on an auto-update. To keep one off, remove its part in a terminal, such as `~/claudzilla/install.sh --remove ballot`.

#### Claude keeps missing

After two failed corrections, run `/clear` and write a better first prompt with what you learned. If you installed the margin, check its ASK line to see how Claude read your request. See *Talk to Claude* (`/claudzilla talk`).

For problems with Claude Code itself, run `/doctor`, or see Claude Code's [troubleshooting](https://code.claude.com/docs/en/troubleshooting) page.

### Check the install
<!-- topic: doctor -->

`/claudzilla doctor` checks that every claudzilla part runs the version your clone is on, and prints one line per problem with the command that fixes it. It only reads, so it is free and safe to run at any time.

It checks:

- **Plugins:** each claudzilla plugin in the plugin cache matches the clone. A cache can stay old when an update ran but the plugins did not, so the status line shows a new version while a plugin still runs the old one.
- **Restart:** a plugin changed after this session started, so the session still runs the old code.
- **Links, plugins and settings:** the files in `~/.claude` point into the clone, the parts you picked are installed and turned on, and `settings.json` still has claudzilla's hooks and status line.
- **Tools:** `node`, `perl` and `git` are on your PATH, and `rtk` when you picked it.
- **Status line, hooks and the last update:** the status line runs and shows the version, each hook file parses, and the last auto-update did not fail.
- **Symbols:** the margin rail icons and status line symbols, printed so you can see them. Doctor cannot read your terminal's font, so this row starts with `?`. Boxes mean the font lacks them: set MesloLGS NF as your terminal font, or switch to basic symbols and restart Claude.

```text
claudzilla doctor  v1.10.0 @ cee0f89
✗ margin      cache at 6dfdb1b, clone at cee0f89
  fix: claude plugin update margin@claudzilla
✓ links       19/19
Fix all: /claudzilla doctor fix
```

`/claudzilla doctor fix`, or asking Claude to fix claudzilla, lets Claude apply the fixes. Claude lists them first and runs nothing until you say yes. When your permission mode denies a command, Claude gives you the commands to run yourself.

A row that starts with `!` has no automatic fix, and its second line says why. A restart row clears when you restart Claude. `/reload-plugins` also loads the new plugins, but the row may stay until the next session.

When a session starts and something is wrong, claudzilla shows one line, such as `claudzilla: margin out of date`. A healthy install shows nothing.

### Report a problem
<!-- topic: bugs -->

claudzilla keeps a trace of each session so a problem can be reported with facts, not memory. It stays on your machine: nothing is uploaded, except that a report sends a short search phrase to GitHub to look for an existing issue. Nothing else leaves your machine unless you say yes to filing or commenting.

#### What is recorded

- **Where:** `~/.claude/claudzilla-trace/` (or `$CLAUDE_CONFIG_DIR/claudzilla-trace/`). The folder is readable only by you.
- **What:** which claudzilla hooks and plugins (margin, ballot, primer and the rest) ran and what they decided, plus a snapshot of your setup. The snapshot lists enabled claudzilla plugins and the names of settings, never their values. Secrets, such as API keys and tokens, are masked before anything is written.
- **Doctor:** the report snapshot replaces local project and configuration paths in doctor results with `<path>`. Running `/claudzilla doctor` yourself still shows the paths you need for repairs.
- **How long:** files older than 7 days are removed, and the folder is kept under 50 MB. Both happen when a session starts.
- **Off switch:** put `{"rulesGuard":{"trace":false}}` in `~/.claude/claudzilla.json`. It takes effect at the next session start. Traces already written stay and are removed after 7 days. With tracing off nothing is written, and a report uses the conversation plus a snapshot built on the spot.

#### Report it

Run `/claudzilla report` and, if you like, add what happened, such as `/claudzilla report the guard blocked a safe command`. Claude then:

- asks questions if the problem is unclear, and can mark a window while you make it happen again;
- decides whether it is a bug or expected behaviour, and points to the guide topic if it is expected;
- searches for an issue that already covers it;
- drafts the whole report in `~/.cache/claudzilla/report-drafts/`. The trace part leaves out your prompt text and shows only its length. Claude files a GitHub issue (label `report`) only when you say yes to the draft; otherwise you get text to copy.
- if filing through `gh` fails, gives you a prefilled link plus a saved `.txt` file to attach. The saved `.txt` goes in `~/.claude/claudzilla-reports/` (or `$CLAUDE_CONFIG_DIR/claudzilla-reports/`); it holds the full masked report, and nothing removes it or the drafts, so delete them when you are done.

If your Claude account or `git config user.email` is not a common personal address (a Claude account with no email also counts; a malformed git email too), or the account uses an API key, an auth token, an `apiKeyHelper` in settings, Bedrock, Vertex or Foundry, GitHub is off: you get text to copy and share through your company's channel.

### Quick reference
<!-- topic: ref -->

Type a word or command at the prompt and press **Enter**. Items marked "if installed" work only with that part. Keys are in *Shortcuts* (`/claudzilla keys`).

#### Words to Claude

| type | does |
|---|---|
| `go` | accept every recommendation |
| `1B` | pick option B of Decision 1 |
| `go, but 2B` | accept the rest, change one pick |
| `stop caveman` | turn caveman off (if installed) |
| `stop ponytail` | turn ponytail off (if installed) |
| `normal mode` | turn both off |

#### claudzilla commands

| type | does |
|---|---|
| `/claudzilla [topic]` | open or close this guide, or open one section |
| `/claudzilla-guide [topic]` | open this guide, or one section; never closes it |
| `/claudzilla-worlds` | open this guide on *Worlds* |
| `/claudzilla report [what happened]` | draft a problem report from the local trace |
| `/claudzilla compact` | draft a `/compact` line into the prompt box |
| `/claudzilla handoff [ask]` or `/claudzilla-handoff [ask]` | start fresh with a note from this session; text after it is the new session's first ask |
| `/claudzilla cost [session-id]` | show what this session or one session cost |
| `/claudzilla doctor [fix]` | check that every part runs your clone's version; `fix` lets Claude apply the fixes once you say yes |
| `/claudzilla experimental [<id> on\|off]` | list experimental features or switch one |
| `/rule-review` | count how often each claudzilla rule slipped |
| `/margin` | open or close the margin (if installed) |
| `/caveman` | turn caveman on (if installed) |
| `/ponytail lite` | set ponytail's level: `lite`, `full`, `ultra` (if installed) |

#### Claude Code commands

| type | does |
|---|---|
| `/compact` | summarize context to free space |
| `/clear` | start a new session |
| `/rewind` | go back to an earlier prompt |
| `/context` | show what fills context |
| `/usage` | show your usage limits |
| `/help` | list Claude Code's commands |
| `!` and a command | run the command yourself |

### Update and get help
<!-- topic: more -->

#### How updates arrive

Each feature, fix or refactor pushed to claudzilla's `main` branch ships as a release once its tests pass. At most once an hour, a new session or `/clear` installs the newest release in the background. A notice appears when a session starts; if you installed the herald plugin, a toast also tells you when an update is available, installing, installed, or failed, even in a session that is already open. Restart Claude to apply an update; `/claudzilla news` lists what changed. If the release changes a part you edited in the clone, the update waits and the notice asks you to let Claude update. Auto-update is described in *What runs on its own* (`/claudzilla background`).

#### Update by hand

Run this in a terminal. It takes the latest `main`, which can be ahead of the newest release:

```bash
cd ~/claudzilla && git pull && ./install.sh
```

#### Add or remove parts

Run `~/claudzilla/install.sh --add margin` to add a part, or `--remove margin` to take it out. The [README](https://github.com/HT0710/claudzilla/blob/main/README.md#install) lists the other flags, such as `--full`, `--custom` and `--yes`. The parts are `hud` (the status line), `rtk`, `caveman`, `ponytail`, `folio`, `margin`, `ballot`, `herald`, `byline` and `ledger`.

#### Uninstall

Run this in a terminal:

```bash
~/claudzilla/install.sh --uninstall
```

It asks first, then removes claudzilla's links, settings entries, keys and plugins from `~/.claude`, and undoes what the install recorded, such as the node, fonts and shell lines it added. What is still there, such as rtk, copies it did not install and the clone, it lists with the commands to delete them.

#### Get help

- Run `/help` to list Claude Code's commands, or `/doctor` to check your Claude Code setup.
- Report a claudzilla problem or ask a question in [claudzilla's GitHub issues](https://github.com/HT0710/claudzilla/issues).
- Read every claudzilla setting in [CONFIGURATION.md](https://github.com/HT0710/claudzilla/blob/main/CONFIGURATION.md).
- Read each plugin's README: [margin](https://github.com/HT0710/claudzilla/blob/main/plugins/margin/README.md), [ballot](https://github.com/HT0710/claudzilla/blob/main/plugins/ballot/README.md), [folio](https://github.com/HT0710/claudzilla/blob/main/plugins/folio/README.md), [byline](https://github.com/HT0710/claudzilla/blob/main/plugins/byline/README.md), [primer](https://github.com/HT0710/claudzilla/blob/main/plugins/primer/README.md), [herald](https://github.com/HT0710/claudzilla/blob/main/plugins/herald/README.md), [ledger](https://github.com/HT0710/claudzilla/blob/main/plugins/ledger/README.md).
- Learn Claude Code itself in [Claude Code's docs](https://code.claude.com/docs/en/overview).
- claudzilla is built on [caveman](https://github.com/JuliusBrussee/caveman), [ponytail](https://github.com/DietrichGebert/ponytail), [superpowers](https://github.com/obra/superpowers) and [rtk](https://github.com/rtk-ai/rtk).

### What's new
<!-- topic: news -->

Headline features of recent versions. Restart Claude after an update to use them.

#### v1.10.0

- **Edits open in Explorer:** click a file in an edit's row, and the margin's Explorer opens at the edit, instead of a diff box in the chat. Explorer also shows git's letters and each change inline (`/claudzilla margin`).
- **Markdown in Explorer:** a `.md` file opens drawn as Markdown, and its tables draw as a grid when they fit. A switch shows the source (`/claudzilla margin`).
- **Prompt cards:** each prompt you type shows as a card at the right edge, with its send time, so you find where each turn began (`/claudzilla replies`).
- **Failed calls:** a failed tool call draws one row with up to three lines of its error, instead of the full red block (`/claudzilla replies`).
- **Waiting sessions:** herald toasts when another open session finishes its turn or waits on you, with its name and branch. Each kind of toast takes its own time, and `0` turns it off (`/claudzilla plugins`).
- **API spend:** with an API key, the `5h` and `wk` meters give way to your spend this session, today and this month, with a 24-hour chart. On OpenRouter, today and month come from its bill (`/claudzilla hud`).
- **Doctor:** `/claudzilla doctor` checks that every part runs your clone's version and prints the fix for each problem. `/claudzilla doctor fix` lets Claude apply the fixes once you say yes (`/claudzilla doctor`).
- **Two new experiments, both off by default:** Chancery designs features with the `blueprint` skill and keeps each job's papers in one folder. Baton offers to continue a long job in a fresh session after `/claudzilla handoff` (`/claudzilla labs`).

#### v1.9.0

- **Steward on by default:** Claude now decides for each task whether to hand it to a subagent, and at which model and effort. Run `/claudzilla experimental steward off` to turn it off; an old `agentRouting: false` carries over. Scripts that run without the Agent tool should set `EVAL_ROUTING=off` (`/claudzilla labs`).
- **Explorer:** the margin's File tab is now Explorer, a read-only file browser with folder pages, find, back and forward, and line references you copy from the gutter (alt+e, `/claudzilla margin`).
- **Side rail:** the margin's tabs sit on a narrow rail down its edge, which widens when you hover it (`/claudzilla margin`).
- **Tool rows fold:** every finished tool call folds into one short row on a section rail, and a click opens it (`/claudzilla replies`).
- **One-row status line:** `{"hud":{"layout":"minimal"}}` draws the status line in one row (`/claudzilla hud`).
- **Subagent names:** each subagent gets a character name, and `atlas` scouts the code for Claude's lookups (`/claudzilla bestiary`).
- **Worlds:** meet claudzilla's parts and their stories with alt+w or `/claudzilla-worlds`.
- **Changed keys:** the guide moved from alt+q to alt+i (`/claudzilla keys`).
- **Fewer side requests:** prompt suggestions and the away recap are off by default (`/claudzilla background`).
- **Preview channel:** set `{"rulesGuard":{"autoUpdate":"preview"}}` to follow the release in progress before it is tagged. It brings unreviewed work; set `true` to return to the newest release (`/claudzilla background`).
- **Turn timer:** the Overview footer counts a turn's time while it runs and says how long it took when it ends (`/claudzilla margin`).
- **Handoff in the Compact line:** when context runs long, the Compact line names `/claudzilla handoff` if the next step needs only the last few turns (`/claudzilla context`).
- **Run before done:** after changing an app, CLI, server, UI or plugin, Claude launches it and checks the change before it says done (`/claudzilla skills`).
- **Usage in cost warnings:** with a usage ratio set in `~/.claude/CLAUDE.local.md`, Claude's cost warning adds the share of your 5-hour and weekly limits, such as `≈ 3% of 5h, 1% of week`.

#### v1.8.0

- **Overview redesign:** the margin's Overview tab shows SESSION, TOPIC, ASK, TAKE and PLAN, and PLAN scrolls in place when it runs long. USED lists what Claude read this turn and opens a modal per kind. Hover a label for a card saying what it is (`/claudzilla margin`).
- **Handoff:** `/claudzilla handoff` starts a fresh session with a note from this one. Herald offers it when the prompt cache goes cold (`/claudzilla context`).
- **New-release toast:** herald checks for a new claudzilla release every 15 minutes, so a session you leave open hears of it too (`/claudzilla background`).
- **Cost report:** `/claudzilla cost` shows what a session cost at API list prices (`/claudzilla limits`).
- **Recolour claudzilla:** the `palette` key in `~/.claude/claudzilla.json` changes claudzilla's colours (`/claudzilla customize`).
- **Git tab fetch:** while the Git tab shows, the margin fetches on its own every 15 minutes (`/claudzilla margin`).
- **Wrap on code cards:** the `↩ Wrap` button on a code card wraps its long lines, or a shell card's output (`/claudzilla replies`).
- **Experimental features:** try new behaviour before it becomes a rule, starting with Steward (`/claudzilla labs`).

## Worlds

### Lore
<!-- topic: lore -->

Long ago, which in claudzilla time means a few releases back, Claude was a plain helper in a terminal. Then some grew big and wild: claudzilla, Claude plus "zilla", the old word for a beast too large to ignore.

Wild claudzilla need taming, and only one tamer knows how: [HT0710](https://github.com/HT0710). The rulebook and the guard are the reins, and `go` is the word every claudzilla waits for.

No two claudzilla are alike. When one comes to live in your `~/.claude`, it is yours to raise. It waits for your `go`, wears your colours (`/claudzilla customize`), and picks up your ways as you train it.

Some say yours will one day learn your world, with your names and your stories.

On its back, creatures soon moved in. They live in three places:

- **The print shop:** folio, margin, ledger, byline and primer set the type, keep the records and mind this guide.
- **The court:** herald brings the news, ballot counts your vote, steward decides who goes where, and chancery drafts and files every job.
- **The road:** atlas scouts the code and comes back with a map, and baton runs a long job on to a fresh session.

Each release is a chapter in the story, and the *Chronicle* tells them all (`/claudzilla chronicle`).

Rare beasts roam here too. When steward sends out a subagent, about one in ten gets a name that nods to a famous figure, such as `sisyphus-the-retrier` for a retry. Spot one while Claude works, and you have seen something few have.

New creatures arrive with each release. Each one takes a name from the print shop or the court, and its entry goes in the *Bestiary* (`/claudzilla bestiary`).

### Bestiary
<!-- topic: bestiary -->

Every part of claudzilla is a creature with a name. Most come from the print shop, such as folio and ledger, and a few are old court roles, such as herald and steward. Here is who lives where.

#### Familiars (plugins)

- **ballot:** a court clerk who waits by the prompt. After a reply with a Decision, it holds out a card of numbered options. Press a key, and it carries your vote back to Claude.
  - **Habit:** it numbers every option on its card, and the recommended one glows blue. Type a digit into an empty prompt, wait a breath, and that row is picked.
  - **Quirk:** it speaks in your voice, so "show you the diff" leaves its paws as "show me the diff".
  - **First seen:** v1.0, then called picks.
- **byline:** a quiet scribe who sits at the end of every commit and PR. It scrubs Claude's session links and the "Generated with Claude Code" line before anyone reads them.
  - **Habit:** it hunts `Claude-Session:` lines and `claude.ai/code/session_…` links in the trailer Claude writes, and eats them before they reach a commit or PR.
  - **First seen:** v1.0, then called attribution.
- **folio:** a typesetter who lives in the chat. Before every reply it measures the page and sets the frame to fit, so not one line wraps, and it turns file paths into doors to the margin.
  - **Habit:** it draws every code block as a card with Copy, and a shell block also gets Run. The first click arms Run, the second runs it, and the output streams into the card.
  - **Habit:** in the fullscreen layout, finished tool calls fold into rows such as `◼ Ran (1 command)`, strung along a `│` rail.
  - **First seen:** v1.0, then called response-dividers.
- **herald:** a messenger who rides through the toasts. It cries the news: an update on its way, usage limits passing 50, 75 and 90%, and the moment to compact.
  - **Habit:** every 15 minutes it rides out to check for a new release, so a session left open still hears the news.
  - **Habit:** on a long chat with an hour-long prompt cache, when you step away and the cache is about to go cold, it puts `/claudzilla compact` in the empty prompt.
  - **Habit:** once the cache has gone cold, it offers `/claudzilla handoff` instead.
  - **First seen:** v1.0, then called update-toast.
- **ledger:** a record keeper who watches every live session. When another one touched a file in the last 30 minutes, it stops Claude's first edit there and sends word to that session.
  - **Habit:** it guards the Edit, Write and NotebookEdit tools. It cannot see files changed by shell commands, such as `sed -i`.
  - **Memory:** it forgets a session's entries when that session ends, and any entry after 30 minutes.
  - **First seen:** v1.6.
- **margin:** a chronicler who lives in the side pane. It writes down Claude's plan and your prompts, and keeps a file view and git close at hand.
  - **Lair:** it keeps four tabs on a narrow rail down its edge: Overview, History, Explorer and Git.
  - **Habit:** click a prompt in History, and the chat scrolls to it. `⟲ rewind` opens the `/rewind` picker.
  - **First seen:** v1.0, then called panel.
- **primer:** the keeper of this guide, who lives in the Guide tab beside the margin. Call it with `/claudzilla [topic]`, and it opens one page at a time.
  - **Habit:** `/claudzilla` with no topic opens or closes its pane, and alt+i calls it too, unless you gave that key another job.
  - **Habit:** it also runs `/claudzilla report`, `/claudzilla compact` and `/claudzilla cost`.
  - **First seen:** v1.4, then called guide.

#### Scouts (agents)

- **atlas:** a read-only scout on haiku who roams the code. Ask where X is defined, and it comes back with a `file:line` map. It never tells you how to fix what it finds.
  - **Habit:** it travels light. It skips `CLAUDE.md`, carries only Read, Grep, Glob and read-only Bash, and sends its searches out side by side.
  - **First seen:** v1.9.

#### Wild ones (experiments)

- **baton:** asleep by default. Awake, it waits near the end of long sessions, and when the work grows heavy, it offers to hand the job to a fresh session, the way a runner passes a baton.
  - **Habit:** its offer comes as a Decision row or a **Next:** line holding `/claudzilla handoff`, and ballot holds the command out as a dim suggestion.
  - **Taming:** `/claudzilla experimental baton on` wakes it.
  - **First seen:** v1.10.
- **chancery:** asleep by default. Awake, it designs every job with `blueprint` instead of `brainstorming`. Its full entry is under Summons.
  - **Taming:** `/claudzilla experimental chancery on` wakes it.
- **steward:** a court officer who stands behind every task. It decides which parts to send off to subagents, and on which model. Tamed in v1.9, it now runs by default.
  - **Habit:** the third inline search in a turn with no subagent call is refused, so a long lookup goes to a scout such as atlas.
  - **Taming:** it still counts as a wild one, so `/claudzilla experimental steward off` puts it back to sleep.
  - **First seen:** v1.8, then called agent routing.

#### Summons (skills)

- **chancery:** the court's keeper of papers. Summoned whenever a job needs designing, it keeps one folder for every job.
  - **Habit:** `blueprint` is its first. It asks what you want, writes the spec, and waits for your go before a plan.
  - **Lair:** `docs/chancery/`, one folder per job.
  - **First seen:** v1.10.

For each creature's full entry, and the rules for naming a new one, see [BESTIARY.md](https://github.com/HT0710/claudzilla/blob/main/BESTIARY.md).

### Chronicle
<!-- topic: chronicle -->

Every release leaves a chapter in claudzilla's story. Each one is told as it happened: a problem met in the wild, the choice the tamer made, and the paths left untaken. The oldest comes first.

#### v1.0, The First Howl

The first claudzilla stepped out of the terminal with five creatures on its back, and two of them led the way.

One, then called update-toast and now herald, cried the news. The other, then called picks and now ballot, held out a card of choices.

The beast needed reins. Rules read once at session start slipped away mid-session, so the tamer made the rules-guard: a hook that stops a bad move, or reminds Claude of the rule, as it happens.

Each rule got its own strength, `deny`, `remind` or `off`, set in layered `claudzilla.json` files instead of being carved in stone.

A public default of `dontAsk` would have let the beast quietly refuse tool calls for anyone who started a plain `claude`. The tamer turned it down, so claudzilla asks first.

Settings brought a quieter trouble. Claude Code rewrote `settings.json` with its keys in a new order, and the old merge, which compared raw JSON, laid every hook down twice. Now a three-way merge remembers what it last laid down.

The rules for pull requests loaded into every session, though they matter only when a PR opens. They moved into a `pr` skill that wakes only when Claude opens or edits one.

#### v1.1, One Look Decides

The card learned to hold back. A card with a lone `go` row asked for a press that meant nothing, because the dim suggestion already said it.

Now the card shows only for a real choice, with two or more options.

A pressed answer once went straight to Claude through `$.prompt.submit`. That path skipped the prompt box's own submit, so the old dim suggestion came back to haunt the next reply.

The card now fills the box, and your Enter sends it.

#### v1.2, Two Heads, One Go

With a Picks line, the suggestion used to drop what `go` starts, so history read "1A, 2A" and nothing more. Now it reads like `1A, 2A, then X`: two heads, one `go`.

The `go: ` prefix fell away, because it repeated in history and Tab on the suggestion already saves the typing. Replies that end with `say "push" and I'll X` now get a suggestion too.

#### v1.3, Called by Name

The panel, now margin, began opening on the Overview, where Claude reports its own plan. Getting Claude to answer that call took three tries.

First the rule sat in a mod's `prompt.compose`, which the guard skips, so the Overview showed only topics. The rule moved into the tool's own text.

In long chats it still faded, with 4 reports in 21 turns, so a one-line reminder now rides along with every prompt.

A background agent set another trap. Its call ended Claude's turn, and the panel marked every step done while the agent still worked. Now steps stay open until the agent comes back.

The release bell changed twice in one season. Eight tags in about a day felt like noise, so releases moved to a weekly Monday bell.

Then fixes sat waiting up to a week, and the weekly bell was turned down: now every push to `main` that changes code, such as a fix or a feature, releases.

Updates stopped chasing the tip of `main`, which brought every merge to users within a day. claudzilla now follows the newest `v*` tag. Shallow clones carried no tags at all, so the first background fetch now digs them up.

The stop nudge asked for the verify skill after every claim of done. A 14-day replay counted 546 nudges, and the skill caught 0 real bugs in 355 calls.

Now the nudge speaks only when a work file changed and no command ran after it.

#### v1.4, Mother of Parts

claudzilla learned to bring its parts out one by one. Full brings them all, and Custom lets you pick.

A third mode named "auto" was turned down, because the word already belonged to `autoUpdate` and to Claude Code's own auto mode.

The keeper of this guide, then called guide and now primer, got a den of its own instead of crowding into the panel, now margin, whose code had already grown to 73.6K.

It is always there, because someone who turned parts off needs help most.

Bug reports used to arrive as words alone. Now every part leaves tracks in a local trace, and `/claudzilla report` turns them into a report.

Sending the tracks off on their own through Sentry was chosen, then deferred, because company networks may block it.

A report must not carry work secrets out of a company. With a company sign-in, the report comes back as copyable text, and nothing is filed for you.

Leaving got kinder too. claudzilla keeps a record of what it brought, and when it goes, it takes only those things, never yours.

#### v1.5, Doors in the Margin

File names in replies turned into doors. The creature then called response-dividers, now folio, cut them.

One click on a file Claude names opens it in the panel's new File tab, beside the chat, with the line marked. The panel is now margin.

A fourth tab broke the bar. At 40 columns, four labels in one bar left too few columns each, so the tabs split into two bars by scope.

Picks, now ballot, spoke in Claude's voice, sending lines like "show you the result" as if you had said them. Now its answers speak in yours.

The compact reminder was a whole drafted section, and it showed on too many replies. It shrank to one line at the end of a reply that finishes a task.

#### v1.6, Cards on the Table

Code blocks became cards with a Run button. Filling `! cmd` into the prompt was turned down, because a mod cannot switch the prompt to shell mode, so every run cost a Claude turn.

Now the first click arms Run, and the second runs the block.

The cards stream output as it comes, a run can be stopped, and the buttons sit beside the block they act on.

Then came the naming. Every creature took one distinct word from the print shop or the court: picks became ballot, attribution became byline, response-dividers became folio, update-toast became herald, panel became margin, and guide became primer.

A new creature arrived to keep the peace. Two sessions sharing one clone could edit the same file unaware, so ledger pauses the first such edit and sends word to the other session.

The guard used to flatly deny a force push or a discard, and you had to retype the command after `!`. Now it asks, and lists what you would lose, so you can say yes in place.

One idea was left in the wild. A note for repeated identical Bash failures was dropped, because 30 days of transcripts, with 15,628 Bash calls, held no three identical failures in a row. Its name, `ditto`, waits for it.

#### v1.7, Many Branches

The margin grew a Git tab. Its top rows show the branch and the fetch, rebase and PR state at a glance, with detail one hover or press away.

CHANGES and COMMITS lists followed, and then a list of worktrees.

One hung worktree once froze the whole tab, and a failed status read as a clean tree. Now each worktree gets 5 seconds to answer, and one that fails or stays silent shows `? changed`.

Big edits filled the chat with their full diffs. folio began folding each edit into one row with a file tree.

ballot met a riddle. A reply recommended "A + B", but the card picks one row, so B dropped out. A combination now gets its own option row.

#### v1.8, The Herald's Horn

herald learned to blow its horn in open sessions. The update check ran only when a session started, so sessions left open never heard of a new release.

Now herald checks every 15 minutes, and every open session hears the news.

Rules could not be switched off, so new behaviour could not be tried without changing every user's sessions. Experiments arrived as `experimental.<id>` keys, all off by default.

The first wild one was agent routing, now steward. Its rule text alone was missed in practice, so a hook came along: the third inline search in a turn with no Agent call is stopped.

Plans written on Opus cost $5.45 to $9.35 each.

With agent routing on, which in v1.8 was off by default, haiku writes the plan, Opus reviews it, and sonnet re-checks the fixes. In a one-spec trial, all of that cost $4.07 against $8.76.

Tool calls each drew their own row, and read and search groups never folded. folio now folds every tool group onto a section rail. Changing the engine's own grouping was turned down, because no API allows it.

#### v1.9, The Steward Wakes

Steward woke. Agent routing took the name steward and now runs by default for everyone, though it is still marked experimental. Only an explicit `false` puts it back to sleep.

Reviews found a cheaper watchman. On 4 past reviews with 11 known bugs, haiku with a second pass caught 9.5 of 11 for $0.21, where sonnet caught 6 for $0.87. Per-task reviews moved to haiku.

The margin's two tab bars became one side rail. A setting to choose bars or rail was turned down, because it meant two layouts to draw and test, and nobody asked for it.

Every subagent now gets a name, and margin and folio show it. A hook that refuses unnamed calls was turned down, because each refusal costs one more main-chat call, about $0.05.

Instead, a hook fills in a name when Claude forgets.

#### v1.10, Ink on Every Paw

The rumour came true: your own words now sit to the right. Prompts looked like every other line, so scrolling back made it hard to find where a turn began.

folio now sets each prompt as a card, with its send time under it.

An edit's diff opened in a box in the chat, out of context. folio dropped the box. A click on the edited file opens the margin's Explorer at the edit, and the new lines flash there.

Explorer learned git's marks too. A changed file shows its change inline, and removed lines are drawn faint, so they never read as live code.

`.md` scrolls showed only their raw source. Explorer borrowed the Git tab's renderer instead of building its own, and a switch still shows the source.

Tables came next: a grid when they fit, and a list that keeps each column name when they do not.

herald learned to carry a cry between sessions. When one session finishes or waits on the tamer, every other open session hears it, with its name and branch.

A line pinned under the prompt was turned down, because it did not scale to many sessions. Later, each kind of toast got its own time, and `0` silences it.

API-key logins saw empty `5h` and `wk` meters. The status line now shows what was spent here, today and this month, with a 24-hour chart.

On OpenRouter, Claude Code's own estimate once ran 51% over the bill in a 10-minute window, so today and month now come from the bill. The rest stays local, because OpenRouter keeps no count per session.

A status line once said v1.9 while margin still ran v1.8, and nothing told the tamer. The doctor arrived. It reads every part with no model call, and speaks at start only when something is wrong.

The doctor never writes config, and `doctor fix` waits for the tamer's yes. At the gate it also learned to hide whole paths from problem reports.

Commit bodies got their gentle growl. An audit of 100 commits found 40 with a body line over 72 columns. The new rule reminds and never blocks.

The v1.9 gate missed 8 stale pictures, because nothing tied a picture to the code it draws. Now a map ties 19 pictures to their sources, and a script lists what changed since each one was taken.

Two wild ones were caught, and both sleep until woken. Chancery designs each job with `blueprint` and files its papers in one folder.

Baton, once only tracks near long sessions, now offers to hand a long job to a fresh session.

The handoff note grew for it: a git block for each worktree touched, the files written, the last reply in full when it is short, and a chain of the sessions before it.
