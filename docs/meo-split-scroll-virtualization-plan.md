# Meo split scroll virtualization plan

## 要解决的问题

Meo 在长 Markdown 文档的 split diff 模式下有两个核心问题：

1. 滚动时会出现白屏或大块空白。
   这说明滚动位置已经推进，但 CodeMirror 子编辑器的可视 viewport、Markdown live decorations、diff spacer / hunk decorations 没有及时覆盖新的可视区域。

2. 重新打开文档时会恢复上次滚动位置。
   如果恢复位置在长文档中间，前面未稳定的 Markdown 渲染高度会在后续解析、decorations、测量阶段继续变化，导致内容上下抖动，并且同一个 git hunk 的左右两边不再垂直对齐。

这两个问题不能当成独立 bug 修。它们共同指向同一个底层问题：

> split 模式没有一套稳定的逻辑 viewport / height map / hunk layout 作为滚动事实来源，而是让外层 scroller、两个 CodeMirror 子编辑器、Markdown live decorations、merge spacer 分别用各自的时机和高度信息修正布局。

## 为什么不能简单照搬 VSCode / Zed

VSCode 和 Zed 的滚动之所以稳，是因为它们不会把完整 DOM 当作滚动事实来源。

VSCode 的编辑器模型更接近：

- 固定或高度可预测的文本行。
- 通过 view layout / view zones 统一管理额外高度。
- decorations 依附在统一布局模型上，而不是每个 UI 层自己测 DOM。
- 只渲染 viewport 附近内容。

Zed 的方向更接近：

- buffer position / display row 是核心锚点。
- viewport 通过 display map 映射到需要渲染的行。
- 渲染层只处理可视窗口和 overscan。
- 滚动不会依赖大量 DOM 节点或异步装饰完成后的偶然高度。

Meo 是 Markdown 编辑器，不能假设每一行等高：

- 标题会改变 font size / weight。
- 表格可能从多行 Markdown 替换成一个 block widget。
- fenced math / Mermaid / image 可能替换成更高的 block。
- blockquote / alert / list 会改变 padding、indent、wrap width。
- 这些 live decorations 可能要等 parser 或 viewport refresh 才出现。

所以 Meo 不能直接采用“固定行高 + view zone”的完整模型。Meo 需要的是：

> 类似 Zed 的逻辑 viewport / display map 思路，但 height map 必须支持 Markdown 可变高度，并且 split 两侧必须共享同一个 diff logical viewport。

## 当前根因模型

当前 split 模式的实际滚动所有者是外层 `.cm-mergeView`。

但左右两个 CodeMirror 子编辑器仍然各自维护自己的 viewport 和 height map。问题发生在：

1. 外层 `.cm-mergeView.scrollTop` 恢复到文档中间。
2. 左右子编辑器根据各自未稳定的 height map 反推 viewport。
3. Markdown live decorations 继续到达，局部行高变化。
4. merge spacer 根据当前 viewport 和行块高度重新计算。
5. git hunk marker / changed background / revert controls 继续依附这些变化后的 DOM 位置。

结果是：

- scrollTop 看起来恢复成功，但目标 logical line 之后继续漂移。
- 左右 pane 可能渲染到不同 logical 区域。
- 同一 hunk 左右两边的 marker 和背景不对齐。
- 快速滚动时 viewport 覆盖不足，出现白屏。

## 解决方案方向

最终目标不是继续补 spacer，也不是单纯加 overscan。

目标是建立 split 模式的统一滚动布局模型：

1. 外层 `.cm-mergeView` 是唯一 scroll owner。
2. 右侧 modified pane 作为主要逻辑 viewport 来源。
3. 左侧 original pane 的 viewport 由右侧 logical viewport 通过 diff chunks 映射得到。
4. Markdown 中会影响高度的结构，必须尽早进入 height map。
5. git hunk marker、changed line background、revert controls、overview 都从同一份 hunk layout snapshot 派生。
6. restore scroll position 时保存和恢复的是 logical anchor：`{ line, lineOffset }`，不是单纯 `scrollTop`。

## 具体实现计划

### 1. Shared outer viewport

在 `src/vendor/codemirror-merge/src/mergeview.ts` 中实现 shared viewport policy：

- 继续让 `.cm-mergeView` 作为外层滚动容器。
- 子编辑器不直接拥有滚动事实。
- modified pane 根据外层 scrollTop 和 height map 得到 visible logical range。
- original pane 不再独立根据自己的 height map 反推 visible range，而是通过 diff chunks 将 modified visible range 映射过去。
- 两侧各自保留 overscan，但 overscan 应该围绕同一个 logical diff viewport。

这对应 Zed / VSCode 的核心经验：滚动先进入布局模型，再进入渲染层。

### 2. Markdown structural height map

在 `src/vendor/meo/webview/liveMode.ts` 中，把会影响行高或 wrap width 的 Markdown 结构分成两类。

第一类必须尽早进入 height map：

- ATX heading line class。
- fenced code block line class。
- blockquote / alert 基础 line class。
- thematic break line class。
- list line class。

这些可以通过轻量文本扫描或局部语法树得到，不应该等待整篇文档 parse 完成。

第二类继续 viewport-local：

- rendered table widget。
- Mermaid widget。
- image widget。
- fenced math widget。
- 复杂 footnote/details/collapse widgets。

这些不应该为了滚动恢复而渲染整篇文档。它们应在 viewport + overscan 范围内逐步测量，并把测量结果写入持久 height map/cache。

### 3. Restore by logical anchor

当前恢复滚动位置不能只写 `scrollTop`。

正确模型：

1. 从持久状态读取 `{ line, lineOffset }`。
2. 将该 line 作为 modified pane 的 logical anchor。
3. 通过 diff chunks 映射 original pane anchor。
4. 要求 shared viewport 覆盖这两个 anchor。
5. 等 viewport-local Markdown structural decorations 和 CodeMirror line blocks 稳定。
6. 再计算外层 `.cm-mergeView.scrollTop`。
7. 如果后续局部 height map 变化，保持 logical anchor 不变，修正 scrollTop。

这不是“先测量前面 100 万行”。只需要：

- 已知结构性高度尽早进入 height map。
- 未知 block widget 使用估算高度。
- 进入 viewport 后实测并修正。
- 修正时保持 logical anchor，而不是保持旧 scrollTop。

### 4. Hunk layout snapshot

git hunk 相关 UI 不能各自从 DOM 找位置。

需要一份 hunk layout snapshot：

- hunk id。
- original start/end logical positions。
- modified start/end logical positions。
- original measured top/bottom。
- modified measured top/bottom。
- spacer/fake-line requirements。
- marker/background/revert control top。

同一个 hunk 的左右两侧 marker、背景和 action controls 都从这个 snapshot 派生。

这样可以避免：

- marker 根据 line decoration 位置算。
- background 根据 changed line DOM 算。
- revert control 根据 merge spacer 后的另一套位置算。

## 不应该再保留的方向

以下改动不属于 Zed/VSCode / 虚拟化主线，不应该混入最终产品代码：

1. Electron profile 脚本改动。
   它只能作为测量工具，不能作为修复本身。

2. offscreen spacer height compensation。
   用文本估算 changed chunk 高度并塞进 `updateSpacers(...)` 是补偿性 patch，容易过度修正，不是稳定 display map。

3. 单纯扩大 viewport margin / retention。
   这只能降低白屏概率，不能保证 same hunk alignment，也会增加 DOM 和初始渲染成本。

4. baseline delay 改成 0。
   这可能改变加载时序，但不是滚动虚拟化根因修复。

5. 每次 scroll 强制 rebuild live decorations。
   这会把 parser、decoration、measurement、merge layout 全压进滚动热路径。

6. restore 阶段反复 `scrollIntoView` 左右子编辑器。
   在 split 模式里真实 scroll owner 是外层 merge view；子编辑器滚动只能作为 viewport priming，不能成为滚动事实来源。

## 可复现测试 fixture

不能依赖某台机器上的临时 `many-hunks.md`。这个场景必须能在任意设备上一条命令复现。

仓库现在提供：

```bash
npm run fixture:meo-many-hunks -- replace
```

默认会生成：

- workspace：`tmp/meo-many-hunks-workspace`
- 测试文件：`tmp/meo-many-hunks-workspace/many-hunks.md`

生成逻辑：

1. 创建独立临时 workspace。
2. 初始化 git 仓库。
3. 写入长 Markdown baseline 并提交。
4. 再写入 working-tree 修改，制造大量 hunk。
5. 修改类型包含 replacement、insertion、deletion、heading、table、list 和长段落 wrap。

这个 fixture 用来覆盖两个目标：

- 长文档 split 滚动时不能出现大面积白屏。
- 同一个 git hunk 的左右两边 marker、changed background、revert controls 必须垂直对齐。

如果另一台设备需要不同规模，可以运行：

```bash
npm run fixture:meo-many-hunks -- replace lines=5000
```

## 验证指标

修复不能只靠主观滚动感觉。至少需要这些指标：

1. 快速滚动时 blank area 最大高度。
2. long task 总时长和最大时长。
3. restore-to-middle 后目标 line 是否稳定。
4. 同一个 hunk 左右 marker top delta。
5. 同一个 hunk 左右 changed background top delta。
6. preview fallback promoted 到真实 merge view 后是否保持 logical anchor。
7. git 功能完整性：marker、背景、inline change、overview、revert controls 都不能丢。

## 当前建议的代码范围

重新写时，只保留这些文件作为主线范围：

- `src/vendor/codemirror-merge/src/mergeview.ts`
- `src/vendor/meo/webview/liveMode.ts`
- `src/features/editor/lib/meo-native-diff-split.ts`
- `test/meo-performance.spec.ts`
- 必要时增加专门的 non-Electron layout tests

暂时不应该改：

- `scripts/electron-open-file-profile.mjs`
- `src/vendor/codemirror-merge/src/deco.ts`
- `src/features/editor/components/meo-editor-host.tsx`

除非后续有明确证据表明这些文件是根因路径的一部分。
