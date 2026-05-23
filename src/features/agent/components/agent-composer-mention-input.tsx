import {
  type ClipboardEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { TextArea } from '@heroui/react'
import type { TextAreaProps } from '@heroui/react'
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
  onSubmitShortcut?: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => void
  placeholder?: string
  value: string
  workspaceNodes: WorkspaceNode[]
  workspacePath: string | null
  className?: string
  footer?: ReactNode
} & Omit<TextAreaProps, 'children' | 'className' | 'onChange' | 'placeholder' | 'value'>

type TextValueChange = {
  insertedText: string
  nextEnd: number
  start: number
  previousEnd: number
}

const MENTION_MENU_MAX_HEIGHT = 264
const MENTION_MENU_ROW_HEIGHT = 30
const MENTION_MENU_PADDING = 10
const MENTION_MENU_EMPTY_HEIGHT = 42

function buildActiveMentionKey(activeMention: ActiveComposerMentionQuery | null) {
  if (!activeMention) {
    return null
  }

  return `${activeMention.start}:${activeMention.end}:${activeMention.query}`
}

function clampSelectionOffset(offset: number, value: string) {
  return Math.max(0, Math.min(value.length, offset))
}

function readTextAreaSelection(textarea: HTMLTextAreaElement): ComposerSelectionRange {
  const start = textarea.selectionStart ?? 0
  const end = textarea.selectionEnd ?? start

  return start <= end
    ? { end, start }
    : { end: start, start: end }
}

function writeTextAreaSelection(
  textarea: HTMLTextAreaElement,
  value: string,
  selection: ComposerSelectionRange,
) {
  const start = clampSelectionOffset(selection.start, value)
  const end = clampSelectionOffset(selection.end, value)
  textarea.setSelectionRange(start, end)
}

function getTextValueChange(previousValue: string, nextValue: string): TextValueChange | null {
  if (previousValue === nextValue) {
    return null
  }

  let start = 0
  while (
    start < previousValue.length
    && start < nextValue.length
    && previousValue[start] === nextValue[start]
  ) {
    start += 1
  }

  let previousEnd = previousValue.length
  let nextEnd = nextValue.length
  while (
    previousEnd > start
    && nextEnd > start
    && previousValue[previousEnd - 1] === nextValue[nextEnd - 1]
  ) {
    previousEnd -= 1
    nextEnd -= 1
  }

  return {
    insertedText: nextValue.slice(start, nextEnd),
    nextEnd,
    previousEnd,
    start,
  }
}

function composeClassName(...classNames: Array<string | undefined>) {
  return classNames.filter(Boolean).join(' ')
}

export function AgentComposerMentionInput({
  disabled = false,
  footer,
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
  onKeyUp,
  onClick,
  onSelect,
  onCompositionEnd,
  onCompositionStart,
  onCopy,
  onCut,
  onPaste,
  ...textAreaProps
}: AgentComposerMentionInputProps) {
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null)
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
  const mentionMenuHeight = useMemo(
    () => mentionResults.length > 0
      ? Math.min((mentionResults.length * MENTION_MENU_ROW_HEIGHT) + MENTION_MENU_PADDING, MENTION_MENU_MAX_HEIGHT)
      : MENTION_MENU_EMPTY_HEIGHT,
    [mentionResults.length],
  )

  useLayoutEffect(() => {
    const textarea = textAreaRef.current
    const nextSelection = pendingSelectionRef.current

    if (!textarea || !nextSelection) {
      return
    }

    pendingSelectionRef.current = null
    if (isFocused && document.activeElement !== textarea) {
      textarea.focus()
    }
    writeTextAreaSelection(textarea, value, nextSelection)
    setSelection(nextSelection)
  }, [isFocused, value])

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

  function syncSelectionFromTextArea() {
    const textarea = textAreaRef.current

    if (!textarea) {
      return null
    }

    const rawSelection = readTextAreaSelection(textarea)
    const nextSelection = normalizedMentions.length > 0
      ? normalizeSelectionToMentionBoundary(rawSelection)
      : rawSelection

    if (nextSelection.start !== rawSelection.start || nextSelection.end !== rawSelection.end) {
      writeTextAreaSelection(textarea, value, nextSelection)
    }

    setSelection(nextSelection)
    return nextSelection
  }

  function normalizeSelectionToMentionBoundary(nextSelection: ComposerSelectionRange) {
    if (nextSelection.start !== nextSelection.end) {
      return nextSelection
    }

    const matchingMention = normalizedMentions.find((mention) => (
      nextSelection.start > mention.start && nextSelection.start < mention.end
    ))

    if (!matchingMention) {
      return nextSelection
    }

    const distanceToStart = nextSelection.start - matchingMention.start
    const distanceToEnd = matchingMention.end - nextSelection.start
    const nextOffset = distanceToStart <= distanceToEnd ? matchingMention.start : matchingMention.end

    return {
      end: nextOffset,
      start: nextOffset,
    }
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
    const nextModel = applyComposerTextEdit({
      insertText,
      mentions: normalizedMentions,
      selection: editSelection,
      value,
    })
    const nextSelection = {
      end: nextModel.nextSelectionEnd,
      start: nextModel.nextSelectionStart,
    }

    emitModel(
      {
        mentions: nextModel.mentions,
        value: nextModel.value,
      },
      nextSelection,
    )
  }

  function handleMentionNavigation(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
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

  function handleCopyLikeEvent(event: ClipboardEvent<HTMLTextAreaElement>, shouldDelete: boolean) {
    const currentSelection = syncSelectionFromTextArea() ?? selection

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

      <TextArea
        {...textAreaProps}
        ref={textAreaRef}
        className={composeClassName('agent-composer-input', className)}
        disabled={disabled}
        fullWidth
        placeholder={placeholder}
        rows={1}
        spellCheck={false}
        value={value}
        onBlur={(event) => {
          setIsFocused(false)
          onBlur?.(event)
        }}
        onChange={(event) => {
          const change = getTextValueChange(value, event.currentTarget.value)
          const rawSelection = readTextAreaSelection(event.currentTarget)

          if (!change) {
            setSelection(rawSelection)
            return
          }

          const nextModel = applyComposerTextEdit({
            insertText: change.insertedText,
            mentions: normalizedMentions,
            selection: {
              end: change.previousEnd,
              start: change.start,
            },
            value,
          })
          const nextSelection = nextModel.value === event.currentTarget.value
            ? rawSelection
            : {
                end: nextModel.nextSelectionEnd,
                start: nextModel.nextSelectionStart,
              }

          emitModel(
            {
              mentions: nextModel.mentions,
              value: nextModel.value,
            },
            nextSelection,
          )
        }}
        onClick={(event) => {
          syncSelectionFromTextArea()
          onClick?.(event)
        }}
        onCompositionEnd={(event) => {
          setIsComposing(false)
          syncSelectionFromTextArea()
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
        onFocus={(event) => {
          setIsFocused(true)
          setSelection(readTextAreaSelection(event.currentTarget))
          onFocus?.(event)
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event)

          if (event.defaultPrevented || disabled || isComposing || event.nativeEvent.isComposing) {
            return
          }

          if (handleMentionNavigation(event)) {
            return
          }

          const currentSelection = syncSelectionFromTextArea() ?? selection

          if (event.key === 'Backspace' || event.key === 'Delete') {
            const direction = event.key === 'Backspace' ? 'backward' : 'forward'
            const deleteRange = getComposerDeleteRange(currentSelection, normalizedMentions, direction)

            if (deleteRange) {
              event.preventDefault()
              applyTextEdit('', deleteRange)
            }
            return
          }

          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            onSubmitShortcut?.(event)
          }
        }}
        onKeyUp={(event) => {
          syncSelectionFromTextArea()
          onKeyUp?.(event)
        }}
        onPaste={(event) => {
          onPaste?.(event)
          if (event.defaultPrevented) {
            return
          }

          if (disabled || isComposing) {
            return
          }

          event.preventDefault()
          const pastedText = event.clipboardData.getData('text/plain')
          const currentSelection = syncSelectionFromTextArea() ?? selection
          applyTextEdit(pastedText, currentSelection)
        }}
        onSelect={(event) => {
          setSelection(readTextAreaSelection(event.currentTarget))
          onSelect?.(event)
        }}
      />
      {footer}
    </div>
  )
}
