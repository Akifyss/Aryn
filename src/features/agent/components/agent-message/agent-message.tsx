import {
  memo,
  type ReactNode,
  type Ref,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { Disclosure } from '@heroui/react'
import { Icon } from '@iconify/react'
import {
  AiLine,
  BrainLine,
  CodeLine,
  Delete2Line,
  EyeglassLine,
  Pencil2Line,
  RightLine,
  SearchLine,
  TerminalLine,
  ToolLine,
} from '@mingcute/react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { AppScrollArea } from '@/components/app-scroll-area'
import { AppTooltip } from '@/components/app-tooltip'
import { FileChangeStatusBadge } from '@/components/file-change-visuals'
import {
  AgentAttachmentFileCard,
  AgentFileCard,
} from '@/features/agent/components/agent-file-card/agent-file-card'
import { resolveWorkspaceMessageLink } from '@/features/agent/lib/message-links'
import type {
  AgentMessageAttachment,
  AgentMessageFileChange,
  AgentSidebarMessage,
  AgentSidebarMessageStatus,
} from '@/features/agent/types'
import type { WorkspaceIconTheme } from '@/features/workspace/types'

import './styles.css'

const MARKDOWN_PLUGINS = [remarkGfm]
const AGENT_THINKING_AUTO_EXPAND_DELAY_MS = 520
const AGENT_THINKING_AUTO_COLLAPSE_DELAY_MS = 140
const AGENT_THINKING_MIN_EXPANDED_MS = 360
const AGENT_THINKING_SCROLL_STICKY_THRESHOLD_PX = 24

const MAX_VISIBLE_MESSAGE_FILE_CARDS = 6

function getAgentRelativePath(rootPath: string | null, filePath: string) {
  if (!rootPath) {
    return filePath.split(/[\\/]/).pop() ?? filePath
  }

  const normalizedRoot = rootPath.replace(/[\\/]+$/, '').replace(/[\\/]+/g, '/')
  const normalizedFilePath = filePath.replace(/[\\/]+/g, '/')

  if (!normalizedFilePath.startsWith(normalizedRoot)) {
    return filePath.split(/[\\/]/).pop() ?? filePath
  }

  return normalizedFilePath.slice(normalizedRoot.length).replace(/^\/+/, '') || (filePath.split(/[\\/]/).pop() ?? filePath)
}

function getAgentFileChangeVisualKind(kind: AgentMessageFileChange['kind']) {
  if (kind === 'created') {
    return 'added'
  }

  if (kind === 'deleted') {
    return 'deleted'
  }

  return 'modified'
}

function getMessageFileSectionTitle(fileChanges: AgentMessageFileChange[]) {
  if (fileChanges.length === 0) {
    return ''
  }

  const uniqueKinds = new Set(fileChanges.map((change) => change.kind))

  if (uniqueKinds.size === 1) {
    const [kind] = [...uniqueKinds]

    if (kind === 'created') {
      return 'Files Created'
    }

    if (kind === 'deleted') {
      return 'Files Deleted'
    }

    return 'Files Modified'
  }

  return 'Files Changed'
}

function getMessageStatus(message: AgentSidebarMessage): AgentSidebarMessageStatus {
  return message.status ?? (message.isError ? 'error' : 'done')
}

function getToolStatusLabel(status: AgentSidebarMessageStatus) {
  switch (status) {
    case 'running':
      return '运行中'
    case 'error':
      return '失败'
    default:
      return '完成'
  }
}

function useAutoDisclosureState({
  collapseDelayMs = 0,
  expandDelayMs = 0,
  initialExpanded,
  minExpandedMs = 0,
  nextAutoExpanded,
  stateKey,
}: {
  collapseDelayMs?: number
  expandDelayMs?: number
  initialExpanded: boolean
  minExpandedMs?: number
  nextAutoExpanded: boolean
  stateKey: string
}) {
  const [isExpanded, setIsExpanded] = useState(initialExpanded)
  const expandedRef = useRef(initialExpanded)
  const autoExpandedRef = useRef(false)
  const lastAutoExpandedAtRef = useRef<number | null>(null)
  const timerRef = useRef<number | null>(null)
  const userInteractedRef = useRef(false)

  function clearScheduledTransition() {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  function setExpandedState(nextExpanded: boolean) {
    expandedRef.current = nextExpanded
    setIsExpanded(nextExpanded)
  }

  useEffect(() => {
    expandedRef.current = isExpanded
  }, [isExpanded])

  useEffect(() => {
    clearScheduledTransition()
    userInteractedRef.current = false
    autoExpandedRef.current = false
    lastAutoExpandedAtRef.current = null
    setExpandedState(initialExpanded)
  }, [initialExpanded, stateKey])

  useEffect(() => {
    clearScheduledTransition()

    if (userInteractedRef.current) {
      return
    }

    if (nextAutoExpanded) {
      if (expandedRef.current) {
        return
      }

      if (expandDelayMs <= 0) {
        autoExpandedRef.current = true
        lastAutoExpandedAtRef.current = Date.now()
        setExpandedState(true)
        return
      }

      timerRef.current = window.setTimeout(() => {
        if (userInteractedRef.current) {
          timerRef.current = null
          return
        }

        autoExpandedRef.current = true
        lastAutoExpandedAtRef.current = Date.now()
        setExpandedState(true)
        timerRef.current = null
      }, expandDelayMs)

      return clearScheduledTransition
    }

    if (!expandedRef.current || !autoExpandedRef.current) {
      return
    }

    const minVisibleRemainingMs = lastAutoExpandedAtRef.current !== null
      ? Math.max(0, minExpandedMs - (Date.now() - lastAutoExpandedAtRef.current))
      : 0
    const effectiveDelayMs = Math.max(collapseDelayMs, minVisibleRemainingMs)

    if (effectiveDelayMs <= 0) {
      autoExpandedRef.current = false
      lastAutoExpandedAtRef.current = null
      setExpandedState(false)
      return
    }

    timerRef.current = window.setTimeout(() => {
      if (userInteractedRef.current) {
        timerRef.current = null
        return
      }

      autoExpandedRef.current = false
      lastAutoExpandedAtRef.current = null
      setExpandedState(false)
      timerRef.current = null
    }, effectiveDelayMs)

    return clearScheduledTransition
  }, [collapseDelayMs, expandDelayMs, minExpandedMs, nextAutoExpanded, stateKey])

  useEffect(() => () => {
    clearScheduledTransition()
  }, [])

  function handleExpandedChange(nextExpanded: boolean) {
    clearScheduledTransition()
    userInteractedRef.current = true
    autoExpandedRef.current = false
    lastAutoExpandedAtRef.current = null
    setExpandedState(nextExpanded)
  }

  return [isExpanded, handleExpandedChange] as const
}

const AgentMarkdown = memo(function AgentMarkdown({
  onOpenWorkspaceFile,
  text,
  workspacePath,
}: {
  onOpenWorkspaceFile?: (filePath: string) => void
  text: string
  workspacePath: string | null
}) {
  return (
    <div className='agent-markdown'>
      <ReactMarkdown
        components={{
          a: ({ href, children }) => {
            const workspaceFilePath = resolveWorkspaceMessageLink(workspacePath, href)

            if (workspaceFilePath && onOpenWorkspaceFile) {
              return (
                <a
                  href={href}
                  onClick={(event) => {
                    event.preventDefault()
                    onOpenWorkspaceFile(workspaceFilePath)
                  }}
                >
                  {children}
                </a>
              )
            }

            return (
              <a href={href} rel='noreferrer' target='_blank'>
                {children}
              </a>
            )
          },
        }}
        remarkPlugins={MARKDOWN_PLUGINS}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
})

function formatDisclosureTitle(title: string) {
  return title.includes('_') || title.includes('-')
    ? title.replace(/[_-]+/g, ' ')
    : title
}

function getMessageDisclosureIcon(kind: 'details' | 'thinking' | 'tool', title: string) {
  const normalizedTitle = title.trim().toLowerCase()
  const iconClassName = 'agent-message-toggle-icon'

  if (kind === 'thinking') {
    return <BrainLine aria-hidden='true' className={iconClassName} />
  }

  if (kind === 'details') {
    return <AiLine aria-hidden='true' className={iconClassName} />
  }

  if (/write|edit|append|replace|rewrite|update|create|save|draft/.test(normalizedTitle)) {
    return <Pencil2Line aria-hidden='true' className={iconClassName} />
  }

  if (/delete|remove/.test(normalizedTitle)) {
    return <Delete2Line aria-hidden='true' className={iconClassName} />
  }

  if (/bash|shell|terminal|command|powershell/.test(normalizedTitle)) {
    return <TerminalLine aria-hidden='true' className={iconClassName} />
  }

  if (/search|find|grep|query|match/.test(normalizedTitle)) {
    return <SearchLine aria-hidden='true' className={iconClassName} />
  }

  if (/read|open|view|inspect/.test(normalizedTitle)) {
    return <EyeglassLine aria-hidden='true' className={iconClassName} />
  }

  if (/patch|code|diff/.test(normalizedTitle)) {
    return <CodeLine aria-hidden='true' className={iconClassName} />
  }

  return <ToolLine aria-hidden='true' className={iconClassName} />
}

function getMessageStatusIcon(status: AgentSidebarMessageStatus) {
  switch (status) {
    case 'running':
      return <Icon aria-hidden='true' className='agent-message-status-icon is-running' icon='svg-spinners:bars-rotate-fade' />
    case 'error':
      return <Icon aria-hidden='true' className='agent-message-status-icon is-error' icon='ci:error-outline' />
    default:
      return null
  }
}

function AgentMessageDisclosure({
  children,
  className,
  expanded,
  kind,
  label,
  onExpandedChange,
  scrollViewportRef,
  status,
  title,
}: {
  children: ReactNode
  className?: string
  expanded: boolean
  kind: 'details' | 'thinking' | 'tool'
  label?: string
  onExpandedChange: (nextExpanded: boolean) => void
  scrollViewportRef?: Ref<HTMLDivElement>
  status?: AgentSidebarMessageStatus
  title: string
}) {
  const displayTitle = formatDisclosureTitle(title)
  const statusIcon = status ? getMessageStatusIcon(status) : null
  const shouldUseScrollArea = kind === 'thinking' || kind === 'tool'

  return (
    <Disclosure
      className={`agent-message agent-message-disclosure-card ${className ?? ''}`.trim()}
      isExpanded={expanded}
      onExpandedChange={onExpandedChange}
    >
      {({ isExpanded: disclosureExpanded }) => (
        <>
          <div className='agent-message-disclosure-header'>
            <Disclosure.Heading className='agent-disclosure-heading'>
              <AppTooltip
                tooltip={status ? getToolStatusLabel(status) : undefined}
                triggerMode='context'
              >
                <Disclosure.Trigger className='agent-message-toggle'>
                  {getMessageDisclosureIcon(kind, title)}
                  <span className='agent-message-toggle-title'>{displayTitle}</span>
                  <span className='agent-message-toggle-trailing'>
                    {statusIcon && !disclosureExpanded ? (
                      <span className='agent-message-toggle-status-slot'>
                        {statusIcon}
                      </span>
                    ) : null}
                    <RightLine
                      aria-hidden='true'
                      className={`agent-message-toggle-arrow ${disclosureExpanded ? 'is-open' : ''} ${statusIcon && !disclosureExpanded ? 'has-status' : ''}`}
                    />
                  </span>
                </Disclosure.Trigger>
              </AppTooltip>
            </Disclosure.Heading>
            {label ? (
              <div className='agent-message-disclosure-meta'>
                {label ? <span className='agent-message-label'>{label}</span> : null}
              </div>
            ) : null}
          </div>

          {disclosureExpanded ? (
            <Disclosure.Content>
              <Disclosure.Body className={`agent-message-disclosure-body agent-message-disclosure-body-${kind}`}>
                {shouldUseScrollArea ? (
                  <AppScrollArea
                    className={`agent-message-disclosure-scroll agent-message-disclosure-scroll-${kind}`}
                    contentClassName={`agent-message-disclosure-scroll-content agent-message-disclosure-scroll-content-${kind}`}
                    viewportClassName={`agent-message-disclosure-scroll-viewport agent-message-disclosure-scroll-viewport-${kind}`}
                    viewportRef={scrollViewportRef}
                  >
                    {children}
                  </AppScrollArea>
                ) : children}
              </Disclosure.Body>
            </Disclosure.Content>
          ) : null}
        </>
      )}
    </Disclosure>
  )
}

export const AgentMessageFileCards = memo(function AgentMessageFileCards({
  fileChanges,
  iconTheme,
  onOpenFile,
  workspacePath,
}: {
  fileChanges: AgentMessageFileChange[]
  iconTheme?: WorkspaceIconTheme | null
  onOpenFile?: (filePath: string, changeKind: AgentMessageFileChange['kind']) => void
  workspacePath: string | null
}) {
  if (fileChanges.length === 0) {
    return null
  }

  const visibleChanges = fileChanges.slice(0, MAX_VISIBLE_MESSAGE_FILE_CARDS)
  const hiddenCount = fileChanges.length - visibleChanges.length
  const title = getMessageFileSectionTitle(fileChanges)

  return (
    <div className='agent-message-footer'>
      <div className='agent-message-files-heading'>
        <span className='agent-message-files-title'>{title}</span>
        <span className='agent-message-files-count'>{fileChanges.length}</span>
      </div>
      <div className='agent-message-files'>
        {visibleChanges.map((change) => {
          const relativePath = getAgentRelativePath(workspacePath, change.filePath)
          const label = relativePath.split('/').pop() ?? relativePath
          const onActivate = change.kind !== 'deleted' && onOpenFile
            ? () => {
                onOpenFile(change.filePath, change.kind)
              }
            : undefined

          return (
            <AgentFileCard
              key={`${change.filePath}:${change.kind}`}
              aria-label={`Open ${relativePath}`}
              className='agent-message-file-card'
              fileName={label}
              iconTheme={iconTheme}
              onActivate={onActivate}
              trailing={<FileChangeStatusBadge className='agent-message-file-card-status' kind={getAgentFileChangeVisualKind(change.kind)} />}
            />
          )
        })}
        {hiddenCount > 0 ? (
          <AppTooltip
            excludeFromTabOrder
            tooltip={`还有 ${hiddenCount} 个文件`}
            triggerRole='img'
          >
            <div className='agent-message-file-overflow-card'>
              <span className='agent-message-file-overflow-label'>+{hiddenCount}</span>
            </div>
          </AppTooltip>
        ) : null}
      </div>
    </div>
  )
})

function AgentMessageAttachments({
  attachments,
  iconTheme,
}: {
  attachments: AgentMessageAttachment[]
  iconTheme?: WorkspaceIconTheme | null
}) {
  if (attachments.length === 0) {
    return null
  }

  return (
    <div className='agent-message-attachments' aria-label='Attachments'>
      {attachments.map((attachment, index) => (
        <AgentAttachmentFileCard
          attachment={attachment}
          iconTheme={iconTheme}
          key={`${attachment.fileName}-${index}`}
        />
      ))}
    </div>
  )
}

export const AgentMessageBubble = memo(function AgentMessageBubble({
  iconTheme,
  message,
  onOpenWorkspaceFile,
  workspacePath,
}: {
  iconTheme?: WorkspaceIconTheme | null
  message: AgentSidebarMessage
  onOpenWorkspaceFile?: (filePath: string) => void
  workspacePath: string | null
}) {
  const isToolMessage = message.kind === 'tool'
  const hasThinking = message.kind === 'assistant' && Boolean(message.thinkingText)
  const isCollapsibleSystemMessage = (message.kind === 'system' || message.kind === 'custom')
    && (message.title === 'Compaction summary' || message.title === 'Branch summary')
  const messageStatus = getMessageStatus(message)
  const shouldAutoExpandThinking = hasThinking && Boolean(message.isThinkingStreaming)
  const thinkingViewportRef = useRef<HTMLDivElement | null>(null)
  const shouldStickThinkingToBottomRef = useRef(true)
  const [isToolExpanded, setIsToolExpanded] = useState(false)
  const [isThinkingExpanded, setIsThinkingExpanded] = useAutoDisclosureState({
    collapseDelayMs: AGENT_THINKING_AUTO_COLLAPSE_DELAY_MS,
    expandDelayMs: AGENT_THINKING_AUTO_EXPAND_DELAY_MS,
    initialExpanded: false,
    minExpandedMs: AGENT_THINKING_MIN_EXPANDED_MS,
    nextAutoExpanded: shouldAutoExpandThinking,
    stateKey: message.id,
  })
  const [isDetailsExpanded, setIsDetailsExpanded] = useState(Boolean(message.isError))

  useEffect(() => {
    if (!isCollapsibleSystemMessage) {
      return
    }

    setIsDetailsExpanded(Boolean(message.isError))
  }, [isCollapsibleSystemMessage, message.id, message.isError])

  useEffect(() => {
    shouldStickThinkingToBottomRef.current = true
  }, [message.id])

  useEffect(() => {
    const currentViewport = thinkingViewportRef.current
    if (!currentViewport || !isThinkingExpanded) {
      return
    }

    function updateStickiness(viewport: HTMLDivElement) {
      const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight
      shouldStickThinkingToBottomRef.current = distanceFromBottom <= AGENT_THINKING_SCROLL_STICKY_THRESHOLD_PX
    }

    updateStickiness(currentViewport)
    const handleScroll = (event: Event) => {
      if (event.currentTarget instanceof HTMLDivElement) {
        updateStickiness(event.currentTarget)
      }
    }

    currentViewport.addEventListener('scroll', handleScroll, { passive: true })

    return () => {
      currentViewport.removeEventListener('scroll', handleScroll)
    }
  }, [isThinkingExpanded, message.id])

  useLayoutEffect(() => {
    if (!message.isThinkingStreaming || !isThinkingExpanded || !shouldStickThinkingToBottomRef.current) {
      return
    }

    const viewport = thinkingViewportRef.current
    if (!viewport) {
      return
    }

    viewport.scrollTop = viewport.scrollHeight
  }, [isThinkingExpanded, message.isThinkingStreaming, message.thinkingText])

  if (isToolMessage) {
    return (
      <AgentMessageDisclosure
        className={`agent-message-tool ${messageStatus === 'running' ? 'is-running' : ''} ${message.isError ? 'is-error' : ''}`}
        expanded={isToolExpanded}
        kind='tool'
        label={message.label}
        onExpandedChange={setIsToolExpanded}
        status={messageStatus}
        title={message.title ?? 'Tool'}
      >
        <AgentMarkdown onOpenWorkspaceFile={onOpenWorkspaceFile} text={message.text} workspacePath={workspacePath} />
      </AgentMessageDisclosure>
    )
  }

  if (isCollapsibleSystemMessage) {
    return (
      <AgentMessageDisclosure
        className={`agent-message-details ${message.isError ? 'is-error' : ''}`}
        expanded={isDetailsExpanded}
        kind='details'
        onExpandedChange={setIsDetailsExpanded}
        title={message.title ?? message.kind}
      >
        <AgentMarkdown onOpenWorkspaceFile={onOpenWorkspaceFile} text={message.text} workspacePath={workspacePath} />
      </AgentMessageDisclosure>
    )
  }

  const roleLabel = message.kind === 'system' || message.kind === 'custom'
    ? (message.title ?? message.kind)
    : null
  const showMeta = Boolean(roleLabel || message.label)
  const messageAttachments = message.attachments ?? []

  return (
    <article className={`agent-message agent-message-${message.kind} ${message.isError ? 'is-error' : ''}`}>
      {showMeta ? (
        <div className='agent-message-meta'>
          {roleLabel ? <span className='agent-message-role'>{roleLabel}</span> : <span />}
          {message.label ? <span className='agent-message-label'>{message.label}</span> : null}
        </div>
      ) : null}

      <div className='agent-message-body'>
        {message.kind === 'assistant' && message.thinkingText ? (
          <AgentMessageDisclosure
            className='agent-message-thinking'
            expanded={isThinkingExpanded}
            kind='thinking'
            onExpandedChange={setIsThinkingExpanded}
            scrollViewportRef={thinkingViewportRef}
            title='Thinking'
          >
            <AgentMarkdown onOpenWorkspaceFile={onOpenWorkspaceFile} text={message.thinkingText} workspacePath={workspacePath} />
          </AgentMessageDisclosure>
        ) : null}
        {messageAttachments.length > 0 ? (
          <AgentMessageAttachments attachments={messageAttachments} iconTheme={iconTheme} />
        ) : null}
        {message.text.trim() ? (
          <div className='agent-message-bubble'>
            <AgentMarkdown onOpenWorkspaceFile={onOpenWorkspaceFile} text={message.text} workspacePath={workspacePath} />
          </div>
        ) : null}
      </div>
    </article>
  )
})
