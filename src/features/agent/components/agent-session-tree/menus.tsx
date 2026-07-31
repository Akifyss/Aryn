import {
  Delete2Line,
  Edit2Line,
  ExternalLinkLine,
} from '@mingcute/react'
import { AppMenu as Menu } from '@/components/app-menu'
import { getSystemFileManagerName } from '@/features/agent/lib/system-file-manager'

const AGENT_TREE_MENU_POSITIONER_PROPS = {
  positionMethod: 'fixed',
  side: 'bottom',
} as const

type AgentTreeMenuItemComponent = typeof Menu.Item

function AgentTreeActionMenuItems({
  disabled,
  ItemComponent = Menu.Item,
  onDelete,
  onRename,
}: {
  disabled: boolean
  ItemComponent?: AgentTreeMenuItemComponent
  onDelete: () => void
  onRename: () => void
}) {
  return (
    <>
      <ItemComponent
        disabled={disabled}
        icon={<Edit2Line size={16} />}
        label='重命名'
        text='重命名'
        onClick={onRename}
      />
      <ItemComponent
        disabled={disabled}
        icon={<Delete2Line size={16} />}
        label='删除'
        text='删除'
        tone='danger'
        onClick={onDelete}
      />
    </>
  )
}

export function AgentTreeMenuPopup({
  disabled,
  menuPortalTarget,
  onDelete,
  onRename,
}: {
  disabled: boolean
  menuPortalTarget?: HTMLElement | null
  onDelete: () => void
  onRename: () => void
}) {
  return (
    <Menu.Portal
      container={menuPortalTarget ?? undefined}
    >
      <Menu.Positioner
        align='end'
        {...AGENT_TREE_MENU_POSITIONER_PROPS}
      >
        <Menu.Popup
          data-agent-tree-menu-root='true'
          size='sm'
        >
          <AgentTreeActionMenuItems disabled={disabled} onDelete={onDelete} onRename={onRename} />
        </Menu.Popup>
      </Menu.Positioner>
    </Menu.Portal>
  )
}

export function AgentTreeContextMenuPopup({
  disabled,
  menuPortalTarget,
  onDelete,
  onRename,
}: {
  disabled: boolean
  menuPortalTarget?: HTMLElement | null
  onDelete: () => void
  onRename: () => void
}) {
  return (
    <Menu.Context.Portal
      container={menuPortalTarget ?? undefined}
    >
      <Menu.Context.Positioner
        align='start'
        {...AGENT_TREE_MENU_POSITIONER_PROPS}
      >
        <Menu.Context.Popup
          data-agent-tree-menu-root='true'
          size='sm'
        >
          <AgentTreeActionMenuItems
            disabled={disabled}
            ItemComponent={Menu.Context.Item}
            onDelete={onDelete}
            onRename={onRename}
          />
        </Menu.Context.Popup>
      </Menu.Context.Positioner>
    </Menu.Context.Portal>
  )
}

function AgentProjectMenuItems({
  ItemComponent = Menu.Item,
  onOpenFolder,
  onRemoveProject,
}: {
  ItemComponent?: AgentTreeMenuItemComponent
  onOpenFolder: () => void
  onRemoveProject: () => void
}) {
  const systemFileManagerName = getSystemFileManagerName(window.appApi.platform)

  return (
    <>
      <ItemComponent
        icon={<ExternalLinkLine size={16} />}
        label={`在${systemFileManagerName}中打开`}
        text={`在“${systemFileManagerName}”中打开`}
        onClick={onOpenFolder}
      />
      <ItemComponent
        icon={<Delete2Line size={16} />}
        label='移除'
        text='移除'
        tone='danger'
        onClick={onRemoveProject}
      />
    </>
  )
}

export function AgentProjectMenuPopup({
  menuPortalTarget,
  onOpenFolder,
  onRemoveProject,
}: {
  menuPortalTarget?: HTMLElement | null
  onOpenFolder: () => void
  onRemoveProject: () => void
}) {
  return (
    <Menu.Portal
      container={menuPortalTarget ?? undefined}
    >
      <Menu.Positioner
        align='end'
        {...AGENT_TREE_MENU_POSITIONER_PROPS}
      >
        <Menu.Popup
          data-agent-tree-menu-root='true'
          size='md'
        >
          <AgentProjectMenuItems onOpenFolder={onOpenFolder} onRemoveProject={onRemoveProject} />
        </Menu.Popup>
      </Menu.Positioner>
    </Menu.Portal>
  )
}

export function AgentProjectContextMenuPopup({
  menuPortalTarget,
  onOpenFolder,
  onRemoveProject,
}: {
  menuPortalTarget?: HTMLElement | null
  onOpenFolder: () => void
  onRemoveProject: () => void
}) {
  return (
    <Menu.Context.Portal
      container={menuPortalTarget ?? undefined}
    >
      <Menu.Context.Positioner
        align='start'
        {...AGENT_TREE_MENU_POSITIONER_PROPS}
      >
        <Menu.Context.Popup
          data-agent-tree-menu-root='true'
          size='md'
        >
          <AgentProjectMenuItems
            ItemComponent={Menu.Context.Item}
            onOpenFolder={onOpenFolder}
            onRemoveProject={onRemoveProject}
          />
        </Menu.Context.Popup>
      </Menu.Context.Positioner>
    </Menu.Context.Portal>
  )
}
