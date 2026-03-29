---
name: update-agents
description: Update the repository root `AGENTS.md` when the user provides new requirements, scope changes, architecture decisions, workflow conventions, feature additions, feature removals, or clarified constraints. Use when Codex should merge the latest project guidance into `AGENTS.md` and keep it concise, deduplicated, and aligned with the current plan.
---

Update `AGENTS.md` in this repository whenever the user provides project guidance deltas.

## Goal

Keep the repository guidance document current without rewriting stable sections unnecessarily.

## Target File

- Edit `AGENTS.md` at the repository root.

## Workflow

1. Read the current `AGENTS.md` before editing.
2. Extract only the net-new facts and explicit changes from the user's latest message.
3. Distinguish between:
   - new requirements
   - changed requirements
   - removed or superseded requirements
   - clarified implementation constraints
   - workflow or repository convention changes
   - roadmap or milestone adjustments
4. Merge those changes into the existing document instead of appending raw notes.
5. Preserve valid existing content unless the new message clearly replaces it.
6. Keep the document concise, structured, and useful for future agents working in the repo.

## Editing Rules

- Prefer updating existing sections before creating new ones.
- Remove contradictions when the latest user message clearly overrides older content.
- Normalize scattered notes into the document's current outline and tone.
- Convert vague user wording into precise project language, but do not invent requirements.
- If the user gives implementation detail that materially affects product scope, repo conventions, or architecture, record it in the most relevant section.
- If the user message is ambiguous, record only the unambiguous part and avoid speculative edits.
- Do not turn transient discussion into committed project direction unless the user frames it as a decision, requirement, or change.

## Preferred Section Mapping

- Product purpose and user value: update the opening summary or current scope.
- Feature additions or removals: update scope or milestone sections.
- Tech choices and architectural constraints: update technical direction or architecture guidance.
- Workflow and repo changes: update repository conventions for agents.
- Delivery sequencing: update milestone or roadmap sections when present.

## Output Expectations

After editing, report:

1. what changed in `AGENTS.md`
2. any assumptions kept implicit
3. any conflicts or ambiguities that were not merged

## Trigger Examples

- "把这些新需求同步到 AGENTS.md"
- "这个仓库规范变了，顺手更新 AGENTS"
- "把这次范围调整合并进 AGENTS.md"
- "后续 agent 的工作方式改了，更新一下仓库根文档"
