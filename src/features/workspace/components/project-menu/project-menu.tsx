import { useMemo, useState } from 'react'
import { Menu } from '@base-ui/react/menu'
import {
  CheckLine,
  FolderForbidLine,
  FolderOpenLine,
  NewFolderLine,
  SearchLine,
} from '@mingcute/react'
import { AppScrollArea } from '@/components/app-scroll-area'
import { ProjectIcon } from '@/components/project-icon'
import type { ProjectRecord } from '@/features/workspace/types'
import { shouldCloseClickOpenedMenu } from '@/lib/base-ui-menu'
import {
  createProjectMenuVirtualAnchor,
  PROJECT_MENU_GAP_PX,
  PROJECT_MENU_MARGIN_PX,
  resolveProjectMenuCollisionBoundary,
  resolveProjectMenuStyle,
  type ProjectMenuAnchorRect,
  type ProjectMenuFrameRect,
  type ProjectMenuMode,
  type ProjectMenuSurface,
} from './project-menu-positioning'
import './styles.css'

export { serializeProjectMenuAnchorRect } from './project-menu-positioning'
export type {
  ProjectMenuAnchorRect,
  ProjectMenuFrameRect,
  ProjectMenuMode,
  ProjectMenuSurface,
} from './project-menu-positioning'

type ProjectMenuProps = {
  activeProjectId: string | null
  canUseNoProject: boolean
  anchorRect: ProjectMenuAnchorRect | null
  frameRect?: ProjectMenuFrameRect | null
  isBusy: boolean
  mode: ProjectMenuMode
  portalContainer?: HTMLElement | null
  projects: ProjectRecord[]
  surface: ProjectMenuSurface
  onAddExistingProject: () => Promise<void> | void
  onClose: () => void
  onCreateProject: () => void
  onSelectProject: (project: ProjectRecord) => Promise<void> | void
  onUseNoProject: () => Promise<void> | void
}

export function ProjectMenu({
  activeProjectId,
  canUseNoProject,
  anchorRect,
  frameRect = null,
  isBusy,
  mode,
  portalContainer = null,
  projects,
  surface,
  onAddExistingProject,
  onClose,
  onCreateProject,
  onSelectProject,
  onUseNoProject,
}: ProjectMenuProps) {
  const [search, setSearch] = useState('')
  const isSwitchMenu = mode === 'editor-switch' || mode === 'agent-new-switch'
  const hasProjects = projects.length > 0
  const renderedMode = isSwitchMenu && !hasProjects ? 'agent-add' : mode
  const showProjectlessAction = canUseNoProject && renderedMode === 'agent-new-switch'
  const filteredProjects = useMemo(() => {
    const query = search.trim().toLowerCase()

    if (!query) {
      return projects
    }

    return projects.filter((project) => (
      project.name.toLowerCase().includes(query)
      || project.path.toLowerCase().includes(query)
    ))
  }, [projects, search])
  const viewport = frameRect ?? (typeof window === 'undefined'
    ? null
    : { height: window.innerHeight, width: window.innerWidth })
  const menuStyle = viewport
    ? resolveProjectMenuStyle(renderedMode, showProjectlessAction, viewport)
    : undefined
  const menuAnchor = createProjectMenuVirtualAnchor(anchorRect, frameRect)
  const collisionBoundary = resolveProjectMenuCollisionBoundary(frameRect)
  const menuAlign = renderedMode === 'editor-switch' ? 'center' : 'start'
  const projectMenuActions = (
    <>
      <div className='project-menu-actions'>
        <Menu.Item
          nativeButton
          render={<button type='button' />}
          className={({ highlighted }) => `project-menu-action${highlighted ? ' is-highlighted' : ''}`}
          disabled={isBusy}
          label='新建空白项目'
          onClick={onCreateProject}
        >
          <NewFolderLine aria-hidden='true' size={18} />
          <span>新建空白项目</span>
        </Menu.Item>
        <Menu.Item
          nativeButton
          render={<button type='button' />}
          className={({ highlighted }) => `project-menu-action${highlighted ? ' is-highlighted' : ''}`}
          disabled={isBusy}
          label='使用现有文件夹'
          onClick={() => {
            void onAddExistingProject()
          }}
        >
          <FolderOpenLine aria-hidden='true' size={18} />
          <span>使用现有文件夹</span>
        </Menu.Item>
      </div>
      {showProjectlessAction ? (
        <div className='project-menu-actions project-menu-projectless-actions'>
          <Menu.Item
            nativeButton
            render={<button type='button' />}
            className={({ highlighted }) => `project-menu-action${highlighted ? ' is-highlighted' : ''}`}
            disabled={isBusy}
            label='不使用项目'
            onClick={() => {
              void onUseNoProject()
            }}
          >
            <FolderForbidLine aria-hidden='true' size={18} />
            <span className='project-menu-action-spacer'>不使用项目</span>
          </Menu.Item>
        </div>
      ) : null}
    </>
  )

  return (
    <Menu.Root
      modal={false}
      open
      onOpenChange={(open, details) => {
        if (open) {
          return
        }

        if (shouldCloseClickOpenedMenu(details)) {
          onClose()
        } else {
          details.cancel?.()
        }
      }}
    >
      <Menu.Portal container={portalContainer ?? undefined}>
        <Menu.Backdrop
          className={`project-menu-backdrop${surface === 'global' ? '' : ' is-local'}`}
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) {
              onClose()
            }
          }}
        />
        <Menu.Positioner
          align={menuAlign}
          anchor={menuAnchor}
          className={`project-menu-positioner${surface === 'global' ? '' : ' is-local'}`}
          collisionAvoidance={{ side: 'flip', align: 'shift', fallbackAxisSide: 'none' }}
          collisionBoundary={collisionBoundary}
          collisionPadding={PROJECT_MENU_MARGIN_PX}
          positionMethod='fixed'
          side='bottom'
          sideOffset={PROJECT_MENU_GAP_PX}
        >
          <Menu.Popup
            className={`project-menu project-menu-${renderedMode}`}
            data-surface={surface}
            aria-label={isSwitchMenu && hasProjects ? '切换项目' : '添加项目'}
            finalFocus={false}
            style={menuStyle}
          >
            {isSwitchMenu && hasProjects ? (
              <>
                <label className='project-menu-search'>
                  <SearchLine aria-hidden='true' size={16} />
                  <input
                    autoFocus
                    aria-label='搜索项目'
                    autoComplete='off'
                    name='project-search'
                    value={search}
                    placeholder='搜索项目'
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </label>
                <AppScrollArea
                  className='project-menu-list'
                  contentClassName='project-menu-list-content'
                >
                  {filteredProjects.map((project) => {
                    const isActive = project.id === activeProjectId

                    return (
                      <Menu.Item
                        key={project.id}
                        nativeButton
                        render={<button type='button' />}
                        className={({ highlighted }) => (
                          `project-menu-project${isActive ? ' is-active' : ''}${highlighted ? ' is-highlighted' : ''}`
                        )}
                        disabled={isBusy}
                        label={project.name}
                        aria-current={isActive ? 'true' : undefined}
                        onClick={() => {
                          void onSelectProject(project)
                        }}
                      >
                        <ProjectIcon />
                        <span className='project-menu-project-name'>{project.name}</span>
                        {isActive ? (
                          <CheckLine aria-hidden='true' className='project-menu-project-check' size={16} />
                        ) : null}
                      </Menu.Item>
                    )
                  })}
                  {filteredProjects.length === 0 ? (
                    <div className='project-menu-empty' role='status'>没有匹配项目</div>
                  ) : null}
                </AppScrollArea>
                {projectMenuActions}
              </>
            ) : projectMenuActions}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}
