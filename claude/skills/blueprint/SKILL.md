---
name: blueprint
description: Use for a feature ask, a behaviour change or other new work that needs designing before it is built, in code or outside it. Finds out what the user wants, writes a short spec, then hands it to writing-plans. Replaces superpowers:brainstorming.
---

# Blueprint

Design before building: find out what the user wants, write a spec, then plan. Ask few questions, keep replies short, give every pick a reason, and show visuals before asking about them.

## Every reply

- Never use `AskUserQuestion`. Ask in plain text, with lettered options.
- Keep replies short. Use tables where the reader compares, and never play back what the user said.
- Define a term in a few words the first time you use it.
- Give every pick a reason with its source: a `file:line`, a command and its result, or the user's words.

## Flow

```text
recon, reply 1 (TL;DR, found table, one why-question or Decisions), picks,
spec, builder check, re-read, approval, writing-plans
```

1. **Opt-out.** When the request already settles the design, or the user says to skip the questions, ask none and go to the spec. Repo rules about waiting for a go-ahead still apply.
2. **Recon, before the first reply.** Read only what exists, and read each file once. Keep notes instead of re-reading.
   - Agent and contributor docs: `CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING*`, the README's development section, `.github/` templates.
   - Design-doc homes such as `docs/adr/`, `rfcs/`, `design/` or `specs/`, and where past design docs were added (`git log --diff-filter=A -- '*.md'`). Reuse their template.
   - Planning docs such as `ROADMAP*` or `TODO*`, and the issue tracker when its CLI is signed in. Look for a related open item.
   - The code and docs that hold the request's nouns, and the stack's manifest and test setup.

   Say in one line what you found and what you did not. Never create a planning file unasked.
3. **Not code.** With no repo, or for a project that is not software, skip code recon. Ask where the user keeps notes, and size by effort instead of files. See `reference.md`.
4. **Name risks.** When part of the request costs more than its need justifies, add a found-table row that says so and names a cheaper path. Keep the tone plain.
5. **Reply 1, why unknown.** Give a TL;DR, the found table, then one open question in the user's words about why they want it. Say what the answer changes. Attach no options.
6. **Reply 1, why known.** Give a TL;DR, the found table, then the design Decisions. Each Decision has lettered options, a pick, a reason with its source, and what the pick gives up. Several Decisions end with one picks line, such as `Picks: 1B, 2A`. Defaults that do not change the design go on one line the user can correct, and the size goes on that line too.
7. **Later replies.** Answer every question in the user's message first. Then ask at most one open question, or give the next Decisions. When nothing design-changing is left, write the spec.
8. **Show it.** Anything the user will look at gets each option rendered before you ask about it. Use a text sketch in the reply, or a mockup file in the job folder opened with the system's default opener (`open`, `xdg-open`, `wslview` or `start`). Look at the render yourself first, by screenshot or by running it in the real medium. If it can't be opened, print the path.
9. **Size.** Always size the work. Small means one sitting, one part and a clear done. A project has several parts or sittings, or an unclear done. Split a request that is really several projects, and sequence the parts first. The user can override the size.
10. **Spec.** Small work gets a short spec, a line or two per section. A project gets the full spec. Save it as `docs/chancery/<YYYY-MM-DD>-<topic>/spec.md`, dated the day it is written, unless the user names a path. A repo's design-doc home supplies the template only. Say where it went. If a planning doc or issue lists the item, link the spec there. Before showing the spec, check it against the writing rules.
11. **Builder check, every spec.** Give a one-line cost notice first. Then send a fresh agent the prompt in `builder-check-prompt.md`, with the domain and the spec path filled in. Settle what the conversation already answered, decide minor points and mark them in the spec. Then re-read the whole spec once, because the settling edits can leave stale lines or two lines that disagree. Fix what you find and list it. Bring only the user's points, from the check and the re-read, back as Decisions in one reply.
12. **Gate.** Build nothing until the user approves the spec. The one exception is a spike the user agrees to, which stays throwaway (see `reference.md`). After approval, invoke `superpowers:writing-plans` and no other skill, and tell it to save the plan as `plan.md` in the job folder. Once the plan is approved and the context is large, suggest a fresh session for building.

## Spec layout

The spec follows the reply layout: TL;DR first, a header per section, and tables where the reader compares.

| section | content |
|---|---|
| TL;DR | what gets built and why, under 30 words |
| Why | the trigger or problem, with sources |
| Goals, non-goals, anti-goals | bullets |
| Constraints | hard limits with sources (`file:line` in code) |
| Approaches | the options table and the pick, with who picked it |
| Design | the decided how, as the user decided it |
| Left to the builder | what the plan may settle |
| Verify | the check that shows it done: a command in code, or a checklist outside code |
