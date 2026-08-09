import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type Ref,
} from 'react'
import { AppButton } from '@/components/app-button'
import { AppScrollArea } from '@/components/app-scroll-area'
import type { MeoHeading } from '@/features/editor/lib/meo-native-editor-types'

type MeoOutlineEditor = {
  getHeadings: () => MeoHeading[]
  moveHeadingSection: (
    sourceFrom: number,
    targetFrom: number,
    placement: 'before' | 'after',
  ) => boolean
  scrollToLine: (line: number, position: string) => void
}

type OutlineDropPlacement = 'before' | 'after'

type OutlineDragState = {
  sourceFrom: number
}

type OutlineDropTarget = {
  placement: OutlineDropPlacement
  targetFrom: number
}

type OutlineVisualState = {
  draggedFrom: number | null
  dropTarget: OutlineDropTarget | null
}

type MeoNativeOutlineProps = {
  getEditor: () => MeoOutlineEditor | null
  getEditorWrapper: () => HTMLElement | null
  getOutlineButton: () => HTMLButtonElement | null
  getRoot: () => HTMLElement | null
}

export type MeoNativeOutlineController = {
  destroy: () => void
  isVisible: () => boolean
  refresh: () => void
  setPosition: (position: 'left' | 'right') => void
  setVisible: (visible: boolean) => void
}

export function buildOutlineSubtreeEndIndexes(headings: readonly MeoHeading[]) {
  const subtreeEnds = new Array<number>(headings.length)

  for (let index = 0; index < headings.length; index += 1) {
    let endIndex = headings.length - 1

    for (let nextIndex = index + 1; nextIndex < headings.length; nextIndex += 1) {
      if (headings[nextIndex].level <= headings[index].level) {
        endIndex = nextIndex - 1
        break
      }
    }

    subtreeEnds[index] = endIndex
  }

  return subtreeEnds
}

export function resolveOutlineDropTarget({
  headings,
  placement,
  sourceFrom,
  targetFrom,
}: {
  headings: readonly MeoHeading[]
  placement: OutlineDropPlacement
  sourceFrom: number
  targetFrom: number
}): OutlineDropTarget | null {
  const headingIndexByFrom = new Map(
    headings.map((heading, index) => [heading.from, index]),
  )
  const sourceIndex = headingIndexByFrom.get(sourceFrom)
  const targetIndex = headingIndexByFrom.get(targetFrom)

  if (sourceIndex === undefined || targetIndex === undefined) {
    return null
  }

  const subtreeEnds = buildOutlineSubtreeEndIndexes(headings)
  const sourceSubtreeEndIndex = subtreeEnds[sourceIndex]
  const targetSubtreeEndIndex = subtreeEnds[targetIndex]

  if (sourceSubtreeEndIndex === undefined || targetSubtreeEndIndex === undefined) {
    return null
  }

  if (targetIndex >= sourceIndex && targetIndex <= sourceSubtreeEndIndex) {
    return null
  }

  const insertionSlot = placement === 'before'
    ? targetIndex
    : targetSubtreeEndIndex + 1
  const sourceBlockLength = sourceSubtreeEndIndex - sourceIndex + 1
  const adjustedSlot = insertionSlot > sourceSubtreeEndIndex
    ? insertionSlot - sourceBlockLength
    : insertionSlot

  if (adjustedSlot === sourceIndex) {
    return null
  }

  return { placement, targetFrom }
}

function getDropPlacement(event: DragEvent<HTMLElement>): OutlineDropPlacement {
  const rect = event.currentTarget.getBoundingClientRect()
  return event.clientY <= rect.top + (rect.height / 2) ? 'before' : 'after'
}

function areDropTargetsEqual(
  left: OutlineDropTarget | null,
  right: OutlineDropTarget | null,
) {
  return left?.placement === right?.placement
    && left?.targetFrom === right?.targetFrom
}

function normalizeHeadingLabel(heading: MeoHeading) {
  const label = heading.text.trim()
  return label || 'Untitled heading'
}

export const MeoNativeOutline = forwardRef(function MeoNativeOutline(
  {
    getEditor,
    getEditorWrapper,
    getOutlineButton,
    getRoot,
  }: MeoNativeOutlineProps,
  forwardedRef: Ref<MeoNativeOutlineController>,
) {
  const [headings, setHeadings] = useState<MeoHeading[]>([])
  const [visualState, setVisualState] = useState<OutlineVisualState>({
    draggedFrom: null,
    dropTarget: null,
  })
  const headingsRef = useRef<MeoHeading[]>([])
  const visibleRef = useRef(false)
  const mountedRef = useRef(true)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const dragStateRef = useRef<OutlineDragState | null>(null)
  const suppressNextClickRef = useRef(false)

  const headingIndexByFrom = useMemo(
    () => new Map(headings.map((heading, index) => [heading.from, index])),
    [headings],
  )

  const setCurrentHeadings = useCallback((nextHeadings: MeoHeading[]) => {
    headingsRef.current = nextHeadings
    if (mountedRef.current) {
      setHeadings(nextHeadings)
    }
  }, [])

  const clearDragState = useCallback(() => {
    dragStateRef.current = null
    if (mountedRef.current) {
      setVisualState({ draggedFrom: null, dropTarget: null })
    }
  }, [])

  const syncVisibleUi = useCallback((visible: boolean) => {
    const outlineButton = getOutlineButton()
    outlineButton?.classList.toggle('is-active', visible)
    outlineButton?.setAttribute('aria-pressed', visible ? 'true' : 'false')
    if (visible) {
      outlineButton?.setAttribute('data-active', 'true')
    } else {
      outlineButton?.removeAttribute('data-active')
    }
    getRoot()?.classList.toggle('outline-visible', visible)
  }, [getOutlineButton, getRoot])

  const refresh = useCallback(() => {
    clearDragState()
    setCurrentHeadings(getEditor()?.getHeadings() ?? [])
  }, [clearDragState, getEditor, setCurrentHeadings])

  const setVisible = useCallback((nextVisible: boolean) => {
    const visible = nextVisible === true
    visibleRef.current = visible
    syncVisibleUi(visible)

    if (visible) {
      refresh()
    } else if (!visible) {
      clearDragState()
    }
  }, [clearDragState, refresh, syncVisibleUi])

  const destroy = useCallback(() => {
    visibleRef.current = false
    suppressNextClickRef.current = false
    syncVisibleUi(false)
    clearDragState()
    setCurrentHeadings([])
    if (viewportRef.current) {
      viewportRef.current.scrollTop = 0
    }
  }, [clearDragState, setCurrentHeadings, syncVisibleUi])

  useImperativeHandle(forwardedRef, () => ({
    destroy,
    isVisible: () => visibleRef.current,
    refresh,
    setPosition(position) {
      const editorWrapper = getEditorWrapper()
      if (editorWrapper) {
        editorWrapper.dataset.outlinePosition = position === 'left' ? 'left' : 'right'
      }
    },
    setVisible,
  }), [destroy, getEditorWrapper, refresh, setVisible])

  useLayoutEffect(() => {
    mountedRef.current = true
    syncVisibleUi(visibleRef.current)

    return () => {
      mountedRef.current = false
      visibleRef.current = false
      getRoot()?.classList.remove('outline-visible')
    }
  }, [getRoot, syncVisibleUi])

  const updateDropTarget = useCallback((nextTarget: OutlineDropTarget | null) => {
    setVisualState((currentState) => (
      areDropTargetsEqual(currentState.dropTarget, nextTarget)
        ? currentState
        : { ...currentState, dropTarget: nextTarget }
    ))
  }, [])

  const getDropTarget = useCallback((
    heading: MeoHeading,
    placement: OutlineDropPlacement,
  ) => {
    const dragState = dragStateRef.current
    if (!dragState) {
      return null
    }

    return resolveOutlineDropTarget({
      headings: headingsRef.current,
      placement,
      sourceFrom: dragState.sourceFrom,
      targetFrom: heading.from,
    })
  }, [])

  const handleHeadingClick = useCallback((heading: MeoHeading) => {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false
      return
    }

    const headingIndex = headingIndexByFrom.get(heading.from)
    const currentHeading = headingIndex === undefined ? null : headings[headingIndex]
    if (currentHeading) {
      getEditor()?.scrollToLine(currentHeading.line, 'top')
    }
  }, [getEditor, headingIndexByFrom, headings])

  const handleDragStart = useCallback((
    event: DragEvent<HTMLButtonElement>,
    heading: MeoHeading,
  ) => {
    if (!getEditor()) {
      event.preventDefault()
      return
    }

    dragStateRef.current = { sourceFrom: heading.from }
    setVisualState({ draggedFrom: heading.from, dropTarget: null })
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.dropEffect = 'move'
    event.dataTransfer.setData('text/plain', String(heading.from))
  }, [getEditor])

  const handleDragOver = useCallback((
    event: DragEvent<HTMLButtonElement>,
    heading: MeoHeading,
  ) => {
    if (!dragStateRef.current) {
      return
    }

    const candidate = getDropTarget(heading, getDropPlacement(event))
    updateDropTarget(candidate)

    if (candidate) {
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
    }
  }, [getDropTarget, updateDropTarget])

  const handleDrop = useCallback((
    event: DragEvent<HTMLButtonElement>,
    heading: MeoHeading,
  ) => {
    const dragState = dragStateRef.current
    if (!dragState) {
      return
    }

    const candidate = getDropTarget(heading, getDropPlacement(event))
    event.preventDefault()
    event.stopPropagation()
    clearDragState()

    const editor = getEditor()
    if (!candidate || !editor) {
      return
    }

    const moved = editor.moveHeadingSection(
      dragState.sourceFrom,
      candidate.targetFrom,
      candidate.placement,
    )
    if (moved) {
      suppressNextClickRef.current = true
      setCurrentHeadings(editor.getHeadings())
    }
  }, [clearDragState, getDropTarget, getEditor, setCurrentHeadings])

  return (
    <AppScrollArea
      className='meo-outline-scroll-area'
      contentClassName='outline-list'
      viewportClassName='outline-content'
      viewportProps={{
        'aria-label': 'Document headings',
      }}
      viewportRef={viewportRef}
    >
      {headings.length === 0 ? (
        <div className='outline-empty'>No headings</div>
      ) : headings.map((heading) => {
        const label = normalizeHeadingLabel(heading)
        const isDragging = visualState.draggedFrom === heading.from
        const dropPlacement = visualState.dropTarget?.targetFrom === heading.from
          ? visualState.dropTarget.placement
          : null

        return (
          <AppButton
            key={heading.from}
            type='button'
            size='sm'
            variant='ghost'
            className={[
              'outline-item',
              `outline-level-${heading.level}`,
              isDragging && 'is-dragging',
              dropPlacement === 'before' && 'outline-drop-before',
              dropPlacement === 'after' && 'outline-drop-after',
            ].filter(Boolean).join(' ')}
            aria-grabbed={isDragging ? 'true' : 'false'}
            data-heading-from={heading.from}
            data-heading-line={heading.line}
            draggable
            title={label}
            onClick={() => handleHeadingClick(heading)}
            onDragEnd={clearDragState}
            onDragOver={(event) => handleDragOver(event, heading)}
            onDragStart={(event) => handleDragStart(event, heading)}
            onDrop={(event) => handleDrop(event, heading)}
          >
            {label}
          </AppButton>
        )
      })}
    </AppScrollArea>
  )
})
