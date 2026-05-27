# Meo split scroll virtualization plan

更新时间：2026-05-27。

这份文档现在不只描述 split diff 对齐问题，也把 Meo 在长文档、加载、滚动、编辑和 git diff UI 上的性能优化作为主线。目标是避免后续继续用局部补丁堆问题，而是逐步把 Meo 的滚动、布局和 diff UI 收敛到同一套可测量的模型上。

## 当前结论

Meo 在长 Markdown 文档的 split diff 模式下，根因不是“某个 gutter、spacer 或 restore 逻辑写错了”，而是 split 模式长期缺少统一的布局事实来源：

- 外层 `.cm-mergeView` 是实际 scroll owner。
- 左右两个 CodeMirror 子编辑器各自维护 viewport 和 height map。
- Markdown live decorations 会异步改变行高、wrap width 和 block widget 高度。
- merge spacer、git gutter marker、changed background、revert controls、overview 各自从不同输入推导位置。

因此同一 hunk 的左右两边会在长文档/多 hunk/restore-to-middle 场景下错位。系统并不是完全不知道“哪一行该对齐哪一行”，diff chunks 里有逻辑对应关系；问题在于这些逻辑关系没有被提升为 shared layout snapshot，最终 UI 仍然受各层异步测量和 DOM 状态影响。

已经阶段性修复的部分：

- split restore 使用 `{ line, lineOffset }` logical anchor，并在恢复过程中继续修正外层 scrollTop。
- 用户在 restore 稳定期内主动滚动、输入或点击时会取消 pending restore anchor，避免“被拉回”。
- `MergeView` 支持 shared outer viewport，以 modified/right pane 作为 primary side，把 primary logical viewport 映射到 original/left pane。
- 长文档 split 下 git gutter marker 不再被直接跳过，而是按 shared viewport scoped chunks 生成 sparse line flags。
- gutter/background 相关 sparse flags 带 `changedLineNumbers`，避免为了少数可见变更扫描整篇文档。
- split gutter sync 有 signature 去重，滚动/restore 期间 scoped chunks 没变时不会重复 dispatch。

仍未完成的核心部分：

- Markdown structural height map 还没有成为独立布局输入。
- hunk layout snapshot 还没有统一驱动 gutter、background、revert controls 和 overview。
- 加载、滚动、编辑、diff 刷新的性能预算还没有和 split virtualization 统一成一套阶段性验收。

## VSCode / Zed 调研结论

本轮对照的是当前上游源码主干：

- VSCode `ViewLinesViewportData`：<https://github.com/microsoft/vscode/blob/main/src/vs/editor/common/viewLayout/viewLinesViewportData.ts>
- VSCode `ViewLayer`：<https://github.com/microsoft/vscode/blob/main/src/vs/editor/browser/view/viewLayer.ts>
- VSCode `DiffEditorViewZones`：<https://github.com/microsoft/vscode/blob/main/src/vs/editor/browser/widget/diffEditor/components/diffEditorViewZones/diffEditorViewZones.ts>
- VSCode `DiffEditorViewModel`：<https://github.com/microsoft/vscode/blob/main/src/vs/editor/browser/widget/diffEditor/diffEditorViewModel.ts>
- Zed `scroll.rs`：<https://github.com/zed-industries/zed/blob/main/crates/editor/src/scroll.rs>
- Zed `display_map.rs`：<https://github.com/zed-industries/zed/blob/main/crates/editor/src/display_map.rs>
- Zed `block_map.rs`：<https://github.com/zed-industries/zed/blob/main/crates/editor/src/display_map/block_map.rs>

共同原则：

- 滚动先进入编辑器布局模型，再由渲染层输出 viewport DOM。
- DOM 不是 scroll truth，DOM 是布局模型在当前 viewport 的投影。
- diff 对齐不是各 UI 层临时测 DOM，而是从 line mapping、view zones、display map、block map 或 shared scroll anchor 这类模型派生。
- 可见区域和 overscan 是一等输入，不能为了长文档场景全量创建 DOM。

VSCode 的重点：

- `ViewportData` 聚合当前 viewport 渲染所需的 line range、visible range、line height、whitespace viewport data 和 decorations。
- `ViewLayer` 围绕 viewport 增删复用行 DOM，处理 viewport 内外插入删除，而不是长期维护全量行 DOM。
- diff editor 通过 `DiffEditorViewZones` 计算 range alignment，并用 view zones/top padding/scroll offset 让左右编辑器高度和滚动保持一致。
- `DiffEditorViewModel` 管理 diff mappings 和 unchanged regions，UI 消费映射结果。

Zed 的重点：

- `ScrollAnchor` 以 buffer/display anchor + offset 表示滚动位置。
- `SharedScrollAnchor` 明确用于 split diff：两边共享 scroll anchor，并通过 display map id 在左右 display map 之间解析。
- `DisplaySnapshot`、`DisplayMap` 和 `BlockMap` 把 folds、inlays、custom blocks、diagnostics、diff balancing blocks 等额外高度纳入 display 层。
- split diff 不是让两边 scroller 各自漂移，而是共享 anchor，再通过各自 display snapshot 得到当前滚动位置。

对 Meo 的含义：

- 不应该照搬 VSCode 的固定行高假设，因为 Markdown live mode 有 headings、tables、Mermaid、images、math、blockquote、lists 等可变高度内容。
- 更接近的方向是 Zed 的 display map / block map / shared scroll anchor 思路，但 Meo 的 height map 必须能处理 Markdown structural decorations 和 viewport-local block widgets。
- 当前已经落地的 shared outer viewport 和 restore anchor 是正确方向，但还只是第一层。下一步应把 hunk geometry 和 Markdown structural height 都纳入模型，而不是继续扩展 spacer patch。

## VSCode / Zed 性能实现调研

这部分是后续 Meo 性能优化的直接参考。结论不是“他们更快”，而是他们把重活从热路径移走，并把局部变化限制在明确的 layout/model 层。

### VSCode 性能机制

源码参考：

- `ViewModelImpl`：<https://github.com/microsoft/vscode/blob/main/src/vs/editor/common/viewModel/viewModelImpl.ts>
- `ViewLayer`：<https://github.com/microsoft/vscode/blob/main/src/vs/editor/browser/view/viewLayer.ts>
- `TextModelTokens`：<https://github.com/microsoft/vscode/blob/main/src/vs/editor/common/model/textModelTokens.ts>
- `DiffEditorViewModel`：<https://github.com/microsoft/vscode/blob/main/src/vs/editor/browser/widget/diffEditor/diffEditorViewModel.ts>

关键机制：

- viewport 是渲染输入。`ViewModelImpl.getVisibleRanges()` 和 `getVisibleRangesPlusViewportAboveBelow()` 只给当前可见范围及有限 overscan，decorations 通过 `getDecorationsInViewport(...)` 和 `getViewportViewLineRenderingData(...)` 获取。
- `ViewLayer` 维护 viewport DOM collection。插入、删除、变更会判断影响区域在 viewport 上方、下方还是内部，尽量复用当前 DOM；重新渲染也是围绕 `ViewportData`。
- tokenization 后台化。`TextModelTokens` 使用 idle deadline，每次只 tokenizes 至少约 1ms，然后让出主线程，未完成时再调度下一轮。
- diff 计算防抖和可取消。`DiffEditorViewModel` 内容变化后用 `RunOnceScheduler(..., 200)` 触发 diff recompute，计算时传 cancellation token，并受 `maxComputationTimeMs` 约束。
- diff 结果可被局部 edits 映射。内容变化时先尝试 `applyModifiedEdits(...)` / `applyOriginalEdits(...)` 把已有 diff state 映射到新文档，再异步刷新权威 diff，避免每次输入都让 UI 退回空状态。
- viewport 稳定性是一等概念。`StableViewport` 会保留 viewport 起始 model position 和 delta，line mapping/hidden areas 改变后恢复 viewport start，而不是直接相信旧 scrollTop。
- diff UI 读模型状态。`DiffEditorViewZones` 由 diff mappings 和 editor line height / wrapping / view zones 计算 alignment，tokenization 完成等事件会触发 view zone 更新，但不是由滚动热路径直接扫描 DOM。

对 Meo 的启发：

- live decorations、git diff flags、merge chunks、hunk UI 都不能在输入事务和 scroll event 中全量重建。
- 可见 UI 可以先 map/preserve，再通过 idle/deferred refresh 产出下一份权威结果。
- 长文档性能测试不能只看毫秒数，还要证明热路径没有 `doc.toString()`、全量 line traversal、全量 chunks flatten。
- restore 和 layout 改变时要维护 logical anchor，而不是维护旧像素 scrollTop。

### Zed 性能机制

源码参考：

- `scroll.rs`：<https://github.com/zed-industries/zed/blob/main/crates/editor/src/scroll.rs>
- `display_map.rs`：<https://github.com/zed-industries/zed/blob/main/crates/editor/src/display_map.rs>
- `block_map.rs`：<https://github.com/zed-industries/zed/blob/main/crates/editor/src/display_map/block_map.rs>
- `split.rs`：<https://github.com/zed-industries/zed/blob/main/crates/editor/src/split.rs>

关键机制：

- display map 是分层增量模型。`DisplayMap` 由 inlay、fold、tab、wrap、block 等层组成，每层都有 snapshot、坐标转换、row/chunk iterator 和 `sync` 函数。
- edit 语义更像 invalidation region。`display_map.rs` 明确说明可以用全量 edit 表示正确性，但这样会导致大量不必要重算；实际设计是把变化范围通过各层转换后局部失效。
- scroll anchor 不直接绑定 DOM。`ScrollAnchor` 用 anchor + offset 表示滚动位置，`SharedScrollAnchor` 在 split diff 两侧共享 anchor，并通过 display map id 找到对应 snapshot。
- block map 管理额外高度。`BlockMap` 记录 custom blocks、spacers、folded buffers、headers 等高度，snapshot 负责把这些高度纳入 display rows。
- split diff 用 balancing blocks 对齐。一个 side 插入 custom block 后，companion side 会生成 balancing block；block resize 会同步 companion block height，避免左右高度漂移。
- companion edits 会反向进入本 side 的 invalidation。`BlockMap` 会把 companion wrap edits 转换到当前 side，确保对侧变化也能触发 spacer/balancing block 的局部重算。
- snapshot 读取会同步到需要的层。`DisplayMap.snapshot()` 先 sync through wrap，再 read block map，并处理 companion snapshot；渲染消费 snapshot，而不是直接从 DOM 查询布局。

对 Meo 的启发：

- Markdown widgets 不应该只是 DOM widgets，它们需要在 Meo 的 height map / hunk layout snapshot 中有估算高度、实测高度、失效范围和版本边界。
- split diff 的左右对齐不应由两个 pane 各自测量后互相补偿，而应有类似 balancing block / hunk layout snapshot 的双边模型。
- 长文档性能优化的核心不是“少画一点 UI”，而是把全量重算变成局部 invalidation，并让滚动只消费 snapshot。
- block resize 需要同步对侧布局。如果 Meo table/image/Mermaid/math widget 实测高度变化，只改当前 pane 会重新制造 hunk 错位。

## 当前代码状态

### Shared outer viewport

代码范围：

- `src/vendor/codemirror-merge/src/mergeview.ts`
- `src/features/editor/lib/meo-native-diff-split.ts`
- `src/vendor/codemirror-merge/src/deco.ts`

当前状态：

- `MergeView` 支持 `outerScrollViewportSync`、`outerScrollViewportMargin`、`outerScrollViewportRetention` 和 `outerScrollPrimarySide`。
- Meo split diff 默认 `outerScrollPrimarySide: 'b'`，即 modified/right pane 是 primary side。
- `getSharedOuterScrollViewportOverride()` 暴露当前 shared viewport override，供 Meo split gutter 和 spacer/deco 路径消费。
- secondary/original pane 的 viewport 由 primary/modified pane 的 outer viewport 通过 diff chunks 映射，而不是只依赖 original pane 自己的当前 visible window。
- `src/vendor/codemirror-merge/src/deco.ts` 的 spacer 更新已经能消费 shared viewport override，但它还不是最终 hunk layout snapshot。

这个阶段解决的是“左右 pane 至少围绕同一份 logical diff viewport 渲染”。它不等于完整虚拟化，也不等于完整 Markdown height map。

### Restore logical anchor

代码范围：

- `src/features/editor/lib/meo-native-diff-split.ts`
- `src/features/editor/lib/meo-native-editor.ts`
- `test/meo-performance.spec.ts`

当前状态：

- position persistence 保存和恢复 `{ line, lineOffset }`，不是只保存裸 scrollTop。
- restore-to-middle 时会等待 viewport、line blocks 和 Markdown decorations 逐步稳定，并以 anchor delta 修正外层 `.cm-mergeView.scrollTop`。
- restore 过程有 generation guard，用户 wheel、keydown、pointerdown、beforeinput 等直接输入会取消 pending anchor。
- programmatic navigation scroll 会先取消 pending restore anchor，避免导航和恢复互相抢 scroll owner。

这个阶段解决的是“重新打开到文档中间后，不再因为后续高度变化持续漂移或把用户滚动拉回”。

### Split git gutter marker

代码范围：

- `src/features/editor/lib/meo-native-diff-split.ts`
- `src/vendor/meo/webview/helpers/gitDiffGutter.ts`
- `src/vendor/meo/webview/helpers/gitDiffLineHighlights.ts`
- `test/meo-git-diff-gutter.spec.ts`
- `test/meo-performance.spec.ts`

当前状态：

- 长文档 split 下不再去掉 git gutter marker。
- `syncSplitGutterLineFlagsFromChunks()` 从 shared outer viewport 拿 scoped chunks，只为当前 viewport 附近 hunk 生成 line flags。
- `GitDiffLineFlags` 保留 array 兼容现有 API，同时附带 `changedLineNumbers` 作为 sparse metadata。
- gutter marker 和 changed line highlights 在有 `changedLineNumbers` 时只遍历 changed lines，不扫描整个 document。
- split gutter sync signature 用 `doc length/lines + scoped chunk ranges` 去重；scoped chunks 没变时跳过重复 dispatch。

这个阶段解决的是“长文档下 marker 不丢，同时避免恢复到全量行扫描或全量 hunk DOM”的问题。

## 性能优化主线

Meo 性能后续不应只按“长文档 split 对齐”理解。主线应该覆盖四类场景：

1. 加载性能。
   打开长 Markdown、初始化 live mode、构建 diff chunks、创建 merge view、promote preview/fallback，都需要避免同步全量扫描和全量 DOM。

2. 滚动性能。
   scroll hot path 只能推进 viewport、anchor 和必要的 lightweight sync；不能在 scroll 中强制 rebuild live decorations、全量 parser、全量 diff flags 或全量 spacer。

3. 编辑性能。
   typing、delete、paste、IME composition 不能触发 O(document) diff/chunk/gutter/deco 重建。可见 diff artifacts 应该先 map/preserve，再 idle refresh。

4. diff UI 完整性。
   gutter marker、changed background、inline change、overview、hunk action/revert controls 不能为了性能被隐藏。正确做法是 viewport scoped、sparse metadata、snapshot 派生和延迟刷新。

已有性能标准见 `docs/meo-performance-standard.md`。后续 split virtualization 的实现和 review 应把这份标准作为基础门槛，再补充 Electron profile 指标。

从 VSCode/Zed 的性能实现映射到 Meo，后续改动必须遵守这些约束：

- hot path 只做 mapping、anchor update、viewport range update、轻量 signature 判断。
- expensive path 必须进入 deferred/idle/background 阶段，并可被新输入取消或覆盖。
- 可见 diff artifacts 必须先 map/preserve，不允许因为权威 diff 尚未刷新就清空 UI。
- height/widget/hunk 变化要以局部 invalidation 表达，不能用“整篇文档重新生成 decorations”作为默认方案。
- split 两侧的额外高度要有双边模型。当前 side widget resize 后，另一 side 的 spacer/balancing height 必须同步进入 snapshot。
- 性能验证要同时证明正确性和算法边界，例如 sparse line flags 只访问 changed lines、scroll sync 不重复 dispatch、输入事务不 flatten document。

## 目标架构

最终目标不是继续补 spacer，也不是单纯加 overscan。

目标是建立 split 模式的统一滚动布局模型：

1. 外层 `.cm-mergeView` 是唯一 scroll owner。
2. modified/right pane 是主要 logical viewport 来源。
3. original/left pane viewport 由 modified viewport 通过 diff chunks 映射。
4. Markdown structural height 尽早进入 height map。
5. viewport-local widgets 使用估算高度 + 实测修正。
6. restore scroll position 时以 `{ line, lineOffset }` 为事实来源，后续高度变化继续修正 scrollTop。
7. git gutter marker、changed background、revert controls、overview 都从同一份 hunk layout snapshot 派生。

## 实施计划

### 1. Shared outer viewport

状态：已阶段性完成，继续维护。

要求：

- 不回退到左右子编辑器各自决定 viewport。
- 不把 child editor 当前 visible range 反向并入 primary viewport。
- overscan 围绕 shared logical diff viewport 做。
- `updateSpacers(...)` 可以继续存在，但应消费 shared layout 结果，而不是成为独立事实来源。

验收：

- restore-to-middle 后左右 pane 渲染同一 hunk 的 mapped range。
- 快速滚动不出现大面积白屏。
- secondary pane 旧 viewport 不能因为范围过宽而被误判为可用。

### 2. Restore by logical anchor

状态：已阶段性完成，继续维护。

要求：

- 恢复过程中 anchor 仍是 `{ line, lineOffset }`，不是第一次算出的 scrollTop。
- 用户直接输入、滚轮、点击会取消 restore anchor。
- programmatic navigation 与 restore 不互相抢滚动。
- 后续 Markdown decoration 或 line block 高度变化时，修正外层 scrollTop，而不是左右子编辑器分别 scrollIntoView。

验收：

- restore-to-middle 后目标 line 稳定。
- restore 稳定期内用户滚动不会被拉回。
- 切换模式、文件刷新、read-only 更新不留下过期 restore loop。

### 3. Viewport-scoped split gutter

状态：已阶段性完成，继续维护。

要求：

- 长文档下 marker 不能被跳过。
- 不允许为了 marker 扫描全部 document line。
- 不允许每次 scroll 都 dispatch 相同 line flags。
- sparse line flags 必须保持 hunk metadata，不能破坏 hover、inline diff、hunk action 和 navigation。

验收：

- `test/meo-git-diff-gutter.spec.ts` 覆盖 sparse marker 不扫描整篇文档。
- `test/meo-performance.spec.ts` 覆盖 scoped signature 去重。
- Electron restore profile 能看到 viewport 内 marker，并记录 scoped chunks 远小于 total chunks。

### 4. Markdown structural height map

状态：未完成，是下一条核心主线。

第一类结构必须尽早进入 structural layout input：

- ATX heading line class。
- fenced code block line class。
- blockquote / alert 基础 line class。
- thematic break line class。
- list line class。

这些结构会影响 line height、padding、indent 或 wrap width，可以通过轻量文本扫描或局部语法树尽早得到，不应该等待整篇文档 parse 完成。

第二类继续 viewport-local：

- rendered table widget。
- Mermaid widget。
- image widget。
- fenced math widget。
- 复杂 footnote/details/collapse widgets。

这些不应该为了滚动恢复而渲染整篇文档。它们应使用估算高度进入 viewport height map，进入 viewport + overscan 后实测，并把结果写入 session-level height cache。只有 cache key、失效策略和文档版本边界明确后，才考虑跨会话持久化。

验收：

- 打开长 Markdown 时不等待整篇 live decorations 才能恢复 viewport。
- heading/list/blockquote/code fence 等结构高度输入能在 restore 早期稳定 anchor。
- widget 实测修正不会把用户滚动强行拉回。
- 编辑局部 Markdown 结构只失效附近 height map。
- 输入事务中不能全量重建 structural height map；局部 edit 应转成局部 invalidation。
- widget height cache 必须能区分 estimated / measured / stale，避免把未知高度当成稳定事实。

### 5. Hunk layout snapshot

状态：v1 已开始落地，仍是下一条核心主线。

需要一份统一 snapshot：

- hunk id。
- original / modified logical line range。
- original / modified measured top/bottom。
- original / modified estimated top/bottom。
- marker top。
- changed background top/bottom。
- revert controls anchor。
- overview segment range。
- snapshot 来源是否是 viewport scoped。
- snapshot version / doc version。
- invalidation range。

当前 v1 已经从 scoped CodeMirror chunks 生成 `DiffSplitHunkLayoutSnapshot`，包含 hunk id、全局 chunk index、双边 logical line range、双边 changed line numbers、marker line、可选 measured top/bottom、doc length/lines、total/scoped chunk count、viewport scoped 标记和签名。长文档 split gutter flags 已能从这份 snapshot 派生，避免 snapshot 和 gutter helper 在同一批 scoped hunk 上重复计算 changed lines。

这还不是最终形态：

- estimated top/bottom 仍未接入 height map。
- marker top、background top/bottom、revert controls anchor、overview segment 还没有统一从 snapshot 派生。
- snapshot version / doc version / invalidation range 还只是签名级别，没有形成可局部失效的数据结构。
- spacer/balancing height 还没有写回 snapshot。

初期可以继续从现有 CodeMirror chunks、line flags、spacer 测量结果和 overview segment cache 组合，不要求第一步重写所有 helper。最终 gutter、background、overview、revert controls 都应读这份 snapshot。

验收：

- scoped snapshot 能记录全局 chunk index，而不是 viewport 内临时 index。
- snapshot 派生的 split gutter flags 与旧 chunks helper 输出一致。
- 同一 hunk 左右 marker top delta 可测试。
- 同一 hunk 左右 changed background top delta 可测试。
- revert controls 不再各自找 DOM 或 wrapper chunk 边界。
- overview 不因为 viewport scoped gutter 而丢失全局 diff 信息。
- scroll 期间 scoped hunk 没变时 snapshot 不重复 dispatch。
- widget/custom block height 变化能同步影响两侧 hunk layout。

### 6. 加载与编辑热路径预算

状态：需要和上述主线同步补齐。

加载路径要求：

- open file、create editor shell、create merge view、build chunks、mount base scroll area 都应继续记录 profile events。
- preview/fallback promote 到真实 merge view 后必须保持 logical anchor。
- large document render health 或 fallback 不应改变 diff 功能完整性。

编辑路径要求：

- normal typing、delete、paste、IME composition 不进入全量 diff flags/chunks/decorations 重建。
- split merge live input/delete/IME 继续走 deferred chunk path。
- find/search highlights 在 live typing 中先 map，再 deferred refresh。
- hunk action、navigation、undo/redo、external sync 在读取 chunks 前刷新必要 stale artifacts。
- diff state 更新优先尝试局部映射，权威 diff deferred recompute，类似 VSCode 的 apply edits + debounced computeDiff。
- live mode parser/scanner 要有 token gate、range gate 或 idle budget，不允许同步扫描整个 Markdown 作为默认行为。

验收：

- `npm run perf:meo` 作为日常快速门槛。
- `npm run perf:meo:full` 作为性能敏感改动提交前门槛。
- Electron profile 用真实 `many-hunks.md` 验证 restore、marker、long task、page errors 和 scoped chunks。
- 新增 hot path 必须有测试证明没有 `doc.toString()`、全量 line traversal 或全量 chunk flatten。

## 不应该再保留的方向

以下方向不属于最终架构主线：

1. Electron profile 脚本改动作为修复本身。
   profile 只能用于测量，不能把 profile-only hook 写成产品行为。

2. ad-hoc offscreen spacer height compensation。
   用文本估算 changed chunk 高度并直接塞进 `updateSpacers(...)` 是补偿性 patch。`updateSpacers(...)` 可以保留，但必须消费 shared layout / hunk snapshot。

3. 单纯扩大 viewport margin / retention。
   这只能降低白屏概率，不能保证 same hunk alignment，也会增加 DOM 和初始渲染成本。

4. baseline delay 改成 0。
   这可能改变加载时序，但不是滚动虚拟化根因修复。

5. 每次 scroll 强制 rebuild live decorations。
   这会把 parser、decoration、measurement、merge layout 全压进滚动热路径。

6. restore 阶段反复 `scrollIntoView` 左右子编辑器。
   在 split 模式里真实 scroll owner 是外层 merge view；子编辑器滚动只能作为 viewport priming，不能成为滚动事实来源。

7. 为性能隐藏 git UI。
   长文档下 gutter marker、background、overview、revert controls 都应存在。性能优化应该靠 viewport scoped snapshot、sparse metadata 和延迟刷新，而不是移除功能。

## 可复现测试 fixture

不能依赖某台机器上的临时 `many-hunks.md`。这个场景必须能在任意设备上一条命令复现。

仓库提供：

```bash
npm run fixture:meo-many-hunks -- replace
```

默认生成：

- workspace：`tmp/meo-many-hunks-workspace`
- 测试文件：`tmp/meo-many-hunks-workspace/many-hunks.md`

生成逻辑：

1. 创建独立临时 workspace。
2. 初始化 git 仓库。
3. 写入长 Markdown baseline 并提交。
4. 再写入 working-tree 修改，制造大量 hunk。
5. 修改类型包含 replacement、insertion、deletion、heading、table、list 和长段落 wrap。

不同规模可以运行：

```bash
npm run fixture:meo-many-hunks -- replace lines=5000
```

这个 fixture 用来覆盖：

- 长文档 split 滚动时不能出现大面积白屏。
- restore-to-middle 后 logical anchor 稳定。
- 同一个 git hunk 的左右 marker、changed background、revert controls 垂直对齐。
- 长文档 split 下 git gutter marker 存在且不触发全量行扫描。

## 验证指标

修复不能只靠主观滚动感觉。至少需要这些指标：

1. 快速滚动时 blank area 最大高度。
2. long task 总时长和最大时长。
3. restore-to-middle 后目标 line 是否稳定。
4. 用户在 restore 稳定期内主动滚动是否会被拉回。
5. 同一个 hunk 左右 marker top delta。
6. 同一个 hunk 左右 changed background top delta。
7. scoped chunks 数量与 total chunks 数量。
8. split gutter sync skipped count / dispatched count。
9. preview fallback promoted 到真实 merge view 后是否保持 logical anchor。
10. git 功能完整性：marker、背景、inline change、overview、revert controls 都不能丢。

当前阶段验证结果：

- `npx --no-install tsc --noEmit --pretty false`：通过。
- `npx --no-install vitest run test/meo-performance.spec.ts test/meo-git-diff-gutter.spec.ts test/git-diff-navigation.spec.ts --reporter=dot`：102 个相关测试通过。
- `npm run perf:meo:full`：通过。
- `git diff --check`：通过。
- Electron restore-to-middle profile：真实 `many-hunks.md` split 模式能恢复到文档中部，viewport 内 gutter marker 存在，scoped chunks 远小于 total chunks，page errors / request failures 为 0。

Electron profile 必须先执行 `npm run pretest` 或走会触发 build 的 profile 命令，因为调试脚本启动的是构建后的 `dist` / `dist-electron`，不是 Vite dev server。之前出现过的 restore 失败来自 stale build。

## 当前建议的代码范围

主线范围：

- `src/vendor/codemirror-merge/src/mergeview.ts`
- `src/vendor/codemirror-merge/src/deco.ts`
- `src/vendor/meo/webview/liveMode.ts`
- `src/features/editor/lib/meo-native-diff-split.ts`
- `src/vendor/meo/webview/helpers/gitDiffGutter.ts`
- `src/vendor/meo/webview/helpers/gitDiffLineHighlights.ts`
- `test/meo-performance.spec.ts`
- `test/meo-git-diff-gutter.spec.ts`
- `test/git-diff-navigation.spec.ts`
- 必要时增加专门的 non-Electron layout snapshot tests

辅助验证范围：

- `scripts/electron-open-file-profile.mjs`
- `scripts/create-meo-many-hunks-fixture.mjs`
- `docs/meo-performance-standard.md`

暂时不应随意扩大到：

- `src/features/editor/components/meo-editor-host.tsx`
- 与 Meo scroll owner 无关的 React shell UI
- 非 Meo diff 的 Monaco 路径

除非证据显示这些文件参与了具体性能或布局问题。
