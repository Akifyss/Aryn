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

type AgentSessionTreeRowProps = {
  activity?: 'running' | 'waiting'
  agentId?: AgentId
  isActive: boolean
  isDeleting: boolean
  isRenaming: boolean
  label: string
  menuPortalTarget?: HTMLElement | null
  menuTitle?: string
  itemClassName?: string
  relativeTime?: string
  rowClassName?: string
  onOpen: () => void
  onCancelRename: () => void
  onDelete: () => void
  onRename: (name: string) => Promise<void>
  onRequestRename: () => void
}

export function AgentSessionTreeRow({
  activity,
  agentId,
  isActive,
  isDeleting,
  isRenaming,
  label,
  menuPortalTarget,
  menuTitle = '更多',
  itemClassName,
  relativeTime,
  rowClassName,
  onOpen,
  onCancelRename,
  onDelete,
  onRename,
  onRequestRename,
}: AgentSessionTreeRowProps) {
  const [draftName, setDraftName] = useState(label)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isActionMenuOpen, setIsActionMenuOpen] = useState(false)
  const [isContextMenuOpen, setIsContextMenuOpen] = useState(false)
  const rowRef = useRef<HTMLDivElement | null>(null)
  const renameInputRef = useRef<HTMLInputElement | null>(null)
  const isMenuOpen = isActionMenuOpen || isContextMenuOpen
  const accessibleLabel = agentId ? `${label}，${getAgentDefinition(agentId).label}` : label
  const activityLabel = activity === 'waiting' ? '等待操作' : '运行中'
  const sessionInfo = !isRenaming
    ? activity === 'running'
      ? <Spinner
        aria-hidden='true'
        className='size-4 agent-session-running-spinner'
        color='current'
        size='sm'
      />
      : relativeTime
    : undefined

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
        <CheckLine size={16} />
      </AppItemActionButton>
      <AppItemActionButton
        aria-label='Cancel rename'
        title='取消重命名'
        disabled={isSubmitting}
        onClick={onCancelRename}
      >
        <CloseLine size={16} />
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
        <More1Line size={16} />
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
      itemClassName={`agent-project-session-node${itemClassName ? ` ${itemClassName}` : ''}`}
      ref={rowRef}
      rowClassName={`agent-project-session-row${rowClassName ? ` ${rowClassName}` : ''}`}
      isActive={isActive}
      isEditing={isRenaming}
      isMenuOpen={isMenuOpen}
      after={error ? <p className='tree-error agent-session-rename-error'>{error}</p> : null}
      icon={agentId ? (
        <AppItemIcon>
          <AgentBrandIcon agentId={agentId} className='agent-brand-icon' size={16} tone='muted' />
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
