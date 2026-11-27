# Chancery (blueprint)

Designs a feature with the `blueprint` skill instead of `superpowers:brainstorming`, and keeps each job's papers in `docs/chancery/`.

`blueprint` is a claudzilla skill, called by that bare name in the Skill tool. It replaces `brainstorming` in `superpowers.md`:

- New feature, behaviour change, multi-file (not refactor / migration) → suggest `blueprint` → `writing-plans`.
- `brainstorming` would trigger, another skill names it, or plan mode wants a brainstorm first: use `blueprint`. A hook denies Claude's Skill call to `superpowers:brainstorming`; the user typing it still runs it.
- `blueprint` asks questions → ask only what changes the design or the request; the rest take a sane default, listed as one `Assumed:` line. Open question with no options yet → plain text; otherwise one `Decision — <topic>` table per reply. Never `AskUserQuestion`.

Spec/plan files: new jobs land in `docs/chancery/<YYYY-MM-DD>-<topic>/` (`spec.md`, `plan.md`); older specs + plans stay in `docs/superpowers/`. The `superpowers.md` spec/plan rules apply to `docs/chancery` too, per folder: `git ls-files docs/chancery` empty → the guard adds `docs/chancery/` to the exclude file on the first Write; don't append it yourself.
