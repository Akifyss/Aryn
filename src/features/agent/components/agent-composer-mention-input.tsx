import {
  type ClipboardEvent,
  type CSSProperties,
  type DragEvent,
  type HTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Popover } from '@base-ui/react/popover'
import { AppScrollArea } from '@/components/app-scroll-area'
import { WorkspaceFileIcon } from '@/components/file-change-visuals'
import type {
  ActiveComposerMentionQuery,
  ComposerMentionToken,
  ComposerSelectionRange,
} from '@/features/agent/lib/composer-mentions'
import {
  applyComposerTextEdit,
  expandComposerSelectionToMentionBoundaries,
  findActiveComposerMentionQuery,
  flattenWorkspaceNodesForMentions,
  getComposerDeleteRange,
  normalizeComposerSelection,
  parseComposerMentionRanges,
  replaceComposerMentionQuery,
  searchComposerMentionItems,
  serializeComposerText,
} from '@/features/agent/lib/composer-mentions'
import type { WorkspaceIconTheme, WorkspaceNode } from '@/features/workspace/types'

type ComposerModel = {
  mentions: ComposerMentionToken[]
  value: string
}

type AgentComposerMentionInputProps = {
  disabled?: boolean
  footer?: ReactNode
  header?: ReactNode
  iconTheme?: WorkspaceIconTheme | null
  mentions: ComposerMentionToken[]
  onFilesPastedOrDropped?: (files: File[]) => void
  onChange: (nextModel: ComposerModel) => void
  onSubmitShortcut?: (event: ReactKeyboardEvent<HTMLDivElement>) => void
  placeholder?: string
  portalContainer?: HTMLElement | null
  value: string
  workspaceNodes: WorkspaceNode[]
  workspacePath: string | null
} & Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'onChange' | 'placeholder' | 'value'>

type EditorPoint = {
  node: Node
  offset: number
}

type EditorLeaf =
  | {
      length: number
      node: Text
      type: 'text'
    }
  | {
      element: HTMLElement
      length: number
      type: 'mention'
    }

const MENTION_MENU_MAX_HEIGHT = 264
const MENTION_MENU_ROW_HEIGHT = 30
const MENTION_MENU_PADDING = 10
const MENTION_MENU_EMPTY_HEIGHT = 48
const MENTION_MENU_GAP = 8
const MENTION_MENU_MARGIN = 12
const MENTION_MENU_MIN_WIDTH = 260
const MENTION_MENU_MAX_WIDTH = 420

type MentionMenuRect = {
  bottom: number
  height: number
  left: number
  right: number
  top: number
  width: number
  x: number
  y: number
}

type MentionMenuLayout = {
  anchorRect: MentionMenuRect
  height: number
  width: number
}

type MentionMenuCssVars = CSSProperties & {
  '--agent-composer-mention-menu-height'?: string
  '--agent-composer-mention-menu-width'?: string
}

function buildActiveMentionKey(activeMention: ActiveComposerMentionQuery | null) {
  if (!activeMention) {
    return null
  }

  return `${activeMention.start}:${activeMention.end}:${activeMention.query}`
}

function isMentionElement(node: Node | null): node is HTMLElement {
  return node instanceof HTMLElement && node.dataset.composerMention === 'true'
}

function getNodeIndex(node: Node) {
  let index = 0
  let sibling = node.previousSibling

  while (sibling) {
    index += 1
    sibling = sibling.previousSibling
  }

  return index
}

function collectEditorLeaves(root: Node): EditorLeaf[] {
  const leaves: EditorLeaf[] = []

  function visit(node: Node) {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = child.textContent ?? ''
        if (text.length > 0) {
          leaves.push({
            length: text.length,
            node: child as Text,
            type: 'text',
          })
        }
        continue
      }

      if (isMentionElement(child)) {
        const length = Number.parseInt(child.dataset.mentionLength ?? '', 10)
        leaves.push({
          element: child,
          length: Number.isFinite(length) ? length : (child.textContent?.length ?? 0),
          type: 'mention',
        })
        continue
      }

      if (child.nodeName === 'BR') {
        continue
      }

      visit(child)
    }
  }

  visit(root)
  return leaves
}

function getSelectionOffsetFromPoint(root: HTMLElement, node: Node, offset: number) {
  const range = document.createRange()
  range.selectNodeContents(root)
  range.setEnd(node, offset)
  const textLength = range.toString().length
  range.detach()
  return textLength
}

function getSelectionFromEditor(editor: HTMLElement): ComposerSelectionRange | null {
  const selection = window.getSelection()

  if (!selection || selection.rangeCount === 0) {
    return null
  }

  const range = selection.getRangeAt(0)

  if (!editor.contains(range.startContainer) || !editor.contains(range.endContainer)) {
    return null
  }

  return {
    end: getSelectionOffsetFromPoint(editor, range.endContainer, range.endOffset),
    start: getSelectionOffsetFromPoint(editor, range.startContainer, range.startOffset),
  }
}

type DocumentWithCaretFromPoint = Document & {
  caretPositionFromPoint?: (x: number, y: number) => { offset: number, offsetNode: Node } | null
  caretRangeFromPoint?: (x: number, y: number) => Range | null
}

function getSelectionFromClientPoint(editor: HTMLElement, clientX: number, clientY: number): ComposerSelectionRange | null {
  const ownerDocument = editor.ownerDocument as DocumentWithCaretFromPoint
  let range: Range | null = null

  const caretPosition = ownerDocument.caretPositionFromPoint?.(clientX, clientY)
  if (caretPosition) {
    range = ownerDocument.createRange()
    range.setStart(caretPosition.offsetNode, caretPosition.offset)
    range.collapse(true)
  } else {
    range = ownerDocument.caretRangeFromPoint?.(clientX, clientY) ?? null
  }

  if (!range || !editor.contains(range.startContainer)) {
    return null
  }

  const offset = getSelectionOffsetFromPoint(editor, range.startContainer, range.startOffset)
  return {
    end: offset,
    start: offset,
  }
}

function getEditorPointForOffset(editor: HTMLElement, targetOffset: number): EditorPoint {
  const leaves = collectEditorLeaves(editor)

  if (leaves.length === 0) {
    return {
      node: editor,
      offset: 0,
    }
  }

  let cursor = 0

  for (const leaf of leaves) {
    const nextCursor = cursor + leaf.length

    if (leaf.type === 'text') {
      if (targetOffset <= nextCursor) {
        return {
          node: leaf.node,
          offset: Math.max(0, targetOffset - cursor),
        }
      }

      cursor = nextCursor
      continue
    }

    const parentNode = leaf.element.parentNode ?? editor
    const nodeIndex = getNodeIndex(leaf.element)

    if (targetOffset <= cursor) {
      return {
        node: parentNode,
        offset: nodeIndex,
      }
    }

    if (targetOffset < nextCursor) {
      const distanceToStart = targetOffset - cursor
      const distanceToEnd = nextCursor - targetOffset

      return {
        node: parentNode,
        offset: distanceToStart <= distanceToEnd ? nodeIndex : nodeIndex + 1,
      }
    }

    if (targetOffset === nextCursor) {
      return {
        node: parentNode,
        offset: nodeIndex + 1,
      }
    }

    cursor = nextCursor
  }

  return {
    node: editor,
    offset: editor.childNodes.length,
  }
}

function restoreSelection(editor: HTMLElement, selectionRange: ComposerSelectionRange) {
  const domSelection = window.getSelection()

  if (!domSelection) {
    return
  }

  const nextRange = document.createRange()
  const startPoint = getEditorPointForOffset(editor, selectionRange.start)
  const endPoint = getEditorPointForOffset(editor, selectionRange.end)

  nextRange.setStart(startPoint.node, startPoint.offset)
  nextRange.setEnd(endPoint.node, endPoint.offset)

  domSelection.removeAllRanges()
  domSelection.addRange(nextRange)
}

function getEditorRangeForSelection(editor: HTMLElement, selectionRange: ComposerSelectionRange) {
  const range = document.createRange()
  const startPoint = getEditorPointForOffset(editor, selectionRange.start)
  const endPoint = getEditorPointForOffset(editor, selectionRange.end)

  range.setStart(startPoint.node, startPoint.offset)
  range.setEnd(endPoint.node, endPoint.offset)
  return range
}

function getEditorCaretRect(editor: HTMLElement, offset: number) {
  const range = getEditorRangeForSelection(editor, { end: offset, start: offset })
  let rect = range.getBoundingClientRect()

  if (rect.width === 0 && rect.height === 0) {
    const firstClientRect = range.getClientRects()[0]
    if (firstClientRect) {
      rect = firstClientRect
    }
  }

  range.detach()

  if (rect.width === 0 && rect.height === 0) {
    return editor.getBoundingClientRect()
  }

  return rect
}

function toMentionMenuRect(rect: DOMRect): MentionMenuRect {
  return {
    bottom: rect.bottom,
    height: rect.height,
    left: rect.left,
    right: rect.right,
    top: rect.top,
    width: rect.width,
    x: rect.x,
    y: rect.y,
  }
}

function areMentionMenuLayoutsEqual(left: MentionMenuLayout | null, right: MentionMenuLayout) {
  if (!left) {
    return false
  }

  return left.width === right.width
    && left.height === right.height
    && left.anchorRect.bottom === right.anchorRect.bottom
    && left.anchorRect.height === right.anchorRect.height
    && left.anchorRect.left === right.anchorRect.left
    && left.anchorRect.right === right.anchorRect.right
    && left.anchorRect.top === right.anchorRect.top
    && left.anchorRect.width === right.anchorRect.width
}

function renderEditorContent(editor: HTMLElement, value: string, mentions: ComposerMentionToken[]) {
  const fragment = document.createDocumentFragment()
  let cursor = 0

  for (const mention of mentions) {
    if (mention.start > cursor) {
      fragment.append(document.createTextNode(value.slice(cursor, mention.start)))
    }

    const mentionElement = document.createElement('span')
    mentionElement.className = 'agent-composer-mention-token'
    mentionElement.dataset.composerMention = 'true'
    mentionElement.dataset.mentionId = mention.id
    mentionElement.dataset.mentionKind = mention.kind
    mentionElement.dataset.mentionLabel = mention.label
    mentionElement.dataset.mentionLength = String(mention.text.length)
    mentionElement.dataset.mentionPath = mention.path
    mentionElement.contentEditable = 'false'
    mentionElement.spellcheck = false
    mentionElement.textContent = mention.label
    fragment.append(mentionElement)
    cursor = mention.end
  }

  if (cursor < value.length) {
    fragment.append(document.createTextNode(value.slice(cursor)))
  }

  editor.replaceChildren(fragment)
}

function parseEditorContent(editor: HTMLElement): ComposerModel {
  const mentions: ComposerMentionToken[] = []
  let value = ''

  function visit(node: Node) {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        value += child.textContent ?? ''
        continue
      }

      if (isMentionElement(child)) {
        const label = child.dataset.mentionLabel ?? child.textContent ?? ''
        const text = label
        const start = value.length
        value += text
        mentions.push({
          end: start + text.length,
          id: child.dataset.mentionId ?? `mention:${label}:${start}`,
          kind: (child.dataset.mentionKind as WorkspaceNode['kind']) ?? 'file',
          label,
          path: child.dataset.mentionPath ?? label,
          start,
          text,
        })
        continue
      }

      if (child.nodeName === 'BR') {
        continue
      }

      visit(child)
    }
  }

  visit(editor)

  return {
    mentions,
    value,
  }
}

function modelsEqual(left: ComposerModel, right: ComposerModel) {
  if (left.value !== right.value || left.mentions.length !== right.mentions.length) {
    return false
  }

  return left.mentions.every((mention, index) => {
    const otherMention = right.mentions[index]

    return Boolean(otherMention)
      && mention.start === otherMention.start
      && mention.end === otherMention.end
      && mention.id === otherMention.id
      && mention.kind === otherMention.kind
      && mention.label === otherMention.label
      && mention.path === otherMention.path
      && mention.text === otherMention.text
  })
}

function editorContentMatchesModel(editor: HTMLElement, value: string, mentions: ComposerMentionToken[]) {
  return modelsEqual(parseEditorContent(editor), { mentions, value })
}

export function AgentComposerMentionInput({
  disabled = false,
  footer,
  header,
  iconTheme,
  mentions,
  onFilesPastedOrDropped,
  onChange,
  onSubmitShortcut,
  placeholder = 'Message',
  portalContainer,
  value,
  workspaceNodes,
  workspacePath,
  className,
  onBlur,
  onCompositionEnd,
  onCompositionStart,
  onCopy,
  onCut,
  onDrop,
  onFocus,
  onKeyDown,
  onPaste,
  ...editorProps
}: AgentComposerMentionInputProps) {
  const editorRef = useRef<HTMLDivElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const pendingSelectionRef = useRef<ComposerSelectionRange | null>(null)
  const [selection, setSelection] = useState<ComposerSelectionRange>({ end: 0, start: 0 })
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [isFocused, setIsFocused] = useState(false)
  const [dismissedMentionKey, setDismissedMentionKey] = useState<string | null>(null)
  const [isComposing, setIsComposing] = useState(false)
  const [mentionMenuLayout, setMentionMenuLayout] = useState<MentionMenuLayout | null>(null)

  const normalizedMentions = useMemo(() => parseComposerMentionRanges(value, mentions), [mentions, value])
  const mentionItems = useMemo(
    () => workspacePath ? flattenWorkspaceNodesForMentions(workspaceNodes, workspacePath) : [],
    [workspaceNodes, workspacePath],
  )
  const activeMention = useMemo(
    () => workspacePath ? findActiveComposerMentionQuery(value, selection, normalizedMentions) : null,
    [normalizedMentions, selection, value, workspacePath],
  )
  const activeMentionKey = buildActiveMentionKey(activeMention)
  const mentionResults = useMemo(
    () => searchComposerMentionItems(mentionItems, activeMention?.query ?? ''),
    [activeMention?.query, mentionItems],
  )
  const shouldShowMentionMenu = Boolean(
    isFocused
    && activeMention
    && activeMentionKey !== dismissedMentionKey,
  )
  const shouldShowPlaceholder = !value && !isComposing
  const isMentionMenuOpen = shouldShowMentionMenu && mentionMenuLayout !== null
  const mentionMenuHeight = useMemo(
    () => mentionResults.length > 0
      ? Math.min((mentionResults.length * MENTION_MENU_ROW_HEIGHT) + MENTION_MENU_PADDING, MENTION_MENU_MAX_HEIGHT)
      : MENTION_MENU_EMPTY_HEIGHT,
    [mentionResults.length],
  )
  const mentionMenuAnchor = useMemo(() => {
    if (!mentionMenuLayout) {
      return null
    }

    return {
      getBoundingClientRect: () => mentionMenuLayout.anchorRect,
    }
  }, [mentionMenuLayout])
  const mentionMenuCssVars = useMemo<MentionMenuCssVars | undefined>(() => (
    mentionMenuLayout
      ? {
          '--agent-composer-mention-menu-height': `${mentionMenuLayout.height}px`,
          '--agent-composer-mention-menu-width': `${mentionMenuLayout.width}px`,
        }
      : undefined
  ), [mentionMenuLayout])

  function updateMentionMenuPosition() {
    const editor = editorRef.current

    if (!editor || !activeMention) {
      setMentionMenuLayout(null)
      return
    }

    const editorRect = editor.getBoundingClientRect()
    const anchorRect = getEditorCaretRect(editor, activeMention.end)
    const viewportWidth = window.innerWidth
    const maxWidth = Math.max(MENTION_MENU_MIN_WIDTH, viewportWidth - (MENTION_MENU_MARGIN * 2))
    const width = Math.min(Math.max(editorRect.width, MENTION_MENU_MIN_WIDTH), MENTION_MENU_MAX_WIDTH, maxWidth)
    const availableAbove = anchorRect.top - MENTION_MENU_GAP - MENTION_MENU_MARGIN
    const maxHeight = Math.max(
      MENTION_MENU_EMPTY_HEIGHT,
      Math.min(mentionMenuHeight, availableAbove, MENTION_MENU_MAX_HEIGHT),
    )
    const nextLayout: MentionMenuLayout = {
      anchorRect: toMentionMenuRect(anchorRect),
      height: maxHeight,
      width,
    }

    setMentionMenuLayout((currentLayout) => (
      areMentionMenuLayoutsEqual(currentLayout, nextLayout) ? currentLayout : nextLayout
    ))
  }

  useLayoutEffect(() => {
    const editor = editorRef.current

    if (!editor || isComposing) {
      return
    }

    if (!editorContentMatchesModel(editor, value, normalizedMentions)) {
      renderEditorContent(editor, value, normalizedMentions)
    }

    if (!pendingSelectionRef.current) {
      return
    }

    const nextSelection = pendingSelectionRef.current
    pendingSelectionRef.current = null
    if (isFocused && document.activeElement !== editor) {
      editor.focus()
    }
    restoreSelection(editor, nextSelection)
    setSelection(nextSelection)
  }, [isComposing, isFocused, normalizedMentions, value])

  useLayoutEffect(() => {
    if (!shouldShowMentionMenu) {
      setMentionMenuLayout(null)
      return
    }

    updateMentionMenuPosition()
  }, [activeMention?.end, activeMentionKey, mentionMenuHeight, shouldShowMentionMenu, value])

  useEffect(() => {
    if (!shouldShowMentionMenu) {
      return
    }

    const frameId = window.requestAnimationFrame(updateMentionMenuPosition)
    window.addEventListener('resize', updateMentionMenuPosition)
    window.addEventListener('scroll', updateMentionMenuPosition, true)

    return () => {
      window.cancelAnimationFrame(frameId)
      window.removeEventListener('resize', updateMentionMenuPosition)
      window.removeEventListener('scroll', updateMentionMenuPosition, true)
    }
  }, [activeMention?.end, mentionMenuHeight, shouldShowMentionMenu, value])

  useEffect(() => {
    setSelectedIndex(0)
  }, [activeMentionKey])

  useEffect(() => {
    if (selectedIndex < mentionResults.length) {
      return
    }

    setSelectedIndex(Math.max(mentionResults.length - 1, 0))
  }, [mentionResults.length, selectedIndex])

  useEffect(() => {
    if (!activeMentionKey || activeMentionKey !== dismissedMentionKey) {
      return
    }

    if (activeMention?.query === '') {
      setDismissedMentionKey(null)
    }
  }, [activeMention?.query, activeMentionKey, dismissedMentionKey])

  useEffect(() => {
    if (!shouldShowMentionMenu || !menuRef.current) {
      return
    }

    const activeElement = menuRef.current.querySelector<HTMLElement>('[data-active="true"]')
    activeElement?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex, shouldShowMentionMenu])

  useEffect(() => {
    if (!isFocused || isComposing) {
      return
    }

    function handleSelectionChange() {
      const editor = editorRef.current

      if (!editor) {
        return
      }

      const rawSelection = getSelectionFromEditor(editor)
      const nextSelection = rawSelection && normalizedMentions.length > 0
        ? normalizeComposerSelection(rawSelection, normalizedMentions)
        : rawSelection

      if (!nextSelection) {
        return
      }

      if (
        rawSelection
        && (nextSelection.start !== rawSelection.start || nextSelection.end !== rawSelection.end)
      ) {
        restoreSelection(editor, nextSelection)
      }
      setSelection(nextSelection)
    }

    document.addEventListener('selectionchange', handleSelectionChange)
    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange)
    }
  }, [isComposing, isFocused, normalizedMentions])

  function queueSelection(nextSelection: ComposerSelectionRange) {
    pendingSelectionRef.current = nextSelection
  }

  function emitModel(nextModel: ComposerModel, nextSelection?: ComposerSelectionRange) {
    setDismissedMentionKey(null)
    if (nextSelection) {
      queueSelection(nextSelection)
    }
    onChange(nextModel)
  }

  function syncSelectionFromEditor() {
    const editor = editorRef.current

    if (!editor) {
      return null
    }

    const rawSelection = getSelectionFromEditor(editor)
    const nextSelection = rawSelection && normalizedMentions.length > 0
      ? normalizeComposerSelection(rawSelection, normalizedMentions)
      : rawSelection

    if (nextSelection) {
      if (
        rawSelection
        && (nextSelection.start !== rawSelection.start || nextSelection.end !== rawSelection.end)
      ) {
        restoreSelection(editor, nextSelection)
      }
      setSelection(nextSelection)
    }

    return nextSelection
  }

  function applyMentionSelection(resultIndex: number) {
    if (!activeMention) {
      return
    }

    const selectedItem = mentionResults[resultIndex]
    if (!selectedItem) {
      return
    }

    const replacement = replaceComposerMentionQuery({
      item: selectedItem,
      mentions: normalizedMentions,
      target: activeMention,
      value,
    })

    emitModel(
      {
        mentions: replacement.mentions,
        value: replacement.value,
      },
      {
        end: replacement.nextSelectionEnd,
        start: replacement.nextSelectionStart,
      },
    )
  }

  function applyTextEdit(insertText: string, editSelection: ComposerSelectionRange) {
    const normalizedEditSelection = normalizedMentions.length > 0
      ? normalizeComposerSelection(editSelection, normalizedMentions)
      : editSelection
    const nextModel = applyComposerTextEdit({
      insertText,
      mentions: normalizedMentions,
      selection: normalizedEditSelection,
      value,
    })

    emitModel(
      {
        mentions: nextModel.mentions,
        value: nextModel.value,
      },
      {
        end: nextModel.nextSelectionEnd,
        start: nextModel.nextSelectionStart,
      },
    )
  }

  function handleMentionNavigation(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!shouldShowMentionMenu) {
      return false
    }

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        setSelectedIndex((currentValue) => (
          mentionResults.length === 0 ? 0 : (currentValue + 1) % mentionResults.length
        ))
        return true
      case 'ArrowUp':
        event.preventDefault()
        setSelectedIndex((currentValue) => (
          mentionResults.length === 0 ? 0 : (currentValue - 1 + mentionResults.length) % mentionResults.length
        ))
        return true
      case 'Home':
        event.preventDefault()
        setSelectedIndex(0)
        return true
      case 'End':
        event.preventDefault()
        setSelectedIndex(Math.max(mentionResults.length - 1, 0))
        return true
      case 'Tab':
        event.preventDefault()
        setSelectedIndex((currentValue) => (
          mentionResults.length === 0
            ? 0
            : event.shiftKey
              ? (currentValue - 1 + mentionResults.length) % mentionResults.length
              : (currentValue + 1) % mentionResults.length
        ))
        return true
      case 'Enter':
        event.preventDefault()
        applyMentionSelection(selectedIndex)
        return true
      case 'Escape':
        event.preventDefault()
        setDismissedMentionKey(activeMentionKey)
        return true
      default:
        return false
    }
  }

  function handleCopyLikeEvent(event: ClipboardEvent<HTMLDivElement>, shouldDelete: boolean) {
    const currentSelection = expandComposerSelectionToMentionBoundaries(
      syncSelectionFromEditor() ?? selection,
      normalizedMentions,
    )

    if (currentSelection.start === currentSelection.end) {
      return
    }

    const selectedText = value.slice(currentSelection.start, currentSelection.end)
    const selectedMentions = normalizedMentions
      .filter((mention) => currentSelection.start < mention.end && currentSelection.end > mention.start)
      .map((mention) => ({
        ...mention,
        end: mention.end - currentSelection.start,
        start: mention.start - currentSelection.start,
      }))

    event.preventDefault()
    event.clipboardData.setData('text/plain', serializeComposerText(selectedText, selectedMentions))

    if (shouldDelete) {
      applyTextEdit('', currentSelection)
    }
  }

  function handleDropEvent(event: DragEvent<HTMLDivElement>) {
    onDrop?.(event)
    if (event.defaultPrevented) {
      return
    }

    const droppedFiles = Array.from(event.dataTransfer.files ?? [])
    if (droppedFiles.length > 0) {
      event.preventDefault()
      if (!disabled) {
        onFilesPastedOrDropped?.(droppedFiles)
      }
      return
    }

    const droppedText = event.dataTransfer.getData('text/plain')
    event.preventDefault()

    if (disabled || isComposing || !droppedText) {
      return
    }

    const editor = editorRef.current
    const dropSelection = editor
      ? getSelectionFromClientPoint(editor, event.clientX, event.clientY)
      : null
    const currentSelection = dropSelection ?? syncSelectionFromEditor() ?? selection
    applyTextEdit(droppedText, currentSelection)
  }

  function commitEditorDomToModel() {
    const editor = editorRef.current

    if (!editor) {
      return
    }

    const nextModel = parseEditorContent(editor)
    const rawSelection = getSelectionFromEditor(editor) ?? selection
    const nextSelection = nextModel.mentions.length > 0
      ? normalizeComposerSelection(rawSelection, nextModel.mentions)
      : rawSelection

    if (modelsEqual(nextModel, { mentions: normalizedMentions, value })) {
      if (nextSelection.start !== rawSelection.start || nextSelection.end !== rawSelection.end) {
        restoreSelection(editor, nextSelection)
      }
      setSelection(nextSelection)
      return
    }

    emitModel(nextModel, nextSelection)
  }

  const mentionPortalContainer = typeof document === 'undefined'
    ? null
    : portalContainer === undefined
      ? document.body
      : portalContainer

  const mentionMenu = mentionPortalContainer ? (
    <Popover.Root
      modal={false}
      open={isMentionMenuOpen}
      onOpenChange={(open, details) => {
        if (open) {
          return
        }

        if (details.reason === 'outside-press') {
          const target = details.event.target
          if (target instanceof Node && editorRef.current?.contains(target)) {
            details.cancel()
            return
          }
        }

        if (activeMentionKey) {
          setDismissedMentionKey(activeMentionKey)
        }
      }}
    >
      <Popover.Portal container={mentionPortalContainer}>
        <Popover.Positioner
          anchor={mentionMenuAnchor}
          align='start'
          className='agent-composer-mention-positioner'
          collisionAvoidance={{ align: 'shift', fallbackAxisSide: 'none', side: 'shift' }}
          collisionPadding={MENTION_MENU_MARGIN}
          positionMethod='fixed'
          side='top'
          sideOffset={MENTION_MENU_GAP}
        >
          <Popover.Popup
            className='agent-composer-mention-menu'
            finalFocus={false}
            initialFocus={false}
            style={mentionMenuCssVars}
          >
            <AppScrollArea
              ref={menuRef}
              className='agent-composer-mention-menu-scroll'
              contentClassName='agent-composer-mention-menu-scroll-content'
              rootStyle={{ height: 'var(--agent-composer-mention-menu-height)' }}
            >
              <div className='agent-composer-mention-menu-list' role='listbox' aria-label='Project files'>
                {mentionResults.length > 0 ? mentionResults.map((item, index) => {
                  const isActive = index === selectedIndex

                  return (
                    <button
                      key={item.id}
                      type='button'
                      role='option'
                      aria-selected={isActive}
                      data-active={isActive ? 'true' : 'false'}
                      className={`agent-composer-mention-option${isActive ? ' is-active' : ''}`}
                      title={item.relativePath}
                      onMouseDown={(mouseEvent) => {
                        mouseEvent.preventDefault()
                        applyMentionSelection(index)
                      }}
                      onMouseEnter={() => {
                        setSelectedIndex(index)
                      }}
                    >
                      <WorkspaceFileIcon
                        fileName={item.name}
                        iconTheme={iconTheme ?? null}
                        isClosed={item.kind === 'directory'}
                        isFolder={item.kind === 'directory'}
                        nodeLabel={item.name}
                      />

                      <span className='agent-composer-mention-option-inline'>
                        <span className='agent-composer-mention-option-label'>{item.displayName}</span>
                        {item.displayPath ? (
                          <span className='agent-composer-mention-option-meta'>{item.displayPath}</span>
                        ) : null}
                      </span>
                    </button>
                  )
                }) : (
                  <div className='agent-composer-mention-empty'>No matching files or folders</div>
                )}
              </div>
            </AppScrollArea>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  ) : null

  return (
    <>
      <div className='agent-composer-input-shell'>
        <div className='agent-composer-field'>
          {header ? <div className='agent-composer-header'>{header}</div> : null}

          <div className='agent-composer-text-shell'>
            {shouldShowPlaceholder ? (
              <div className='agent-composer-placeholder' aria-hidden='true'>
                {placeholder}
              </div>
            ) : null}

            <div
              {...editorProps}
              ref={editorRef}
              aria-disabled={disabled || undefined}
              aria-multiline='true'
              className={`agent-composer-editor${className ? ` ${className}` : ''}`}
              contentEditable={disabled ? 'false' : 'true'}
              role='textbox'
              spellCheck={false}
              suppressContentEditableWarning
              onBlur={(event) => {
                setIsFocused(false)
                onBlur?.(event)
              }}
              onCompositionEnd={(event) => {
                setIsComposing(false)
                commitEditorDomToModel()
                onCompositionEnd?.(event)
              }}
              onCompositionStart={(event) => {
                setIsComposing(true)
                onCompositionStart?.(event)
              }}
              onCopy={(event) => {
                onCopy?.(event)
                if (event.defaultPrevented) {
                  return
                }
                handleCopyLikeEvent(event, false)
              }}
              onCut={(event) => {
                onCut?.(event)
                if (event.defaultPrevented) {
                  return
                }
                handleCopyLikeEvent(event, true)
              }}
              onDrop={handleDropEvent}
              onFocus={(event) => {
                setIsFocused(true)
                syncSelectionFromEditor()
                onFocus?.(event)
              }}
              onInput={() => {
                if (isComposing) {
                  return
                }

                commitEditorDomToModel()
              }}
              onKeyDown={(event) => {
                onKeyDown?.(event)

                if (event.defaultPrevented || disabled || isComposing || event.nativeEvent.isComposing) {
                  return
                }

                if (handleMentionNavigation(event)) {
                  return
                }

                const currentSelection = syncSelectionFromEditor() ?? selection

                if (event.key === 'Backspace' || event.key === 'Delete') {
                  const direction = event.key === 'Backspace' ? 'backward' : 'forward'
                  const deleteRange = getComposerDeleteRange(currentSelection, normalizedMentions, direction)

                  if (deleteRange) {
                    event.preventDefault()
                    applyTextEdit('', deleteRange)
                  }
                  return
                }

                if (event.key === 'Enter') {
                  event.preventDefault()

                  if (event.shiftKey) {
                    applyTextEdit('\n', currentSelection)
                    return
                  }

                  onSubmitShortcut?.(event)
                }
              }}
              onPaste={(event) => {
                onPaste?.(event)
                if (event.defaultPrevented) {
                  return
                }

                if (disabled || isComposing) {
                  return
                }

                const pastedFiles = Array.from(event.clipboardData.files ?? [])
                if (pastedFiles.length > 0) {
                  event.preventDefault()
                  onFilesPastedOrDropped?.(pastedFiles)
                  return
                }

                event.preventDefault()
                const pastedText = event.clipboardData.getData('text/plain')
                const currentSelection = syncSelectionFromEditor() ?? selection
                applyTextEdit(pastedText, currentSelection)
              }}
            />
          </div>

          {footer}
        </div>
      </div>
      {mentionMenu}
    </>
  )
}
