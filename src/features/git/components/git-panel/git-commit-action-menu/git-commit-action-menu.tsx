import { type MouseEvent, useEffect, useState } from 'react'
import { ArrowUpCircleLine, CheckLine, DownLine } from '@mingcute/react'
import { AppMenu as Menu, shouldCloseClickOpenedMenu } from '@/components/app-menu'
import { AppSplitButton } from '@/components/app-split-button'

function runCommitMenuAction(event: MouseEvent<HTMLElement>, action: () => void) {
  event.stopPropagation()
  action()
}

export function GitCommitActionMenu({
  canSubmitCommit,
  isBusy,
  menuPortalTarget,
  syncDisabledReason,
  onCommit,
  onCommitAndSync,
}: {
  canSubmitCommit: boolean
  isBusy: boolean
  menuPortalTarget?: HTMLElement | null
  syncDisabledReason: string | null
  onCommit: () => void
  onCommitAndSync: () => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const commitDisabled = !canSubmitCommit || isBusy
  const commitAndSyncDisabled = !canSubmitCommit || Boolean(syncDisabledReason)
  const menuDisabled = commitDisabled
  const isMenuOpen = isOpen && !menuDisabled

  useEffect(() => {
    if (menuDisabled) {
      setIsOpen(false)
    }
  }, [menuDisabled])

  return (
    <Menu.Root
      modal={false}
      open={isMenuOpen}
      onOpenChange={(open, details) => {
        if (open) {
          if (menuDisabled) {
            return
          }

          setIsOpen(true)
          return
        }

        if (shouldCloseClickOpenedMenu(details)) {
          setIsOpen(false)
        } else {
          details.cancel?.()
        }
      }}
    >
      <Menu.Trigger
        aria-label='打开提交菜单'
        disabled={menuDisabled}
        render={(
          <AppSplitButton.Trigger
            isActive={isMenuOpen}
            tooltip='提交选项'
          />
        )}
      >
        <DownLine aria-hidden='true' />
      </Menu.Trigger>
      <Menu.Portal
        container={menuPortalTarget ?? undefined}
      >
        <Menu.Positioner
          align='end'
          positionMethod='fixed'
          side='bottom'
        >
          <Menu.Popup
            aria-label='提交选项'
            finalFocus={false}
            size='sm'
          >
            <Menu.Item
              disabled={commitDisabled}
              icon={<CheckLine aria-hidden='true' />}
              label='提交'
              text='提交'
              onClick={(event) => runCommitMenuAction(event, onCommit)}
            />
            <Menu.Item
              disabled={commitAndSyncDisabled}
              icon={<ArrowUpCircleLine aria-hidden='true' />}
              label='提交并同步'
              text='提交并同步'
              onClick={(event) => runCommitMenuAction(event, onCommitAndSync)}
            />
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}
