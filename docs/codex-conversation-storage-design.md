# Codex “对话”存储逻辑设计参考

版本：v0.1  
范围：只讨论 Codex 左侧“对话”分组中的普通会话，区别于绑定项目目录的“项目”会话。  
依据：基于本机 Codex Desktop 的文件结构观察整理，不视为官方稳定协议。

## 1. 核心结论

Codex 将“对话记录”和“对话产物文件”分开存储。

对话记录存放在应用状态目录下，主要是追加式 JSONL 事件文件。产物文件存放在该对话绑定的工作目录下，表现为普通文件系统文件，例如 Markdown、代码、图片、表格、导出文件等。

这意味着：

- 对话文件不是一个“包含所有内容的项目包”。
- 对话全文、工具调用、上下文信息在 `.codex\sessions` 中。
- 对话生成的文件在 `Documents\Codex\<日期>\<会话目录>` 中。
- 侧边栏列表通常依赖轻量索引，不需要每次扫描完整对话文件。

## 2. 术语

`对话`：未绑定某个用户项目目录的独立线程，显示在左侧“对话”分组下。

`项目`：绑定到用户已有工作区或项目目录的线程，显示在左侧“项目”分组下。

`会话 ID`：每条对话的稳定唯一 ID，类似 `019e654b-fb1b-7b10-ba0c-c5187905ead4`。

`对话事件文件`：一条对话对应的 JSONL 文件，一行一个事件。

`对话索引`：用于侧边栏快速展示的轻量索引，保存标题、更新时间、ID 等。

`工作目录`：该对话执行命令、读写文件、生成产物时使用的目录。

`产物文件`：模型或工具在工作目录中创建、修改、导出的普通文件。

## 3. 本机观察到的目录结构

应用状态目录：

```text
C:\Users\<user>\.codex
```

普通对话的事件文件：

```text
C:\Users\<user>\.codex\sessions\<YYYY>\<MM>\<DD>\rollout-<local-start-time>-<conversation-id>.jsonl
```

示例：

```text
C:\Users\25672\.codex\sessions\2026\05\27\
  rollout-2026-05-27T01-18-58-019e654b-fb1b-7b10-ba0c-c5187905ead4.jsonl
```

侧边栏索引：

```text
C:\Users\<user>\.codex\session_index.jsonl
```

归档对话：

```text
C:\Users\<user>\.codex\archived_sessions
```

普通对话的工作目录：

```text
C:\Users\<user>\Documents\Codex\<YYYY-MM-DD>\<conversation-slug>
```

示例：

```text
C:\Users\25672\Documents\Codex\2026-05-27\codex
```

## 4. 对话事件文件

对话事件文件采用 JSONL 格式：每一行是一个 JSON 对象。典型结构如下：

```json
{
  "timestamp": "2026-05-26T17:19:00.269Z",
  "type": "session_meta",
  "payload": {}
}
```

观察到的事件外层字段：

```text
timestamp
type
payload
```

观察到的事件类型包括：

```text
session_meta
turn_context
event_msg
response_item
```

### 4.1 session_meta

`session_meta` 是会话级元信息，通常出现在文件开头。它保存会话 ID、初始工作目录、来源、模型提供方等信息。

示意：

```json
{
  "type": "session_meta",
  "payload": {
    "id": "019e654b-fb1b-7b10-ba0c-c5187905ead4",
    "timestamp": "2026-05-26T17:18:58.843Z",
    "cwd": "C:\\Users\\25672\\Documents\\Codex\\2026-05-27\\codex",
    "originator": "Codex Desktop",
    "source": "vscode",
    "thread_source": "user",
    "model_provider": "openai"
  }
}
```

关键点：

- `payload.id` 是会话 ID。
- `payload.cwd` 是该对话的工作目录。
- 文件名中的时间更接近本地时间；事件内 `timestamp` 是 UTC 时间。

### 4.2 turn_context

`turn_context` 是每轮对话的上下文快照，包含本轮工作目录、日期、时区、模型、权限策略等。

示意：

```json
{
  "type": "turn_context",
  "payload": {
    "turn_id": "019e654c-00a9-7eb1-a2e5-8cba665f5a4e",
    "cwd": "C:\\Users\\25672\\Documents\\Codex\\2026-05-27\\codex",
    "current_date": "2026-05-27",
    "timezone": "Asia/Shanghai",
    "model": "gpt-5.5"
  }
}
```

关键点：

- 每轮都可以记录 `cwd`，所以工作目录变化可以被追踪。
- 恢复对话时，应优先使用最近一次有效 `turn_context.cwd`，没有时回退到 `session_meta.cwd`。

### 4.3 event_msg 与 response_item

`event_msg` 和 `response_item` 保存用户消息、模型响应、工具调用、工具结果等运行过程事件。

实现产品时，不建议让 UI 直接依赖某个复杂 payload 的所有字段。更稳妥的做法是：

- 对列表页只依赖索引。
- 对详情页按事件流渲染。
- 对工具调用和产物引用做兼容解析。
- 未识别事件类型保留原始 JSON，不丢弃。

## 5. 对话索引

`session_index.jsonl` 是轻量索引，用来支撑侧边栏快速加载。

观察到的字段：

```text
id
thread_name
updated_at
project_path
cwd
```

示意：

```json
{
  "id": "019e654b-fb1b-7b10-ba0c-c5187905ead4",
  "thread_name": "查看对话文件存储逻辑",
  "updated_at": "2026-05-26T17:19:08.9801026Z",
  "project_path": "",
  "cwd": ""
}
```

关键点：

- 普通“对话”的 `project_path` 通常为空。
- 普通“对话”的索引行中 `cwd` 也可能为空，真实工作目录仍可在事件文件中找到。
- 侧边栏标题来自 `thread_name`，不一定等于工作目录名。
- 对话标题后续变化时，不应假设工作目录会被自动重命名。

## 6. 产物文件存储

普通对话的产物文件默认写入该对话的工作目录：

```text
C:\Users\<user>\Documents\Codex\<YYYY-MM-DD>\<conversation-slug>
```

例如当前对话工作目录：

```text
C:\Users\25672\Documents\Codex\2026-05-27\codex
```

如果在这条对话里生成文档，产物可能是：

```text
C:\Users\25672\Documents\Codex\2026-05-27\codex\codex-conversation-storage-design.md
```

关键点：

- 产物是普通文件，不内嵌在对话 JSONL 中。
- 对话 JSONL 可能记录“创建了某文件”的消息、工具调用和路径，但不应被当作产物二进制内容的主存储。
- 如果用户指定绝对路径，产物可能写到工作目录之外。
- 如果工具在子目录中生成文件，仍属于该工作目录树的一部分。
- 如果工作目录被用户手动删除，对话仍可能存在，但产物链接会失效。

## 7. 普通“对话”的生命周期

### 7.1 创建

用户从“新对话”进入，不选择现有项目目录时，系统创建一条普通对话。

创建时通常完成：

```text
生成 conversation_id
创建对话事件文件
创建或分配工作目录
写入 session_meta
写入 session_index
```

工作目录命名可参考：

```text
Documents\Codex\<local-date>\<slug>
```

`slug` 可以来自初始标题、用户输入、默认名，或系统生成名。若重名，可追加 `-2`、`-3` 等后缀。

### 7.2 对话进行中

每轮对话追加事件到 JSONL 文件。

如果模型调用工具创建文件：

```text
文件写入 cwd
工具调用和结果写入 JSONL
必要时更新侧边栏索引 updated_at
```

这形成两个独立但可关联的数据源：

```text
事件流：说明发生了什么
工作目录：保存实际产物
```

### 7.3 标题生成或更新

标题可能在对话开始后才生成，例如根据首轮用户意图命名。

标题更新通常只影响索引中的 `thread_name`，不应默认影响：

```text
conversation_id
对话事件文件名
工作目录名
产物文件路径
```

这是重要的实现细节：显示名称和物理路径应解耦。

### 7.4 重新打开

重新打开一条普通对话时，推荐流程：

```text
从 session_index 读取列表
用户点击某个 conversation_id
根据 conversation_id 定位 JSONL 文件
读取 session_meta 和最近的 turn_context
恢复 cwd
按事件流渲染对话详情
按需扫描 cwd 或读取产物清单
```

如果 `cwd` 不存在：

```text
仍允许打开对话
提示工作目录缺失
文件链接显示为不可用
允许用户重新关联目录
```

### 7.5 归档

归档应优先理解为“从活跃列表隐藏”，而不是删除。

观察到 Codex 有：

```text
.codex\archived_sessions
```

产品实现中建议：

- 归档不删除工作目录。
- 归档不删除产物文件。
- 归档后仍可通过搜索或归档列表恢复。
- 真正删除应单独设计确认流程。

## 8. 推荐产品实现模型

建议将系统拆成三层。

### 8.1 Thread Index

用于侧边栏和搜索入口。

推荐字段：

```text
id
kind                conversation | project
title
created_at
updated_at
archived_at
project_path
workspace_path
transcript_path
last_model
last_message_preview
```

设计原则：

- 列表页只读索引，避免加载完整对话。
- `title` 可变，`id` 不变。
- `workspace_path` 和 `title` 解耦。
- 普通对话 `project_path` 为空，项目会话 `project_path` 非空。

### 8.2 Transcript Event Log

用于保存完整对话和运行过程。

推荐格式：

```json
{
  "timestamp": "ISO-8601 UTC",
  "type": "event_type",
  "payload": {}
}
```

设计原则：

- 追加写入，避免频繁重写大文件。
- 未识别事件类型也保留。
- 写入时保证单行 JSON 完整。
- 每个事件带时间戳。
- 会话级元信息和每轮上下文都入事件流。

### 8.3 Workspace Artifacts

用于保存产物文件。

推荐结构：

```text
Documents\AppName\<YYYY-MM-DD>\<conversation-slug>\
  README.md
  output.md
  images\
  exports\
  .app\
    artifacts.json
```

`artifacts.json` 可选，但对产品很有帮助。建议记录：

```json
{
  "artifacts": [
    {
      "id": "artifact_01",
      "thread_id": "conversation_id",
      "turn_id": "turn_id",
      "relative_path": "output.md",
      "mime_type": "text/markdown",
      "size": 12345,
      "hash": "sha256...",
      "created_at": "ISO-8601 UTC",
      "updated_at": "ISO-8601 UTC",
      "source": "assistant_tool"
    }
  ]
}
```

Codex 当前观察到的实现不一定有独立产物清单，但如果你的产品需要“文件面板”“历史版本”“导出管理”，产物清单会显著降低后续复杂度。

## 9. 推荐关系模型

逻辑关系：

```text
Conversation
  id
  title
  transcript_path
  workspace_path

TranscriptEvent
  conversation_id
  timestamp
  type
  payload

Artifact
  conversation_id
  turn_id
  relative_path
  mime_type
  created_at
```

实际存储可以是：

```text
索引：SQLite 或 JSONL
事件：JSONL
产物：文件系统
产物清单：JSON 或 SQLite
```

## 10. 路径与命名规则建议

### 10.1 对话 ID

使用稳定唯一 ID。不要用标题或目录名作为主键。

### 10.2 对话文件名

建议：

```text
rollout-<local-created-at>-<conversation-id>.jsonl
```

文件名包含时间便于人工排查，包含 ID 便于程序定位。

### 10.3 工作目录名

建议：

```text
<base-storage-dir>\<local-date>\<slug>
```

规则：

- `local-date` 使用用户本地日期，便于用户理解。
- `slug` 使用安全字符。
- 重名时追加数字后缀。
- 标题变更不自动改目录名。

### 10.4 文件引用

事件和产物清单里建议优先保存相对路径：

```text
relative_path = "exports/report.pdf"
```

运行时再基于 `workspace_path` 解析成绝对路径。

优点：

- 工作目录迁移后更容易修复。
- 避免把用户名、磁盘路径过度写入业务数据。
- 更容易做跨设备同步。

## 11. 需要特别处理的边界情况

标题为空：先使用默认标题，例如“新对话”，之后异步生成标题。

标题重复：标题可重复，目录名不可重复；目录名加后缀即可。

目录被删除：对话仍可打开，但产物不可用。

目录被移动：允许用户重新关联 `workspace_path`。

对话文件损坏：JSONL 可逐行恢复，损坏行隔离处理。

索引丢失：可扫描 `.jsonl` 文件，根据 `session_meta` 重建索引。

索引过期：以事件文件中的最新事件时间作为兜底。

跨时区：事件时间用 UTC；目录日期和 UI 显示用本地时区。

产物同名覆盖：默认应避免静默覆盖，至少在产物清单中记录版本或更新时间。

绝对路径输出：明确标记为外部文件，不把它当作工作目录内产物。

## 12. UI 逻辑参考

左侧“对话”列表：

```text
读取 Thread Index
筛选 kind = conversation
按 updated_at 倒序
展示 title 和相对更新时间
```

打开对话：

```text
读取 transcript_path
解析事件流
恢复 workspace_path
渲染消息
展示相关产物
```

产物面板：

```text
优先读取 artifacts.json
没有清单时扫描 workspace_path
忽略应用内部隐藏目录
展示相对路径、类型、更新时间
```

删除对话：

```text
默认只删除索引和事件记录
是否删除工作目录必须单独确认
```

归档对话：

```text
设置 archived_at 或移动到 archived_sessions
不删除 workspace_path
不删除产物
```

## 13. 最小可行实现

如果要在自己的产品中复刻这套逻辑，最小实现可以是：

```text
app_state/
  session_index.jsonl
  sessions/
    2026/
      05/
        30/
          rollout-2026-05-30T10-00-00-<id>.jsonl

user_documents/
  AppName/
    2026-05-30/
      new-chat/
        output.md
        image.png
```

创建对话时：

```text
1. 生成 id
2. 创建 workspace_path
3. 创建 transcript_path
4. 写 session_meta
5. 写 session_index
```

每轮对话时：

```text
1. 写 turn_context
2. 写用户消息事件
3. 写模型响应和工具调用事件
4. 工具产物写入 workspace_path
5. 更新 session_index.updated_at
6. 可选更新 artifacts.json
```

重新打开时：

```text
1. 从 session_index 找 id
2. 读 transcript_path
3. 从最近 turn_context 或 session_meta 恢复 workspace_path
4. 渲染事件流
5. 展示 workspace_path 内产物
```

## 14. 设计原则总结

主键用 ID，不用标题。

显示名和物理路径解耦。

事件日志和产物文件分离。

索引用于快速列表，事件文件作为对话事实来源。

工作目录作为产物事实来源。

普通对话也必须有工作目录，即使它不属于任何项目。

归档不是删除。

删除产物必须单独确认。

路径记录尽量使用相对路径，绝对路径只作为运行时解析结果。

JSONL 适合追加和局部恢复，SQLite 适合索引、搜索和状态查询。

