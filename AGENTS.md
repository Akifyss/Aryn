# 项目 Agent 指南

## 项目背景

本项目是一个专注于长篇草拟、改写、续写和辅助创作的 AI 写作 Agent 桌面应用程序。它采用本地优先的架构，将“工作区”作为核心模型，而非简单的文件选择器，旨在为创作者提供类似 Obsidian 或 VS Code 的深度本地文件管理体验。

核心产品方向：
- 本地工作区模式：直接打开本地文件夹作为活动工作区。
- 一等公民能力：支持外部文件更改检测和本地优先的文件访问。
- Git 辅助创作：为选定的 Git 工作流提供 GUI 界面，辅助版本管理。
- MVP 范围（已实现）：包括文件树渲染、MEO/CodeMirror 编辑、AI 对话面板、工作区状态持久化及 Agent 任务反馈。

## 技术栈

本项目采用现代桌面应用技术栈，强调模块化和高性能的本地集成。

- 核心架构：
  - Electron：桌面容器，负责窗口管理与系统级集成。
  - 进程分层：`main` 进程处理 FS/Agent 编排，`preload` 提供安全 IPC，`renderer` 负责 React UI 交互。
- 渲染层：
  - React + TypeScript：前端逻辑开发。
  - Vite / electron-vite：构建与热更新工具链。
- 编辑器与 AI：
  - MEO / CodeMirror：核心 Markdown 与文本编辑器。
  - PI Agent (`@mariozechner/pi-coding-agent`)：集成 AI 后端能力。
- UI 与 状态管理：
  - 样式 (CSS)：优先使用 [Tailwind CSS v4](https://tailwindcss.com/docs)。
  - 组件库：使用 [HeroUI V3](https://heroui.com/docs/react/getting-started)。
  - Design Token / CSS 变量：优先使用 HeroUI V3 提供的系统 ([Colors](https://heroui.com/docs/react/getting-started/colors) 、 [Theming](https://heroui.com/docs/react/getting-started/theming) 、 [Styling](https://heroui.com/docs/react/getting-started/styling))。
  - 图标：优先使用 [mingcute](https://www.mingcute.com/) ([GitHub](https://github.com/mingcute-design/mingcute-icons))；若无合适图标则使用 [iconify](https://iconify.design/) ([Docs](https://iconify.design/docs/) 、 [GitHub](https://github.com/iconify/iconify))。
  - 状态管理：使用 Zustand 管理渲染器全局状态；UI 状态需标注明确。
- 数据策略：保持本地文件系统优先，仅在需要复杂元数据（如会话历史、模板）时引入 `better-sqlite3`。

## 参考项目

- [scratch](https://github.com/erictli/scratch): 极简、离线优先的桌面 Markdown 笔记，具有强大的本地文件人体工程学。
- [1code](https://github.com/21st-dev/1code): 多 Agent 视觉编排和 Git 工作树隔离理念。
- [openchamber](https://github.com/openchamber/openchamber): 具有分支时间线和深度 Git 集成的桌面 AI Agent UI。
- [craft-agents-oss](https://github.com/lukilabs/craft-agents-oss): 基于 Pi SDK 模式构建的 Agent 原生架构。
- [obsidian git](https://github.com/Vinzent03/obsidian-git): Obsidian 的 Git 集成插件。
- [tolaria](https://github.com/refactoringhq/tolaria)
