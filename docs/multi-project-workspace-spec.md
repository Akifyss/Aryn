# 支持多项目工作目录功能说明

## 目标

Aryn 需要从“只能打开一个工作目录”升级为“应用级项目库 + 当前工作上下文”。一个项目对应一个本地文件夹；项目列表由 Aryn 应用级维护，不跟随单个窗口生命周期。

当前工作上下文由 `activeContext` 表示：它可以是某个项目、某条普通对话，或尚未分配目录的普通对话草稿。文件树、Git 面板、编辑器、Agent 面板都必须从 `activeContext` 推导当前工作目录，不能只依赖最近项目。

用户可以：

- 在 Agent 布局左侧栏看到应用级项目列表。
- 新建空白项目，Aryn 在系统 Documents 目录下创建对应文件夹。
- 使用已有本地文件夹加入项目列表。
- 在项目之间切换当前项目上下文。
- 在 Editor 布局顶部点击 `.section-title-text` 触发项目菜单，并通过该菜单切换当前项目上下文。

## 概念

- 项目：绑定一个本地文件夹，是文件树、Git 状态、编辑器和 Agent 工作目录的归属单位。
- 项目列表：应用级维护的项目集合，不跟随单个窗口生命周期。持久化到 Aryn 内部状态目录 `~/.aryn`。
- 当前项目上下文：`activeContext.kind = 'project'` 时当前应用正在使用的项目。`lastProjectId` 只记录最近一次项目上下文，用于从普通对话回到项目模式时恢复最近项目。
- session 文件：Agent 的对话文件。PI Agent 的 session JSONL 属于 Aryn 应用级 Agent 状态，存放在 `~/.aryn/agents/pi/sessions/<encoded-cwd>/*.jsonl`；其中 `<encoded-cwd>` 由“可读目录名 + 工作目录路径 identity hash”组成，避免不同路径因为字符替换产生碰撞。Agent 布局中的 session 树展示这些对话文件，并按项目归属组织到对应项目节点下。

## 本期范围

本期实现：

- 应用级项目列表维护。
- Agent 布局左侧栏项目区改版。
- 新建空白项目。
- 使用现有文件夹。
- 当前项目上下文切换。
- 项目操作：在资源管理器中打开、移除项目。
- Editor 布局顶部项目菜单。

## 项目数据

项目列表是应用级状态，保存到 Aryn 内部状态目录 `~/.aryn/app-state.json`。可以参考 Codex 使用 `~/.codex` 的方式，为 Aryn 维护 `~/.aryn`。

Agent backend 的全局数据使用实现命名空间保存，例如 PI backend 使用 `~/.aryn/agents/pi/`。后续新增其他 Agent 实现时，可以继续在 `~/.aryn/agents/<backend>/` 下扩展。

状态文件边界：

- `~/.aryn/app-state.json`：应用级核心状态，包括项目列表、当前工作上下文、最近项目、窗口尺寸、侧栏/面板布局、应用设置、一次性迁移标记。
- `~/.aryn/workspace-state.json`：随工作区和文件增长的 UI 状态，包括编辑器 tab 状态、MEO 文件视图状态。
- `~/.aryn/agents/pi/`：PI Agent backend 的全局数据。新增其他 Agent backend 时使用 `~/.aryn/agents/<backend>/`。

### 状态存储架构标准

Aryn 状态目录和 JSON 状态文件需要按同一套标准收口，避免路径、写入和损坏恢复策略散落在各模块里：

- 只有一个模块负责解析 Aryn 数据目录和子路径，例如 `~/.aryn`、`app-state.json`、`workspace-state.json`、`conversations/index.json`、`agents/pi/`。业务模块不能自己拼这些核心路径。
- 所有 JSON 状态文件统一走 `AtomicJsonStore<T>`：负责 `version`、schema normalize、atomic write、`.bak` backup、stale temp cleanup、corruption policy。
- 所有 JSON 状态文件都必须有明确损坏策略：优先恢复 `.bak`；如果主文件和 `.bak` 都不可解析，应暴露错误，不允许静默清空重要状态。
- `activeContext`、`lastProjectId`、`projects`、`conversations` 之间的关系必须有 invariant 测试覆盖。
- 文档描述必须和实现保持一致，尤其是 conversation index 损坏策略、普通对话工作目录和 PI Agent session JSONL 的物理位置。

当前实现状态：

- `aryn-paths` 负责解析 `~/.aryn` 及核心子路径，main 进程从该模块取得 app state、workspace state、conversation index 和 PI Agent 目录。
- `json-file-store` 提供 `AtomicJsonStore<T>`，统一处理 normalized read、queued update、atomic write、有效 `.bak`、stale temp cleanup、从 `.bak` 恢复并 best-effort 修复主文件。
- `app-state.json`、`workspace-state.json` 和 `conversations/index.json` 均按“恢复 `.bak`；不能恢复就报错”的策略处理，不再把损坏状态静默当作空状态。
- Aryn 自己维护的 session 附属 JSON，例如 `*.annotations.json`，也必须使用同一持久化能力；PI Agent 自身维护的 `auth.json`、`models.json` 等文件由 PI Agent 负责。
- 后续新增 JSON 状态文件时，必须复用 `AtomicJsonStore<T>`，不得重新实现一套 JSON 读写、backup 或 temp cleanup 逻辑。

`app-state.json`、`workspace-state.json` 和 `conversations/index.json` 都需要包含 schema version，并通过统一 JSON 持久化能力完成原子写入、备份恢复和 stale tmp 清理，避免崩溃或异常退出时写坏项目表、当前上下文、最近项目、布局、编辑器状态和普通对话索引。

首次引入多项目时，需要将现有已打开或已持久化的工作目录迁移为项目：

- 如果已有 `lastWorkspacePath` 或当前窗口已打开项目工作目录，将该路径加入项目列表，并设为 `lastProjectId`。
- `lastProjectId` 只表示“最近使用的项目上下文”，不能单独代表当前工作目录；当前工作目录必须从 `activeContext` 推导。
- 如果启动时没有可恢复的项目，或最后一个项目被移除，`lastProjectId` 可以为空，界面显示创建空白项目或使用现有文件夹的空状态。

建议项目状态结构：

```ts
type ProjectState = {
  lastProjectId: string | null
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
- `lastProjectId` 是应用级状态，和项目列表一起持久化，用于记住最近项目；当 `activeContext.kind = 'project'` 时它应与当前项目保持一致。
- 项目列表保持应用状态中的持久顺序；打开项目、激活项目或打开项目内 session 不改变项目列表顺序。
- 文件 watcher 只监听从 `activeContext` 推导出的当前工作目录。

## Agent 布局左侧栏

Agent 布局下，左侧栏不再使用顶部 `.section-title-text` 展示单个当前工作目录。左侧栏本身承担多项目导航，因此不再重复显示“当前工作区标题”。

左侧栏结构：

1. 顶部全局入口保持现有风格。
2. 项目 section：展示应用级项目列表。
3. 底部设置入口保持。

顶部全局“新对话”入口进入普通无项目对话草稿。项目内新对话由项目行上的新对话操作、项目 session 树或工作目录选择菜单触发。

项目 section：

- 标题为“项目”。
- 标题右侧有添加按钮，点击弹出菜单：
  - 新建空白项目
  - 使用现有文件夹
- 每个项目显示文件夹图标和项目名。
- 只展示路径当前存在的项目；项目路径不存在时，左侧栏本期暂不显示该项目。
- 项目列表继续使用目前 session 树的 `https://trees.software/` 实现，不替换树组件；只是把当前 session 树向上增加一层项目节点，形成“项目名 - session 文件名”的树结构。
- 当前项目上下文加载完整 Agent workspace；非当前项目只需要读取 session 文件列表用于树展示，不能因为读取列表而激活该项目的 Agent session。
- 非当前项目的 session 文件列表优先在展开项目节点时懒加载，避免启动时遍历所有项目对应的 `~/.aryn/agents/pi/sessions/<encoded-cwd>`。
- 点击项目行：展开或折叠该项目下的 session 文件树，不直接切换当前项目上下文。
- Agent 模式下，激活某个项目下的 session 文件时，该 session 文件所属项目需要同时成为当前项目上下文。
- 当前项目上下文不需要高亮项目行。

项目行 hover/选中时展示操作：

- “更多”菜单：
  - 在系统文件管理器中打开（Windows 为资源管理器，macOS 为访达）
  - 移除
- 在 {$项目} 中开启新对话：创建新对话时，该项目需要同时成为当前项目上下文。

“移除项目”只从 Aryn 的项目列表移除，不删除本地文件夹。移除当前项目上下文时，切换到列表中下一个可用项目；如果没有项目，则回到普通对话草稿或创建/打开项目的空状态。

## Editor 布局顶部项目菜单

Editor 布局保留现有 `.section-title-text` 位置。用户点击 `.section-title-text` 后，不再直接打开文件夹选择器，而是打开项目切换菜单。

菜单内容：

- 顶部搜索框：按项目名和路径搜索。
- 项目列表：显示应用级项目列表，当前项目上下文带勾或高亮。
- 底部操作：
  - 新建空白项目
  - 使用现有文件夹

选择项目后：

- 该项目成为当前项目上下文。
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
5. 创建成功后加入应用级项目列表，并设为当前项目上下文。

建议默认目录：

`<Documents>/<project-name>`

## 使用现有文件夹

入口同“新建空白项目”。

流程：

1. 打开系统文件夹选择器。
2. 用户选择文件夹后，将该路径加入应用级项目列表。
3. 如果该路径已存在于项目列表，则只切换为当前项目上下文。
4. 加入成功后加载文件树和 Git 状态。

## 切换当前项目上下文

触发当前项目上下文切换的入口包括：

- Agent 模式下激活某个项目下的 session 文件。
- Agent 布局中执行“在 {$项目} 中开启新对话”。
- Editor 布局顶部项目菜单中选择项目。

Agent 布局中点击项目行只用于展开或折叠该项目下的 session 文件树，不触发当前项目上下文切换。

切换当前项目上下文时需要处理：

- flush 当前项目的自动保存。
- 保存当前项目 last file。
- 停止旧当前项目的 watcher。
- 加载新项目文件树和 Git 状态。
- 恢复新项目编辑器 tab 或 last file。
- 更新项目 `lastOpenedAt`，仅用于恢复信息，不用于项目列表排序。

## 交互边界

- 项目被移除时，如果该项目有未保存 editor/diff tab，需要先执行现有未保存确认逻辑。
- 项目路径不存在时，左侧栏本期暂不显示该项目；异常标记、重新选择文件夹等边缘情况后续再处理。
- 使用现有文件夹加入项目时，不自动创建文件或初始化 Git。
- 新建空白项目只创建文件夹，不自动创建首个文档。
- 移除项目不删除本地文件夹。

## 下一阶段：无项目对话

本阶段要补齐“不要求用户主动选定文件夹”的普通对话能力。它参考 Codex 的“列表索引”和“工作目录产物”分离思路，但不一比一复刻 Codex 的归档、完整事件协议等外围设计；实现上应优先贴合 Aryn 当前的多项目模型、`~/.aryn` 状态目录和 PI Agent 集成方式。

### 目标

用户可以直接开始一条普通对话，而不需要先新建项目、选择已有文件夹或把某个目录加入项目列表。

普通对话仍然必须有工作目录。区别是这个目录由 Aryn 在需要时自动创建，作为该对话的产物目录；它不是用户显式加入的项目，也不应该自动出现在“项目”列表里。

本阶段需要支持：

- 左侧栏在“项目”区块下方展示“对话”区块。
- 用户可以从“对话”区块创建普通新对话。
- 普通新对话页面不显示项目名，不要求用户先选择工作目录。
- 如果用户直接发送消息，Aryn 自动创建对话工作目录。
- 如果用户在发送前主动选择工作目录，则进入项目/工作目录绑定的对话流程，不再创建普通无项目对话。
- 普通对话列表从轻量索引读取，不通过扫描所有工作目录或所有对话全文生成。
- 顶部全局“新对话”入口进入普通无项目对话草稿；项目内新对话通过项目区块中的项目行操作或“选择工作目录”菜单完成。

### 和项目的关系

普通“对话”和“项目”需要明确分层：

- 项目：用户明确创建或加入的本地文件夹，持久化在 `~/.aryn/app-state.json` 的项目表中。
- 项目 session：属于某个项目目录的 Agent 会话，继续显示在项目树的项目节点下。
- 普通对话：不属于项目表，不占用 `ProjectRecord`，显示在独立“对话”区块中。
- 普通对话工作目录：Aryn 自动创建的产物目录，用于保存该对话生成的文件，但不自动加入项目列表。

因此，普通对话不能通过伪造项目来实现。否则会污染项目列表，也会让用户难以区分“我主动管理的项目”和“Aryn 为一次对话临时创建的工作目录”。

`lastProjectId` 表示最近一次项目上下文，不表示当前工作目录。引入普通对话后，当前工作目录只能由 `activeContext` 推导，避免把普通对话误写成项目上下文。

建议状态模型：

```ts
type ActiveWorkspaceContext =
  | { kind: 'project'; projectId: string }
  | { kind: 'conversation'; conversationId: string }
  | { kind: 'conversationDraft' }
```

规则：

- 当 `kind = 'project'` 时，文件树、Git、编辑器和 Agent 使用该项目路径。
- 当 `kind = 'conversation'` 时，文件树、Git、编辑器和 Agent 使用该对话的 `workspacePath`。
- 当 `kind = 'conversationDraft'` 时，尚未分配工作目录；文件树和 Git 可显示空态，Agent 输入框可直接输入。
- 切到普通对话不修改 `lastProjectId`；再次回到项目模式时，应恢复最近的项目。
- 切换项目不应该改变普通对话列表，只改变当前工作上下文。

### 存储设计

Codex 对 Aryn 的参考价值主要是“列表索引/对话身份”和“工作目录产物”分离。Aryn 不需要复刻 Codex 的完整对话事件存储协议，因为当前对话 JSONL 由 PI Agent 生成和读取；Aryn 需要维护的是普通对话的产品级索引、`activeContext` 和工作目录归属。

边界：

- 对话索引和对话身份保存在 `~/.aryn`。
- 对话产生的 Markdown、代码、图片、导出文件等产物保存在该对话的工作目录。
- 完整会话内容以 PI Agent session JSONL 为准，位于 `~/.aryn/agents/pi/sessions/<encoded-cwd>/` 下。
- `~/.aryn/agents/pi/` 是 PI backend 的应用级状态目录，包含 provider 凭据、模型配置、按工作目录分桶的 session JSONL。
- 标题、对话 ID、工作目录名彼此解耦；标题变化不重命名目录。

建议新增目录：

```text
~/.aryn/conversations/
  index.json

~/.aryn/agents/pi/
  auth.json
  models.json
  sessions/
    <encoded-cwd>/
      <pi-agent-session>.jsonl

<Documents>/Aryn/<YYYY-MM-DD>/<conversation-slug>/
  output.md
  image.png
  other generated files
```

说明：

- `~/.aryn/conversations/index.json` 是普通对话侧边栏列表的轻量索引，使用统一 JSON 持久化层完成原子写入、备份恢复和 stale tmp 清理。
- `index.json` 属于普通对话的核心索引，不是可丢弃缓存；如果主文件和 `.bak` 都不可解析，必须报错或进入显式修复流程，不能静默回退为空列表。
- 普通对话的 JSONL 仍由 PI Agent 生成，路径位于 `~/.aryn/agents/pi/sessions/<encoded-cwd>/*.jsonl`。Aryn 不另建第二套对话 JSONL，避免出现两个事实来源。
- `<encoded-cwd>` 需要稳定、可识别归属且不碰撞：建议采用工作目录 basename 作为可读前缀，再追加基于规范化工作目录路径的短 hash。不能只把 `/`、`\`、`:` 替换为 `-`，否则 `C:\a-b` 与 `C:\a\b` 这类路径会落入同一个 bucket。
- Aryn 的 `index.json` 只保存产品级列表和恢复所需的轻量元信息；其中的 `agentSessionPath` 指向 PI Agent 生成的 session JSONL。
- `<Documents>/Aryn/<YYYY-MM-DD>/<conversation-slug>/` 是普通对话的自动工作目录，只用于无项目对话；这不改变“新建空白项目”仍创建在 `<Documents>/<project-name>` 的规则。
- 工作目录中的产物文件是普通文件，不内嵌在索引或 PI Agent session JSONL 中。

建议索引结构：

```ts
type ConversationIndexState = {
  version: number
  conversations: ConversationRecord[]
}

type ConversationRecord = {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  status: 'draft' | 'active'
  workspacePath: string | null
  agentSessionPath: string | null
  lastMessagePreview: string | null
}
```

字段规则：

- `id` 是稳定主键，不能使用标题或目录名。
- `id` 是 Aryn 的普通对话 ID，不要求等于 PI Agent 的 session ID。
- `title` 可变，可先使用“新对话”，之后根据首轮内容、PI Agent session 名称或摘要结果更新；标题更新只改索引，不重命名工作目录。
- `status = 'draft'` 的记录不应显示在左侧“对话”列表；它只用于首次发送过程中的临时索引和失败清理。如果首轮发送失败且 PI Agent 没有写入有效消息，应删除或保持隐藏，避免空对话污染列表。
- `conversationDraft` 上下文不创建 `ConversationRecord`，因此没有 `workspacePath`；首次发送普通对话消息时才创建工作目录，并写入临时 draft `ConversationRecord.workspacePath`。
- `agentSessionPath` 指向 PI Agent 生成的 `.jsonl` session 文件，是恢复 Agent runtime 和读取对话内容的事实来源。
- `updatedAt` 用于左侧“对话”列表排序。

`activeContext` 可以继续保存在应用级 `~/.aryn/app-state.json` 中。重启恢复时，如果上次 context 是普通 `conversation` 且索引记录仍有效，则恢复该普通对话；如果上次 context 是 `conversationDraft`，只恢复为空白普通新对话，不创建目录或索引。

### 自动工作目录

普通对话的工作目录只在真正需要时创建，建议在用户首次发送消息时创建，而不是用户点击“新对话”时立刻创建。这样可以避免空白草稿污染文件系统和索引。

默认路径：

```text
<Documents>/Aryn/<YYYY-MM-DD>/<conversation-slug>
```

命名规则：

- `YYYY-MM-DD` 使用用户本地日期。
- `conversation-slug` 可来自首轮用户消息、生成标题或默认名。
- 文件夹名需要做非法字符清理。
- 如果重名，追加 `-2`、`-3` 等后缀。
- 标题后续变化不重命名工作目录。

普通对话工作目录不是项目目录：

- 不写入项目表。
- 不出现在“项目”区块。
- 可以在文件树中作为当前工作目录展示。
- 可以允许用户后续“在资源管理器中打开”该工作目录。
- 是否支持“将此对话工作目录加入项目”属于后续功能，本阶段不要求。

### 创建流程

进入普通新对话：

```text
1. 用户点击“对话”区块的新对话入口，或全局新对话入口进入无项目草稿。
2. 应用切换为 conversationDraft 上下文。
3. 不创建 index 记录，不创建工作目录，不创建空 session。
4. 展示普通新对话空态。
```

用户直接发送消息：

```text
1. 生成 conversationId。
2. 根据首轮消息或默认名生成工作目录 slug。
3. 创建 <Documents>/Aryn/<YYYY-MM-DD>/<slug>。
4. 写入或更新 ConversationRecord，初始 status 可为 draft。
5. 将当前上下文切换为 { kind: 'conversation', conversationId }，并把 workspacePath 传给 Agent。
6. 调用 PI Agent 创建 session；拿到 sessionPath 后写入 agentSessionPath。
7. 发送首轮消息。
8. 如果首轮消息成功进入 PI Agent session，将 status 改为 active，更新 title、lastMessagePreview、updatedAt。
9. 如果首轮消息失败且 session 没有有效消息，应删除该 draft 记录或保持隐藏。
```

实现注意：

- 当前 Agent composer 依赖 `workspacePath` 才能提交。`conversationDraft` 提交时必须先完成工作目录分配和 Agent workspace 初始化，再进入现有 `createAgentSession` / `sendAgentPrompt` 流程。
- 普通对话首次发送应使用 `restoreSession: false` 或等效逻辑，确保新建工作目录不会意外恢复旧 session。
- `conversationDraft` 虽然没有 `workspacePath`，仍应读取应用级 PI provider 和模型快照；模型选择、provider 设置入口和 provider 设置页不能因为尚未分配工作目录而失效。
- provider 凭据写入 `~/.aryn/agents/pi/`，不应为了配置 provider 提前创建普通对话工作目录或伪造项目。
- PI Agent session JSONL 仍由 `createAgentSession` / `sendAgentPrompt` 写入，Aryn 只在成功创建或更新 session 后同步 `agentSessionPath` 和索引字段。
- 新 session 一律写入 `~/.aryn/agents/pi/sessions/<encoded-cwd>/`。旧版工作目录内 `.pi/sessions/` 以及早期无 hash 的 app-level encoded bucket 可作为兼容读取来源，但不再作为新 session 的写入位置。

用户发送前点击“选择工作目录”：

```text
1. 打开工作目录选择菜单。
2. 菜单可复用当前项目表作为主要选择来源。
3. 选择某个项目后，切换到该项目并创建项目内新 session。
4. 使用现有文件夹时，按当前项目逻辑加入项目表并切换为项目上下文。
5. 当前处于项目上下文时，菜单底部提供“不使用项目”；点击后回到 `conversationDraft`，允许用户直接发送消息并按普通对话流程自动创建工作目录。当前已经是普通对话或普通对话草稿时不显示该选项。
6. 这种路径不创建普通 ConversationRecord。
```

这样可以保持模型简单：普通对话只代表“不主动选择工作目录”的路径；只要用户主动选择了目录，就回到项目/工作目录绑定逻辑。

如果用户从普通对话草稿切到某个项目新 session，原 `conversationDraft` 不应写入索引，也不应创建 `<Documents>/Aryn/...` 工作目录。

### 重新打开普通对话

点击“对话”区块中的历史对话时：

```text
1. 根据 conversationId 从 index 中找到 ConversationRecord。
2. 切换当前上下文为 conversation。
3. 使用 workspacePath 加载文件树、Git 状态和编辑器 tab。
4. 使用 agentSessionPath 恢复 PI Agent 会话。
5. 如果 workspacePath 不存在，仍允许打开对话，但文件树显示目录缺失状态。
```

边界：

- `workspacePath` 缺失：对话仍显示；产物文件不可用；允许后续补充“重新关联目录”能力。
- `agentSessionPath` 缺失或不可读：对话列表仍可显示；打开时展示恢复失败提示。
- `index.json` 损坏：优先从 `.bak` 恢复；如果主文件和备份都不可解析，不应静默清空列表，应暴露错误或进入后续修复流程，避免把索引损坏误表现为“没有对话”。
- PI Agent session JSONL 某行损坏：由 Agent session 读取层尽量容错；UI 不应因为单条损坏记录导致整个应用启动失败。

### 左侧栏 UI

Agent 布局左侧栏结构扩展为：

```text
顶部全局入口
置顶
项目
对话
底部设置
```

“对话”区块位于“项目”区块下方。

对话区块规则：

- 标题为“对话”。
- 展示普通对话列表，不展示项目 session。
- 按 `updatedAt` 倒序排列。
- 每行展示标题和相对更新时间。
- 行样式尽量与项目 session 行保持一致。
- 对话 section 标题右侧提供“新对话”操作；图标使用 `mingcute` 的 `edit_line`，并保留快捷键提示 `Ctrl+Alt+N`。
- 对话行 hover 操作本阶段可以只保留打开行为；删除、重命名、归档后续单独设计。
- 点击普通对话行，打开该对话并切换到 conversation 上下文。

项目区块和对话区块的边界：

- 项目下的 session 只在项目树中展示。
- 普通对话只在“对话”区块展示。
- 普通对话不会嵌套到项目树下。
- 项目树展开、折叠、懒加载 session 的逻辑不应影响普通对话列表。

### 新对话空态和输入框

普通新对话页面的空态文案：

```text
今天要处理些什么？
```

这里不显示 `agent-project-switch-trigger`，也不拼接项目名。

输入框下方的工作目录触发器仍使用现有 `agent-project-switch-trigger` 样式，但在普通对话草稿中显示 placeholder：

```text
选择工作目录
```

交互规则：

- placeholder 只表示“可选选择”，不是发送前必填项。
- 用户不选择工作目录也可以直接发送消息。
- 如果用户不选择，首次发送时自动创建普通对话工作目录。
- 如果用户选择项目或已有文件夹，则进入项目上下文的新 session 流程。
- 已创建的普通对话再次打开时，触发器可显示该对话工作目录名；是否允许中途切换工作目录本阶段不要求，避免破坏对话产物归属。
- 顶部全局“新对话”和对话 section 的“新对话”都进入这个普通草稿空态。

### 文件树、Git 和编辑器

普通对话一旦拥有 `workspacePath`，文件树、Git 面板和编辑器应使用该路径作为当前工作目录。

规则：

- draft 阶段没有工作目录时，文件树和 Git 面板显示空态或不可用状态。
- 首次发送并创建工作目录后，启动 watcher，加载文件树和 Git 状态。
- 普通对话的编辑器 tab 状态应按 `workspacePath` 复用现有 `workspace-state.json` 设计。
- 切换到其他项目或对话前，仍需要执行现有的未保存确认和 autosave flush。
- 生成文件写入该对话工作目录；如果用户明确指定绝对路径，则按现有工具能力处理，但不要把外部文件误认为普通对话产物。

### 不做的内容

本阶段不要求实现：

- 归档对话。
- 删除对话时同时删除产物目录。
- 对话工作目录改名。
- 将普通对话转换为项目。
- 跨设备同步。
- 全文搜索所有 PI Agent session JSONL。
- 扫描 `<Documents>/Aryn` 来反推对话列表。

这些能力可以后续单独设计，不能影响本阶段的最小稳定模型。

### 验收点

- 没有项目时，用户也能进入普通新对话并直接发送消息。
- 普通新对话空态显示“今天要处理些什么？”，标题中没有项目触发器。
- 输入框下方触发器显示“选择工作目录”。
- 直接发送消息会自动创建 `<Documents>/Aryn/<YYYY-MM-DD>/<slug>` 工作目录。
- `conversationDraft` 直接发送时不会因为 `workspacePath` 为空被 composer 提前 return；提交前必须先分配自动工作目录。
- `conversationDraft` 在尚未创建工作目录时仍可读取已有 provider 和模型、切换模型、打开 provider 设置并更新凭据。
- PI Agent session JSONL 位于 `~/.aryn/agents/pi/sessions/<encoded-cwd>/`，工作目录只保存产物文件。
- 自动创建的普通对话不会出现在项目列表。
- 普通对话会出现在“对话”区块，按更新时间排序。
- 点击普通对话可以恢复对应 Agent 会话和工作目录。
- 切换普通对话不会覆盖 `lastProjectId`。
- 选择项目后会进入项目新 session，而不是创建普通 ConversationRecord。
- 项目区块的 session 树逻辑和普通对话列表互不污染。
