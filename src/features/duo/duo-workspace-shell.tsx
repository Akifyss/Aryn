import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type CSSProperties, type Ref } from 'react'
import { DownLine, Settings3Line } from '@mingcute/react'
import { AppIconButton } from '@/components/app-icon-button'
import { AppMenu } from '@/components/app-menu'
import { ProjectIcon } from '@/components/project-icon'
import { AppTitlebar } from '@/components/app-titlebar'
import { AppChromeSearchButton } from '@/features/layout/components/app-chrome-controls/app-chrome-controls'
import { DuoPane, type DuoPaneCommands, type DuoPaneConfiguration } from './duo-pane'
import { DuoConversationLayer } from './duo-conversation-layer'
import { DuoPanelLayer } from './duo-panel-layer'
import { clampDuoRatio, useDuoStore } from './duo-state'
import { startDuoProjectConversation } from './duo-open-actions'
import type { ProjectRecord } from '@/features/workspace/types'
import '../layout/components/app-shell/styles.css'
import './styles.css'

export type DuoWorkspaceHandle = {
  closeActiveTab: () => Promise<void>
  cycleTabs: (direction: 1 | -1) => void
  capture: () => void
}

export function DuoWorkspaceShell({ configuration, chromeVars, platform, isFullScreen, isModalOpen, isActive, onRequestClose, onSearch, onSettings, onWorkspace, workspaceLabel, isPickingWorkspace, isWorkspaceMenuOpen, ref }: {
  configuration: DuoPaneConfiguration
  chromeVars: CSSProperties
  platform: 'macos' | 'windows'
  isFullScreen: boolean
  isModalOpen: boolean
  isActive: boolean
  onRequestClose: () => void
  onSearch: () => void
  onSettings: () => void
  onWorkspace: (anchorRect: DOMRect) => void
  workspaceLabel: string
  isPickingWorkspace: boolean
  isWorkspaceMenuOpen: boolean
  ref: Ref<DuoWorkspaceHandle>
}) {
  const ratio = useDuoStore((state) => state.ratio)
  const initialized = useDuoStore((state) => state.initialized)
  const presentedProjectId = useDuoStore((state) => state.project?.id ?? null)
  const restoring = useDuoStore((state) => state.restoring)
  const restoreError = useDuoStore((state) => state.restoreError)
  const [width, setWidth] = useState(0)
  const [resizing, setResizing] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)
  const shellRef = useRef<HTMLDivElement>(null)
  const leftChromeRef = useRef<HTMLDivElement>(null)
  const commands = useRef<Partial<Record<'left' | 'right', DuoPaneCommands>>>({})
  const selectedProjectId = configuration.conversations.selectedProject?.id ?? null
  const isRestoring = restoring || (initialized && selectedProjectId !== presentedProjectId)
  // Project selection and filesystem preparation happen before Duo commits its
  // layout. Keep the last committed inputs with that layout, so neither pane
  // briefly loses its chats or displays the next project's tree in the old tabs.
  const committedPresentation = useRef({ configuration, workspaceLabel })
  const presentation = initialized && isRestoring
    ? committedPresentation.current : { configuration, workspaceLabel }
  useLayoutEffect(() => {
    if (initialized && !isRestoring) committedPresentation.current = { configuration, workspaceLabel }
  }, [configuration, workspaceLabel, initialized, isRestoring])
  const effectiveRatio = clampDuoRatio(ratio, width)
  useImperativeHandle(ref, () => ({
    closeActiveTab: async () => { if (!useDuoStore.getState().restoring) await commands.current[useDuoStore.getState().focusedPane]?.close() },
    cycleTabs: (direction) => { if (!useDuoStore.getState().restoring) commands.current[useDuoStore.getState().focusedPane]?.cycle(direction) },
    capture: () => commands.current[useDuoStore.getState().focusedPane]?.capture(),
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
      if (controlsWidth > 0) shellRef.current?.style.setProperty('--duo-left-controls-width', `${controlsWidth}px`)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(controls)
    return () => observer.disconnect()
  }, [])
  return (
    <div ref={shellRef} className='app-shell duo-shell' data-app-layout='duo' data-platform={platform} data-window-fullscreen={isFullScreen} data-modal-layer-open={isModalOpen} data-resizing={resizing} style={{ ...chromeVars, '--duo-left-pane-width': width ? `${width * effectiveRatio - 3}px` : '50vw' } as CSSProperties}>
      <div className='duo-global-actions'>
        <AppChromeSearchButton onClick={onSearch} />
        <AppIconButton aria-label='打开设置' tooltip='设置' onClick={onSettings}><Settings3Line /></AppIconButton>
      </div>
      {restoreError ? <div className='duo-restore-error' role='alert'>{restoreError}</div> : null}
      <main ref={contentRef} className='duo-panes' inert={!initialized || isRestoring ? true : undefined} aria-busy={!initialized || isRestoring} style={{ '--duo-left-ratio': `${effectiveRatio * 100}%` } as CSSProperties}>
        <DuoPane pane='left' configuration={presentation.configuration} commands={commands} isActive={isActive} />
        <div
          role='separator' tabIndex={0} className='duo-separator'
          aria-label='调整左右面板宽度' aria-orientation='vertical' aria-controls='duo-left duo-right'
          aria-valuemin={Math.round(clampDuoRatio(0, width) * 100)} aria-valuemax={Math.round(clampDuoRatio(1, width) * 100)} aria-valuenow={Math.round(effectiveRatio * 100)}
          aria-valuetext={`左侧 ${Math.round(effectiveRatio * 100)}%，右侧 ${Math.round((1 - effectiveRatio) * 100)}%`}
          onDoubleClick={() => useDuoStore.getState().setRatio(0.5)}
          onPointerDown={(event) => {
            if (event.button !== 0) return
            event.preventDefault()
            event.currentTarget.setPointerCapture(event.pointerId)
            setResizing(true)
          }}
          onPointerMove={(event) => {
            if (!event.currentTarget.hasPointerCapture(event.pointerId) || !contentRef.current) return
            const rect = contentRef.current.getBoundingClientRect()
            useDuoStore.getState().setRatio(clampDuoRatio((event.clientX - rect.left) / rect.width, rect.width))
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
            useDuoStore.getState().setRatio(clampDuoRatio(next, width))
          }}
        />
        <DuoPane pane='right' configuration={presentation.configuration} commands={commands} isActive={isActive} />
        <DuoPanelLayer configuration={presentation.configuration} commands={commands} />
        <DuoConversationLayer configuration={presentation.configuration} commands={commands} />
      </main>
      <AppTitlebar onRequestClose={onRequestClose} leftControls={(
        <div ref={leftChromeRef} className='left-chrome-actions duo-left-chrome' data-overlay-elevated={isModalOpen ? 'false' : 'true'}>
          <AppMenu.TriggerSurface
            className='duo-workspace-switch' size='md' variant='outline'
            aria-label={`选择或切换工作目录：${presentation.workspaceLabel}`} aria-haspopup='menu' aria-expanded={isWorkspaceMenuOpen}
            disabled={isPickingWorkspace} title={presentation.workspaceLabel}
            onClick={(event) => onWorkspace(event.currentTarget.getBoundingClientRect())}
          >
            <ProjectIcon />
            <span className='duo-workspace-switch-label'>{presentation.workspaceLabel}</span>
            <DownLine className='duo-workspace-switch-chevron' aria-hidden='true' />
          </AppMenu.TriggerSurface>
        </div>
      )} />
    </div>
  )
}

export function startDuoConversation(project?: ProjectRecord | null, chooseProject?: () => void) {
  startDuoProjectConversation(useDuoStore.getState().focusedPane, project, chooseProject)
}
