# 沟通
- 使用中文和我沟通交流。

# 技术栈

- 核心架构：
  - Electron：桌面容器，负责窗口管理与系统级集成。
  - 进程分层：`main` 进程处理 FS/Agent 编排，`preload` 提供安全 IPC，`renderer` 负责 React UI 交互。
- 渲染层：
  - React + TypeScript：前端逻辑开发。
  - Vite / electron-vite：构建与热更新工具链。
- 编辑器与 AI：
  - MEO / CodeMirror：核心 Markdown 与文本编辑器。
  - PI Agent (`@earendil-works/pi-coding-agent`)：集成 AI 后端能力。
- UI 与 状态管理：
  - 样式 (CSS)：优先使用 [Tailwind CSS v4](https://tailwindcss.com/docs)。
  - 组件库：使用 [HeroUI V3](https://heroui.com/docs/react/getting-started)。
    - 只要是可滚动容器，使用 [base-ui Scroll Area](https://base-ui.com/react/components/scroll-area)。
  - Design Token / CSS 变量：优先使用 HeroUI V3 提供的系统 ([Colors](https://heroui.com/docs/react/getting-started/colors) 、 [Theming](https://heroui.com/docs/react/getting-started/theming) 、 [Styling](https://heroui.com/docs/react/getting-started/styling))。
  - 图标：优先使用 [mingcute](https://www.mingcute.com/) ([GitHub](https://github.com/mingcute-design/mingcute-icons))；若无合适图标则使用 [iconify](https://iconify.design/) ([Docs](https://iconify.design/docs/) 、 [GitHub](https://github.com/iconify/iconify))。
  - 状态管理：使用 Zustand 管理渲染器全局状态；UI 状态需标注明确。
- 数据策略：保持本地文件系统优先，仅在需要复杂元数据（如会话历史、模板）时引入 `better-sqlite3`。
