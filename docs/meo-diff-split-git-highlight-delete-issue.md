# MEO 分屏 Diff 删除时 Git 高亮异常记录

## 背景

该问题发生在 MEO 编辑器的分屏 diff 视图中，典型场景是 `INDEX - WORKING TREE`。左侧是原始侧或 index 侧，右侧是可编辑的 working tree 侧。

当前视图里有两类容易混淆的高亮：

- 行级背景高亮：CodeMirror merge 的 `.cm-changedLine`，视觉上表现为整行淡红或淡绿背景。
- 文本级高亮：CodeMirror merge 的 `.cm-changedText`、`.cm-changedTextFullLine`、`.cm-changedTextEmpty` 等，表示具体字符或文本范围的变化。

用户反馈的问题只针对删除编辑时的行级背景异常，但之前尝试修复时误伤了文本级高亮，这是不可接受的。

## 问题定义

稳定状态下，某个 hunk 的显示是正确的：右侧第 19 行是实际修改行，右侧第 20 行不是用户正在修改的目标行，也不应因为第 19 行的逐字删除而被解释为“当前也发生了 git 行级变更”。

复现路径：

1. 打开 MEO 分屏 diff 视图。
2. 在右侧 modified/working tree pane 中定位到一个已有修改 hunk。
3. 在第 19 行逐字删除内容。
4. 观察右侧第 20 行。

实际现象：

- 删除第 19 行内容时，第 20 行会临时出现淡绿色行级背景高亮。
- 从用户语义看，第 20 行没有被编辑，不应出现 git 行级背景。
- 之前错误尝试中，还出现过编辑期间整屏 git 行高亮消失、文本级高亮消失、或第 19 行文本级高亮短暂消失的问题。

期望行为：

- 第 19 行正在编辑时，其相关 git 高亮可以更新，但不应把未变动的第 20 行临时染成 changed line。
- 文本级高亮不能因为行级高亮的 debounce、冻结或刷新策略而消失。
- 修复应针对“行级背景误判”这个问题，不应全局隐藏、禁用或延迟所有 diff 高亮。

## 相关代码路径

主要涉及以下模块：

- `src/vendor/codemirror-merge/src/mergeview.ts`
  - `MergeView` 持有当前 `chunks`。
  - 编辑发生后，`dispatch()` 会通过 `Chunk.updateA()` / `Chunk.updateB()` 或 `Chunk.build()` 更新 chunks。
  - 当前已有 `deferChunkUpdates` / `refreshChunks()` 机制。

- `src/vendor/codemirror-merge/src/deco.ts`
  - `addChunkDecorations()` 同时生成行级背景和文本级高亮。
  - `.cm-changedLine` 由 chunk 的行范围生成。
  - `.cm-changedText` 等文本级标记也在同一函数中生成。
  - 这意味着“延迟或冻结 chunk decorations”很容易同时影响行级和文本级高亮。

- `src/features/editor/lib/meo-native-diff-split.ts`
  - `getDiffConfig(editable)` 使用 `buildCodeMirrorChunksFromVsCodeDiff` 作为 `overrideChunks`。
  - `createMeoDiffSplitMergeView()` 创建 split `MergeView`。
  - `deferChunkUpdates: shouldDeferSplitMergeChunkUpdate` 控制编辑期间是否延迟 chunk 更新。
  - `scheduleDeferredDiffRefresh()` / `refreshDiffArtifactsNow()` 负责 idle 后刷新 chunks、line flags、overview ruler 等。
  - `syncSplitGutterLineFlagsFromChunks()` 从当前 chunks 派生 git gutter / overview 所需 line flags。

- `src/vendor/meo/shared/gitDiffLineFlags.ts`
  - `buildLineFlagsFromVsCodeDiff()`、`buildScopedLineFlagsFromVsCodeDiff()` 负责从 diff 结果构造 git line flags。

## 已确认结论

1. 第 20 行的淡绿色背景不是“Git 真的认为第 20 行被用户编辑了”的直接证据。

   它更可能是当前 merge chunk decoration 在 live edit 过程中，根据临时 chunks 或被映射后的旧 decoration range 生成了 `.cm-changedLine`。也就是说，这是渲染层/差异块边界层面的误标，不是用户语义层面的真实编辑。

2. 这个问题不能通过隐藏整屏 git 高亮解决。

   隐藏或暂停所有 diff decorations 会造成更严重的问题：编辑期间文本级高亮消失，用户无法判断具体字符差异。

3. debounce 不能应用到“全部 git 高亮”。

   用户提出的 debounce 方向只适合行级背景或 line flags 的稳定化。文本级高亮必须保持即时、连续、可见。后续实现如果使用 debounce，必须明确区分：

   - 可以 debounce 或稳定化：行级背景 `.cm-changedLine`、git gutter line flags、overview ruler。
   - 不应 debounce 或隐藏：文本级高亮 `.cm-changedText` 及其 inline layer。

4. 当前 `addChunkDecorations()` 把行级背景和文本级高亮耦合在一起。

   这是后续修复必须正视的结构性问题。只要行级背景和文本级高亮共用同一套 decoration 刷新策略，就很容易在修行级问题时误伤文本级表现。

5. 仅在 MEO 外层做 CSS 或 DOM 级补丁风险很高。

   例如临时移除 `.cm-changedLine`、关闭 `highlightChanges`、或让 fallback decoration 覆盖主 decoration，都会导致状态来源不清、时序不可控，并可能再次造成文本级高亮丢失。

## 推测根因

当前最可信的根因方向是：行级背景的判定粒度过粗，直接使用 chunk 的行范围，而不是“该侧这一行是否真的有可展示的变化”。

CodeMirror merge 的 chunk 是差异块，用于描述一段变更区域。为了对齐和展示，它可能覆盖多行。`addChunkDecorations()` 在 chunk 范围内会为每一行添加 `.cm-changedLine`。当用户在第 19 行逐字删除时，增量 diff 或 decoration 映射可能让 chunk 范围暂时覆盖到第 20 行，于是第 20 行获得淡绿色背景。

从产品语义看，MEO 的 git 行级背景不应该简单等同于“当前 chunk 覆盖了这一行”。它应该表示“这一行本身在当前侧有真实、可展示的行级变化”。

## 后续合理解法方向

后续再修时，优先考虑结构性方案，而不是补丁式压制。

### 方向 A：拆分行级与文本级 decoration

把 merge decoration 分成两个独立层：

- 文本级 decoration：继续由 chunk changes 直接生成，保持实时更新。
- 行级背景 decoration：由单独的 changed-line set 生成，并允许 debounce / stable mapping。

需要的能力：

- `addChunkDecorations()` 或其上层 wrapper 能够单独关闭 `.cm-changedLine`，但保留 `.cm-changedText`。
- 行级背景使用独立函数生成，例如 `buildChangedLineDecorationsFromChunks()`。
- 行级背景函数不能简单遍历整个 chunk 范围，应基于 change span、整行插入/删除、空文本变化等语义决定某行是否应被染色。

### 方向 B：只对行级 changed-line set 做 debounce

编辑中：

- 文本级高亮照常更新或映射，不能被隐藏。
- 行级背景先保持上一帧稳定结果，并通过 transaction changes 做位置映射。
- 不在每个 key stroke 期间用临时 chunks 立即重算行级背景。

idle 后：

- 调用 `refreshChunks()` 得到稳定 chunks。
- 重算行级背景、git gutter line flags、overview ruler。
- 原子替换行级 changed-line set。

这比“冻结全部 chunk decorations”更符合问题边界，因为原始问题只发生在行级背景。

### 方向 C：修正 changed-line 判定语义

即使不做 debounce，也应修正“chunk 覆盖行”与“该行真正变更”的关系。

候选规则：

- 如果某一行只是在 chunk 范围内，但没有任何 change span 与该行相交，也不是整行插入/删除，不应添加 `.cm-changedLine`。
- 对 replacement chunk，逐行检查该侧 change offset 是否覆盖该行。
- 对纯插入/纯删除，保留对应侧的整行高亮。
- 对空文本变化，保留必要的 empty marker，但不要扩散到下一条未变化行。

这个方向可以直接解决“第 19 行删除时第 20 行被 chunk 范围误伤”的核心语义问题。

## 明确不要再走的方向

- 不要关闭 `highlightChanges` 来规避。
- 不要隐藏整个 pane 的 git 高亮。
- 不要让 debounce 影响 `.cm-changedText`。
- 不要用 CSS 选择器临时覆盖 `.cm-changedLine`，除非它只是最终方案中的展示层配套，而不是状态来源。
- 不要把 fallback decoration 当作主修复路径；fallback 应只处理渲染健康问题，不应承担 git diff 语义。

## 建议测试用例

后续修复必须补测试，至少覆盖以下层级。

### 单元测试

文件建议：`test/codemirror-merge-deco.spec.ts`

- 构造一个 replacement chunk，其 chunk 行范围覆盖第 N 和 N+1 行，但实际 change span 只在第 N 行。
- 断言第 N 行有 `.cm-changedLine`。
- 断言第 N+1 行没有 `.cm-changedLine`。
- 断言第 N 行仍保留 `.cm-changedText`。

### MEO split 层测试

文件建议：`test/meo-performance.spec.ts` 或新增更聚焦的 diff split spec。

- 模拟 modified pane 第 19 行逐字删除。
- 验证编辑事务期间文本级高亮不消失。
- 验证 debounce 期间第 20 行不被新增行级背景。
- 验证 idle refresh 后 line flags、overview ruler、gutter 与最终 chunks 一致。

### 浏览器/视觉验证

用真实 MEO 分屏 diff 页面复现：

- 编辑第 19 行。
- 截图或 DOM 查询确认第 20 行没有 `.cm-changedLine`。
- 确认第 19 行文本级高亮持续存在，不出现短暂清空。

## 当前修复结论

本次修复确认了两个直接原因：

1. `Chunk.toA` / `Chunk.toB` 的语义是“最后变化行末尾后一位”，当 chunk 结束位置正好等于下一行起点时，下一行只是边界，不代表下一行发生变化。
2. live edit 删除期间会进入 deferred chunk 状态，此时 chunks 仍描述编辑前文档。如果在新的 `setChunks` 到来前用旧 chunks 重建 decorations，就会把旧 chunk 范围套到新文档上，产生短暂的错误行级背景。

最终修复不隐藏文本级高亮，也不全局 debounce diff 高亮：

- `.cm-changedLine` 和 split gutter line flags 使用“该行是否真的被 change span 命中”的判定，而不是直接使用 chunk 覆盖范围。
- deferred chunk 期间只 mapping 既有 decorations，不用 stale chunks 重建 decorations。
- `cm-changedText` / `cm-changedTextFullLine` 的文本级高亮路径保持独立，不作为 debounce 对象。
