import {
  AddLine,
  Back2Line,
  Columns2Line,
  DownLine,
  Rows2Line,
  UpLine,
} from '@mingcute/react'
import minusIcon from '@iconify-icons/lucide/minus'
import { Icon as OfflineIcon } from '@iconify/react/offline'
import { createRoot, type Root } from 'react-dom/client'
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react'
import { AppIconButton } from '@/components/app-icon-button'
import type { GitDiffBlockAction } from '@/features/git/types'
import { scheduleDeferredReactRootUnmount } from '@/features/editor/lib/meo-react-root'

export type MeoInlineDiffViewMode = 'split' | 'unified'

type DiffHunkActionButtonsProps = {
  actions: readonly GitDiffBlockAction[]
  busy: boolean
  onAction: (control: HTMLElement, action: GitDiffBlockAction) => void
}

type MeoLiveInlineDiffToolbarProps = DiffHunkActionButtonsProps & {
  onNavigate: (direction: 'next' | 'previous') => void
  onViewModeChange: (mode: MeoInlineDiffViewMode) => void
  viewMode: MeoInlineDiffViewMode
}

type MountedReactControl<Props> = {
  destroy: () => void
  dom: HTMLElement
  update: (nextProps: Props) => void
}

const ACTION_BUSY_TOOLTIP = 'Wait for the current Git block action to finish.'
const GIT_DIFF_BLOCK_ACTION_LABELS: Record<GitDiffBlockAction, string> = {
  discard: 'Discard block',
  stage: 'Stage block',
  unstage: 'Unstage block',
}

export function getGitDiffBlockActionLabel(action: GitDiffBlockAction) {
  return GIT_DIFF_BLOCK_ACTION_LABELS[action]
}

export function getNextInlineDiffViewMode(mode: MeoInlineDiffViewMode): MeoInlineDiffViewMode {
  return mode === 'unified' ? 'split' : 'unified'
}

export function getInlineDiffViewModeToggleLabel(mode: MeoInlineDiffViewMode) {
  return mode === 'unified'
    ? 'Switch to inline split'
    : 'Switch to inline unified'
}

function DiffHunkActionIcon({ action }: { action: GitDiffBlockAction }) {
  if (action === 'stage') {
    return <AddLine aria-hidden='true' />
  }

  if (action === 'unstage') {
    return <OfflineIcon aria-hidden='true' icon={minusIcon} />
  }

  return <Back2Line aria-hidden='true' />
}

function stopEditorPointerEvent(event: ReactMouseEvent<HTMLElement>) {
  event.preventDefault()
  event.stopPropagation()
}

function DiffHunkActionButton({
  action,
  busy,
  onAction,
}: {
  action: GitDiffBlockAction
  busy: boolean
  onAction: DiffHunkActionButtonsProps['onAction']
}) {
  const label = getGitDiffBlockActionLabel(action)

  return (
    <AppIconButton
      aria-label={label}
      className='meo-diff-hunk-action'
      data-action={action}
      disabled={busy}
      preventFocusOnPress
      size='sm'
      tooltip={busy ? ACTION_BUSY_TOOLTIP : label}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onAction(event.currentTarget, action)
      }}
      onMouseDown={stopEditorPointerEvent}
    >
      <DiffHunkActionIcon action={action} />
    </AppIconButton>
  )
}

export function MeoDiffHunkActionButtons({
  actions,
  busy,
  onAction,
}: DiffHunkActionButtonsProps) {
  return actions.map((action) => (
    <DiffHunkActionButton
      action={action}
      busy={busy}
      key={action}
      onAction={onAction}
    />
  ))
}

export function MeoLiveInlineDiffToolbar({
  actions,
  busy,
  onAction,
  onNavigate,
  onViewModeChange,
  viewMode,
}: MeoLiveInlineDiffToolbarProps) {
  const targetViewMode = getNextInlineDiffViewMode(viewMode)
  const viewModeLabel = getInlineDiffViewModeToggleLabel(viewMode)
  const ViewModeIcon = targetViewMode === 'unified'
    ? Rows2Line
    : Columns2Line

  return (
    <div
      aria-label='Inline diff controls'
      className='meo-live-inline-diff-controls meo-diff-floating-hunk-toolbar meo-diff-floating-control-surface'
      role='toolbar'
      onMouseDown={stopEditorPointerEvent}
    >
      {actions.length > 0 ? (
        <div
          aria-label='Git block actions'
          className='meo-diff-hunk-actions meo-live-inline-diff-hunk-actions'
          role='group'
        >
          <MeoDiffHunkActionButtons actions={actions} busy={busy} onAction={onAction} />
        </div>
      ) : null}

      <div className='meo-live-inline-diff-nav' role='group' aria-label='Diff navigation'>
        <AppIconButton
          aria-label={viewModeLabel}
          className='meo-live-inline-diff-nav-button meo-live-inline-diff-view-toggle'
          data-target-mode={targetViewMode}
          preventFocusOnPress
          size='sm'
          tooltip={viewModeLabel}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onViewModeChange(targetViewMode)
          }}
          onMouseDown={stopEditorPointerEvent}
        >
          <ViewModeIcon aria-hidden='true' />
        </AppIconButton>

        <AppIconButton
          aria-label='Previous change'
          className='meo-live-inline-diff-nav-button'
          preventFocusOnPress
          size='sm'
          tooltip='Previous change'
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onNavigate('previous')
          }}
          onMouseDown={stopEditorPointerEvent}
        >
          <UpLine aria-hidden='true' />
        </AppIconButton>

        <AppIconButton
          aria-label='Next change'
          className='meo-live-inline-diff-nav-button'
          preventFocusOnPress
          size='sm'
          tooltip='Next change'
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onNavigate('next')
          }}
          onMouseDown={stopEditorPointerEvent}
        >
          <DownLine aria-hidden='true' />
        </AppIconButton>
      </div>
    </div>
  )
}

function createMountedReactControl<Props>(
  dom: HTMLElement,
  initialProps: Props,
  render: (props: Props) => ReactNode,
): MountedReactControl<Props> {
  const root: Root = createRoot(dom)
  let destroyed = false
  const update = (nextProps: Props) => {
    if (destroyed) {
      return
    }

    root.render(render(nextProps))
  }

  update(initialProps)

  return {
    destroy() {
      if (destroyed) {
        return
      }

      destroyed = true
      scheduleDeferredReactRootUnmount(root)
    },
    dom,
    update,
  }
}

export function mountMeoDiffHunkActions(
  props: DiffHunkActionButtonsProps,
): MountedReactControl<DiffHunkActionButtonsProps> {
  const dom = document.createElement('div')
  dom.className = 'meo-diff-hunk-actions meo-diff-hunk-actions-vertical meo-diff-floating-control-surface'
  dom.setAttribute('aria-label', 'Git block actions')
  dom.setAttribute('aria-orientation', 'vertical')
  dom.setAttribute('role', 'toolbar')
  dom.onmousedown = (event) => {
    event.preventDefault()
    event.stopPropagation()
  }

  return createMountedReactControl(
    dom,
    props,
    (nextProps) => <MeoDiffHunkActionButtons {...nextProps} />,
  )
}

export function mountMeoDiffHunkAction(
  props: Omit<DiffHunkActionButtonsProps, 'actions'> & { action: GitDiffBlockAction },
): MountedReactControl<typeof props> {
  const dom = document.createElement('span')
  dom.className = 'meo-diff-hunk-action-mount'
  return createMountedReactControl(
    dom,
    props,
    (nextProps) => (
      <DiffHunkActionButton
        action={nextProps.action}
        busy={nextProps.busy}
        onAction={nextProps.onAction}
      />
    ),
  )
}

export function mountMeoLiveInlineDiffToolbar(
  dom: HTMLElement,
  props: MeoLiveInlineDiffToolbarProps,
): MountedReactControl<MeoLiveInlineDiffToolbarProps> {
  return createMountedReactControl(
    dom,
    props,
    (nextProps) => <MeoLiveInlineDiffToolbar {...nextProps} />,
  )
}
