import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type CSSProperties, type Ref } from 'react'
import { DownLine, Settings3Line } from '@mingcute/react'
import { AppIconButton } from '@/components/app-icon-button'
import { AppMenu } from '@/components/app-menu'
import { ProjectIcon } from '@/components/project-icon'
import { AppTitlebar } from '@/components/app-titlebar'
import { AppChromeSearchButton } from '@/features/layout/components/app-chrome-controls/app-chrome-controls'
import { WorkbenchPane, type WorkbenchPaneCommands, type WorkbenchPaneConfiguration } from './workbench-pane'
import { WorkbenchConversationLayer } from './workbench-conversation-layer'
import { WorkbenchPanelLayer } from './workbench-panel-layer'
import { clampWorkbenchRatio, useWorkbenchStore } from './workbench-state'
import { startWorkbenchProjectConversation } from './workbench-open-actions'
import type { ProjectRecord } from '@/features/workspace/types'
import '../layout/components/app-shell/styles.css'
import './styles.css'

export type WorkspaceShellHandle = {
  closeActiveTab: () => Promise<void>
  cycleTabs: (direction: 1 | -1) => void
  capture: () => void
}

export function WorkspaceShell({ configuration, chromeVars, platform, isFullScreen, isModalOpen, onRequestClose, onSearch, onSettings, onWorkspace, workspaceLabel, isPickingWorkspace, isWorkspaceMenuOpen, ref }: {
  configuration: WorkbenchPaneConfiguration
  chromeVars: CSSProperties
  platform: 'macos' | 'windows'
  isFullScreen: boolean
  isModalOpen: boolean
  onRequestClose: () => void
  onSearch: () => void
  onSettings: () => void
  onWorkspace: (anchorRect: DOMRect) => void
  workspaceLabel: string
  isPickingWorkspace: boolean
  isWorkspaceMenuOpen: boolean
  ref: Ref<WorkspaceShellHandle>
}) {
  const ratio = useWorkbenchStore((state) => state.ratio)
  const initialized = useWorkbenchStore((state) => state.initialized)
  const presentedProjectId = useWorkbenchStore((state) => state.project?.id ?? null)
  const restoring = useWorkbenchStore((state) => state.restoring)
  const restoreError = useWorkbenchStore((state) => state.restoreError)
  const [width, setWidth] = useState(0)
  const [resizing, setResizing] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)
  const shellRef = useRef<HTMLDivElement>(null)
  const leftChromeRef = useRef<HTMLDivElement>(null)
  const commands = useRef<Partial<Record<'left' | 'right', WorkbenchPaneCommands>>>({})
  const selectedProjectId = configuration.conversations.selectedProject?.id ?? null
  const isRestoring = restoring || (initialized && selectedProjectId !== presentedProjectId)
  // Project selection and filesystem preparation happen before Workbench commits its
  // layout. Keep the last committed inputs with that layout, so neither pane
  // briefly loses its chats or displays the next project's tree in the old tabs.
  const committedPresentation = useRef({ configuration, workspaceLabel })
  const presentation = initialized && isRestoring
    ? committedPresentation.current : { configuration, workspaceLabel }
  useLayoutEffect(() => {
    if (initialized && !isRestoring) committedPresentation.current = { configuration, workspaceLabel }
  }, [configuration, workspaceLabel, initialized, isRestoring])
  const effectiveRatio = clampWorkbenchRatio(ratio, width)
  useImperativeHandle(ref, () => ({
    closeActiveTab: async () => { if (!useWorkbenchStore.getState().restoring) await commands.current[useWorkbenchStore.getState().focusedPane]?.close() },
    cycleTabs: (direction) => { if (!useWorkbenchStore.getState().restoring) commands.current[useWorkbenchStore.getState().focusedPane]?.cycle(direction) },
    capture: () => commands.current[useWorkbenchStore.getState().focusedPane]?.capture(),
  }), [])
  useEffect(() => {
    if (!contentRef.current) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(contentRef.current)
    return () => observer.disconnect()
  }, [])
  useLayoutEffect(() => {
    const controls = leftChromeRef.current
    if (!controls) return
    const measure = () => {
      const controlsWidth = controls.getBoundingClientRect().width
      if (controlsWidth > 0) shellRef.current?.style.setProperty('--workbench-left-controls-width', `${controlsWidth}px`)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(controls)
    return () => observer.disconnect()
  }, [])
  return (
    <div ref={shellRef} className='app-shell' data-platform={platform} data-window-fullscreen={isFullScreen} data-modal-layer-open={isModalOpen} data-resizing={resizing} style={{ ...chromeVars, '--workbench-left-pane-width': width ? `${width * effectiveRatio - 3}px` : '50vw' } as CSSProperties}>
      <div className='workbench-global-actions'>
        <AppChromeSearchButton onClick={onSearch} />
        <AppIconButton aria-label='打开设置' tooltip='设置' onClick={onSettings}><Settings3Line /></AppIconButton>
      </div>
      {restoreError ? <div className='workbench-restore-error' role='alert'>{restoreError}</div> : null}
      <main ref={contentRef} className='workbench-panes' inert={!initialized || isRestoring ? true : undefined} aria-busy={!initialized || isRestoring} style={{ '--workbench-left-ratio': `${effectiveRatio * 100}%` } as CSSProperties}>
        <WorkbenchPane pane='left' configuration={presentation.configuration} commands={commands} />
        <div
          role='separator' tabIndex={0} className='workbench-separator'
          aria-label='调整左右面板宽度' aria-orientation='vertical' aria-controls='workbench-left workbench-right'
          aria-valuemin={Math.round(clampWorkbenchRatio(0, width) * 100)} aria-valuemax={Math.round(clampWorkbenchRatio(1, width) * 100)} aria-valuenow={Math.round(effectiveRatio * 100)}
          aria-valuetext={`左侧 ${Math.round(effectiveRatio * 100)}%，右侧 ${Math.round((1 - effectiveRatio) * 100)}%`}
          onDoubleClick={() => useWorkbenchStore.getState().setRatio(0.5)}
          onPointerDown={(event) => {
            if (event.button !== 0) return
            event.preventDefault()
            event.currentTarget.setPointerCapture(event.pointerId)
            setResizing(true)
          }}
          onPointerMove={(event) => {
            if (!event.currentTarget.hasPointerCapture(event.pointerId) || !contentRef.current) return
            const rect = contentRef.current.getBoundingClientRect()
            useWorkbenchStore.getState().setRatio(clampWorkbenchRatio((event.clientX - rect.left) / rect.width, rect.width))
          }}
          onPointerUp={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
            setResizing(false)
          }}
          onLostPointerCapture={() => setResizing(false)}
          onPointerCancel={() => setResizing(false)}
          onKeyDown={(event) => {
            const next = event.key === 'ArrowLeft' ? effectiveRatio - 0.025
              : event.key === 'ArrowRight' ? effectiveRatio + 0.025
                : event.key === 'Home' ? 0 : event.key === 'End' ? 1
                  : event.key === 'Enter' ? 0.5 : null
            if (next === null) return
            event.preventDefault()
            useWorkbenchStore.getState().setRatio(clampWorkbenchRatio(next, width))
          }}
        />
        <WorkbenchPane pane='right' configuration={presentation.configuration} commands={commands} />
        <WorkbenchPanelLayer configuration={presentation.configuration} commands={commands} />
        <WorkbenchConversationLayer configuration={presentation.configuration} commands={commands} />
      </main>
      <AppTitlebar onRequestClose={onRequestClose} leftControls={(
        <div ref={leftChromeRef} className='left-chrome-actions workbench-left-chrome' data-overlay-elevated={isModalOpen ? 'false' : 'true'}>
          <AppMenu.TriggerSurface
            className='workbench-workspace-switch' size='md' variant='outline'
            aria-label={`选择或切换工作目录：${presentation.workspaceLabel}`} aria-haspopup='menu' aria-expanded={isWorkspaceMenuOpen}
            disabled={isPickingWorkspace} title={presentation.workspaceLabel}
            onClick={(event) => onWorkspace(event.currentTarget.getBoundingClientRect())}
          >
            <ProjectIcon />
            <span className='workbench-workspace-switch-label'>{presentation.workspaceLabel}</span>
            <DownLine className='workbench-workspace-switch-chevron' aria-hidden='true' />
          </AppMenu.TriggerSurface>
        </div>
      )} />
    </div>
  )
}

export function startWorkbenchConversation(project?: ProjectRecord | null, chooseProject?: () => void) {
  startWorkbenchProjectConversation(useWorkbenchStore.getState().focusedPane, project, chooseProject)
}
