# claudzilla guide

This file is the user guide for claudzilla. You can read it here, or type `/claudzilla` in Claude to open it in a pane. Type `/claudzilla <topic>` to jump to one section; in the pane, each section shows its topic name under its title. Each section stands alone.

## Basics

### What claudzilla is
<!-- topic: start -->

[Claude Code](https://code.claude.com/docs/en/how-claude-code-works) is an AI coding agent. It runs in your terminal: you describe a task, and Claude reads your files, edits code and runs commands to do it.

[claudzilla](https://github.com/HT0710/claudzilla) is a layer of configuration on top of Claude Code. It adds rules that Claude follows, the *guard* (a hook that checks Claude's git commands and its "done" claims), skills for common workflows, and plugins that change what you see. Its files live in a *clone*, `~/claudzilla` by default, and the installer sets them up in `~/.claude`, the folder where Claude Code reads your configuration.

What changes compared with stock Claude Code:

- **Replies:** short, with the answer first. Each claim carries a `file:line` reference or a command, or is marked *unverified*.
- **Changes:** Claude investigates, proposes one fix, and waits for your `go` before a multi-file or risky edit. It changes only what the task needs.
- **Proof:** Claude says "fixed" only after the check ran. The guard sends an unchecked "done" back to be checked.
- **Git:** the guard blocks force-pushes, discarding work, and commits on `main`.
- **Permissions:** sessions start in Manual mode, so Claude asks before it edits files or runs commands. Recent versions of stock Claude Code start in auto mode, where a classifier reviews most actions instead of asking you.
- **Screen:** if you installed them, the status line, the panel, the picks card, the response dividers and the toasts.

A Full install includes every part; a Custom install includes the parts you kept. Sections about an optional part say "if you installed" it.

If you are new to terminals, Claude Code's [terminal guide](https://code.claude.com/docs/en/terminal-guide) shows how to open one and start Claude Code. Then follow *Run your first task* (`/claudzilla first`).

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
- **Plugin:** a package of skills, hooks and other parts that installs as one unit. claudzilla installs superpowers and, if you installed them, its own plugins (such as the panel and the picks card), caveman and ponytail.
- **Mode (caveman, ponytail):** if you installed them, caveman makes replies terse and ponytail keeps code changes to the smallest one that works. Both start at the `ultra` level. Say `stop caveman`, `stop ponytail` or `normal mode` to turn them off.
- **Subagent:** a helper Claude starts for one task. It works in its own context and returns a summary, so a large search does not fill yours.
- **Transcript:** a session saved as a file under `~/.claude/projects/`. Claude Code reads it back when you resume the session.

**Context** is the most important thing to manage. It is everything Claude holds for the current session: your messages, its replies, every file it read and every command output, plus rule files and loaded skills. Context has a limit. As it fills, Claude starts to forget earlier instructions and makes more mistakes. Near the limit, Claude Code compacts it: it summarizes the conversation to free space, and details you gave only in chat can be lost. To keep context useful:

- Run `/clear` between unrelated tasks.
- Run `/context` to see what uses the space.
- If you installed the status line, watch its `ctx` meter.

*Manage context* (`/claudzilla context`) has more. Claude Code's [glossary](https://code.claude.com/docs/en/glossary) defines more terms.

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

| # | option | tradeoff |
|---|---|---|
| A | change `<` to `<=` | one line |
| B | rewrite the check | more to test |

**Recommend: A**
- **Why:** only the comparison is wrong (`auth/mw.go:42`).

**Next:** say go → I change line 42.
```

- **TL;DR** (short for "too long; didn't read"): the first line gives the answer. A reply of three lines or fewer has no label and no headers.
- **Headers and tables:** headers split each part; a table holds items that share fields, such as a cause and where it is.
- **Evidence:** a claim carries a `file:line` reference (file and line number) or the command that showed it. A claim Claude did not check is marked *unverified*; treat it as a guess.
- **Decision:** options `A`, `B` in a table, then `**Recommend:**` with one pick and a **Why:** line with its source. With several decisions, they are numbered: `Decision 1`, `Decision 2`.
- **Picks:** with two or more choices, a `**Picks:**` line lists the recommended answers, such as `1B, 2A`.
- **File links:** a code span with the path of an existing file, such as `src/app.ts:42`, is a link. Click it to see the lines around it in the panel's File tab, but only in the fullscreen terminal; elsewhere a click does what the terminal does. Your terminal's own link click, such as ctrl+click, opens the file; Claude Code does not. Needs the response dividers and the panel. Without the panel, a click shows a toast saying so.
- **Next:** the last line, the single next action.
- **Dividers:** a heavy line frames a reply that has a TL;DR. A thin line follows the TL;DR and comes before the Picks or Next line. A dotted line marks a change of group: what Claude found, what to choose, what to do.

To answer, type one of these and press **Enter**, or write a question or correction in your own words:

- `go` accepts every recommendation in the reply.
- `1B` picks option B of Decision 1.
- `go, but 2B` accepts the rest and changes one pick.

If you installed the picks plugin, the picks card numbers the options so a digit answers. See *The picks card* (`/claudzilla picks`).

## Working

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

Some rules apply only to certain files:

- **Python:** these rules load once Claude reads a `.py`, `.pyi`, `.ipynb`, `pyproject.toml` or `requirements` file. An existing project keeps its own tools. New code uses `uv` for packages, `pyproject.toml` for dependencies, `ruff check --fix` and `ruff format` for lint and formatting, and `pytest` for tests.
- **Comments:** if the project has a comment style, Claude matches it. Otherwise it writes a comment only to explain a reason the code cannot show, and never history such as "was X, now Y": git holds that.

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

A *skill* is a file of instructions for one kind of task, such as debugging or writing a plan. Claude loads a skill when the task fits, or you run one by typing `/` and its name, such as `/superpowers:brainstorming`. A skill makes Claude follow a set method instead of improvising one. claudzilla installs the superpowers plugin, whose skills cover debugging, test-first coding, plans and reviews.

Claude uses these skills without asking when the task fits:

| when | skill |
|---|---|
| a bug, a failing test or unexpected behaviour | `systematic-debugging`: finds the root cause, proposes the fix, fixes on `go` |
| writing non-trivial code | `test-driven-development`: writes a failing test first |
| before it says "done" after edits | `verification-before-completion`: runs a check |
| you pass on code review feedback | `receiving-code-review` |
| you ask to push, open a pull request or merge, and the branch had no review yet | `requesting-code-review`: an agent reviews the branch first |

With caveman, a refactor or a migration runs `caveman:safe-refactor` or `caveman:migration`; with ponytail, asking what's next runs `ponytail:ponytail-debt`.

When your prompt contains words such as "bug", "error" or "crash", the guard reminds Claude to use the debugging skill.

For bigger steps, Claude suggests a skill and waits. The reply names it on the **Recommend:** line, or ends with `say go → I run <name>`. Type `go` to run it. For example: `brainstorming`, then `writing-plans`, for a new feature; `subagent-driven-development` to carry out a plan; `finishing-a-development-branch` when a branch is done.

Some skills hand tasks to *subagents*: helpers that each work in their own context and return a summary. They keep your context small, but their requests count toward the same usage limits.

claudzilla adds four skills of its own:

- **`pr`:** Claude runs it before it opens or edits a pull request: pre-PR checks, then the description template. The guard blocks a pull request without it.
- **`/rule-review`:** counts how often each claudzilla rule slipped, from your local transcripts. Only you run it; a weekly summary appears at startup. It shares the counts, never the text, as a GitHub issue only after you say yes.
- **`claudzilla-report` and `claudzilla-compact`:** run by `/claudzilla report` and `/claudzilla compact`. See *Report a problem* and *Manage context*.

If you installed caveman (terse replies), `/caveman` turns it on, `/caveman status` shows its mode, and `stop caveman` turns it off. If you installed ponytail (smallest change), `/ponytail lite`, `/ponytail full` or `/ponytail ultra` sets its level, and `stop ponytail` turns it off. `normal mode` turns both off.

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

claudzilla also tells you when to compact. Once context passes the `compactNudge` threshold, 150,000 tokens by default, a reply that finishes a task can end with one **Compact** line: how many tokens are re-sent every turn, what finished, and what to run. That is `/claudzilla compact`, or `/clear` when the finished work and the next are unrelated. Mid-task it stays quiet; past four times the threshold it can come on any reply that is not mid-task. The line reads `optional` at first, `suggest` at twice the threshold and `recommend` at four times. `/claudzilla compact` has Claude draft a `/compact` line that names what to keep and what to drop, and puts it in your prompt box: check it, then press Enter. If you installed the update toast, a toast says the same at each step and every 30 minutes while context stays past the threshold; after 30 minutes with no message, the reminder stays under the prompt until you send one. If you installed picks, a reply that ends with the line and no **Next:** offers its command as the dim suggestion. To change the threshold, or set it to `0` to turn it off, see *Customize claudzilla* (`/claudzilla customize`).

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

If you installed the panel, the `⟲ rewind` button on its History tab opens the same menu. See *The panel* (`/claudzilla panel`).

> **Rewind cannot undo:** files changed by shell commands, such as `rm`, `mv` or `cp`; most edits made by subagents; and changes made outside Claude Code.

**Use git as the safety net.** Checkpoints are for quick recovery in one session; git keeps history for good. When you work with Claude step by step, it leaves its changes uncommitted until you say `commit`, so say it when a step works.

**Discard work yourself.** The guard blocks Claude from commands that throw away uncommitted work, such as `git reset --hard`, `git clean -f`, `git checkout -- <file>`, `git restore <file>` and `git stash drop`. Claude asks you instead. If you agree, type the command at the prompt after `!`, for example `! git restore src/app.py`.

> **Not checked:** a `!` command runs directly, without going through Claude, so the guard does not check it.

Claude Code's [checkpointing](https://code.claude.com/docs/en/checkpointing) page covers rewind in full.

### Git and safety
<!-- topic: guard -->

The *guard* is a hook: it checks each git and GitHub command Claude runs, before it runs, and each reply when Claude finishes. Rewind cannot undo a git command, so the guard turns claudzilla's git rules into checks that hold even when Claude forgets a rule.

> **A guardrail, not security:** if the guard itself fails, the command goes through.

By default, the guard blocks these and tells Claude what to do instead:

| Claude tries to | instead, Claude |
|---|---|
| force-push | uses `--force-with-lease`, and only when you ask |
| discard work, such as `git reset --hard` | asks you; you run it yourself, see *Stop and undo* (`/claudzilla undo`) |
| commit on `main` or `master` | creates a branch first, named `<type>/<short-slug>` |
| push or open a PR before verification | runs `verification-before-completion`, then a check |
| open or edit a PR without the `pr` skill | runs the `pr` skill: checks and description template |
| commit with a subject that is not Conventional Commits | starts it with `feat:`, `fix:`, `refactor:`, `chore:`, `docs:` or `test:`, in 50 characters or fewer |
| put a Claude session link in a commit or PR | removes the link |
| commit a staged `.env` file | unstages it |
| add a worktree inside the repository | puts it at `../<repo>-<slug>` |

When Claude edited files and its reply says "done", "fixed" or "passing" with no command run after the last edit, the guard sends the reply back: Claude must run a check, such as the tests, and report the output.

Claude also never pushes, opens a PR or tags unless you ask. Before a push, it regroups its commits into one logical change each. If you installed the attribution plugin, it removes session links from the commit trailer and PR footer that Claude Code asks Claude to write.

> **Prompt injection:** text in a file, web page or command output that tries to give Claude instructions. The guard does not stop it. Your defense is the permission prompt, so read each command before you approve it. Trust only folders you know: once trusted, a folder's settings can allow commands.

Each blocked action in the table can be set to `deny`, `remind` or `off`, and the done check to `now`, `flag` or `off`. For a solo repository that commits straight to `main`, put `{"rulesGuard":{"allowMain":true}}` in `.claude/claudzilla.local.json`. See *Customize claudzilla* (`/claudzilla customize`). If the guard blocked something you need, see *Fix common problems* (`/claudzilla stuck`).

## Screen

### The status line
<!-- topic: hud -->

If you installed the status line (the `hud` part), it fills the bottom of the screen, under the prompt. It shows where Claude works, how full context and your usage limits are, and what Claude is running, so you can check them without typing a command. If you did not install it, run `~/claudzilla/install.sh --add hud` in a terminal.

From top to bottom:

- **Top row:** the folder, the git branch, and uncommitted changes: `!3` files changed, `?2` new files git does not track, and `+40 -12` lines added and removed that are not yet staged. On the right: the email of the account you are logged in with, and the claudzilla version.
- **Two thin lines** frame the meters: the top one shows the time, the bottom one the date.
- **`ctx` meter:** how full context is, as a percentage, and the token count, such as `150k`.
- **`5h` and `wk` meters:** how much of your 5-hour and weekly usage limits you used, and the time until each resets, such as `2h13m` or `3d4h`. Claude Code sends these only to a Claude subscription login, such as Pro, Max or Team, after the first reply of a session; on other accounts the two rows do not show.
- **Bottom row:** the model and the effort level, such as `high`; the last skill Claude loaded; and `◇ thinking` when Claude was thinking in the last 30 seconds. On the right: the session name, the first 8 characters of the session id, and the time since the session started, such as `up 42m`.

Each meter bar runs from blue to orange: the cells past about two thirds of the bar are orange. The status line redraws every second. The folder name shifts color slowly, and every 90 seconds a highlight sweeps across the meters for 30 seconds. The motion is decoration only.

> **Your email is visible:** it shows whenever the status line does. Anyone who sees your screen, a screen share or a screenshot sees it too.

On a narrow terminal, the top row drops the version first, then shortens the email to the part before `@`, then drops it, then the changes and the branch, and finally cuts the folder from the left. The bottom row drops thinking, then the skill, the session id, the session name, and the model last.

The installer offers the MesloLGS NF font, which draws the symbols. If you said no, the status line uses basic symbols every font has: `■ □` instead of `▰ ▱` in the meters, `›` instead of `⎇` for the branch, and `▸` instead of `⚑` for the skill. To switch later, run `CLAUDZILLA_FONT=yes ~/claudzilla/install.sh`, then set MesloLGS NF as your terminal font. If you see boxes instead of symbols, see *Fix common problems* (`/claudzilla stuck`).

What to do with it:

- When `ctx` runs high, compact or clear. See *Manage context* (`/claudzilla context`).
- When `5h` or `wk` nears 100%, check its reset time and plan around it. See *Usage and cost* (`/claudzilla limits`).
- Check the branch before you ask Claude to commit.
- Before you share your screen, remember the email.

Claude Code's [status line](https://code.claude.com/docs/en/statusline) page explains how a status line works.

### The panel
<!-- topic: panel -->

If you installed the panel, it is a pane with two tab bars. The top bar is about this chat: Overview, Decisions and History. The bottom bar is about the repo: File, Tree and Git. Decisions and Tree are dimmed and say "coming in v1.8". It shows how Claude read your request and what it is doing, and it lets you move around a long chat without scrolling. If you did not install it, run `~/claudzilla/install.sh --add panel` in a terminal.

To open or close the panel, press **alt+h** or type `/panel`. A new session opens it if you left it open, and the first session opens it too; on a terminal under 144 columns it waits for room (110 once you have opened it yourself); **alt+h** shows it at any width. In the fullscreen layout, on a terminal 110 columns or wider, it docks beside the chat; otherwise it opens over the prompt. It opens on the Overview tab; click a tab name to switch. On macOS, alt is the Option key, and your terminal must send it as Meta; see [Option key shortcuts on macOS](https://code.claude.com/docs/en/terminal-config#enable-option-key-shortcuts-on-macos).

**Overview** shows, at the top, whether Claude is `● working`, `✓ done` or `■ stopped`, or, when its turn ended with background agents still running, `◌ waiting on N agents`, then:

- **TOPICS:** what this chat is about. After each prompt, while the tab shows, Opus groups your prompts, and only your prompts, into topics.
- **ASK:** how Claude read your request.
- **PLAN:** its approach.
- **STEPS:** its steps: `✓` done, `●` in progress, `○` pending.
  - Agents Claude starts hang under their step: `○` planned, `◌` working, `✓` done, `✗` failed, `■` stopped. Past 3, the rest fold into `… N more`; click it to see them all, `… less` to fold them. Click an agent to open its transcript (its row lights blue); click it again, click its step, or press **Esc** to go back.

From the moment you submit until Claude reports, the header shows `planning…` over last turn's dimmed report. The current step is lit blue. When STEPS runs past the pane's last row, a dim `… N more` counts the rows left out; the `⇕` rule under TOPICS gives them more rows. Claude fills ASK, PLAN and STEPS by calling a hidden `intent` tool at the start of each turn. TOPICS, ASK, PLAN and STEPS are written in the language you write in; the labels stay in English. Check ASK first: if Claude misread you, press **Esc** and correct it. Each report and each topics read uses a little of your usage limits; see *Usage and cost* (`/claudzilla limits`). To turn the reports off, set the panel's `intent` option to off in `/config`; it applies from the next session.

**History** lists this chat's prompts, newest first:

- Click a prompt to scroll the chat to it.
- `↻` puts the prompt back in the prompt box, to edit or send again.
- `⟲ rewind` opens the `/rewind` menu. See *Stop and undo* (`/claudzilla undo`).
- `⤓ latest` scrolls the chat to its newest row.
- `⟲ rewind` and `⤓ latest` show once there is a prompt; with History empty they are hidden.
- A dim prompt was rewound or compacted, or is not drawn in the chat yet. A compacted prompt still jumps while the chat shows it; the others do not. `↻` works on all of them.

**File** shows the lines around a file mentioned in Claude's reply, with the line marked `▶`. Click the file link in the reply to open it here; the panel opens if it was closed. See *Read a reply* (`/claudzilla replies`).

**Git** shows the session folder's branch, with `↑` for commits ahead of its remote and `↓` for commits behind, the changed files under CHANGES, and recent commits under COMMITS. It redraws after each tool call and each prompt. Scrolled, a `↑` line goes back to the top of CHANGES or COMMITS. When the `origin` remote is on GitHub, GitLab, Codeberg or SourceHut, a pushed commit's id, or the branch once pushed to origin, links to its web page: its row lights up while the pointer is on it. Alt+click opens it; Ctrl+click opens it twice until a Claude Code bug is fixed ([anthropics/claude-code#76110](https://github.com/anthropics/claude-code/issues/76110)).

The mouse wheel scrolls each list. The `⇕` rule between CHANGES and COMMITS, and the one under TOPICS, sets how the rows are shared: drag it, and each side keeps at least one row; click it to move it to the top, and click it there to move it to the bottom. The [panel README](https://github.com/HT0710/claudzilla/blob/main/plugins/panel/README.md) has the full detail.

### The picks card
<!-- topic: picks -->

If you installed the picks card, it appears over the prompt box when a reply asks you to choose. It turns the reply's decision into numbered answers, so one key answers instead of a typed reply. If you did not install it, run `~/claudzilla/install.sh --add picks` in a terminal.

The picks card appears after a reply with one `Decision` table of two or more options; see *Read a reply* (`/claudzilla replies`). The table's heading becomes the question and each option a numbered row. The recommended row is blue; when the reply gives a `Why:`, it shows under the rows. The last row is always `go ahead, except…`.

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
- The recommended answer waits dim in the empty prompt. Press **→** or **Tab**, then **Enter**, to send it.
- Pick `go ahead, except…` to get `go, but ` in the prompt box, then type your changes, such as `go, but 2B`.
- Press **alt+k** to move into the picks card, on the recommended row. **Arrow keys** move between rows, **Enter** puts the answer in the prompt box, and **Esc** goes back without one. Without the claudzilla key, `ctrl+x tab` does the same. On macOS, alt is the Option key, and your terminal must send it as Meta; see [Option key shortcuts on macOS](https://code.claude.com/docs/en/terminal-config#enable-option-key-shortcuts-on-macos).
- Or ignore the picks card and type your own answer.

The picks card hides while Claude works and goes once you send any prompt. When a reply has nothing to choose, such as a `**Picks:**` line, a Next line that says `say go`, or a **Compact** line with no Next, no picks card appears: only the dim answer, such as `1B, 2A` or `go`, waits in the prompt box.

An answer you send speaks in your voice, so the history reads as you wrote it: Claude's `show you the diff` comes back as `show me the diff`, and `your branch` as `my branch`. Code and double-quoted text stay as written.

The [picks README](https://github.com/HT0710/claudzilla/blob/main/plugins/picks/README.md) has the full detail.

## Own it

### Usage and cost
<!-- topic: limits -->

Every request to Claude uses *tokens*: the text it reads, writes and thinks. On a Claude subscription, usage counts against two limits at once: a rolling 5-hour session limit and a weekly limit. Both are shared across all models. When one runs out, Claude Code stops sending requests until the reset time in the message, such as `You've hit your session limit · resets 3:45pm`.

#### See your usage

- Run `/usage` to see your plan limits and when they reset.
- If you installed the status line, its `5h` and `wk` meters show the same, with the time to each reset. See *The status line* (`/claudzilla hud`).
- If you installed the `toast` part, a toast shows when the 5-hour or weekly limit passes 50%, 75% and 90%, such as `5-hour usage 77% · resets in 2h10m`. Each point shows once per limit window, even across sessions.

#### What uses more

- **Model:** claudzilla starts sessions on Opus (`opus[1m]`). Sonnet handles most coding tasks well and costs less. Run `/model` to switch.
- **Effort:** higher effort means deeper reasoning and more tokens; lower effort is faster and cheaper. Run `/effort` to change it.
- **Context:** each turn sends the whole context again, so a long session costs more per turn. See *Manage context* (`/claudzilla context`).

#### What claudzilla adds

Each of these costs tokens; here is how to turn it off.

- **Intent reports:** if you installed the panel, Claude calls a hidden `intent` tool at the start of each turn. To stop it, set the panel's `intent` option to off in `/config`; it applies from the next session.
- **Topics:** while the panel's Overview tab shows, an Opus request at low effort sorts your prompts into topics after each prompt. Switch to another tab or close the panel to stop it.
- **Done check:** when Claude says "done" with no check after its last edit, the guard sends the reply back, and Claude takes another turn to run a check. To get a note on the next prompt instead, put `{"rulesGuard":{"rules":{"doneClaim":"flag"}}}` in `~/.claude/claudzilla.json`, or use `"off"`. See *Customize claudzilla* (`/claudzilla customize`).

Two parts save tokens: caveman shortens replies, and rtk shortens command output. Claude Code's [costs](https://code.claude.com/docs/en/costs) page has more ways to reduce usage.

### What runs on its own
<!-- topic: background -->

claudzilla does some things without being asked. This list names each one, so none of them surprises you. Settings named here are explained in *Customize claudzilla* (`/claudzilla customize`).

- **Auto-update:** when a session starts or you run `/clear`, a background job checks for a new claudzilla release, at most once a day. If there is one, it updates the clone at `~/claudzilla` and runs the installer again; restart Claude to apply it. If the clone has uncommitted edits or local commits, it skips the update and shows a notice instead. To get only the notice, put `{"rulesGuard":{"autoUpdate":false}}` in `~/.claude/claudzilla.json`.
- **Transcript reads by the guard:** the guard reads the end of the current session's transcript, the saved file of the session, to measure context and to see whether a check ran. It keeps its notes in a temporary file for each session.
- **Rule counts:** at startup, if the last `/rule-review` report is missing or a week old, a background job scans your transcripts in `~/.claude/projects/` and saves counts in `~/.claude/claudzilla-reports/`. When rules slipped, the next session shows a one-line summary once. The counts leave your machine only if you say yes in `/rule-review`. To stop the scan and the summary, put `{"rulesGuard":{"reviewNudge":false}}` in `~/.claude/claudzilla.json`.
- **Command rewriting:** if you installed rtk, a hook passes each shell command Claude runs through rtk, which shortens the output Claude reads. Run `rtk gain` in a terminal to see the tokens it saved.
- **Lines added to each prompt:** the guard tells Claude your terminal width, so its tables fit. If you use the panel, it also reminds Claude to send its intent report. Past the `compactNudge` threshold it adds the compact reminder, and a prompt with words such as "bug" or "code review" gets a reminder to use the matching skill; `compactNudge` `0` and the rules `debugTrigger` and `reviewTrigger` set to `off` drop them. To drop the width line, put `{"rulesGuard":{"rules":{"tableWidth":"off"}}}` in `~/.claude/claudzilla.json`.
- **Plans kept out of git:** when Claude writes a spec or plan under `docs/superpowers/` in a repository that tracks no files there, the guard adds `docs/superpowers/` to the repository's `.git/info/exclude` file. Git then ignores those files, so they stay out of your commits. To stop it, put `{"rulesGuard":{"rules":{"specExclude":"off"}}}` in `~/.claude/claudzilla.json`.
- **Settings reset on update:** each update runs the installer again, which puts claudzilla's values back in `~/.claude/settings.json`, such as the model or effort level that a `/model` or `/effort` pick saved. Put lasting choices in `~/.claude/settings.overrides.json`.
- **Local trace:** the guard and other claudzilla parts write what they did to `~/.claude/claudzilla-trace/` on your machine. Nothing is uploaded. To turn it off, put `{"rulesGuard":{"trace":false}}` in `~/.claude/claudzilla.json`. See *Report a problem* (`/claudzilla bugs`).
- **Your email:** if you installed the status line, it shows the email of the account you are logged in with. Anyone who sees your screen sees it.
- **Agent teams:** claudzilla sets `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` to `1`. This experimental Claude Code feature lets Claude start *teammates*: separate Claude sessions that work in parallel and message each other. A team uses far more tokens than one session. While it is on, a subagent that Claude names can start as a teammate instead. To turn it off, put `{"env":{"CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS":"0"}}` in `~/.claude/settings.overrides.json`, then run `~/claudzilla/install.sh`. See Claude Code's [agent teams](https://code.claude.com/docs/en/agent-teams) page.

### Fix common problems
<!-- topic: stuck -->

Find the problem you see, then follow its steps.

#### The guard blocked a command

The block message tells Claude what to do instead, such as create a branch before it commits, and Claude usually does that next. *Git and safety* (`/claudzilla guard`) lists each block. If you need the blocked command, run it yourself: type `!` and the command at the prompt, such as `! git restore src/app.py`. To change a rule for good, see *Customize claudzilla* (`/claudzilla customize`).

#### "Done" got sent back

Claude said "done", "fixed" or "passing" with no check after its last edit, so the guard sent the reply back. Wait: Claude runs a check, such as the tests, and reports the output. If the reply made no such claim, Claude answers `no claim`, and you can ignore it.

#### An update failed

The notice reads `claudzilla: auto-update to <version> failed - ask Claude to debug it`, with the path of the log. Ask Claude to debug the claudzilla update: it gets the log path and the command to try again. A notice that says `auto-update skipped: local changes` means the clone at `~/claudzilla` has edits; see *Customize claudzilla* (`/claudzilla customize`).

#### Boxes instead of symbols

The status line draws its symbols with the MesloLGS NF font. Set MesloLGS NF as your terminal font. If it is not installed, run `CLAUDZILLA_FONT=yes ~/claudzilla/install.sh` first. To use basic symbols instead, run `CLAUDZILLA_FONT=no ~/claudzilla/install.sh`.

#### A plugin misbehaves

Run `/plugin`, press **Tab** to reach the Installed tab, select the plugin and press **Space** to turn it off. The installer turns the plugins it installed back on when it runs again, such as on an auto-update. To keep one off, remove its part in a terminal, such as `~/claudzilla/install.sh --remove picks`.

#### Claude keeps missing

After two failed corrections, run `/clear` and write a better first prompt with what you learned. If you installed the panel, check its ASK line to see how Claude read your request. See *Talk to Claude* (`/claudzilla talk`).

For problems with Claude Code itself, run `/doctor`, or see Claude Code's [troubleshooting](https://code.claude.com/docs/en/troubleshooting) page.

### Report a problem
<!-- topic: bugs -->

claudzilla keeps a trace of each session so a problem can be reported with facts, not memory. It stays on your machine: nothing is uploaded, except that a report sends a short search phrase to GitHub to look for an existing issue. Nothing else leaves your machine unless you say yes to filing or commenting.

#### What is recorded

- **Where:** `~/.claude/claudzilla-trace/` (or `$CLAUDE_CONFIG_DIR/claudzilla-trace/`). The folder is readable only by you.
- **What:** which claudzilla hooks and plugins (panel, picks, guide and the rest) ran and what they decided, plus a snapshot of your setup. The snapshot lists enabled claudzilla plugins and the names of settings, never their values. Secrets, such as API keys and tokens, are masked before anything is written.
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
| `/claudzilla report [what happened]` | draft a problem report from the local trace |
| `/claudzilla compact` | draft a `/compact` line into the prompt box |
| `/rule-review` | count how often each claudzilla rule slipped |
| `/panel` | open or close the panel (if installed) |
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

### Shortcuts
<!-- topic: keys -->

Press a key at the prompt. Items marked "if installed" work only with that part.

| press | does |
|---|---|
| Esc | stop Claude, or decline a prompt |
| Esc Esc | open the rewind menu (empty prompt) |
| Shift+Tab | change the permission mode |
| → or Tab | put the dim suggestion in the prompt |
| alt+g | open or close this guide |
| alt+h | open or close the panel (if installed) |
| alt+k | move into the picks card (if installed) |

On macOS, alt is the Option key, and your terminal must send it as Meta; see [Option key shortcuts on macOS](https://code.claude.com/docs/en/terminal-config#enable-option-key-shortcuts-on-macos). To change keys, see *Customize claudzilla* (`/claudzilla customize`). Claude Code's [interactive mode](https://code.claude.com/docs/en/interactive-mode) page lists all its keys.

### Customize claudzilla
<!-- topic: customize -->

You change claudzilla through a few files of your own.

#### Two rules first

- **Which file wins.** For settings, `~/.claude/settings.overrides.json` wins over claudzilla's settings and over `~/.claude/settings.json`. The installer merges it, so run `~/claudzilla/install.sh` after you edit it. For the guard, a later file wins: `~/.claude/claudzilla.json` (this machine), then `<repo>/.claude/claudzilla.json` (shared, commit it), then `<repo>/.claude/claudzilla.local.json` (yours only). The guard reads them on each prompt. It skips a bad value and tells Claude about it on your next prompt.
- **Never edit the linked files.** `~/.claude/CLAUDE.md`, `~/.claude/rules/`, the hooks and claudzilla's skills are links into the clone at `~/claudzilla`. An edit there is an uncommitted change in the clone, so auto-update stops and you get only a notice.

#### What to change

In this list, `env`, `permissions` and `model` go in `~/.claude/settings.overrides.json`; the guard settings go under `rulesGuard` in a guard file. I want to:

- **Change the reply style:** set `CAVEMAN_DEFAULT_MODE` to `caveman` for less terse replies, or `off` (if you installed caveman).
- **Set how strictly Claude keeps changes small:** set `PONYTAIL_DEFAULT_MODE` to `full` to stop Claude pushing back on parts of a request, `lite` to build what you asked, or `off` (if you installed ponytail).
- **Get fewer permission prompts:** set `permissions.defaultMode` to `acceptEdits` or `auto`. See *Approve actions* (`/claudzilla approve`).
- **Use another model or effort:** run `/model` or `/effort` in a session. A default that `/model` or `/effort` saves lasts only until the next update; for every session, set `model` or `effortLevel` in `settings.overrides.json`, such as `"model": "sonnet"`.
- **Loosen a guard rule:** set it under `rules`. Values: blocks take `deny`, `remind` or `off`; `doneClaim` takes `now`, `flag` or `off`; skill reminders take `remind` or `off`; reply format checks take `flag` or `off`; `specExclude` takes `on` or `off`. The rule names are in [CONFIGURATION.md](https://github.com/HT0710/claudzilla/blob/main/CONFIGURATION.md#guard-hook-config).
- **Commit to `main` in a solo repository:** put `{"rulesGuard":{"allowMain":true}}` in `<repo>/.claude/claudzilla.local.json`.
- **Stop auto-update:** put `{"rulesGuard":{"autoUpdate":false}}` in `~/.claude/claudzilla.json`; you still get the notice.
- **Change other guard settings:** `compactNudge` (the context size, in tokens, at which Claude suggests compacting; `0` turns it off), `reviewNudge`, `autoUpdate` and `trace` (`false` stops the local trace; machine file only) sit next to `rules`, not inside it.
- **Add your own instructions:** write them in `~/.claude/CLAUDE.local.md`. claudzilla's rules load it in every session on this machine.
- **Change keys:** run `/keybindings` to open `~/.claude/keybindings.json`. To free **alt+g**, **alt+h** or **alt+k**, set it to `null` in the `Chat` block. Changes apply without a restart.

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

### Update and get help
<!-- topic: more -->

#### How updates arrive

Each feature, fix or refactor pushed to claudzilla's `main` branch ships as a release once its tests pass. At most once a day, a new session or `/clear` installs the newest release in the background. A notice appears when a session starts; if you installed the update toast, a toast also tells you when an update is available, installing, installed, or failed. Restart Claude to apply an update; `/claudzilla news` lists what changed. If the clone has local changes, the update waits and the notice gives the command to run. Auto-update is described in *What runs on its own* (`/claudzilla background`).

#### Update by hand

Run this in a terminal. It takes the latest `main`, which can be ahead of the newest release:

```bash
cd ~/claudzilla && git pull && ./install.sh
```

#### Add or remove parts

Run `~/claudzilla/install.sh --add panel` to add a part, or `--remove panel` to take it out. The [README](https://github.com/HT0710/claudzilla/blob/main/README.md#install) lists the other flags, such as `--full`, `--custom` and `--yes`. The parts are `hud` (the status line), `rtk`, `caveman`, `ponytail`, `dividers`, `panel`, `picks`, `toast` and `attribution`.

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
- Read each plugin's README: [panel](https://github.com/HT0710/claudzilla/blob/main/plugins/panel/README.md), [picks](https://github.com/HT0710/claudzilla/blob/main/plugins/picks/README.md), [response dividers](https://github.com/HT0710/claudzilla/blob/main/plugins/response-dividers/README.md), [attribution](https://github.com/HT0710/claudzilla/blob/main/plugins/attribution/README.md), [guide](https://github.com/HT0710/claudzilla/blob/main/plugins/guide/README.md), [update toast](https://github.com/HT0710/claudzilla/blob/main/plugins/update-toast/README.md).
- Learn Claude Code itself in [Claude Code's docs](https://code.claude.com/docs/en/overview).
- claudzilla is built on [caveman](https://github.com/JuliusBrussee/caveman), [ponytail](https://github.com/DietrichGebert/ponytail), [superpowers](https://github.com/obra/superpowers) and [rtk](https://github.com/rtk-ai/rtk).

### What's new
<!-- topic: news -->

Headline features of recent versions. Restart Claude after an update to use them.

#### v1.5.0

- The panel opens at the start of each session as you left it, open the first time. Its tabs sit in two bars: Overview, Decisions and History at the top; File, Tree and Git at the bottom.
- Overview writes TOPICS, ASK, PLAN and STEPS in the language you write in.
- Agents Claude starts show as rows under the step that started them, and Overview shows `◌ waiting on N agents` while they run. Click one to open its transcript; click it again or press Esc to go back.
- A file path in Claude's reply is a link: click it to see those lines in the panel's new File tab, ctrl+click to open the file.
- In the Git tab, a pushed commit or branch links to its GitHub, GitLab, Codeberg or SourceHut page: alt+click opens it.
- A picks card answer goes into the prompt box in your voice: "show you the diff" becomes "show me the diff".
- When context grows large, a **Compact** line and a toast say so; `/claudzilla compact` drafts a `/compact` line into your prompt box.
- A toast shows when your 5-hour or weekly limit passes 50%, 75% and 90%.

#### v1.4.0

- `/claudzilla` opens this guide in a pane, and alt+g toggles it.
- `/claudzilla report` drafts a problem report from a local trace of what each part did.
- `install.sh` picks parts with `--full`, `--custom`, `--add` and `--remove`, and removes claudzilla with `--uninstall`.
- The status line shows the claudzilla version.
