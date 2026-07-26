import { useMemo, useState } from 'react'
import {
  CheckLine,
  FolderForbidLine,
  FolderOpenLine,
  NewFolderLine,
  SearchLine,
} from '@mingcute/react'
import { AppMenu as Menu, shouldCloseClickOpenedMenu } from '@/components/app-menu'
import { ProjectIcon } from '@/components/project-icon'
import type { ProjectRecord } from '@/features/workspace/types'
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
import { handleProjectMenuSearchKeyDown } from './project-menu-search-keyboard'
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
    <Menu.List className='project-menu-actions'>
      <Menu.Item
        className='project-menu-action'
        disabled={isBusy}
        icon={<NewFolderLine aria-hidden='true' size={18} />}
        label='新建空白项目'
        text='新建空白项目'
        onClick={onCreateProject}
      />
      <Menu.Item
        className='project-menu-action'
        disabled={isBusy}
        icon={<FolderOpenLine aria-hidden='true' size={18} />}
        label='使用现有文件夹'
        text='使用现有文件夹'
        onClick={() => {
          void onAddExistingProject()
        }}
      />
      {showProjectlessAction ? (
        <Menu.Item
          className='project-menu-action'
          disabled={isBusy}
          icon={<FolderForbidLine aria-hidden='true' size={18} />}
          label='不使用项目'
          text='不使用项目'
          onClick={() => {
            void onUseNoProject()
          }}
        />
      ) : null}
    </Menu.List>
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
            layout='compound'
            size='fit'
            style={menuStyle}
          >
            {isSwitchMenu && hasProjects ? (
              <>
                <div className='project-menu-project-section'>
                  <div className='project-menu-search-section'>
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
                        onKeyDown={handleProjectMenuSearchKeyDown}
                      />
                    </label>
                  </div>
                  <Menu.ScrollArea className='project-menu-list'>
                    <Menu.ScrollViewport>
                      <Menu.ScrollContent className='project-menu-project-list'>
                        {filteredProjects.map((project) => {
                          const isActive = project.id === activeProjectId

                          return (
                            <Menu.Item
                              key={project.id}
                              className='project-menu-project'
                              disabled={isBusy}
                              info={isActive ? <CheckLine aria-hidden='true' size={16} /> : undefined}
                              infoVariant='status'
                              icon={<ProjectIcon />}
                              label={project.name}
                              selected={isActive}
                              text={project.name}
                              aria-current={isActive ? 'true' : undefined}
                              onClick={() => {
                                void onSelectProject(project)
                              }}
                            />
                          )
                        })}
                        {filteredProjects.length === 0 ? (
                          <div className='project-menu-empty' role='status'>没有匹配项目</div>
                        ) : null}
                      </Menu.ScrollContent>
                    </Menu.ScrollViewport>
                  </Menu.ScrollArea>
                </div>
                <Menu.Separator className='project-menu-section-separator' />
                {projectMenuActions}
              </>
            ) : projectMenuActions}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}
