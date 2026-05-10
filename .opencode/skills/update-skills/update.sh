#!/usr/bin/env bash
# update.sh - fetch the latest skills from upstream and merge into installed location
#
# The skills directory does NOT need to be a git repository. Clones upstream
# to a temp dir, diffs each SKILL.md against the installed version, copies
# in changes while preserving existing ## Project Context sections.
#
# Compatible with bash 3 (macOS default).

# Self-reinvocation guard: copy this script to a temp file and re-exec from
# there so that replacing update.sh on disk mid-run does not cause errors.
if [ -z "${_UPDATE_SKILLS_SELF_COPY:-}" ]; then
  _tmp_self="$(mktemp)"
  cp "$0" "$_tmp_self"
  chmod +x "$_tmp_self"
  _UPDATE_SKILLS_ORIG_DIR="$(cd "$(dirname "$0")" && pwd)" \
  _UPDATE_SKILLS_SELF_COPY=1 exec bash "$_tmp_self" "$@"
fi

set -euo pipefail

UPSTREAM="${SKILLS_UPSTREAM:-https://github.com/garethrhughes/skills.git}"

SCRIPT_DIR="${_UPDATE_SKILLS_ORIG_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
SKILLS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "Upstream   : $UPSTREAM"
echo "Skills dir : $SKILLS_DIR"
echo ""

# Write awk programs to temp files to avoid quoting issues
AWK_EXTRACT="$(mktemp)"
AWK_REPLACE="$(mktemp)"

cat > "$AWK_EXTRACT" << 'AWK'
/^## Project Context/ { b=1 }
b && /^## / && !/^## Project Context/ { b=0 }
b { print }
AWK

cat > "$AWK_REPLACE" << 'AWK'
/^## Project Context/ {
  b=1
  while ((getline ln < ctx_file) > 0) print ln
  close(ctx_file)
  next
}
b && /^## / && !/^## Project Context/ { b=0 }
!b { print }
AWK

extract_project_context() {
  awk -f "$AWK_EXTRACT" "$1"
}

replace_project_context() {
  local file="$1"
  local ctx_file="$2"
  local tmp
  tmp="$(mktemp)"
  awk -v ctx_file="$ctx_file" -f "$AWK_REPLACE" "$file" > "$tmp"
  mv "$tmp" "$file"
}

# Root-level files that are copied verbatim (no Project Context merging).
# RULES.md is the canonical rules file — overrides live in per-project ADRs,
# never in RULES.md itself, so it is safe to copy verbatim. A warning is
# emitted below if the installed RULES.md has been locally modified.
ROOT_FILES="README.md CLAUDE.md.template RULES.md"

if [ -n "${_UPDATE_SKILLS_REUSE_CLONE:-}" ] && [ -d "$_UPDATE_SKILLS_REUSE_CLONE" ]; then
  CLONE_DIR="$_UPDATE_SKILLS_REUSE_CLONE"
  REUSED_CLONE=1
  # Only delete the inherited clone dir if the previous run explicitly handed
  # ownership over (it does this when self-updating via exec, since the
  # previous process can't clean up after exec). External callers that pass
  # _UPDATE_SKILLS_REUSE_CLONE without _UPDATE_SKILLS_OWN_CLONE keep their
  # directory intact.
  OWN_CLONE_DIR="${_UPDATE_SKILLS_OWN_CLONE:-0}"
else
  CLONE_DIR="$(mktemp -d)"
  REUSED_CLONE=0
  OWN_CLONE_DIR=1
fi
BEFORE_DIR="$(mktemp -d)"
AFTER_DIR="$(mktemp -d)"
CONTEXT_DIR="$(mktemp -d)"
cleanup() {
  [ "$OWN_CLONE_DIR" = "1" ] && rm -rf "$CLONE_DIR"
  rm -rf "$BEFORE_DIR" "$AFTER_DIR" "$CONTEXT_DIR" "$AWK_EXTRACT" "$AWK_REPLACE"
}
trap cleanup EXIT

if [ "$REUSED_CLONE" = "0" ]; then
  echo "Fetching upstream skills..."
  git clone --depth 1 --quiet "$UPSTREAM" "$CLONE_DIR"
  echo "Done."
  echo ""
fi

# --- Self-update: re-exec from the new update.sh if upstream changed ---
# Without this, a change to update.sh itself only takes effect on the *next*
# run, because the current process is still executing the old logic from a
# tempfile snapshot taken before this script ran. Detect drift, install the
# new version, and exec into it so a single /update-skills picks up
# everything (including any new top-level dirs the new logic syncs).
UPSTREAM_UPDATE="$CLONE_DIR/update-skills/update.sh"
INSTALLED_UPDATE="$SKILLS_DIR/update-skills/update.sh"
if [ -z "${_UPDATE_SKILLS_SELF_UPDATED:-}" ] \
   && [ -f "$UPSTREAM_UPDATE" ] \
   && [ -f "$INSTALLED_UPDATE" ] \
   && ! diff -q "$UPSTREAM_UPDATE" "$INSTALLED_UPDATE" >/dev/null 2>&1; then
  echo "→ update.sh changed upstream — installing new version and re-running."
  echo ""
  cp "$UPSTREAM_UPDATE" "$INSTALLED_UPDATE"
  chmod +x "$INSTALLED_UPDATE"
  # Hand the existing clone to the next run so we don't pay for a second
  # `git clone`. The cleanup trap won't fire because exec replaces this
  # process; the new run will manage CLONE_DIR via its own trap.
  _UPDATE_SKILLS_SELF_UPDATED=1 \
  _UPDATE_SKILLS_REUSE_CLONE="$CLONE_DIR" \
  _UPDATE_SKILLS_OWN_CLONE=1 \
  _UPDATE_SKILLS_ORIG_DIR="${_UPDATE_SKILLS_ORIG_DIR:-$SCRIPT_DIR}" \
  exec bash "$INSTALLED_UPDATE" "$@"
fi

for f in "$SKILLS_DIR"/*/SKILL.md; do
  [ -f "$f" ] || continue
  skill="$(basename "$(dirname "$f")")"
  cp "$f" "$BEFORE_DIR/$skill.md"
  extract_project_context "$f" > "$CONTEXT_DIR/$skill.ctx"
  # Snapshot non-SKILL.md files in the skill dir
  for extra in "$SKILLS_DIR/$skill/"*; do
    [ -f "$extra" ] || continue
    efname="$(basename "$extra")"
    [ "$efname" = "SKILL.md" ] && continue
    cp "$extra" "$BEFORE_DIR/__extra__${skill}__${efname}"
  done
done

# Snapshot root files before update
for rf in $ROOT_FILES; do
  [ -f "$SKILLS_DIR/$rf" ] && cp "$SKILLS_DIR/$rf" "$BEFORE_DIR/__root__$rf"
done

# Snapshot scripts/ before update
if [ -d "$SKILLS_DIR/scripts" ]; then
  for f in "$SKILLS_DIR/scripts/"*; do
    [ -f "$f" ] || continue
    cp "$f" "$BEFORE_DIR/__scripts__$(basename "$f")"
  done
fi

# Snapshot rules/ before update (top-level stack overlays)
if [ -d "$SKILLS_DIR/rules" ]; then
  for f in "$SKILLS_DIR/rules/"*; do
    [ -f "$f" ] || continue
    cp "$f" "$BEFORE_DIR/__rules__$(basename "$f")"
  done
fi

# Snapshot profiles/ before update (per-profile bootstrap defaults + scaffolders)
if [ -d "$SKILLS_DIR/profiles" ]; then
  for d in "$SKILLS_DIR/profiles"/*/; do
    [ -d "$d" ] || continue
    profile="$(basename "$d")"
    for f in "$d"*; do
      [ -f "$f" ] || continue
      cp "$f" "$BEFORE_DIR/__profiles__${profile}__$(basename "$f")"
    done
  done
fi

for upstream_skill_dir in "$CLONE_DIR"/*/; do
  [ -d "$upstream_skill_dir" ] || continue
  skill="$(basename "$upstream_skill_dir")"
  upstream_file="$upstream_skill_dir/SKILL.md"
  [ -f "$upstream_file" ] || continue

  installed_dir="$SKILLS_DIR/$skill"
  installed_file="$installed_dir/SKILL.md"

  if [ ! -d "$installed_dir" ]; then
    cp -r "$upstream_skill_dir" "$installed_dir"
  else
    cp "$upstream_file" "$installed_file"
    for upstream_extra in "$upstream_skill_dir"*; do
      [ -f "$upstream_extra" ] || continue
      fname="$(basename "$upstream_extra")"
      [ "$fname" = "SKILL.md" ] && continue
      cp "$upstream_extra" "$installed_dir/$fname"
    done
  fi

  ctx_file="$CONTEXT_DIR/$skill.ctx"
  if [ -f "$ctx_file" ] && [ -s "$ctx_file" ]; then
    replace_project_context "$installed_file" "$ctx_file"
  fi
done

# Remove skills that existed in the installed README (i.e. were upstream skills)
# but are no longer present in the upstream clone.
# Using the pre-update installed README (snapshotted in BEFORE_DIR) ensures we
# catch skills removed from both the upstream repo and its README in the same
# release, and avoids touching local skills that were never listed there.
INSTALLED_README="$BEFORE_DIR/__root__README.md"
if [ -f "$INSTALLED_README" ]; then
  for installed_skill_dir in "$SKILLS_DIR"/*/; do
    [ -d "$installed_skill_dir" ] || continue
    skill="$(basename "$installed_skill_dir")"
    [ -f "$installed_skill_dir/SKILL.md" ] || continue
    if grep -q "\[$skill\](" "$INSTALLED_README" 2>/dev/null && [ ! -d "$CLONE_DIR/$skill" ]; then
      rm -rf "$installed_skill_dir"
    fi
  done
fi

# Detect local RULES.md modifications before overwriting.
# RULES.md is the single source of truth — overrides belong in per-project
# ADRs, never in RULES.md itself. If the installed copy diverges from the
# upstream copy that was previously installed, surface that loudly.
RULES_LOCAL_MODIFIED=0
if [ -f "$BEFORE_DIR/__root__RULES.md" ] && [ -f "$CLONE_DIR/RULES.md" ]; then
  if ! diff -q "$BEFORE_DIR/__root__RULES.md" "$CLONE_DIR/RULES.md" >/dev/null 2>&1; then
    # Upstream changed RULES.md — that's expected. Only warn if the local
    # copy diverges from BOTH the previous install AND the new upstream.
    :
  fi
fi
# Compare installed RULES.md against upstream RULES.md directly to detect
# local edits (which are forbidden — overrides go in ADRs).
if [ -f "$SKILLS_DIR/RULES.md" ] && [ -f "$CLONE_DIR/RULES.md" ]; then
  if ! diff -q "$SKILLS_DIR/RULES.md" "$CLONE_DIR/RULES.md" >/dev/null 2>&1; then
    RULES_LOCAL_MODIFIED=1
    echo ""
    echo "⚠  WARNING: installed RULES.md differs from upstream RULES.md."
    echo "   RULES.md is the single source of truth and must not be edited"
    echo "   locally — per-project overrides belong in ADRs (decision-log)."
    echo "   The local file will be overwritten. Diff:"
    echo ""
    diff -u "$SKILLS_DIR/RULES.md" "$CLONE_DIR/RULES.md" || true
    echo ""
  fi
fi

# Copy root-level files from upstream
for rf in $ROOT_FILES; do
  [ -f "$CLONE_DIR/$rf" ] && cp "$CLONE_DIR/$rf" "$SKILLS_DIR/$rf"
done

# Sync scripts/ from upstream
if [ -d "$CLONE_DIR/scripts" ]; then
  mkdir -p "$SKILLS_DIR/scripts"
  for f in "$CLONE_DIR/scripts/"*; do
    [ -f "$f" ] || continue
    cp "$f" "$SKILLS_DIR/scripts/$(basename "$f")"
  done
fi

# Sync rules/ from upstream (stack overlays — worker skills reference these)
if [ -d "$CLONE_DIR/rules" ]; then
  mkdir -p "$SKILLS_DIR/rules"
  for f in "$CLONE_DIR/rules/"*; do
    [ -f "$f" ] || continue
    cp "$f" "$SKILLS_DIR/rules/$(basename "$f")"
  done
  # Remove rules files that no longer exist upstream
  for f in "$SKILLS_DIR/rules/"*; do
    [ -f "$f" ] || continue
    fname="$(basename "$f")"
    [ -f "$CLONE_DIR/rules/$fname" ] || rm -f "$f"
  done
fi

# Sync profiles/ from upstream (per-profile bootstrap defaults + scaffolders)
if [ -d "$CLONE_DIR/profiles" ]; then
  mkdir -p "$SKILLS_DIR/profiles"
  for upstream_profile_dir in "$CLONE_DIR/profiles"/*/; do
    [ -d "$upstream_profile_dir" ] || continue
    profile="$(basename "$upstream_profile_dir")"
    mkdir -p "$SKILLS_DIR/profiles/$profile"
    for f in "$upstream_profile_dir"*; do
      [ -f "$f" ] || continue
      cp "$f" "$SKILLS_DIR/profiles/$profile/$(basename "$f")"
    done
  done
  # Remove profiles that no longer exist upstream
  for installed_profile_dir in "$SKILLS_DIR/profiles"/*/; do
    [ -d "$installed_profile_dir" ] || continue
    profile="$(basename "$installed_profile_dir")"
    [ -d "$CLONE_DIR/profiles/$profile" ] || rm -rf "$installed_profile_dir"
  done
fi

for f in "$SKILLS_DIR"/*/SKILL.md; do
  [ -f "$f" ] || continue
  skill="$(basename "$(dirname "$f")")"
  cp "$f" "$AFTER_DIR/$skill.md"
  # Snapshot non-SKILL.md files in the skill dir after update
  for extra in "$SKILLS_DIR/$skill/"*; do
    [ -f "$extra" ] || continue
    efname="$(basename "$extra")"
    [ "$efname" = "SKILL.md" ] && continue
    cp "$extra" "$AFTER_DIR/__extra__${skill}__${efname}"
  done
done

# Snapshot root files after update
for rf in $ROOT_FILES; do
  [ -f "$SKILLS_DIR/$rf" ] && cp "$SKILLS_DIR/$rf" "$AFTER_DIR/__root__$rf"
done

# Snapshot scripts/ after update
if [ -d "$SKILLS_DIR/scripts" ]; then
  for f in "$SKILLS_DIR/scripts/"*; do
    [ -f "$f" ] || continue
    cp "$f" "$AFTER_DIR/__scripts__$(basename "$f")"
  done
fi

# Snapshot rules/ after update
if [ -d "$SKILLS_DIR/rules" ]; then
  for f in "$SKILLS_DIR/rules/"*; do
    [ -f "$f" ] || continue
    cp "$f" "$AFTER_DIR/__rules__$(basename "$f")"
  done
fi

# Snapshot profiles/ after update
if [ -d "$SKILLS_DIR/profiles" ]; then
  for d in "$SKILLS_DIR/profiles"/*/; do
    [ -d "$d" ] || continue
    profile="$(basename "$d")"
    for f in "$d"*; do
      [ -f "$f" ] || continue
      cp "$f" "$AFTER_DIR/__profiles__${profile}__$(basename "$f")"
    done
  done
fi

ADDED=""
REMOVED=""
MODIFIED=""

for after_file in "$AFTER_DIR"/*.md; do
  [ -f "$after_file" ] || continue
  skill="$(basename "$after_file" .md)"
  # skip internal snapshot files (prefixed with __)
  case "$skill" in __*) continue ;; esac
  before_file="$BEFORE_DIR/$skill.md"
  if [ ! -f "$before_file" ]; then
    ADDED="$ADDED $skill"
  elif ! diff -q "$before_file" "$after_file" > /dev/null 2>&1; then
    MODIFIED="$MODIFIED $skill"
  fi
done

for before_file in "$BEFORE_DIR"/*.md; do
  [ -f "$before_file" ] || continue
  skill="$(basename "$before_file" .md)"
  case "$skill" in __*) continue ;; esac
  if [ ! -f "$AFTER_DIR/$skill.md" ]; then
    REMOVED="$REMOVED $skill"
  fi
done

added_count=0; removed_count=0; modified_count=0
for s in $ADDED;    do added_count=$((added_count+1));      done
for s in $REMOVED;  do removed_count=$((removed_count+1));  done
for s in $MODIFIED; do modified_count=$((modified_count+1));done

# Count modified root files
ROOT_MODIFIED=""
for rf in $ROOT_FILES; do
  before="$BEFORE_DIR/__root__$rf"
  after="$AFTER_DIR/__root__$rf"
  [ -f "$after" ] || continue
  if [ ! -f "$before" ]; then
    ROOT_MODIFIED="$ROOT_MODIFIED $rf"
  elif ! diff -q "$before" "$after" > /dev/null 2>&1; then
    ROOT_MODIFIED="$ROOT_MODIFIED $rf"
  fi
done
root_modified_count=0
for rf in $ROOT_MODIFIED; do root_modified_count=$((root_modified_count+1)); done

# Count modified scripts
SCRIPTS_MODIFIED=""
for after_f in "$AFTER_DIR"/__scripts__*; do
  [ -f "$after_f" ] || continue
  fname="$(basename "$after_f" | sed 's/^__scripts__//')"
  before_f="$BEFORE_DIR/__scripts__$fname"
  if [ ! -f "$before_f" ]; then
    SCRIPTS_MODIFIED="$SCRIPTS_MODIFIED $fname"
  elif ! diff -q "$before_f" "$after_f" > /dev/null 2>&1; then
    SCRIPTS_MODIFIED="$SCRIPTS_MODIFIED $fname"
  fi
done
scripts_modified_count=0
for f in $SCRIPTS_MODIFIED; do scripts_modified_count=$((scripts_modified_count+1)); done

# Count modified skill extra files (e.g. update.sh inside update-skills/)
EXTRAS_MODIFIED=""
for after_f in "$AFTER_DIR"/__extra__*; do
  [ -f "$after_f" ] || continue
  key="$(basename "$after_f" | sed 's/^__extra__//')"  # skill__filename
  before_f="$BEFORE_DIR/__extra__$key"
  if [ ! -f "$before_f" ]; then
    EXTRAS_MODIFIED="$EXTRAS_MODIFIED $key"
  elif ! diff -q "$before_f" "$after_f" > /dev/null 2>&1; then
    EXTRAS_MODIFIED="$EXTRAS_MODIFIED $key"
  fi
done
extras_modified_count=0
for e in $EXTRAS_MODIFIED; do extras_modified_count=$((extras_modified_count+1)); done

# Count modified rules/ files
RULES_MODIFIED=""
for after_f in "$AFTER_DIR"/__rules__*; do
  [ -f "$after_f" ] || continue
  fname="$(basename "$after_f" | sed 's/^__rules__//')"
  before_f="$BEFORE_DIR/__rules__$fname"
  if [ ! -f "$before_f" ]; then
    RULES_MODIFIED="$RULES_MODIFIED $fname"
  elif ! diff -q "$before_f" "$after_f" > /dev/null 2>&1; then
    RULES_MODIFIED="$RULES_MODIFIED $fname"
  fi
done
# Detect removed rules files
for before_f in "$BEFORE_DIR"/__rules__*; do
  [ -f "$before_f" ] || continue
  fname="$(basename "$before_f" | sed 's/^__rules__//')"
  if [ ! -f "$AFTER_DIR/__rules__$fname" ]; then
    RULES_MODIFIED="$RULES_MODIFIED REMOVED:$fname"
  fi
done
rules_modified_count=0
for f in $RULES_MODIFIED; do rules_modified_count=$((rules_modified_count+1)); done

# Count modified profiles/ files
PROFILES_MODIFIED=""
for after_f in "$AFTER_DIR"/__profiles__*; do
  [ -f "$after_f" ] || continue
  key="$(basename "$after_f" | sed 's/^__profiles__//')"  # profile__filename
  before_f="$BEFORE_DIR/__profiles__$key"
  if [ ! -f "$before_f" ]; then
    PROFILES_MODIFIED="$PROFILES_MODIFIED $key"
  elif ! diff -q "$before_f" "$after_f" > /dev/null 2>&1; then
    PROFILES_MODIFIED="$PROFILES_MODIFIED $key"
  fi
done
# Detect removed profile files
for before_f in "$BEFORE_DIR"/__profiles__*; do
  [ -f "$before_f" ] || continue
  key="$(basename "$before_f" | sed 's/^__profiles__//')"
  if [ ! -f "$AFTER_DIR/__profiles__$key" ]; then
    PROFILES_MODIFIED="$PROFILES_MODIFIED REMOVED:$key"
  fi
done
profiles_modified_count=0
for f in $PROFILES_MODIFIED; do profiles_modified_count=$((profiles_modified_count+1)); done

TOTAL=$(( added_count + removed_count + modified_count + root_modified_count + scripts_modified_count + extras_modified_count + rules_modified_count + profiles_modified_count ))

if [ $TOTAL -eq 0 ]; then
  echo "STATUS: up-to-date"
  echo "All skills are already up to date. No changes applied."
  exit 0
fi

echo "STATUS: updated"
echo "CHANGES: $TOTAL skill(s) affected"
echo ""

if [ $added_count -gt 0 ]; then
  echo "--- ADDED ($added_count) ---"
  for skill in $ADDED; do echo "  + $skill"; done
  echo ""
fi

if [ $removed_count -gt 0 ]; then
  echo "--- REMOVED ($removed_count) ---"
  for skill in $REMOVED; do echo "  - $skill"; done
  echo ""
fi

if [ $modified_count -gt 0 ]; then
  echo "--- MODIFIED ($modified_count) ---"
  for skill in $MODIFIED; do
    echo ""
    echo "  skill: $skill"
    echo "  diff (## Project Context excluded):"
    diff --unified=3 \
      --label "before/$skill/SKILL.md" \
      --label "after/$skill/SKILL.md" \
      "$BEFORE_DIR/$skill.md" "$AFTER_DIR/$skill.md" \
      | sed 's/^/    /' || true
  done
  echo ""
fi

if [ $root_modified_count -gt 0 ]; then
  echo "--- ROOT FILES UPDATED ($root_modified_count) ---"
  for rf in $ROOT_MODIFIED; do
    echo ""
    echo "  file: $rf"
    diff --unified=3 \
      --label "before/$rf" \
      --label "after/$rf" \
      "$BEFORE_DIR/__root__$rf" "$AFTER_DIR/__root__$rf" \
      | sed 's/^/    /' || true
  done
  echo ""
fi

if [ $scripts_modified_count -gt 0 ]; then
  echo "--- SCRIPTS UPDATED ($scripts_modified_count) ---"
  for f in $SCRIPTS_MODIFIED; do
    echo ""
    echo "  file: scripts/$f"
    before_f="$BEFORE_DIR/__scripts__$f"
    after_f="$AFTER_DIR/__scripts__$f"
    if [ -f "$before_f" ]; then
      diff --unified=3 \
        --label "before/scripts/$f" \
        --label "after/scripts/$f" \
        "$before_f" "$after_f" \
        | sed 's/^/    /' || true
    else
      echo "    (new file)"
    fi
  done
  echo ""
fi

if [ $extras_modified_count -gt 0 ]; then
  echo "--- SKILL FILES UPDATED ($extras_modified_count) ---"
  for e in $EXTRAS_MODIFIED; do
    skill="${e%%__*}"
    fname="${e#*__}"
    echo ""
    echo "  file: $skill/$fname"
    before_f="$BEFORE_DIR/__extra__$e"
    after_f="$AFTER_DIR/__extra__$e"
    if [ -f "$before_f" ]; then
      diff --unified=3 \
        --label "before/$skill/$fname" \
        --label "after/$skill/$fname" \
        "$before_f" "$after_f" \
        | sed 's/^/    /' || true
    else
      echo "    (new file)"
    fi
  done
  echo ""
fi

if [ $rules_modified_count -gt 0 ]; then
  echo "--- RULES OVERLAYS UPDATED ($rules_modified_count) ---"
  for entry in $RULES_MODIFIED; do
    case "$entry" in
      REMOVED:*)
        fname="${entry#REMOVED:}"
        echo ""
        echo "  file: rules/$fname  (REMOVED upstream)"
        ;;
      *)
        fname="$entry"
        echo ""
        echo "  file: rules/$fname"
        before_f="$BEFORE_DIR/__rules__$fname"
        after_f="$AFTER_DIR/__rules__$fname"
        if [ -f "$before_f" ]; then
          diff --unified=3 \
            --label "before/rules/$fname" \
            --label "after/rules/$fname" \
            "$before_f" "$after_f" \
            | sed 's/^/    /' || true
        else
          echo "    (new file)"
        fi
        ;;
    esac
  done
  echo ""
fi

if [ $profiles_modified_count -gt 0 ]; then
  echo "--- PROFILES UPDATED ($profiles_modified_count) ---"
  for entry in $PROFILES_MODIFIED; do
    case "$entry" in
      REMOVED:*)
        key="${entry#REMOVED:}"
        profile="${key%%__*}"
        fname="${key#*__}"
        echo ""
        echo "  file: profiles/$profile/$fname  (REMOVED upstream)"
        ;;
      *)
        key="$entry"
        profile="${key%%__*}"
        fname="${key#*__}"
        echo ""
        echo "  file: profiles/$profile/$fname"
        before_f="$BEFORE_DIR/__profiles__$key"
        after_f="$AFTER_DIR/__profiles__$key"
        if [ -f "$before_f" ]; then
          diff --unified=3 \
            --label "before/profiles/$profile/$fname" \
            --label "after/profiles/$profile/$fname" \
            "$before_f" "$after_f" \
            | sed 's/^/    /' || true
        else
          echo "    (new file)"
        fi
        ;;
    esac
  done
  echo ""
fi
