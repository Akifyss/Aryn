# 支持多项目工作目录功能说明

## 目标

Aryn 需要从“单一工作目录”升级为“同一窗口可维护多个项目”。一个项目对应一个本地文件夹；同一时间只有一个 active 项目承载文件树、Git、编辑器和 Agent 运行上下文。

用户可以：

- 在 Agent 布局左侧栏同时看到多个项目。
- 为任意项目开始新对话，或打开该项目下已有对话。
- 在 Editor 布局顶部点击 `.section-title-text` 触发项目菜单，并通过该菜单切换 active 项目。
- 新建空白项目时先命名，Aryn 自动在系统 Documents 目录下创建对应文件夹。
- 使用已有本地文件夹加入项目列表。

## 概念

- 项目：绑定一个本地文件夹，是文件树、Git 状态、Agent session 的归属单位。
- 对话/session：归属于某个项目。一个项目可以有多个 session。
- active 项目：当前正在被编辑器、文件树、Git 面板和 Agent 面板使用的项目。
- 项目列表：当前窗口已加入的项目集合，不等于 active 项目。切换 active 项目不代表关闭其他项目。

## 本期范围

本期实现：

- 多项目数据维护。
- Agent 布局左侧栏项目区改版。
- 新建空白项目。
- 使用现有文件夹。
- active 项目切换。
- 项目操作：置顶项目、在资源管理器中打开、移除项目。
- Editor 布局顶部项目菜单。


## Agent 布局左侧栏

Agent 布局下，左侧栏不再使用顶部 `.section-title-text` 展示单个当前工作目录。左侧栏本身承担多项目导航，因此只保留必要的窗口/侧栏控制，不再重复显示“当前工作区标题”。

左侧栏结构：

1. 顶部全局入口：新对话保留，点击后会到当前 active 的Agent 新对话界面。
2. 项目 section：展示多个项目。
3. 对话 section：保留用于非项目/兼容历史对话入口；新功能下，主要对话入口应在项目树下呈现。
4. 底部设置入口保持。

项目 section：

- 标题为“项目”。
- 标题右侧有添加按钮，点击弹出菜单：
  - 新建空白项目
  - 使用现有文件夹
- 每个项目显示文件夹图标和项目名。
- 项目可展开，展开后显示该项目下的 session 列表。
- 项目下没有 session 时显示“暂无对话”。
- 点击项目行：将该项目设为 active 项目，并让 Agent 面板进入“新对话”状态。
- 点击项目下 session：将该项目设为 active 项目，并打开对应 session。
- 当前 active 项目需要高亮；当前 active session 需要在其项目下高亮。

项目行 hover/选中时展示操作：

- “新对话”图标：在该项目中进入新对话状态。
- “更多”菜单：
  - 置顶项目
  - 在资源管理器中打开
  - 移除

“移除项目”只从 Aryn 的项目列表移除，不删除本地文件夹。移除 active 项目时，切换到列表中下一个可用项目；如果没有项目，则 active 项目为空，并显示需要创建/打开项目的空状态。

## Editor 布局顶部项目菜单

Editor 布局保留现有 `.section-title-text` 位置。用户点击 `.section-title-text` 后，不再直接打开文件夹选择器，而是打开项目切换菜单。

菜单内容：

- 顶部搜索框：按项目名和路径搜索。
- This Window：显示当前窗口已加入的项目，active 项目带勾。
- Recent Projects：显示历史使用过但不一定在当前窗口中的项目。
- 底部操作：
  - 新建空白项目
  - 打开本地文件夹

选择项目后：

- 该项目成为 active 项目。
- 文件树、Git 面板、编辑器 tab、Agent 运行上下文切换到该项目。
- Agent 面板默认进入该项目的新对话状态。
- 用户仍可从 Agent 左侧项目树打开该项目下的历史 session。

## 新建空白项目

入口：

- Agent 布局项目 section 添加菜单。
- Editor 布局顶部项目菜单底部操作。
- 没有 active 项目时点击“新对话”。

流程：

1. 弹出“为项目命名” modal。
2. 用户输入项目名并保存。
3. 主进程在系统 Documents 目录下创建项目文件夹。
4. 文件夹名来自项目名，需要做非法字符清理和重名后缀处理。
5. 创建成功后加入项目列表，设为 active 项目，Agent 面板进入新对话状态。

建议默认目录：

`<Documents>/Aryn Projects/<project-name>`

如果后续要调整目录策略，只需要改主进程的空白项目创建逻辑，不影响前端交互。

## 使用现有文件夹

入口同“新建空白项目”。

流程：

1. 打开系统文件夹选择器。
2. 用户选择文件夹后，将该路径加入项目列表。
3. 如果该路径已存在于项目列表，则只切换为 active 项目。
4. 加入成功后加载文件树、Git 状态和 Agent session 列表。

## 状态与数据

现有实现主要围绕单个 `currentPath`：

- `useWorkspaceStore.currentPath`
- `App.tsx` 内 `connectWorkspace(nextPath)`
- `workspace:start-watch` / `workspace:stop-watch`
- `AgentProvider workspacePath={currentPath}`
- `AgentSidebar` 根据 `workspacePath` 加载 session
- `app-state.ts` 只记录 `lastWorkspacePath` 和每个 workspace 的 last file/session

需要扩展为“项目集合 + active 项目”：

```ts
type ProjectRecord = {
  id: string
  name: string
  path: string
  pinned: boolean
  addedAt: string
  lastOpenedAt: string
  lastFilePath: string | null
  lastAgentSessionPath: string | null
}
```

建议：

- `id` 可先使用规范化后的绝对路径。
- active 项目持久化为 `activeProjectId` 或 `lastWorkspacePath` 的升级字段。
- 项目排序：置顶项目优先，之后按最近打开时间排序。
- session 数据仍以项目路径为边界，由现有 Pi Agent session 机制读取。
- 文件 watcher 本期只需要监听 active 项目；非 active 项目只展示项目名和 session 摘要，不需要监听文件树变化。

切换 active 项目时需要处理：

- flush 当前项目的自动保存。
- 保存当前项目 last file/session。
- 停止旧 active 项目的 watcher。
- 加载新项目文件树和 Git 状态。
- 恢复新项目编辑器 tab 或 last file。
- 加载新项目 Agent workspace state。
- 默认设置 Agent 为新对话状态，除非切换动作明确来自某个 session。

## 交互边界

- 项目被移除时，如果该项目有未保存 editor/diff tab，需要先执行现有未保存确认逻辑。
- 项目路径不存在时，应在列表中标记异常，并在点击时提示用户移除或重新选择文件夹。
- 使用现有文件夹加入项目时，不自动创建文件或初始化 Git。
- 新建空白项目只创建文件夹，不自动创建首个文档。
- “新对话”属于 active 项目；如果没有 active 项目，先走新建空白项目流程。

## 验收标准

- Agent 布局左侧栏能同时展示多个项目，且项目下能展示各自 session。
- 点击项目会切换 active 项目，并让 Agent 面板进入新对话状态。
- 点击项目下 session 会切换 active 项目并打开该 session。
- Editor 布局点击顶部项目名会打开项目菜单，而不是直接打开文件夹选择器。
- 在项目菜单选择项目后，文件树、Git、编辑器和 Agent 都切到对应项目。
- 新建空白项目会在 Documents 下创建文件夹，并加入项目列表。
- 使用现有文件夹不会重复添加同一路径。
- 置顶项目影响排序并持久化。
- 在资源管理器中打开会打开项目绑定的本地文件夹。
- 移除项目不会删除本地文件夹。

## 建议验证

- 运行 TypeScript 类型检查。
- 运行已有单元测试。
- 手动验证 Editor 布局和 Agent 布局下的项目切换。
- 如涉及真实 Electron IPC、文件夹创建、资源管理器打开，使用 `debug:electron` 流程验证主进程、preload、renderer 行为。
