import {
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@heroui/react'
import { CloseLine, RightLine, SearchLine } from '@mingcute/react'
import { AppScrollArea } from '@/components/app-scroll-area'
import { AppTooltipButton } from '@/components/app-tooltip'
import { isAgentKeyboardCompositionEvent } from '@/features/agent/lib/keyboard'
import {
  clampAgentThinkingLevel,
  formatThinkingLevelLabel,
  getAgentModelKey,
  hasConfigurableAgentThinkingLevel,
  parseModelSelection,
} from '@/features/agent/lib/model-selection'
import { shouldRunAgentModelCascaderDelayedActivation } from '@/features/agent/lib/model-cascader-pointer-intent'
import type { AgentThinkingLevel, AgentWorkspaceState } from '@/features/agent/types'
import './styles.css'

type AgentModelPickerOption = {
  key: string
  modelId: string
  provider: string
  thinkingLevels: AgentThinkingLevel[]
}

type AgentModelPickerKeyboardColumn = 'provider' | 'model' | 'thinking'

type AgentModelCascaderStyle = CSSProperties & {
  '--agent-model-cascader-grid-height'?: string
  '--agent-model-cascader-provider-width'?: string
  '--agent-model-cascader-thinking-width'?: string
}

type AgentModelCascaderLayoutMetrics = {
  panelWidth: number
  positioningWidth: number
  providerColumnWidth: number
  thinkingColumnWidth: number
}

type AgentModelPickerPoint = {
  x: number
  y: number
}

type AgentModelPickerPointerPoint = AgentModelPickerPoint & {
  time: number
}

type AgentModelPickerSafeTriangleTarget = 'model' | 'thinking'

type AgentModelPickerPendingActivation = {
  run: () => void
  target: AgentModelPickerSafeTriangleTarget
  timeoutId: number
  version: number
}

type AgentModelCascaderProps = {
  availableModels: AgentWorkspaceState['runtime']['availableModels']
  availableThinkingLevels: AgentWorkspaceState['runtime']['availableThinkingLevels']
  availableThinkingLevelsByModel: AgentWorkspaceState['runtime']['availableThinkingLevelsByModel']
  configuredProviders: string[]
  currentModelId: string
  currentProvider: string
  currentThinkingLevel: AgentThinkingLevel
  currentThinkingLevelLabel: string
  disabled: boolean
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
  onOpenProviderSettings?: () => void
  onSelectModel: (modelKey: string) => Promise<void>
  onSelectThinkingLevel: (level: AgentThinkingLevel, modelKey: string) => Promise<void>
}

const AGENT_MODEL_CASCADER_MARGIN_PX = 12
const AGENT_MODEL_CASCADER_GAP_PX = 10
const AGENT_MODEL_CASCADER_MAX_WIDTH_PX = 680
const AGENT_MODEL_CASCADER_MAX_HEIGHT_PX = 390
const AGENT_MODEL_CASCADER_MIN_PANEL_HEIGHT_PX = 220
const AGENT_MODEL_CASCADER_MIN_GRID_HEIGHT_PX = 172
const AGENT_MODEL_CASCADER_MAX_GRID_HEIGHT_PX = 286
const AGENT_MODEL_CASCADER_SEARCH_HEIGHT_PX = 39
const AGENT_MODEL_CASCADER_SAFE_TRIANGLE_DELAY_MS = 180
const AGENT_MODEL_CASCADER_SAFE_TRIANGLE_PADDING_PX = 18
const AGENT_MODEL_CASCADER_POINTER_TRAIL_MS = 180
const AGENT_MODEL_CASCADER_MIN_WIDTH_PX = 340
const AGENT_MODEL_CASCADER_PROVIDER_MIN_WIDTH_PX = 132
const AGENT_MODEL_CASCADER_PROVIDER_MAX_WIDTH_PX = 190
const AGENT_MODEL_CASCADER_MODEL_MIN_WIDTH_PX = 176
const AGENT_MODEL_CASCADER_MODEL_MAX_WIDTH_PX = 400
const AGENT_MODEL_CASCADER_THINKING_WIDTH_PX = 128
const AGENT_MODEL_CASCADER_SELECTOR = '[data-agent-model-cascader="true"]'
const AGENT_MODEL_CASCADER_PROVIDER_COLUMN_SELECTOR = `${AGENT_MODEL_CASCADER_SELECTOR} .agent-model-cascader-column-provider`
const AGENT_MODEL_CASCADER_MODEL_COLUMN_SELECTOR = `${AGENT_MODEL_CASCADER_SELECTOR} .agent-model-cascader-column-model`
const AGENT_MODEL_CASCADER_RESULTS_COLUMN_SELECTOR = `${AGENT_MODEL_CASCADER_SELECTOR} .agent-model-cascader-column-results`
const AGENT_MODEL_CASCADER_THINKING_COLUMN_SELECTOR = `${AGENT_MODEL_CASCADER_SELECTOR} .agent-model-cascader-column-thinking`

function getLoopedIndex(length: number, currentIndex: number, offset: number) {
  if (length <= 0) {
    return -1
  }

  if (currentIndex < 0) {
    return offset >= 0 ? 0 : length - 1
  }

  return (currentIndex + offset + length) % length
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function estimateAgentCascaderTextWidth(value: string, averageGlyphWidth: number, extraWidth: number) {
  return Math.ceil(value.length * averageGlyphWidth) + extraWidth
}

let agentCascaderTextMeasureCanvas: HTMLCanvasElement | null = null

function measureAgentCascaderTextWidth(value: string, averageGlyphWidth: number, extraWidth: number) {
  if (typeof document === 'undefined') {
    return estimateAgentCascaderTextWidth(value, averageGlyphWidth, extraWidth)
  }

  agentCascaderTextMeasureCanvas ??= document.createElement('canvas')
  const context = agentCascaderTextMeasureCanvas.getContext('2d')

  if (!context) {
    return estimateAgentCascaderTextWidth(value, averageGlyphWidth, extraWidth)
  }

  const bodyElement = document.body as HTMLElement | null
  const computedFontFamily = bodyElement ? window.getComputedStyle(bodyElement).fontFamily : ''
  const fontFamily = computedFontFamily || 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
  context.font = `13px ${fontFamily}`

  const measuredWidth = context.measureText(value).width
  if (!Number.isFinite(measuredWidth) || measuredWidth <= 0) {
    return estimateAgentCascaderTextWidth(value, averageGlyphWidth, extraWidth)
  }

  return Math.ceil(measuredWidth) + extraWidth
}

function scoreAgentModelSearchOption(
  option: AgentModelPickerOption,
  normalizedQuery: string,
  preferredProvider: string,
) {
  const modelId = option.modelId.toLowerCase()
  const provider = option.provider.toLowerCase()
  const key = option.key.toLowerCase()
  const tokens = normalizedQuery.split(/\s+/).filter(Boolean)
  const matches = tokens.every((token) => (
    modelId.includes(token) || provider.includes(token) || key.includes(token)
  ))

  if (!matches) {
    return null
  }

  let score = option.provider === preferredProvider ? 0 : 2

  if (modelId === normalizedQuery) {
    score += 0
  } else if (key === normalizedQuery) {
    score += 4
  } else if (modelId.startsWith(normalizedQuery)) {
    score += 8
  } else if (key.startsWith(normalizedQuery)) {
    score += 12
  } else if (modelId.includes(normalizedQuery)) {
    score += 20
  } else if (tokens.every((token) => modelId.includes(token))) {
    score += 24
  } else if (provider === normalizedQuery) {
    score += 30
  } else if (provider.startsWith(normalizedQuery)) {
    score += 34
  } else {
    score += 40
  }

  return score + (option.modelId.length / 1000)
}

function rankAgentModelSearchOptions(
  options: AgentModelPickerOption[],
  normalizedQuery: string,
  preferredProvider: string,
) {
  return options
    .map((option, index) => ({
      index,
      option,
      score: scoreAgentModelSearchOption(option, normalizedQuery, preferredProvider),
    }))
    .filter((entry): entry is { index: number, option: AgentModelPickerOption, score: number } => entry.score !== null)
    .sort((left, right) => left.score - right.score || left.index - right.index)
    .map((entry) => entry.option)
}

function areAgentModelCascaderStylesEqual(
  left: AgentModelCascaderStyle,
  right: AgentModelCascaderStyle,
) {
  return left.left === right.left
    && left.maxHeight === right.maxHeight
    && left.top === right.top
    && left.width === right.width
    && left['--agent-model-cascader-grid-height'] === right['--agent-model-cascader-grid-height']
    && left['--agent-model-cascader-provider-width'] === right['--agent-model-cascader-provider-width']
    && left['--agent-model-cascader-thinking-width'] === right['--agent-model-cascader-thinking-width']
}

function scrollAgentModelCascaderActiveItemsIntoView() {
  if (typeof document === 'undefined') {
    return
  }

  const cascaderElement = document.getElementById('agent-model-cascader')
  const activeItems = cascaderElement?.querySelectorAll<HTMLElement>('.agent-model-cascader-option.is-active')

  activeItems?.forEach((activeItem) => {
    const viewportElement = activeItem.closest<HTMLElement>('.app-scroll-area-viewport')

    if (!viewportElement) {
      return
    }

    const viewportRect = viewportElement.getBoundingClientRect()
    const itemRect = activeItem.getBoundingClientRect()
    const itemCenterOffset = itemRect.top - viewportRect.top + (itemRect.height / 2)
    const viewportCenterOffset = viewportRect.height / 2

    viewportElement.scrollTop += itemCenterOffset - viewportCenterOffset
  })
}

function isAgentModelCascaderPointInsideRect(
  point: AgentModelPickerPoint,
  rect: DOMRect,
  padding = 0,
) {
  return point.x >= rect.left - padding
    && point.x <= rect.right + padding
    && point.y >= rect.top - padding
    && point.y <= rect.bottom + padding
}

function getAgentModelCascaderTriangleSign(
  firstPoint: AgentModelPickerPoint,
  secondPoint: AgentModelPickerPoint,
  thirdPoint: AgentModelPickerPoint,
) {
  return (firstPoint.x - thirdPoint.x) * (secondPoint.y - thirdPoint.y)
    - (secondPoint.x - thirdPoint.x) * (firstPoint.y - thirdPoint.y)
}

function isPointInsideAgentModelCascaderTriangle(
  point: AgentModelPickerPoint,
  firstVertex: AgentModelPickerPoint,
  secondVertex: AgentModelPickerPoint,
  thirdVertex: AgentModelPickerPoint,
) {
  const firstSign = getAgentModelCascaderTriangleSign(point, firstVertex, secondVertex)
  const secondSign = getAgentModelCascaderTriangleSign(point, secondVertex, thirdVertex)
  const thirdSign = getAgentModelCascaderTriangleSign(point, thirdVertex, firstVertex)
  const hasNegative = firstSign < 0 || secondSign < 0 || thirdSign < 0
  const hasPositive = firstSign > 0 || secondSign > 0 || thirdSign > 0

  return !(hasNegative && hasPositive)
}

function resolveAgentModelCascaderStyle(
  anchorRect: DOMRect,
  layoutMetrics: AgentModelCascaderLayoutMetrics,
): AgentModelCascaderStyle {
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const margin = Math.min(AGENT_MODEL_CASCADER_MARGIN_PX, Math.max(8, viewportWidth / 32))
  const maxWidth = Math.max(280, viewportWidth - (margin * 2))
  const width = Math.min(layoutMetrics.panelWidth, maxWidth)
  const positioningWidth = Math.min(layoutMetrics.positioningWidth, maxWidth)
  const left = Math.max(margin, Math.min(anchorRect.left, viewportWidth - positioningWidth - margin))
  const availableAbove = Math.max(0, anchorRect.top - margin - AGENT_MODEL_CASCADER_GAP_PX)
  const availableBelow = Math.max(0, viewportHeight - anchorRect.bottom - margin - AGENT_MODEL_CASCADER_GAP_PX)
  const opensBelow = availableAbove < AGENT_MODEL_CASCADER_MIN_PANEL_HEIGHT_PX && availableBelow > availableAbove
  const availableHeight = opensBelow ? availableBelow : availableAbove
  const fallbackHeight = Math.max(160, viewportHeight - (margin * 2))
  const minimumHeight = Math.min(AGENT_MODEL_CASCADER_MIN_PANEL_HEIGHT_PX, fallbackHeight)
  const panelHeight = Math.min(
    AGENT_MODEL_CASCADER_MAX_HEIGHT_PX,
    Math.max(
      minimumHeight,
      Math.min(availableHeight || fallbackHeight, fallbackHeight),
    ),
  )
  const availableGridHeight = Math.max(96, panelHeight - AGENT_MODEL_CASCADER_SEARCH_HEIGHT_PX)
  const gridHeight = Math.min(
    AGENT_MODEL_CASCADER_MAX_GRID_HEIGHT_PX,
    Math.max(Math.min(AGENT_MODEL_CASCADER_MIN_GRID_HEIGHT_PX, availableGridHeight), availableGridHeight),
  )
  const renderedHeight = Math.min(panelHeight, gridHeight + AGENT_MODEL_CASCADER_SEARCH_HEIGHT_PX)
  const top = opensBelow
    ? Math.min(anchorRect.bottom + AGENT_MODEL_CASCADER_GAP_PX, viewportHeight - renderedHeight - margin)
    : Math.max(margin, anchorRect.top - AGENT_MODEL_CASCADER_GAP_PX - renderedHeight)

  return {
    left: `${left}px`,
    maxHeight: `${panelHeight}px`,
    top: `${Math.max(margin, top)}px`,
    width: `${width}px`,
    '--agent-model-cascader-grid-height': `${gridHeight}px`,
    '--agent-model-cascader-provider-width': `${layoutMetrics.providerColumnWidth}px`,
    '--agent-model-cascader-thinking-width': `${layoutMetrics.thinkingColumnWidth}px`,
  }
}

export function AgentModelCascader({
  availableModels,
  availableThinkingLevels,
  availableThinkingLevelsByModel,
  configuredProviders,
  currentModelId,
  currentProvider,
  currentThinkingLevel,
  currentThinkingLevelLabel,
  disabled,
  isOpen,
  onOpenChange,
  onOpenProviderSettings,
  onSelectModel,
  onSelectThinkingLevel,
}: AgentModelCascaderProps) {
  const [query, setQuery] = useState('')
  const [previewProvider, setPreviewProvider] = useState(currentProvider)
  const [activeModelKey, setActiveModelKey] = useState<string | null>(null)
  const [activeThinkingLevel, setActiveThinkingLevel] = useState<AgentThinkingLevel | null>(null)
  const [keyboardColumn, setKeyboardColumn] = useState<AgentModelPickerKeyboardColumn>('model')
  const searchRef = useRef<HTMLInputElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const pointerTrailRef = useRef<AgentModelPickerPointerPoint[]>([])
  const latestPointerPointRef = useRef<AgentModelPickerPointerPoint | null>(null)
  const pendingActivationRef = useRef<AgentModelPickerPendingActivation | null>(null)
  const activationVersionRef = useRef(0)
  const [cascaderStyle, setCascaderStyle] = useState<AgentModelCascaderStyle>({})
  const trimmedModelValue = currentModelId.trim()
  const selectedModelKey = trimmedModelValue
    ? getAgentModelKey(currentProvider, trimmedModelValue)
    : null
  const options = useMemo<AgentModelPickerOption[]>(() => (
    availableModels
      .map((modelKey) => {
        const selection = parseModelSelection(modelKey)

        if (!selection.provider || !selection.modelId) {
          return null
        }

        return {
          key: modelKey,
          modelId: selection.modelId,
          provider: selection.provider,
          thinkingLevels: availableThinkingLevelsByModel[modelKey] ?? availableThinkingLevels,
        }
      })
      .filter((option): option is AgentModelPickerOption => Boolean(option))
  ), [availableModels, availableThinkingLevels, availableThinkingLevelsByModel])
  const optionByKey = useMemo(() => new Map(
    options.map((option) => [option.key, option]),
  ), [options])
  const resolvedPreviewProvider = configuredProviders.includes(previewProvider)
    ? previewProvider
    : currentProvider
  const providerModels = useMemo(() => (
    options.filter((option) => option.provider === resolvedPreviewProvider)
  ), [options, resolvedPreviewProvider])
  const normalizedQuery = query.trim().toLowerCase()
  const isSearching = normalizedQuery.length > 0
  const searchResults = useMemo(() => (
    isSearching
      ? rankAgentModelSearchOptions(options, normalizedQuery, currentProvider)
      : []
  ), [currentProvider, isSearching, normalizedQuery, options])
  const activeModelCandidate = activeModelKey ? optionByKey.get(activeModelKey) ?? null : null
  const selectedModelOption = selectedModelKey ? optionByKey.get(selectedModelKey) ?? null : null
  const fallbackModelOption = providerModels[0] ?? options[0] ?? null
  const activeModelOption = isSearching
    ? (
        activeModelCandidate && searchResults.some((option) => option.key === activeModelCandidate.key)
          ? activeModelCandidate
          : searchResults[0] ?? null
      )
    : (
        activeModelCandidate?.provider === resolvedPreviewProvider
          ? activeModelCandidate
          : selectedModelOption?.provider === resolvedPreviewProvider
            ? selectedModelOption
            : fallbackModelOption
      )
  const activeModelThinkingLevels = activeModelOption?.thinkingLevels ?? []
  const selectedActiveThinkingLevel = clampAgentThinkingLevel(
    currentThinkingLevel,
    activeModelThinkingLevels,
  )
  const previewThinkingLevel = activeThinkingLevel
    && activeModelThinkingLevels.includes(activeThinkingLevel)
    ? activeThinkingLevel
    : selectedActiveThinkingLevel
  const selectedModelThinkingLevels = selectedModelOption?.thinkingLevels
    ?? (
      selectedModelKey
        ? availableThinkingLevelsByModel[selectedModelKey] ?? availableThinkingLevels
        : []
    )
  const showThinkingColumn = hasConfigurableAgentThinkingLevel(activeModelThinkingLevels)
  const layoutMetrics = useMemo<AgentModelCascaderLayoutMetrics>(() => {
    const providerColumnWidth = clampNumber(
      configuredProviders.reduce((maxWidth, provider) => Math.max(
        maxWidth,
        estimateAgentCascaderTextWidth(provider, 8, 44),
      ), AGENT_MODEL_CASCADER_PROVIDER_MIN_WIDTH_PX),
      AGENT_MODEL_CASCADER_PROVIDER_MIN_WIDTH_PX,
      AGENT_MODEL_CASCADER_PROVIDER_MAX_WIDTH_PX,
    )
    const listedModelOptions = isSearching ? searchResults : providerModels
    const fallbackModelOptions = listedModelOptions.length > 0 ? listedModelOptions : providerModels
    const hasAnyListedThinkingColumn = listedModelOptions.some((option) => (
      hasConfigurableAgentThinkingLevel(option.thinkingLevels)
    ))
    const modelColumnWidth = clampNumber(
      fallbackModelOptions.reduce((maxWidth, option) => {
        const estimatedWidth = isSearching
          ? measureAgentCascaderTextWidth(`${option.modelId} ${option.provider}`, 8, 42)
          : measureAgentCascaderTextWidth(option.modelId, 8.2, 34)

        return Math.max(maxWidth, estimatedWidth)
      }, AGENT_MODEL_CASCADER_MODEL_MIN_WIDTH_PX),
      AGENT_MODEL_CASCADER_MODEL_MIN_WIDTH_PX,
      AGENT_MODEL_CASCADER_MODEL_MAX_WIDTH_PX,
    )
    const thinkingColumnWidth = showThinkingColumn ? AGENT_MODEL_CASCADER_THINKING_WIDTH_PX : 0
    const rawPanelWidth = isSearching
      ? modelColumnWidth + thinkingColumnWidth
      : providerColumnWidth + modelColumnWidth + thinkingColumnWidth

    return {
      panelWidth: clampNumber(rawPanelWidth, AGENT_MODEL_CASCADER_MIN_WIDTH_PX, AGENT_MODEL_CASCADER_MAX_WIDTH_PX),
      positioningWidth: clampNumber(
        rawPanelWidth + (hasAnyListedThinkingColumn ? AGENT_MODEL_CASCADER_THINKING_WIDTH_PX - thinkingColumnWidth : 0),
        AGENT_MODEL_CASCADER_MIN_WIDTH_PX,
        AGENT_MODEL_CASCADER_MAX_WIDTH_PX,
      ),
      providerColumnWidth,
      thinkingColumnWidth: AGENT_MODEL_CASCADER_THINKING_WIDTH_PX,
    }
  }, [configuredProviders, isSearching, providerModels, searchResults, showThinkingColumn])
  const showTriggerThinkingLevel = currentThinkingLevel !== 'off'
    && hasConfigurableAgentThinkingLevel(selectedModelThinkingLevels)
  const triggerLabel = trimmedModelValue || 'model'
  const triggerTitle = selectedModelKey
    ? showTriggerThinkingLevel
      ? `${selectedModelKey}, thinking ${currentThinkingLevelLabel}`
      : selectedModelKey
    : 'Model'
  const listedModels = isSearching ? searchResults : providerModels
  const hasConfiguredProviders = configuredProviders.length > 0

  const updatePosition = useCallback(() => {
    const triggerElement = triggerRef.current
    if (!triggerElement) {
      return
    }

    const nextStyle = resolveAgentModelCascaderStyle(
      triggerElement.getBoundingClientRect(),
      layoutMetrics,
    )
    setCascaderStyle((currentStyle) => (
      areAgentModelCascaderStylesEqual(currentStyle, nextStyle) ? currentStyle : nextStyle
    ))
  }, [
    layoutMetrics.panelWidth,
    layoutMetrics.positioningWidth,
    layoutMetrics.providerColumnWidth,
    layoutMetrics.thinkingColumnWidth,
  ])

  function scrollActiveItemsOnNextFrame() {
    window.requestAnimationFrame(scrollAgentModelCascaderActiveItemsIntoView)
  }

  function clearPendingActivation() {
    const pendingActivation = pendingActivationRef.current
    if (!pendingActivation) {
      return
    }

    window.clearTimeout(pendingActivation.timeoutId)
    pendingActivationRef.current = null
  }

  function clearPointerIntent() {
    clearPendingActivation()
    pointerTrailRef.current = []
    latestPointerPointRef.current = null
  }

  function flushPendingActivation(target?: AgentModelPickerSafeTriangleTarget) {
    const pendingActivation = pendingActivationRef.current
    if (!pendingActivation || target && pendingActivation.target !== target) {
      return
    }

    window.clearTimeout(pendingActivation.timeoutId)
    pendingActivationRef.current = null
    pendingActivation.run()
  }

  function invalidatePointerIntent() {
    activationVersionRef.current += 1
    clearPointerIntent()
  }

  function createPointerPoint(event: ReactPointerEvent<HTMLElement> | ReactMouseEvent<HTMLElement>) {
    return {
      time: window.performance.now(),
      x: event.clientX,
      y: event.clientY,
    }
  }

  function seedPointerTrailFromTrigger(event: ReactMouseEvent<HTMLElement>) {
    const triggerRect = triggerRef.current?.getBoundingClientRect()
    const point = createPointerPoint(event)

    pointerTrailRef.current = [{
      ...point,
      x: triggerRect ? Math.min(point.x, triggerRect.left + 8) : point.x,
    }]
  }

  function recordPointerPoint(event: ReactPointerEvent<HTMLElement>) {
    const nextPoint = createPointerPoint(event)
    latestPointerPointRef.current = nextPoint
    const currentTrail = pointerTrailRef.current
    const lastPoint = currentTrail[currentTrail.length - 1]

    if (
      lastPoint
      && Math.abs(lastPoint.x - nextPoint.x) < 0.5
      && Math.abs(lastPoint.y - nextPoint.y) < 0.5
    ) {
      return lastPoint
    }

    pointerTrailRef.current = [
      ...currentTrail.filter((point) => nextPoint.time - point.time <= AGENT_MODEL_CASCADER_POINTER_TRAIL_MS),
      nextPoint,
    ].slice(-8)

    return nextPoint
  }

  function getPointerTriangleOrigin(
    currentPoint: AgentModelPickerPointerPoint,
    sourceColumnRect: DOMRect,
  ) {
    return pointerTrailRef.current.find((point) => (
      point.time < currentPoint.time
      && (Math.abs(point.x - currentPoint.x) >= 0.5 || Math.abs(point.y - currentPoint.y) >= 0.5)
      && isAgentModelCascaderPointInsideRect(
        point,
        sourceColumnRect,
        AGENT_MODEL_CASCADER_SAFE_TRIANGLE_PADDING_PX,
      )
    )) ?? null
  }

  function activateModelPreview(modelKey: string) {
    clearPendingActivation()
    setActiveModelKey(modelKey)
    setActiveThinkingLevel(null)
  }

  function isPointerInsideColumnSafeTriangle(
    currentPoint: AgentModelPickerPointerPoint,
    sourceSelector: string,
    targetSelector: string,
  ) {
    const sourceColumnElement = document.querySelector<HTMLElement>(sourceSelector)
    const targetColumnElement = document.querySelector<HTMLElement>(targetSelector)

    if (!sourceColumnElement || !targetColumnElement) {
      return false
    }

    const sourceColumnRect = sourceColumnElement.getBoundingClientRect()
    const targetColumnRect = targetColumnElement.getBoundingClientRect()
    const originPoint = getPointerTriangleOrigin(currentPoint, sourceColumnRect)

    if (!originPoint || originPoint.x >= targetColumnRect.left || currentPoint.x <= originPoint.x + 1) {
      return false
    }

    if (currentPoint.x >= targetColumnRect.left - 1) {
      return true
    }

    return isPointInsideAgentModelCascaderTriangle(
      currentPoint,
      originPoint,
      {
        x: targetColumnRect.left,
        y: targetColumnRect.top - AGENT_MODEL_CASCADER_SAFE_TRIANGLE_PADDING_PX,
      },
      {
        x: targetColumnRect.left,
        y: targetColumnRect.bottom + AGENT_MODEL_CASCADER_SAFE_TRIANGLE_PADDING_PX,
      },
    )
  }

  function isPointerInsideModelSafeTriangle(currentPoint: AgentModelPickerPointerPoint) {
    if (isSearching || configuredProviders.length <= 1) {
      return false
    }

    return isPointerInsideColumnSafeTriangle(
      currentPoint,
      AGENT_MODEL_CASCADER_PROVIDER_COLUMN_SELECTOR,
      AGENT_MODEL_CASCADER_MODEL_COLUMN_SELECTOR,
    )
  }

  function isPointerInsideThinkingSafeTriangle(currentPoint: AgentModelPickerPointerPoint) {
    if (!showThinkingColumn || !activeModelOption) {
      return false
    }

    const sourceSelector = isSearching
      ? AGENT_MODEL_CASCADER_RESULTS_COLUMN_SELECTOR
      : AGENT_MODEL_CASCADER_MODEL_COLUMN_SELECTOR

    return isPointerInsideColumnSafeTriangle(
      currentPoint,
      sourceSelector,
      AGENT_MODEL_CASCADER_THINKING_COLUMN_SELECTOR,
    )
  }

  function isPointerInsideSafeTriangle(
    currentPoint: AgentModelPickerPointerPoint,
    target: AgentModelPickerSafeTriangleTarget,
  ) {
    return target === 'model'
      ? isPointerInsideModelSafeTriangle(currentPoint)
      : isPointerInsideThinkingSafeTriangle(currentPoint)
  }

  function scheduleDelayedActivation(run: () => void, target: AgentModelPickerSafeTriangleTarget) {
    clearPendingActivation()

    const version = activationVersionRef.current
    const timeoutId = window.setTimeout(() => {
      const latestPoint = latestPointerPointRef.current
      if (
        pendingActivationRef.current?.timeoutId !== timeoutId
        || pendingActivationRef.current.version !== version
        || activationVersionRef.current !== version
      ) {
        return
      }

      if (!shouldRunAgentModelCascaderDelayedActivation(
        latestPoint,
        target,
        isPointerInsideSafeTriangle,
      )) {
        return
      }

      pendingActivationRef.current = null
      run()
    }, AGENT_MODEL_CASCADER_SAFE_TRIANGLE_DELAY_MS)

    pendingActivationRef.current = {
      run,
      target,
      timeoutId,
      version,
    }
  }

  function flushPendingActivationIfOutsideSafeTriangle(currentPoint: AgentModelPickerPointerPoint) {
    const pendingActivation = pendingActivationRef.current
    if (!pendingActivation || isPointerInsideSafeTriangle(currentPoint, pendingActivation.target)) {
      return
    }

    flushPendingActivation()
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLElement>) {
    const currentPoint = recordPointerPoint(event)
    flushPendingActivationIfOutsideSafeTriangle(currentPoint)
  }

  function runOrDelayPointerActivation(
    event: ReactPointerEvent<HTMLElement>,
    target: AgentModelPickerSafeTriangleTarget,
    run: () => void,
  ) {
    const currentPoint = recordPointerPoint(event)

    if (isPointerInsideSafeTriangle(currentPoint, target)) {
      scheduleDelayedActivation(run, target)
      return
    }

    clearPendingActivation()
    run()
  }

  function handleModelPointerPreview(modelKey: string, event: ReactPointerEvent<HTMLElement>) {
    if (modelKey === activeModelOption?.key) {
      recordPointerPoint(event)
      clearPendingActivation()
      return
    }

    runOrDelayPointerActivation(event, 'thinking', () => {
      activateModelPreview(modelKey)
    })
  }

  function handleProviderPointerFocus(provider: string, event: ReactPointerEvent<HTMLElement>) {
    runOrDelayPointerActivation(event, 'model', () => {
      setKeyboardColumn('provider')
      handleProviderFocus(provider)
    })
  }

  function openCascader(event?: ReactMouseEvent<HTMLButtonElement>) {
    if (!hasConfiguredProviders || disabled) {
      return
    }

    invalidatePointerIntent()

    if (isOpen) {
      onOpenChange(false)
      return
    }

    const initialModelKey = selectedModelOption?.key ?? fallbackModelOption?.key ?? null
    setQuery('')
    setPreviewProvider(currentProvider)
    setActiveModelKey(initialModelKey)
    setActiveThinkingLevel(null)
    setKeyboardColumn('model')
    if (event && initialModelKey) {
      seedPointerTrailFromTrigger(event)
    } else {
      pointerTrailRef.current = []
    }

    updatePosition()
    onOpenChange(true)
  }

  function handleProviderFocus(provider: string) {
    clearPointerIntent()
    setPreviewProvider(provider)
    setActiveModelKey(options.find((option) => option.provider === provider)?.key ?? null)
    setActiveThinkingLevel(null)
  }

  function handleQueryChange(value: string) {
    clearPointerIntent()
    setQuery(value)
    setKeyboardColumn('model')
    setActiveThinkingLevel(null)

    const nextQuery = value.trim().toLowerCase()
    if (!nextQuery) {
      setActiveModelKey(selectedModelOption?.key ?? fallbackModelOption?.key ?? null)
      return
    }

    setActiveModelKey(
      rankAgentModelSearchOptions(options, nextQuery, currentProvider)[0]?.key ?? null,
    )
  }

  function handleKeyboardMove(offset: number) {
    if (keyboardColumn === 'provider' && !isSearching) {
      const currentIndex = configuredProviders.indexOf(resolvedPreviewProvider)
      const nextProvider = configuredProviders[getLoopedIndex(configuredProviders.length, currentIndex, offset)]

      if (nextProvider) {
        handleProviderFocus(nextProvider)
        scrollActiveItemsOnNextFrame()
      }

      return
    }

    if (keyboardColumn === 'thinking' && showThinkingColumn) {
      const currentIndex = activeModelThinkingLevels.indexOf(previewThinkingLevel)
      const nextThinkingLevel = activeModelThinkingLevels[getLoopedIndex(activeModelThinkingLevels.length, currentIndex, offset)]

      if (nextThinkingLevel) {
        setActiveThinkingLevel(nextThinkingLevel)
        scrollActiveItemsOnNextFrame()
      }

      return
    }

    const currentIndex = listedModels.findIndex((option) => option.key === activeModelOption?.key)
    const nextModel = listedModels[getLoopedIndex(listedModels.length, currentIndex, offset)]

    if (nextModel) {
      activateModelPreview(nextModel.key)
      scrollActiveItemsOnNextFrame()
    }
  }

  function handleKeyboardLeft() {
    if (keyboardColumn === 'thinking') {
      setKeyboardColumn('model')
      scrollActiveItemsOnNextFrame()
      return
    }

    if (keyboardColumn === 'model' && !isSearching) {
      setKeyboardColumn('provider')
      scrollActiveItemsOnNextFrame()
    }
  }

  function handleKeyboardRight() {
    if (keyboardColumn === 'provider') {
      setKeyboardColumn('model')
      scrollActiveItemsOnNextFrame()
      return
    }

    if (keyboardColumn === 'model' && showThinkingColumn) {
      setKeyboardColumn('thinking')
      setActiveThinkingLevel(selectedActiveThinkingLevel)
      scrollActiveItemsOnNextFrame()
    }
  }

  function handleKeyboardEnter() {
    if (keyboardColumn === 'provider') {
      setKeyboardColumn('model')
      scrollActiveItemsOnNextFrame()
      return
    }

    if (keyboardColumn === 'thinking' && showThinkingColumn && activeModelOption) {
      void handleThinkingSelect(previewThinkingLevel, activeModelOption.key)
      return
    }

    if (activeModelOption) {
      void handleModelSelect(activeModelOption)
    }
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (isAgentKeyboardCompositionEvent(event)) {
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      onOpenChange(false)
      return
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      handleKeyboardMove(1)
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      handleKeyboardMove(-1)
      return
    }

    if (event.key === 'ArrowLeft') {
      if (isSearching) {
        return
      }

      event.preventDefault()
      handleKeyboardLeft()
      return
    }

    if (event.key === 'ArrowRight') {
      if (isSearching) {
        return
      }

      event.preventDefault()
      handleKeyboardRight()
      return
    }

    if (event.key === 'Enter') {
      event.preventDefault()
      handleKeyboardEnter()
    }
  }

  async function handleModelSelect(option: AgentModelPickerOption) {
    clearPointerIntent()
    setActiveModelKey(option.key)
    onOpenChange(false)
    await onSelectModel(option.key)
  }

  async function handleThinkingSelect(level: AgentThinkingLevel, modelKey: string) {
    clearPendingActivation()
    const option = optionByKey.get(modelKey)

    if (!option || !option.thinkingLevels.includes(level)) {
      return
    }

    clearPointerIntent()
    setActiveModelKey(modelKey)
    onOpenChange(false)
    await onSelectThinkingLevel(level, modelKey)
  }

  useLayoutEffect(() => {
    if (!isOpen) {
      invalidatePointerIntent()
    }
  }, [isOpen])

  useEffect(() => () => {
    invalidatePointerIntent()
  }, [])

  useLayoutEffect(() => {
    if (!isOpen) {
      return
    }

    updatePosition()

    const frameId = window.requestAnimationFrame(updatePosition)
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)

    return () => {
      window.cancelAnimationFrame(frameId)
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [isOpen, updatePosition])

  useEffect(() => {
    if (!isOpen) {
      return
    }

    const frameId = window.requestAnimationFrame(() => {
      searchRef.current?.focus()
      scrollAgentModelCascaderActiveItemsIntoView()
    })

    return () => {
      window.cancelAnimationFrame(frameId)
    }
  }, [isOpen])

  return (
    <div className='agent-model-field'>
      {hasConfiguredProviders ? (
        <AppTooltipButton
          ref={triggerRef}
          type='button'
          aria-expanded={isOpen}
          aria-controls='agent-model-cascader'
          aria-haspopup='dialog'
          aria-label={triggerTitle}
          className='agent-model-cascader-trigger'
          disabled={disabled}
          onClick={openCascader}
          onPointerMove={(event) => {
            if (isOpen) {
              recordPointerPoint(event)
            }
          }}
        >
          <span className='agent-model-cascader-trigger-model'>{triggerLabel}</span>
          {showTriggerThinkingLevel ? (
            <>
              <span className='agent-model-cascader-trigger-separator'>/</span>
              <span className='agent-model-cascader-trigger-thinking'>
                {currentThinkingLevelLabel}
              </span>
            </>
          ) : null}
        </AppTooltipButton>
      ) : (
        <Button
          className='agent-provider-setup-button'
          size='sm'
          variant='ghost'
          onPress={() => {
            onOpenChange(false)
            onOpenProviderSettings?.()
          }}
        >
          配置提供商
        </Button>
      )}

      {isOpen && hasConfiguredProviders && typeof document !== 'undefined' ? createPortal(
        <div
          id='agent-model-cascader'
          className='agent-model-cascader'
          data-agent-model-cascader='true'
          role='dialog'
          aria-label='Select model and thinking level'
          style={cascaderStyle}
          onPointerMove={handlePointerMove}
          onPointerLeave={clearPointerIntent}
        >
          <div className='agent-model-cascader-search'>
            <SearchLine aria-hidden='true' size={16} />
            <input
              ref={searchRef}
              type='search'
              aria-label='Search models'
              placeholder='Search models'
              value={query}
              onChange={(event) => {
                handleQueryChange(event.target.value)
              }}
              onKeyDown={handleSearchKeyDown}
            />
            {query ? (
              <AppTooltipButton
                type='button'
                className='agent-model-cascader-search-clear'
                aria-label='Clear model search'
                tooltip='清除搜索'
                onPointerDown={(event) => {
                  event.preventDefault()
                }}
                onClick={() => {
                  handleQueryChange('')
                  window.requestAnimationFrame(() => {
                    searchRef.current?.focus()
                  })
                }}
              >
                <CloseLine aria-hidden='true' size={14} />
              </AppTooltipButton>
            ) : null}
          </div>

          <div className={`agent-model-cascader-grid${isSearching ? ' is-searching' : ''}${showThinkingColumn ? '' : ' has-no-thinking'}`}>
            {isSearching ? (
              <section className='agent-model-cascader-column agent-model-cascader-column-results'>
                <div className='agent-model-cascader-column-title'>Models</div>
                <AppScrollArea
                  className='agent-model-cascader-scroll'
                  contentClassName='agent-model-cascader-scroll-content'
                >
                  <div className='agent-model-cascader-list' role='listbox' aria-label='Matching models'>
                    {searchResults.length > 0 ? searchResults.map((option) => (
                      <button
                        key={option.key}
                        type='button'
                        role='option'
                        aria-selected={option.key === selectedModelKey}
                        className={`agent-model-cascader-option agent-model-cascader-model-option${option.key === activeModelOption?.key ? ' is-active' : ''}${option.key === selectedModelKey ? ' is-selected' : ''}`}
                        onFocus={() => {
                          activateModelPreview(option.key)
                          setKeyboardColumn('model')
                        }}
                        onPointerEnter={(event) => {
                          setKeyboardColumn('model')
                          handleModelPointerPreview(option.key, event)
                        }}
                        onPointerMove={(event) => {
                          handleModelPointerPreview(option.key, event)
                        }}
                        onClick={() => {
                          void handleModelSelect(option)
                        }}
                      >
                        <span className='agent-model-cascader-option-main'>{option.modelId}</span>
                        <span className='agent-model-cascader-option-sub'>{option.provider}</span>
                      </button>
                    )) : (
                      <div className='agent-model-cascader-empty'>No matching models</div>
                    )}
                  </div>
                </AppScrollArea>
              </section>
            ) : (
              <>
                <section className='agent-model-cascader-column agent-model-cascader-column-provider'>
                  <div className='agent-model-cascader-column-title'>Provider</div>
                  <AppScrollArea
                    className='agent-model-cascader-scroll'
                    contentClassName='agent-model-cascader-scroll-content'
                  >
                    <div className='agent-model-cascader-list' role='listbox' aria-label='Available providers'>
                      {configuredProviders.map((provider) => (
                        <button
                          key={provider}
                          type='button'
                          role='option'
                          aria-selected={provider === resolvedPreviewProvider}
                          className={`agent-model-cascader-option${provider === resolvedPreviewProvider ? ' is-active' : ''}${provider === currentProvider ? ' is-selected' : ''}`}
                          onFocus={() => {
                            setKeyboardColumn('provider')
                            handleProviderFocus(provider)
                          }}
                          onPointerEnter={(event) => {
                            handleProviderPointerFocus(provider, event)
                          }}
                          onClick={() => {
                            setKeyboardColumn('provider')
                            handleProviderFocus(provider)
                          }}
                        >
                          <span className='agent-model-cascader-option-main'>{provider}</span>
                          <RightLine aria-hidden='true' className='agent-model-cascader-option-arrow' size={13} />
                        </button>
                      ))}
                    </div>
                  </AppScrollArea>
                </section>

                <section
                  className='agent-model-cascader-column agent-model-cascader-column-model'
                  onPointerEnter={() => {
                    if (pendingActivationRef.current?.target === 'model') {
                      clearPendingActivation()
                    }
                  }}
                >
                  <div className='agent-model-cascader-column-title'>Model</div>
                  <AppScrollArea
                    className='agent-model-cascader-scroll'
                    contentClassName='agent-model-cascader-scroll-content'
                  >
                    <div className='agent-model-cascader-list' role='listbox' aria-label='Available models'>
                      {providerModels.map((option) => (
                        <button
                          key={option.key}
                          type='button'
                          role='option'
                          aria-selected={option.key === selectedModelKey}
                          className={`agent-model-cascader-option agent-model-cascader-model-option${option.key === activeModelOption?.key ? ' is-active' : ''}${option.key === selectedModelKey ? ' is-selected' : ''}`}
                          onFocus={() => {
                            activateModelPreview(option.key)
                            setKeyboardColumn('model')
                          }}
                          onPointerEnter={(event) => {
                            setKeyboardColumn('model')
                            handleModelPointerPreview(option.key, event)
                          }}
                          onPointerMove={(event) => {
                            handleModelPointerPreview(option.key, event)
                          }}
                          onClick={() => {
                            void handleModelSelect(option)
                          }}
                        >
                          <span className='agent-model-cascader-option-main'>{option.modelId}</span>
                        </button>
                      ))}
                    </div>
                  </AppScrollArea>
                </section>
              </>
            )}

            {showThinkingColumn && activeModelOption ? (
              <section
                key={activeModelOption.key}
                data-model-key={activeModelOption.key}
                className='agent-model-cascader-column agent-model-cascader-column-thinking'
                onPointerEnter={() => {
                  clearPendingActivation()
                }}
              >
                <div className='agent-model-cascader-column-title'>Thinking level</div>
                <AppScrollArea
                  className='agent-model-cascader-scroll'
                  contentClassName='agent-model-cascader-scroll-content'
                >
                  <div className='agent-model-cascader-list' role='listbox' aria-label='Available thinking levels'>
                    {activeModelThinkingLevels.map((level) => (
                      <button
                        key={level}
                        type='button'
                        role='option'
                        aria-selected={level === selectedActiveThinkingLevel}
                        className={`agent-model-cascader-option${level === previewThinkingLevel ? ' is-active' : ''}${level === selectedActiveThinkingLevel ? ' is-selected' : ''}`}
                        onFocus={() => {
                          setActiveThinkingLevel(level)
                          setKeyboardColumn('thinking')
                        }}
                        onPointerEnter={() => {
                          clearPendingActivation()
                          setActiveThinkingLevel(level)
                          setKeyboardColumn('thinking')
                        }}
                        onClick={() => {
                          void handleThinkingSelect(level, activeModelOption.key)
                        }}
                      >
                        <span className='agent-model-cascader-option-main'>{formatThinkingLevelLabel(level)}</span>
                      </button>
                    ))}
                  </div>
                </AppScrollArea>
              </section>
            ) : null}
          </div>
        </div>,
        document.body,
      ) : null}
    </div>
  )
}
