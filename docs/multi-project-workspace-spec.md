# 支持多项目工作目录功能说明

## 目标

Aryn 需要从“只能打开一个工作目录”升级为“应用级项目库 + 当前 active 项目”。一个项目对应一个本地文件夹；项目列表和当前 active 项目由 Aryn 应用级维护，不跟随单个窗口生命周期。

同一时间只有一个 active 项目。文件树、Git 面板、编辑器、Agent 面板都使用这个 active 项目的本地文件夹作为工作目录。

用户可以：

- 在 Agent 布局左侧栏看到应用级项目列表。
- 新建空白项目，Aryn 在系统 Documents 目录下创建对应文件夹。
- 使用已有本地文件夹加入项目列表。
- 在项目之间切换 active 项目。
- 在 Editor 布局顶部点击 `.section-title-text` 触发项目菜单，并通过该菜单切换 active 项目。

## 概念

- 项目：绑定一个本地文件夹，是文件树、Git 状态、编辑器和 Agent 工作目录的归属单位。
- 项目列表：应用级维护的项目集合，不跟随单个窗口生命周期。持久化到 Aryn 内部状态目录 `~/.aryn`。
- active 项目：当前应用正在使用的项目。同一时间只有一个 active 项目，应用重启后需要恢复上次 active 项目。
- session 文件：Agent 的对话文件。session 文件归属于保存它的项目目录，当前实现从项目目录下的 `.pi/sessions/*.jsonl` 读取对话文件。Agent 布局中的 session 树展示这些对话文件，并按项目归属组织到对应项目节点下。

## 本期范围

本期实现：

- 应用级项目列表维护。
- Agent 布局左侧栏项目区改版。
- 新建空白项目。
- 使用现有文件夹。
- active 项目切换。
- 项目操作：在资源管理器中打开、移除项目。
- Editor 布局顶部项目菜单。

## 项目数据

项目列表是应用级状态，保存到 Aryn 内部状态目录 `~/.aryn/app-state.json`。可以参考 Codex 使用 `~/.codex` 的方式，为 Aryn 维护 `~/.aryn`。

Agent backend 的全局数据使用实现命名空间保存，例如 PI backend 使用 `~/.aryn/agents/pi/`。后续新增其他 Agent 实现时，可以继续在 `~/.aryn/agents/<backend>/` 下扩展。

状态文件边界：

- `~/.aryn/app-state.json`：应用级核心状态，包括项目列表、active 项目、窗口尺寸、侧栏/面板布局、应用设置、一次性迁移标记。
- `~/.aryn/workspace-state.json`：随工作区和文件增长的 UI 状态，包括编辑器 tab 状态、MEO 文件视图状态。
- `~/.aryn/agents/pi/`：PI Agent backend 的全局数据。新增其他 Agent backend 时使用 `~/.aryn/agents/<backend>/`。

`app-state.json` 和 `workspace-state.json` 需要包含 schema version，并使用原子写入，避免崩溃或异常退出时写坏项目表、active 项目、布局和编辑器状态。

首次引入多项目时，需要将现有已打开或已持久化的工作目录迁移为项目：

- 如果已有 `lastWorkspacePath` 或当前窗口已打开工作目录，将该路径加入项目列表，并设为 `activeProjectId`。
- 只要存在可用项目，应用正常运行态必须有一个有效 active 项目。
- 如果启动时没有可恢复的项目，或最后一个项目被移除，`activeProjectId` 可以为空，界面显示创建空白项目或使用现有文件夹的空状态。

建议项目状态结构：

```ts
type ProjectState = {
  activeProjectId: string | null
  projects: ProjectRecord[]
}

type ProjectRecord = {
  id: string
  name: string
  path: string
  addedAt: string
  lastOpenedAt: string
  lastFilePath: string | null
}
```

建议规则：

- `id` 可先使用规范化后的绝对路径。
- `path` 是项目绑定的本地文件夹。
- `name` 默认取文件夹名；新建空白项目时使用用户输入的项目名。
- `activeProjectId` 是应用级状态，和项目列表一起持久化，应用重启后用它恢复上次 active 项目。
- 项目列表保持应用状态中的持久顺序；打开项目、激活项目或打开项目内 session 不改变项目列表顺序。
- 文件 watcher 本期只需要监听 active 项目。

## Agent 布局左侧栏

Agent 布局下，左侧栏不再使用顶部 `.section-title-text` 展示单个当前工作目录。左侧栏本身承担多项目导航，因此不再重复显示“当前工作区标题”。

左侧栏结构：

1. 顶部全局入口保持现有风格。
2. 项目 section：展示应用级项目列表。
3. 底部设置入口保持。

顶部全局“新对话”入口默认在当前 active 项目中创建新对话。

项目 section：

- 标题为“项目”。
- 标题右侧有添加按钮，点击弹出菜单：
  - 新建空白项目
  - 使用现有文件夹
- 每个项目显示文件夹图标和项目名。
- 只展示路径当前存在的项目；项目路径不存在时，左侧栏本期暂不显示该项目。
- 项目列表继续使用目前 session 树的 `https://trees.software/` 实现，不替换树组件；只是把当前 session 树向上增加一层项目节点，形成“项目名 - session 文件名”的树结构。
- active 项目加载完整 Agent workspace；非 active 项目只需要读取 session 文件列表用于树展示，不能因为读取列表而激活该项目的 Agent session。
- 非 active 项目的 session 文件列表优先在展开项目节点时懒加载，避免启动时遍历所有项目的 `.pi/sessions`。
- 点击项目行：展开或折叠该项目下的 session 文件树，不直接切换 active 项目。
- Agent 模式下，激活某个项目下的 session 文件时，该 session 文件所属项目需要同时成为 active 项目。
- active 项目不需要高亮项目行。

项目行 hover/选中时展示操作：

- “更多”菜单：
  - 在系统文件管理器中打开（Windows 为资源管理器，macOS 为访达）
  - 移除
- 在 {$项目} 中开启新对话：创建新对话时，该项目需要同时成为 active 项目。

“移除项目”只从 Aryn 的项目列表移除，不删除本地文件夹。移除 active 项目时，切换到列表中下一个可用项目；如果没有项目，则 active 项目为空，并显示创建/打开项目的空状态。

## Editor 布局顶部项目菜单

Editor 布局保留现有 `.section-title-text` 位置。用户点击 `.section-title-text` 后，不再直接打开文件夹选择器，而是打开项目切换菜单。

菜单内容：

- 顶部搜索框：按项目名和路径搜索。
- 项目列表：显示应用级项目列表，当前 active 项目带勾或高亮。
- 底部操作：
  - 新建空白项目
  - 使用现有文件夹

选择项目后：

- 该项目成为 active 项目。
- 文件树、Git 面板、编辑器 tab 和 Agent 面板都切换到该项目。

## 新建空白项目

入口：

- Agent 布局项目 section 添加菜单。
- Editor 布局顶部项目菜单底部操作。

流程：

1. 弹出“为项目命名” modal。
2. 用户输入项目名并保存。
3. 主进程在系统 Documents 目录下创建项目文件夹。
4. 文件夹名来自项目名，需要做非法字符清理和重名后缀处理。
5. 创建成功后加入应用级项目列表，并设为 active 项目。

建议默认目录：

`<Documents>/<project-name>`

## 使用现有文件夹

入口同“新建空白项目”。

流程：

1. 打开系统文件夹选择器。
2. 用户选择文件夹后，将该路径加入应用级项目列表。
3. 如果该路径已存在于项目列表，则只切换为 active 项目。
4. 加入成功后加载文件树和 Git 状态。

## 切换 active 项目

触发 active 项目切换的入口包括：

- Agent 模式下激活某个项目下的 session 文件。
- Agent 布局中执行“在 {$项目} 中开启新对话”。
- Editor 布局顶部项目菜单中选择项目。

Agent 布局中点击项目行只用于展开或折叠该项目下的 session 文件树，不触发 active 项目切换。

切换 active 项目时需要处理：

- flush 当前项目的自动保存。
- 保存当前项目 last file。
- 停止旧 active 项目的 watcher。
- 加载新项目文件树和 Git 状态。
- 恢复新项目编辑器 tab 或 last file。
- 更新项目 `lastOpenedAt`，仅用于恢复信息，不用于项目列表排序。

## 交互边界

- 项目被移除时，如果该项目有未保存 editor/diff tab，需要先执行现有未保存确认逻辑。
- 项目路径不存在时，左侧栏本期暂不显示该项目；异常标记、重新选择文件夹等边缘情况后续再处理。
- 使用现有文件夹加入项目时，不自动创建文件或初始化 Git。
- 新建空白项目只创建文件夹，不自动创建首个文档。
- 移除项目不删除本地文件夹。
