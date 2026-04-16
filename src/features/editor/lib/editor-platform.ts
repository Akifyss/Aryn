export type EditorRuntimeId = 'monaco-standalone' | 'vscode-compat'
export type DiffEngineId = 'codemirror-merge' | 'monaco-diff' | 'vscode-workbench'

export type PlatformStability = 'stable' | 'experimental' | 'planned'

type EditorRuntimeOption = {
  capabilities: string[]
  description: string
  detail: string
  id: EditorRuntimeId
  isSelectable: boolean
  label: string
  stability: PlatformStability
}

type DiffEngineOption = {
  capabilities: string[]
  description: string
  detail: string
  id: DiffEngineId
  isSelectable: boolean
  label: string
  stability: PlatformStability
}

export type PlatformResolution<TId extends string, TOption> = {
  fallbackReason: string | null
  preferredId: TId
  resolvedId: TId
  resolvedOption: TOption
}

const STABLE_EDITOR_RUNTIME_ID: EditorRuntimeId = 'monaco-standalone'
const STABLE_DIFF_ENGINE_ID: DiffEngineId = 'codemirror-merge'

export const EDITOR_RUNTIME_OPTIONS: EditorRuntimeOption[] = [
  {
    capabilities: [
      '当前生产默认路径',
      'Monaco 独立运行时',
      '本地文件编辑与输入法行为已验证',
    ],
    description: '当前稳定代码编辑器实现，继续作为所有实验能力的安全回退基线。',
    detail: '适合作为默认生产方案，也便于后续逐步接入更高阶能力时做对照验证。',
    id: 'monaco-standalone',
    isSelectable: true,
    label: 'Monaco 独立运行时',
    stability: 'stable',
  },
  {
    capabilities: [
      '目标能力：VS Code 扩展 API',
      '目标能力：扩展宿主与文件服务 override',
      '后续阶段再评估 Webview / Custom Editor',
    ],
    description: '规划中的兼容层入口，用于承接 VS Code 风格的扩展运行时。',
    detail: '复杂扩展和更接近 VS Code 的体验依赖这一层，但必须先补齐文件系统、生命周期与隔离边界。',
    id: 'vscode-compat',
    isSelectable: false,
    label: 'VS Code 兼容运行时',
    stability: 'planned',
  },
]

export const DIFF_ENGINE_OPTIONS: DiffEngineOption[] = [
  {
    capabilities: [
      '当前生产默认路径',
      '块级 stage / unstage / discard',
      '支持统一视图与分栏视图',
    ],
    description: '当前 Git diff 编辑器实现，最贴近现有工作流能力和交互需求。',
    detail: '虽然不是最终形态，但它已经覆盖块级操作、保存、自动保存和输入法场景，是当前最稳的基线。',
    id: 'codemirror-merge',
    isSelectable: true,
    label: 'CodeMirror Merge',
    stability: 'stable',
  },
  {
    capabilities: [
      '适合基础双栏对比',
      '与 Monaco 代码编辑器风格接近',
      '尚不覆盖现有块级 Git 工作流',
    ],
    description: '规划中的补充方案，可用于未来验证 Monaco 原生 diff 是否值得作为轻量备选。',
    detail: '它不该直接替换当前 Git diff 工作流，除非我们先补齐块级操作、可编辑修改侧和统一视图等缺口。',
    id: 'monaco-diff',
    isSelectable: false,
    label: 'Monaco Diff',
    stability: 'experimental',
  },
  {
    capabilities: [
      '目标能力：更强的 merge / multi-diff 体验',
      '更接近 VS Code 工作台能力',
      '依赖更完整的 VS Code 兼容层',
    ],
    description: '长期目标路线，面向更强的差异比对和合并体验。',
    detail: '这条路线潜力最大，但要建立在更完整的 VS Code 运行时兼容层之上，不能先于基础设施硬接。',
    id: 'vscode-workbench',
    isSelectable: false,
    label: 'VS Code Merge / Diff',
    stability: 'planned',
  },
]

function resolvePlatformChoice<TId extends string, TOption extends { id: TId, isSelectable: boolean }>(
  options: TOption[],
  fallbackId: TId,
  preferredId: TId,
  missingReason: string,
  unavailableReason: string,
): PlatformResolution<TId, TOption> {
  const fallbackOption = options.find((option) => option.id === fallbackId)

  if (!fallbackOption) {
    throw new Error(`Missing fallback option for ${fallbackId}`)
  }

  const preferredOption = options.find((option) => option.id === preferredId)

  if (!preferredOption) {
    return {
      fallbackReason: missingReason,
      preferredId,
      resolvedId: fallbackId,
      resolvedOption: fallbackOption,
    }
  }

  if (!preferredOption.isSelectable) {
    return {
      fallbackReason: unavailableReason,
      preferredId,
      resolvedId: fallbackId,
      resolvedOption: fallbackOption,
    }
  }

  return {
    fallbackReason: null,
    preferredId,
    resolvedId: preferredOption.id,
    resolvedOption: preferredOption,
  }
}

export function isEditorRuntimeId(value: unknown): value is EditorRuntimeId {
  return typeof value === 'string' && EDITOR_RUNTIME_OPTIONS.some((option) => option.id === value)
}

export function isDiffEngineId(value: unknown): value is DiffEngineId {
  return typeof value === 'string' && DIFF_ENGINE_OPTIONS.some((option) => option.id === value)
}

export function resolveEditorRuntimeChoice(
  preferredId: EditorRuntimeId | undefined = STABLE_EDITOR_RUNTIME_ID,
): PlatformResolution<EditorRuntimeId, EditorRuntimeOption> {
  const requestedId = preferredId ?? STABLE_EDITOR_RUNTIME_ID

  return resolvePlatformChoice(
    EDITOR_RUNTIME_OPTIONS,
    STABLE_EDITOR_RUNTIME_ID,
    requestedId,
    '无法识别已保存的编辑器运行时设置，已回退到稳定方案。',
    '当前所选编辑器运行时尚未开放，已回退到稳定方案。',
  )
}

export function resolveDiffEngineChoice(
  preferredId: DiffEngineId | undefined = STABLE_DIFF_ENGINE_ID,
): PlatformResolution<DiffEngineId, DiffEngineOption> {
  const requestedId = preferredId ?? STABLE_DIFF_ENGINE_ID

  return resolvePlatformChoice(
    DIFF_ENGINE_OPTIONS,
    STABLE_DIFF_ENGINE_ID,
    requestedId,
    '无法识别已保存的 diff 引擎设置，已回退到稳定方案。',
    '当前所选 diff 引擎尚未开放，已回退到稳定方案。',
  )
}
