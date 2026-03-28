# 项目需求

- 做一个 AI 写作 Agent 桌面端应用，面向需要在本地桌面环境中进行长文写作、改写、续写和 AI 辅助创作的场景。
- 支持打开本地的文件夹，比较类似obsidian / VScode
- Git集成， 将部分Git 命令 集成为GUI

# 技术栈

- 使用 [PI Agent](https://github.com/badlogic/pi-mono) 作为 AI 处理后端
- 前期使用 HeroUI 提升开发效率，后期逐步迁移为基于 Base UI 的自定义组件
- 使用 Tailwind CSS 作为 CSS 框架
- 使用 [Tiptap](https://github.com/ueberdosis/tiptap) 作为富文本编辑器
- Electron
- React
- TypeScript
- vite/electron-vite
- HeroUI
- Base UI
- Zustand
- chokidar

## 参考项目

- [scratch](https://github.com/erictli/scratch)：极简、离线优先的桌面端 Markdown 笔记应用，可作为本地文件夹操作和基础编辑器的参考。
- [1code](https://github.com/21st-dev/1code)：AI 编码 Agent 的可视化编排层，核心特点是支持多 Agent 并行执行和 Git 工作树隔离（Git worktree isolation）。
- [openchamber](https://github.com/openchamber/openchamber)：OpenCode AI Agent 的桌面界面，支持对话时间线分叉（branchable timeline）和 GitHub 深度集成。
- [craft-agents-oss](https://github.com/lukilabs/craft-agents-oss)：Craft Agents 的开源核心，采用 Agent-Native 架构，且底层同样基于 Pi SDK，对于多任务并行和流式 UI 具有高度参考价值。

### 参考启示

- 将 workspace 作为核心模型，而不只是文件打开能力
- 需要支持文件树、外部文件变更检测和本地优先的数据流
- 采用 `main / preload / renderer / shared` 的分层结构
- 提前预留 session、task、diff 和 Git 集成能力
- 前期用 HeroUI 提升效率，后期将核心业务组件迁移为基于 Base UI 的自定义组件

## 架构建议

### 桌面层

- 使用 Electron 作为桌面应用容器
- 主进程负责本地能力调度、窗口管理、文件系统访问和 AI 能力接入
- 渲染进程负责编辑器、会话界面、写作工作流和交互体验
- 通过 `preload + contextBridge + IPC` 暴露受控能力，避免在渲染进程直接开放 Node 能力

### 前端层

- 使用 React + TypeScript 构建界面
- 使用 vite/electron-vite 作为构建工具
- 前期使用 HeroUI 构建通用界面组件
- 核心业务组件后期逐步迁移为基于 Base UI 的自定义组件
- 使用 Tailwind CSS 负责样式系统
- 使用 Tiptap 作为核心富文本编辑器
- 使用 Zustand 管理前端状态，例如当前文档、会话状态、编辑器工具栏状态和任务执行状态

### 数据层

- 第一阶段优先基于本地文件系统保存内容
- 如后续需要存储工作区元数据、会话记录、提示词模板和用户设置，再引入 better-sqlite3
- 对于编辑器内容，优先保存结构化内容和必要的导出格式

### AI 能力层

- 第一阶段直接在 Electron 主进程中封装 PI Agent 能力
- 如果后续复杂度上升，再考虑将 AI 能力拆分为本地独立服务
- Agent 相关任务建议统一经过主进程调度，避免渲染进程直接承担长任务和敏感调用

## 第一阶段目标

第一阶段先完成一个最小可用版本，至少包括：

- 支持打开和切换本地文件夹
- 支持展示文件树
- 支持读取、编辑和保存文件
- 左侧文档导航区
- 中间写作编辑区
- 右侧 AI 对话面板
- 支持本地保存和恢复文档
- 支持基础的 Agent 任务状态反馈
