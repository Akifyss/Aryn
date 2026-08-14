import { type FormEvent, useEffect, useRef, useState } from 'react'
import { Spinner } from '@heroui/react'
import {
  CheckLine,
  CloseLine,
  More1Line,
} from '@mingcute/react'
import {
  AppItem,
  AppItemActionButton,
  AppItemIcon,
  AppItemMain,
  AppItemMainButton,
  type AppItemMainRenderer,
} from '@/components/app-item'
import { AppMenu as Menu } from '@/components/app-menu'
import { getAgentDefinition, type AgentId } from '@/features/agent/agent-definition'
import { AgentBrandIcon } from '@/features/agent/components/agent-brand-icon/agent-brand-icon'
import {
  AgentTreeContextMenuPopup,
  AgentTreeMenuPopup,
} from './menus'

const SESSION_PREFETCH_HOVER_DELAY_MS = 80

type AgentSessionTreeRowProps = {
  activity?: 'running' | 'waiting'
  agentId?: AgentId
  isActive: boolean
  isDeleting: boolean
  isRenaming: boolean
  itemAs?: 'div' | 'li' | null
  label: string
  menuPortalTarget?: HTMLElement | null
  menuTitle?: string
  itemClassName?: string
  relativeTime?: string
  rowClassName?: string
  onOpen: () => void
  onCancelRename: () => void
  onDelete: () => void
  onMenuOpenChange?: (open: boolean) => void
  onRename: (name: string) => Promise<void>
  onPrefetch?: () => void
  onRequestRename: () => void
}

export function AgentSessionTreeRow({
  activity,
  agentId,
  isActive,
  isDeleting,
  isRenaming,
  itemAs,
  label,
  menuPortalTarget,
  menuTitle = '更多',
  itemClassName,
  relativeTime,
  rowClassName,
  onOpen,
  onCancelRename,
  onDelete,
  onMenuOpenChange,
  onRename,
  onPrefetch,
  onRequestRename,
}: AgentSessionTreeRowProps) {
  const [draftName, setDraftName] = useState(label)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isActionMenuOpen, setIsActionMenuOpen] = useState(false)
  const [isContextMenuOpen, setIsContextMenuOpen] = useState(false)
  const rowRef = useRef<HTMLDivElement | null>(null)
  const renameInputRef = useRef<HTMLInputElement | null>(null)
  const prefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onMenuOpenChangeRef = useRef(onMenuOpenChange)
  const onPrefetchRef = useRef(onPrefetch)
  const reportedMenuOpenRef = useRef(false)
  onMenuOpenChangeRef.current = onMenuOpenChange
  onPrefetchRef.current = onPrefetch
  const isMenuOpen = isActionMenuOpen || isContextMenuOpen
  const accessibleLabel = agentId ? `${label}，${getAgentDefinition(agentId).label}` : label
  const activityLabel = activity === 'waiting' ? '等待操作' : '运行中'
  const sessionInfo = !isRenaming
    ? activity === 'running'
      ? <Spinner
        aria-hidden='true'
        className='size-[var(--icon-size-md)] agent-session-running-spinner'
        color='current'
        size='sm'
      />
      : relativeTime
    : undefined

  useEffect(() => {
    if (reportedMenuOpenRef.current === isMenuOpen) return

    reportedMenuOpenRef.current = isMenuOpen
    onMenuOpenChangeRef.current?.(isMenuOpen)
  }, [isMenuOpen])

  useEffect(() => () => {
    if (prefetchTimerRef.current !== null) clearTimeout(prefetchTimerRef.current)
    if (!reportedMenuOpenRef.current) return

    reportedMenuOpenRef.current = false
    onMenuOpenChangeRef.current?.(false)
  }, [])

  const cancelScheduledPrefetch = () => {
    if (prefetchTimerRef.current === null) return
    clearTimeout(prefetchTimerRef.current)
    prefetchTimerRef.current = null
  }
  const prefetchImmediately = () => {
    cancelScheduledPrefetch()
    onPrefetchRef.current?.()
  }
  const schedulePrefetch = () => {
    if (!onPrefetchRef.current || prefetchTimerRef.current !== null) return
    prefetchTimerRef.current = setTimeout(() => {
      prefetchTimerRef.current = null
      onPrefetchRef.current?.()
    }, SESSION_PREFETCH_HOVER_DELAY_MS)
  }

  useEffect(() => {
    if (!isRenaming) {
      setDraftName(label)
      setError(null)
      return
    }

    setDraftName(label)
  }, [isRenaming, label])

  useEffect(() => {
    if (!isRenaming) {
      return
    }

    const frameId = window.requestAnimationFrame(() => {
      const input = renameInputRef.current
      if (!input) return

      input.focus()
      input.setSelectionRange(0, input.value.length)
    })

    return () => window.cancelAnimationFrame(frameId)
  }, [isRenaming])

  const handleSubmitRename = async (event?: FormEvent) => {
    event?.preventDefault()
    const nextName = draftName.trim()

    if (!nextName || nextName === label.trim()) {
      onCancelRename()
      return
    }

    try {
      setIsSubmitting(true)
      setError(null)
      await onRename(nextName)
      onCancelRename()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rename failed')
    } finally {
      setIsSubmitting(false)
    }
  }

  const rowMain = isRenaming ? (
    <AppItemMain
      className='agent-session-rename-trigger'
      onClick={(event) => event.stopPropagation()}
    >
      <input
        ref={renameInputRef}
        aria-label='Rename conversation'
        className='raw-rename-input'
        value={draftName}
        onFocus={(event) => event.target.select()}
        onChange={(event) => setDraftName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            void handleSubmitRename()
          }
          if (event.key === 'Escape') {
            onCancelRename()
          }
        }}
        onBlur={(event) => {
          if (isSubmitting) return

          const nextFocusedElement = event.relatedTarget
          if (nextFocusedElement instanceof Node && rowRef.current?.contains(nextFocusedElement)) {
            return
          }

          onCancelRename()
        }}
      />
    </AppItemMain>
  ) : undefined
  const renderSessionMain: AppItemMainRenderer | undefined = isRenaming
    ? undefined
    : (content, mainProps) => {
      const { className, hasDescription } = mainProps

      return (
        <Menu.Context.Root onOpenChange={setIsContextMenuOpen}>
          <Menu.Context.Trigger
            aria-label={accessibleLabel}
            render={<AppItemMainButton className={className} hasDescription={hasDescription} role='button' />}
            title={accessibleLabel}
            onClick={onOpen}
          >
            {content}
          </Menu.Context.Trigger>
          <AgentTreeContextMenuPopup
            disabled={isDeleting}
            menuPortalTarget={menuPortalTarget}
            onDelete={onDelete}
            onRename={onRequestRename}
          />
        </Menu.Context.Root>
      )
    }
  const rowActions = isRenaming ? (
    <>
      <AppItemActionButton
        aria-label='Confirm rename'
        title='确认重命名'
        disabled={isSubmitting}
        onClick={() => void handleSubmitRename()}
      >
        <CheckLine />
      </AppItemActionButton>
      <AppItemActionButton
        aria-label='Cancel rename'
        title='取消重命名'
        disabled={isSubmitting}
        onClick={onCancelRename}
      >
        <CloseLine />
      </AppItemActionButton>
    </>
  ) : (
    <Menu.Root modal={false} onOpenChange={setIsActionMenuOpen}>
      <Menu.Trigger
        aria-label={`Open ${accessibleLabel} menu`}
        disabled={isDeleting}
        render={<AppItemActionButton />}
        title={menuTitle}
      >
        <More1Line />
      </Menu.Trigger>
      <AgentTreeMenuPopup
        disabled={isDeleting}
        menuPortalTarget={menuPortalTarget}
        onDelete={onDelete}
        onRename={onRequestRename}
      />
    </Menu.Root>
  )

  return (
    <AppItem
      itemAs={itemAs}
      itemClassName={`agent-project-session-node${itemClassName ? ` ${itemClassName}` : ''}`}
      ref={rowRef}
      onFocusCapture={prefetchImmediately}
      onPointerDown={prefetchImmediately}
      onPointerEnter={schedulePrefetch}
      onPointerLeave={cancelScheduledPrefetch}
      rowClassName={`agent-project-session-row${rowClassName ? ` ${rowClassName}` : ''}`}
      isActive={isActive}
      isEditing={isRenaming}
      isMenuOpen={isMenuOpen}
      after={error ? <p className='tree-error agent-session-rename-error'>{error}</p> : null}
      icon={agentId ? (
        <AppItemIcon>
          <AgentBrandIcon agentId={agentId} className='agent-brand-icon' size='md' />
        </AppItemIcon>
      ) : undefined}
      main={rowMain}
      label={!isRenaming ? label : undefined}
      labelClassName={!isRenaming ? 'agent-project-session-label' : undefined}
      labelSuffix={!isRenaming && activity === 'waiting' ? (
        <span
          aria-label={activityLabel}
          className={`agent-session-activity is-${activity}`}
          role='status'
          title={activityLabel}
        />
      ) : undefined}
      renderMain={renderSessionMain}
      actions={rowActions}
      actionsAlwaysVisible={isRenaming}
      actionsClassName={isRenaming ? 'agent-session-rename-actions' : undefined}
      info={sessionInfo}
      infoProps={activity === 'running' ? {
        'aria-label': activityLabel,
        role: 'status',
        title: activityLabel,
      } : undefined}
      infoVariant={activity === 'running' ? 'status' : 'text'}
    />
  )
}
