import { DownLine } from '@mingcute/react'
import {
  AppMenu as Menu,
  type AppMenuTriggerSize,
} from '@/components/app-menu'
import type { AppIconSize } from '@/components/icon-size'
import { ProjectIcon } from '@/components/project-icon'
import type { ProjectRecord } from '@/features/workspace/types'
import { FlatAgentSessionTree } from './flat-session-tree'
import { AgentProjectTree } from './project-tree'
import type {
  AgentMenuAnchorRect,
  AgentProjectSwitchMenuOptions,
  AgentSessionTreeViewProps,
} from './types'
import './styles.css'

export type {
  AgentMenuAnchorRect,
  AgentProjectSwitchMenuOptions,
  AgentSessionTreeController,
  AgentSessionTreeProps,
} from './types'

export function AgentSessionTreeView(props: AgentSessionTreeViewProps) {
  return props.isFloating ? <FlatAgentSessionTree {...props} /> : <AgentProjectTree {...props} />
}

export function AgentProjectSwitchTrigger({
  activeProject,
  className,
  iconSize = 'md',
  onOpenProjectSwitchMenu,
  placeholder,
  size = 'md',
}: {
  activeProject: ProjectRecord | null
  className?: string
  iconSize?: AppIconSize
  onOpenProjectSwitchMenu?: (anchorRect?: AgentMenuAnchorRect, options?: AgentProjectSwitchMenuOptions) => void
  placeholder?: string
  size?: AppMenuTriggerSize
}) {
  const label = activeProject?.name ?? placeholder ?? '未选择项目'
  const isEnabled = Boolean(onOpenProjectSwitchMenu && (activeProject || placeholder))

  return (
    <Menu.TriggerSurface
      type='button'
      className={[
        'agent-project-switch-trigger',
        className,
      ].filter(Boolean).join(' ')}
      disabled={!isEnabled}
      size={size}
      variant='ghost'
      aria-label={activeProject ? `切换项目，当前项目：${activeProject.name}` : label}
      onClick={(event) => {
        onOpenProjectSwitchMenu?.(event.currentTarget.getBoundingClientRect(), { startNewSession: true })
      }}
    >
      <ProjectIcon size={iconSize} />
      <span className='agent-project-switch-trigger-label'>{label}</span>
      <DownLine className='agent-project-switch-chevron' aria-hidden='true' />
    </Menu.TriggerSurface>
  )
}
