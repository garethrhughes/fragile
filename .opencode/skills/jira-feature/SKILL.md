---
name: jira-feature
description: Loads a Jira ticket by URL or issue key, extracts the description and acceptance criteria, and drives the full create-feature cycle with that ticket as the requirement source.
compatibility: opencode
---

# Jira Feature Skill

This skill bridges a Jira ticket and the full feature development cycle. Given a Jira
issue URL or key, it fetches the ticket details, maps them onto the create-feature brief
format, and then hands off to the **create-feature** skill to drive the complete
proposal → implementation → review → infosec → decision log → PR cycle.

It also detects whether the Jira MCP server is configured and, if not, guides the user
through setting it up before proceeding.

---

## Project Context

> Fill in before use, or run `project-bootstrap` / `project-onboard` to populate this automatically.
>
> This skill expects the following Jira-specific fields (populated by the bootstrap/onboard Phase 9):
>
> - **Jira instance URL** — e.g. `https://your-org.atlassian.net`
> - **Default project key(s)** — e.g. `PLAT, API, FE`
> - **Acceptance criteria location** — e.g. custom field 'Acceptance Criteria', or `## Acceptance Criteria` heading in the Description
>
> Example (paste the Jira line from your Project Context block here):
> `Jira: https://acme.atlassian.net — projects: PLAT, API — AC: ## Acceptance Criteria heading in Description`

---

## Step 1 — Check Jira MCP Server

Before doing anything else, check whether the Jira MCP server is available.

Look for a `jira` entry in `opencode.json` at the project root (or the user's global
OpenCode config if no project config exists).

**If the Jira MCP server is NOT configured:**

Tell the user:

> "The Jira MCP server is not configured — I need it to fetch ticket details from your
> Jira instance. I'll run the **mcp-setup** skill now to add it."

Invoke the **mcp-setup** skill, pre-selecting Jira as the server to configure. Once
mcp-setup completes, tell the user:

> "Jira MCP server has been added to `opencode.json`. Please restart OpenCode so the
> server connects, then re-run this skill."

Stop — do not proceed until the user confirms they have restarted OpenCode.

**If the Jira MCP server IS configured:** proceed to Step 2.

---

## Step 2 — Collect the Jira Issue Reference

Ask the user for the Jira issue in a single prompt:

> "What Jira issue should I use as the feature brief?
>
> Provide either:
> - A full URL: `https://your-org.atlassian.net/browse/PROJ-123`
> - An issue key: `PROJ-123`"

Wait for the user's response. Extract the issue key from the URL if a URL was provided.

---

## Step 3 — Fetch the Jira Ticket

Use the Jira MCP server to fetch the issue. Retrieve at minimum:

- **Summary** — the issue title
- **Description** — the full issue body (may contain acceptance criteria)
- **Issue type** — Story, Bug, Task, Epic, etc.
- **Status** — current workflow state
- **Acceptance Criteria** — look in these locations in order:
  1. A dedicated `Acceptance Criteria` custom field (common in Jira Software)
  2. A `## Acceptance Criteria` or `### Acceptance Criteria` heading in the Description
  3. A bulleted or numbered list following "AC:", "Acceptance Criteria:", or "Done when:"
  4. If none of the above exist, note that no explicit ACs were found

If the fetch fails (issue not found, permission denied, server error), tell the user
clearly what went wrong and stop — do not proceed with incomplete data.

---

## Step 4 — Map Ticket to Feature Brief

Translate the fetched Jira data into the create-feature brief format:

| create-feature field | Mapped from Jira |
|---|---|
| Feature description | Issue Summary + Description (first paragraph or up to 200 words if no explicit AC section) |
| Acceptance criteria | Extracted ACs from Step 3; if none found, derive candidates from the description and flag them as inferred |

If ACs were inferred (not explicitly stated in the ticket), flag this clearly:

> "⚠ No explicit acceptance criteria were found in the ticket. I've inferred the
> following from the description — please confirm or correct them before we proceed."

---

## Step 5 — Present Brief and Confirm

Present the mapped brief in the create-feature summary table format:

```
| Field                | Value                                              |
|----------------------|----------------------------------------------------|
| Jira issue           | {KEY} — {Summary}                                  |
| Issue type           | {Story / Bug / Task / …}                           |
| Feature description  | {description}                                      |
| Acceptance criteria  | {criterion 1}                                      |
|                      | {criterion 2}                                      |
|                      | ...                                                |
```

Then ask:

> "Does this capture the feature correctly? Reply **confirm** to start the feature
> cycle, **edit** to adjust the description or ACs before we begin, or **cancel** to stop."

- **confirm** — proceed to Step 6
- **edit** — let the user amend the description and/or ACs inline, update the table, re-present, and ask again
- **cancel** — stop

---

## Step 6 — Write the Feature Document

Before handing off to create-feature, write a feature document to `docs/features/`.

### File naming

```
docs/features/NNNN-{JIRA-KEY}-short-kebab-case-title.md
```

Increment NNNN sequentially from the highest existing number in `docs/features/`. Start
at 0001 if no files exist yet. Derive the short title from the Jira issue summary.

Populate the document using the confirmed brief and the Jira ticket data:

```markdown
# NNNN — Feature Title

**Date:** YYYY-MM-DD
**Status:** Draft
**Source:** Jira:{KEY} — {full Jira issue URL}
**Related proposal:** *(populated after architect step)*

## Summary

{One or two sentences from the confirmed feature description.}

## Background / Motivation

{Derived from the Jira description — why this feature is needed, what problem it solves.
Include the Jira issue key and link as the authoritative source.}

## Scope

**In scope**
- {Derived from the ticket description or confirmed brief.}

**Out of scope**
- {Anything explicitly excluded in the ticket, or "Not specified in ticket."}

## Acceptance Criteria

{The confirmed acceptance criteria, one bullet per criterion.}

## Open Questions

{Any unresolved items noted during the brief mapping step. If none, write "None."}

## Notes

{Any additional context from the Jira ticket — linked issues, labels, priority, or
fields not captured above.}
```

After writing the file, confirm to the user:

> "Feature document written to `docs/features/NNNN-{JIRA-KEY}-short-title.md`. Proceeding to design."

---

## Step 7 — Hand Off to create-feature

With the confirmed brief and feature document in hand, invoke the **create-feature** skill,
skipping its Feature Intake step and its Feature Document step (both have already been
completed).

Pass the confirmed brief directly as the feature description and acceptance criteria.

From this point, follow the create-feature workflow exactly:

- Step 1 — Design (architect skill) — back-link the feature document in the proposal's
  **Related feature** field
- Step 2 — Implementation (developer skill)
- Step 3 — Code Review (reviewer skill)
- Step 4 — Infosec Sign-Off (infosec skill, if applicable)
- Step 5 — Decision Logging (decision-log skill)
- Step 6 — Pull Request

Include the Jira issue key in all artifacts:
- Feature document: `docs/features/NNNN-{JIRA-KEY}-short-title.md` *(already written)*
- Proposal filename: `docs/proposals/NNNN-{JIRA-KEY}-short-title.md`
- Branch name: `feature/{JIRA-KEY}-short-title`
- PR title: `[{JIRA-KEY}] Short title`
- PR description: link to the feature document and back to the Jira issue

---

## MCP Tools

### jira — Ticket Fetching
Use the Jira MCP server in Step 3 to:
- Fetch the full issue detail by key (summary, description, custom fields, status, issue type)
- Look up any linked issues if the description references them and context would be useful

### filesystem — Config & Feature Doc
Use the Filesystem MCP server to:
- Read `opencode.json` to check whether the Jira MCP server is already configured
- Read `docs/features/` to determine the next sequential NNNN before writing the feature document
- Write the feature document to `docs/features/NNNN-{JIRA-KEY}-short-title.md`

---

## Rules

- Never proceed past Step 1 if the Jira MCP server is not configured. Do not attempt to
  fetch tickets via WebFetch or any other workaround — the MCP server is required.
- Never invent acceptance criteria. If none can be found or inferred with reasonable
  confidence, tell the user and ask them to supply ACs manually before continuing.
- Always include the Jira issue key in the feature document filename, branch name,
  proposal filename, and PR title.
- The Feature Intake step and Feature Document step of create-feature are **skipped** —
  this skill replaces both. Do not ask the user for a feature description and ACs a
  second time, and do not write a second feature document.
- Always write the feature document (Step 6) before invoking create-feature (Step 7).
