为 Aryn 新增一个布局模式： Agent。 目前的布局为 Editor（默认值）。 可以在setting modal当中设置。
启用 Agent 布局后，可能会在 body 中加一个类。你可以采用最合理的方案
总之效果是这样：

- 文件 、 git 面板会到 tab 区域（.panel-editor）。他们会作为起始的两个固定的 tab。不能够被删除。
- 所以目前左侧边栏的空间就会空出来，这边需要放session list 。 即 .agent-session-list 当中的内容（包括 sidebar toggle btn 和 section-title-text）。也就是说Agent 布局模式下，左侧边栏会是 Agent session 树。btw，session 树看看能不能采用 https://trees.software/
- 左上角顶部的 .section-title.workspace-section-title 那部分可以不用动，只是把左侧栏 .sidebar-stack 里面的内容都替换为掉，替换为 Agent session 树。
- 然后当前右侧栏的内容 即 AI 侧边栏的内容 移动至中间位置，tab 区域 移动至右侧栏区域。即 .panel-editor 和 .panel-agent 里面的内容对调。
- 这个时候，即 Agent 模式下，估计右侧栏的最小宽度要给得稍微大一点。以为现在右侧栏需要承载整个 tab 区域
- 对于右侧栏来说，仍需要保留顶部 的 sidebar toggle btn，用以控制 tab 栏的 展开/收起 状态。
- 对于右侧栏来说，还需要注意右上角的 Windows 适配。目前的右侧栏右上角应该是留了一些位置给 Window control buttons 的 。注意别把这个逻辑改坏了。

## 已确认补充

- `Editor` 是默认布局，并且继续维持现有左侧文件/Git、主编辑器、右侧 Agent 的布局。
- `Agent` 布局下最终位置为：左侧栏 = Agent session 树；中间主区域 = Agent chat；右侧栏 = 原 editor tab 区域。
- `文件` / `Git` 固定 tab 只在 `Agent` 布局出现，作为右侧 tab 区域的起始两个固定 tab，不能关闭，也不参与普通文件 tab 删除逻辑。
- `文件` / `Git` 固定 tab 分别承载现有文件树面板和 Git 面板能力；`Editor` 布局下仍使用现有左侧栏切换。
- Agent session 树优先采用 `https://trees.software/` 对应的 `@pierre/trees` React 入口实现。当前仅替换 session 树；工作区 path 树后续再迁移。
- 右侧 editor/tab 栏宽度由实现根据可用空间决定，但需要比现有 Agent 右侧栏更适合承载编辑器。
- 窄屏、compact、focus 布局可以沿用现有 drawer 机制。

## 2026-05-21 布局细节补充

- Agent 布局下右侧 tab/editor 面板不设置最大宽度上限；仅保留适合承载 tab/editor 的最小宽度。拖拽扩大右侧面板时，应优先保证中间 Agent chat 面板的最小可用宽度。
- Agent 布局下左侧栏收起后，左侧 overlay toggle 必须仍然可点击，并能恢复左侧 session 树。
- macOS 下 Agent 布局的 traffic light 只会和左侧/中间 Agent chat 区域发生重叠；右侧 tab/editor 面板位于窗口右侧，不需要为 traffic light 预留左侧空间。
- macOS 下 Agent 布局左侧栏收起时，中间 Agent chat 顶栏需要为 traffic light 预留空间；左侧栏展开时由左侧栏承载该空间，Agent chat 顶栏不额外留白。
- macOS 下 Agent 布局右侧 tab/editor 面板顶部不应套用 editor 布局的左侧 traffic-light inset，也不应在左侧栏收起时出现额外左 padding。
