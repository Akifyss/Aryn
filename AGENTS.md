# Project Agent Guide

## Product Summary

This project is an AI writing agent desktop application for long-form drafting, rewriting, continuation, and assisted creation in a local desktop workspace.

The product direction is:

- open a local folder as the active workspace, similar to Obsidian or VS Code
- treat `workspace` as the core model instead of only a file picker
- keep local-first file access and external file change detection as first-class capabilities
- expose a GUI for selected Git workflows instead of requiring terminal-only usage

## Current Scope

The current minimum viable scope includes:

- open and switch local workspace folders
- render a file tree
- open, edit, and save supported text files
- provide a left navigation area, a central writing/editor area, and a right AI conversation panel
- preserve and restore local workspace state
- surface basic agent task status feedback

## Technical Direction

- Electron is the desktop container
- React + TypeScript is the renderer stack
- `vite` / `electron-vite` is the build toolchain
- PI Agent is the current AI backend integration path
- Tailwind CSS powers styling
- Tiptap is the rich text editor
- Zustand manages renderer state
- HeroUI is allowed for faster early-stage delivery
- Core business UI should gradually move toward custom components built on Base UI

## Architecture Guidance

### Process Boundaries

- `main` owns filesystem access, window management, agent orchestration, and privileged local integrations
- `preload` exposes only controlled APIs through `contextBridge` and IPC
- `renderer` owns editor UX, session UI, writing workflow, and interaction design
- keep a layered structure aligned with `main / preload / renderer / shared`

### Data Strategy

- phase 1 stays local-first on the filesystem
- introduce `better-sqlite3` only when workspace metadata, session history, prompt templates, or user settings outgrow flat files
- prefer saving structured editor content plus required export formats

### Agent Strategy

- keep PI Agent integration in the Electron main process for now
- only split agent work into a standalone local service if complexity or isolation needs justify it later
- route long-running and sensitive agent tasks through the main process rather than directly from the renderer

## Reference Products

- [scratch](https://github.com/erictli/scratch): minimal, offline-first desktop Markdown notes with strong local file ergonomics
- [1code](https://github.com/21st-dev/1code): multi-agent visual orchestration and Git worktree isolation ideas
- [openchamber](https://github.com/openchamber/openchamber): desktop AI agent UI with branchable timelines and deep GitHub integration
- [craft-agents-oss](https://github.com/lukilabs/craft-agents-oss): agent-native architecture built around Pi SDK patterns

## Repository Conventions For Agents

- keep this `AGENTS.md` file as the canonical project guidance document at the repository root
- when project scope, architecture, workflows, or delivery priorities change, update `AGENTS.md` instead of keeping a separate product-specs file
- keep custom Codex skills under `.codex/skills/`
- keep an Antigravity-compatible mirror under `.agents/skills/`
- when a repo-local skill changes, update both trees so the Codex and Antigravity copies stay aligned

