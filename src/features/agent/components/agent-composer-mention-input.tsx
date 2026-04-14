import {
  type ClipboardEvent,
  type HTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { AppScrollArea } from '@/components/app-scroll-area'
import { WorkspaceFileIcon } from '@/components/file-change-visuals'
import type {
  ActiveComposerMentionQuery,
  ComposerMentionToken,
  ComposerSelectionRange,
} from '@/features/agent/lib/composer-mentions'
import {
  applyComposerTextEdit,
  findActiveComposerMentionQuery,
  flattenWorkspaceNodesForMentions,
  getComposerDeleteRange,
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
  iconTheme?: WorkspaceIconTheme | null
  mentions: ComposerMentionToken[]
  onChange: (nextModel: ComposerModel) => void
  onSubmitShortcut?: (event: ReactKeyboardEvent<HTMLDivElement>) => void
  placeholder?: string
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
const MENTION_MENU_ROW_HEIGHT = 38
const MENTION_MENU_PADDING = 12
const MENTION_MENU_EMPTY_HEIGHT = 42

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
  iconTheme,
  mentions,
  onChange,
  onSubmitShortcut,
  placeholder = 'Message',
  value,
  workspaceNodes,
  workspacePath,
  className,
  onBlur,
  onFocus,
  onKeyDown,
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
  const mentionMenuHeight = useMemo(
    () => mentionResults.length > 0
      ? Math.min((mentionResults.length * MENTION_MENU_ROW_HEIGHT) + MENTION_MENU_PADDING, MENTION_MENU_MAX_HEIGHT)
      : MENTION_MENU_EMPTY_HEIGHT,
    [mentionResults.length],
  )

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
    if (document.activeElement !== editor) {
      editor.focus()
    }
    restoreSelection(editor, nextSelection)
    setSelection(nextSelection)
  }, [isComposing, normalizedMentions, value])

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

      const nextSelection = getSelectionFromEditor(editor)

      if (!nextSelection) {
        return
      }

      setSelection(nextSelection)
    }

    document.addEventListener('selectionchange', handleSelectionChange)
    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange)
    }
  }, [isComposing, isFocused])

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

    const nextSelection = getSelectionFromEditor(editor)

    if (nextSelection) {
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
    const currentSelection = syncSelectionFromEditor() ?? selection

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

    if (!shouldDelete) {
      return
    }

    const nextModel = applyComposerTextEdit({
      mentions: normalizedMentions,
      selection: currentSelection,
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

  function commitEditorDomToModel() {
    const editor = editorRef.current

    if (!editor) {
      return
    }

    const nextModel = parseEditorContent(editor)
    const nextSelection = getSelectionFromEditor(editor) ?? selection

    if (modelsEqual(nextModel, { mentions: normalizedMentions, value })) {
      setSelection(nextSelection)
      return
    }

    emitModel(nextModel, nextSelection)
  }

  return (
    <div className='agent-composer-input-shell'>
      {shouldShowMentionMenu ? (
        <div className='agent-composer-mention-menu'>
          <AppScrollArea
            ref={menuRef}
            className='agent-composer-mention-menu-scroll'
            contentClassName='agent-composer-mention-menu-scroll-content'
            rootStyle={{ height: `${mentionMenuHeight}px` }}
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
                    <span className='git-row-icon'>
                      <WorkspaceFileIcon
                        fileName={item.name}
                        iconTheme={iconTheme ?? null}
                        isClosed={item.kind === 'directory'}
                        isFolder={item.kind === 'directory'}
                        nodeLabel={item.name}
                      />
                    </span>

                    <span className='agent-composer-mention-option-inline'>
                      <span className='panel-tree-label'>{item.displayName}</span>
                      {item.displayPath ? (
                        <span className='git-change-meta'>{item.displayPath}</span>
                      ) : null}
                    </span>
                  </button>
                )
              }) : (
                <div className='agent-composer-mention-empty'>No matching files or folders</div>
              )}
            </div>
          </AppScrollArea>
        </div>
      ) : null}

      {shouldShowPlaceholder ? (
        <div className='agent-composer-placeholder' aria-hidden='true'>
          {placeholder}
        </div>
      ) : null}

      <div
        {...editorProps}
        ref={editorRef}
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
        onCompositionEnd={() => {
          setIsComposing(false)
          commitEditorDomToModel()
        }}
        onCompositionStart={() => {
          setIsComposing(true)
        }}
        onCopy={(event) => {
          handleCopyLikeEvent(event, false)
        }}
        onCut={(event) => {
          handleCopyLikeEvent(event, true)
        }}
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

            if (!deleteRange) {
              return
            }

            event.preventDefault()
            const nextModel = applyComposerTextEdit({
              mentions: normalizedMentions,
              selection: deleteRange,
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
            return
          }

          if (event.key === 'Enter') {
            event.preventDefault()

            if (event.shiftKey) {
              const nextModel = applyComposerTextEdit({
                insertText: '\n',
                mentions: normalizedMentions,
                selection: currentSelection,
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
              return
            }

            onSubmitShortcut?.(event)
          }
        }}
        onPaste={(event) => {
          if (disabled || isComposing) {
            return
          }

          event.preventDefault()
          const pastedText = event.clipboardData.getData('text/plain')
          const currentSelection = syncSelectionFromEditor() ?? selection
          const nextModel = applyComposerTextEdit({
            insertText: pastedText,
            mentions: normalizedMentions,
            selection: currentSelection,
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
        }}
      />
    </div>
  )
}
