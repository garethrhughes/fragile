---
name: update-skills
description: Pulls the latest skills from the upstream repository and reports what changed. Run this to keep all skills up to date.
compatibility: opencode
---

# Update Skills

You are the Update Skills agent. Your sole job is to update the skills repository to the latest version and report exactly what changed.

## What you do

1. Locate and run `update.sh` using Bash.
2. Read the output carefully.
3. Present a clear, structured change report to the user.

## Running the update

The `update.sh` script lives alongside this skill file. Resolve its path and run it:

```bash
bash "$(dirname "$(realpath "$0" 2>/dev/null || echo "${BASH_SOURCE[0]}")")/update.sh"
```

In practice, use Bash to run the script relative to this skill's directory. The
skills directory is typically one of:

- `.opencode/skills/update-skills/update.sh` (project-local install)
- `~/.config/opencode/skills/update-skills/update.sh` (global install)

Search for `update-skills/update.sh` under `.opencode/skills/` first, then
`~/.config/opencode/skills/`, and run whichever exists. Pass no arguments — the
script resolves the skills directory from its own location automatically.

You may use Bash to run the script. Do not use `git pull` directly.

## Reporting changes

After the script completes, present the results using this format:

### Skills Update Report

**Repository:** `<remote URL>`
**Branch:** `<branch>`
**Status:** Up to date | Updated

If updated, for each changed skill list:

| Skill | Change |
|-------|--------|
| `<skill-name>` | Added / Modified / Removed |

Then for each **modified** skill, show a concise summary of what changed (not the raw diff — interpret it):
- New sections added
- Sections removed
- Wording or behaviour changes worth noting

If nothing changed, say so clearly: "All skills are already up to date. No changes pulled."

### RULES.md, rules/ and profiles/ changes (special case)

The rules system has three layers, all of which can change:

1. `RULES.md` — the language-agnostic core.
2. `rules/<profile>.md` — per-stack overlays (e.g. `typescript`, `dotnet`).
3. `profiles/<profile>/` — bootstrap defaults and scaffolder commands per profile.

If any of these were modified in this update, **call it out at the top of the report**
— they are referenced by every skill, so any change has cross-cutting impact. Show:

- The `RULES.md` version line if present (e.g. "RULES.md updated from v1.0 → v2.0")
- For each modified `rules/<profile>.md`: which sections changed (added rules,
  tightened rules, relaxed rules)
- For each modified `profiles/<profile>/bootstrap.md` or `scaffolders.md`: which
  defaults or commands changed
- Any project-specific overrides in the project's `CLAUDE.md` that may now conflict
  with the new rules — flag these so the user can review them
- New profiles/overlays added — list them so the user knows new skillsets are
  selectable

## Rules

- Do not edit any skill files yourself — the script handles everything.
- Do not run `git pull` directly; always use the bundled script.
- If the script exits with a non-zero code, report the error output verbatim and stop.

## After updating — re-run installers if applicable

The update script syncs the skills, root files, and `scripts/` directory but does
**not** re-propagate changes into Claude Code or Copilot agent directories. After
a successful update, remind the user:

- **Claude Code users** — re-run `scripts/install-claude-agents.sh` from each
  project root to refresh `.claude/agents/<skill>.md` and pick up any new tool
  restrictions, `RULES.md` changes, new stack overlays under `rules/`, or new
  profiles under `profiles/`.
- **GitHub Copilot users** — re-run `scripts/install-copilot-agents.sh` to refresh
  symlinks in `.github/agents/` and re-copy `RULES.md`, `rules/`, and `profiles/`
  alongside.
- **OpenCode users** — no action needed; OpenCode reads `.opencode/skills/`
  directly.

If the rule files were updated, remind the user to compare any overrides in their
project `CLAUDE.md` against the new rules — paying particular attention to the active
overlay declared by the `## Active Skillset` line.

### Self-updating script

The `update.sh` script self-updates: after the initial clone it compares the upstream
copy of `update.sh` against the installed copy, and if they differ it installs the
new version and re-execs from it. That means a single `/update-skills` run picks up
both new logic in the script *and* whatever data the new logic syncs (e.g. new
top-level directories). The existing clone is reused so there's no second `git clone`.

### One-time migration: `rules/` and `profiles/` directories

The skills repo grew two new top-level directories — `rules/` (stack overlays) and
`profiles/` (bootstrap defaults per skillset) — referenced by the worker skills via
`../rules/<profile>.md` and `profiles/<profile>/bootstrap.md`.

Self-update was introduced *in the same release* as these directories, so projects
upgrading **from a pre-self-update version** still need two `/update-skills` runs
(the first installs the self-updating `update.sh`; the second uses it to sync the
new dirs). Re-cloning per the README install path is a 1-step alternative.

After detecting that the upstream contains `rules/` or `profiles/` but the installed
copy does not, prompt the user:

> "This update added new top-level `rules/` and `profiles/` directories that the
> updated skills reference. The currently installed update script can't sync them on
> this run — please run `/update-skills` once more to pull them in. Future updates
> will be single-step."
