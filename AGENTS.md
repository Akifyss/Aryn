# 沟通
- 使用中文和我沟通交流。

# 开发原则
- 先澄清再动手：遇到需求歧义、缺少上下文或高风险改动时，明确说明假设；无法可靠假设时先问。简单低风险任务可直接按合理假设推进。
- 清理自己的改动：由本次修改造成的未使用导入、变量、函数或失效逻辑需要清理；
- 目标可验证：非平凡改动先给简短计划，并说明如何验证；修 bug 优先补充或运行能复现问题的检查，改完后尽量执行相关测试或说明未执行原因。
- 取舍：这些原则偏向稳健而非速度；纯文案、小样式或低风险改动保持轻量流程。

# worktree 相关流程
- 在 worktree 中提交前，先确认只包含本任务文件；提交前尽量跑相关测试、类型检查或能复现问题的脚本，并记录未执行项。
- 合回 `main` 前必须分别检查修复 worktree 和主工作区状态；如果主工作区有用户或其他任务的未提交改动，不要在主工作区执行普通 merge/cherry-pick。
- 当主工作区 dirty 但需要把已验证提交合入本地 `main` 时，先将修复分支 rebase 到最新 `main` 并验证；确认可快进后，可以只更新 `main` 引用并仅同步本次提交涉及的文件，严禁覆盖无关未提交改动。
- 本地合入后默认不 push；只有用户明确要求 push/开 PR 时才操作远端。

# 技术栈

- 核心架构：
  - Electron：桌面容器，负责窗口管理与系统级集成。
  - 进程分层：`main` 进程处理 FS/Agent 编排，`preload` 提供安全 IPC，`renderer` 负责 React UI 交互。
- 渲染层：
  - React + TypeScript：前端逻辑开发。
  - Vite + vite-plugin-electron：构建与热更新工具链。
- 编辑器与 AI：
  - MEO / CodeMirror：核心 Markdown 编辑器；Monaco 用于代码编辑与部分 diff 场景。
  - PI Agent (`@earendil-works/pi-coding-agent`)：集成 AI 后端能力。
- UI 与 状态管理：
  - 样式 (CSS)：优先使用 [Tailwind CSS v4](https://tailwindcss.com/docs)。
  - 组件库：使用 [HeroUI V3](https://heroui.com/docs/react/getting-started) 和 [base-ui](https://base-ui.com/react/components)。
    - 只要是可滚动容器，使用 [base-ui Scroll Area](https://base-ui.com/react/components/scroll-area)。
  - Design Token / CSS 变量：优先使用 HeroUI V3 提供的系统 ([Colors](https://heroui.com/docs/react/getting-started/colors) 、 [Theming](https://heroui.com/docs/react/getting-started/theming) 、 [Styling](https://heroui.com/docs/react/getting-started/styling))。
  - 图标：优先使用 [mingcute](https://www.mingcute.com/) ([GitHub](https://github.com/mingcute-design/mingcute-icons))；若无合适图标则使用 [iconify](https://iconify.design/) ([Docs](https://iconify.design/docs/) 、 [GitHub](https://github.com/iconify/iconify))。
  - 状态管理：使用 Zustand 管理渲染器全局状态；UI 状态需标注明确。

# electron 调试流程

- 项目已内置 electron 调试流程：说明文档见 `docs/electron-debug-workflow.md`，执行脚本见 `scripts/electron-debug-session.mjs`，命令入口见 `package.json` 中的 `debug:electron` / `debug:electron:build`。
- 仅在需要进入真实 Electron 应用收集 `main` / `preload` / `renderer` 诊断时使用该流程；小改动、用户能快速查看确认的 UI 或文案调整，不用进入 electron 调试流程。

## Codex Computer Use 调试

- 用于观察和操作当前真实桌面窗口，适合快速确认 UI 状态或复查交互结果。
- 基本流程：先用 `mcp__computer_use__list_apps` 找到当前运行的开发窗口，通常是 `Electron`（打包版本可能是 `Aryn`）；再用 `mcp__computer_use__get_app_state` 读取截图和 accessibility tree；需要交互时优先用 element index 点击，操作后再次读取状态确认。
- 注意确认当前窗口对应的是最新代码/HMR 状态；不要只凭截图判断，尽量同时核对 accessibility tree。
