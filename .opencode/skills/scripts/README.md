# scripts/

Operational scripts for installing the skills repo into different AI assistants.
All scripts are run from your **project root** (not from this directory) and
default to reading skills from `~/.config/opencode/skills` unless a path is
passed as the first argument.

## Scripts

### `install-claude-agents.sh`

Generates `.claude/agents/<skill>.md` files for Claude Code subagents.

- Strips OpenCode-specific frontmatter (`compatibility`, `permission`).
- Applies per-skill tool restrictions (e.g. `infosec` is read-only).
- Copies `RULES.md` alongside the agents so relative `RULES.md` links resolve.
- Writes `.rules-version` sidecar so drift can be detected later.
- Safe to re-run after `update-skills` pulls upstream changes.

```bash
~/.config/opencode/skills/scripts/install-claude-agents.sh
```

### `install-copilot-agents.sh`

Symlinks each `SKILL.md` into `.github/agents/<skill>.md` for GitHub Copilot.

- Skips files that already exist (manual replacement required).
- Copies `RULES.md` alongside (not symlinked, so it survives skill removal).
- Writes `.rules-version` sidecar.

```bash
~/.config/opencode/skills/scripts/install-copilot-agents.sh
```

## When to re-run

Re-run the installer for your assistant after every `update-skills` run so that
skill changes (especially RULES.md updates and per-skill tool restriction
changes) propagate into the agent directories.

OpenCode users do **not** need to run any installer — OpenCode reads
`.opencode/skills/` directly.

## Custom skills directory

All scripts accept the skills directory as the first argument:

```bash
./install-claude-agents.sh /path/to/your/skills/checkout
```
