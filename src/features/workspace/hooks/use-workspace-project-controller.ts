import type { Dispatch, SetStateAction } from 'react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { toast } from '@heroui/react'
import type { ActiveWorkspaceContext } from '@/features/conversations/types'
import type { AgentId } from '@/features/agent/agent-definition'
import type { AgentProjectSessionRequest } from '@/features/agent/lib/project-session-request'
import type { AgentWorkspaceState } from '@/features/agent/types'
import {
  serializeProjectMenuAnchorRect,
  type ProjectMenuAnchorRect,
  type ProjectMenuMode,
  type ProjectMenuSurface,
} from '@/features/workspace/components/project-menu/project-menu-positioning'
import {
  createEmptyProjectState,
  getLastActiveProject,
  getProjectByWorkspacePath,
  resolveActiveProject,
} from '@/features/workspace/lib/workspace-project-state'
import { normalizeFilePath } from '@/features/workspace/lib/workspace-paths'
import { useWorkspaceStore } from '@/features/workspace/store/use-workspace-store'
import type { ProjectRecord, ProjectState } from '@/features/workspace/types'

type ConfirmationOptions = {
  cancelLabel?: string
  confirmLabel?: string
  isDanger?: boolean
  message: string
  title: string
}

type ProjectMenuOpenOptions = {
  surface?: ProjectMenuSurface
}

type WorkspaceSurfaceResetOptions = {
  unavailableMessage?: string | null
}

type UseWorkspaceProjectControllerOptions = {
  activeWorkspaceContext: ActiveWorkspaceContext
  confirmDiscardDirtyTabs: (reason: 'close' | 'switch-workspace') => Promise<boolean>
  currentPathRef: { current: string | null }
  flushDiffAutosave: () => Promise<boolean>
  flushWorkspaceAutosave: (filePath?: string) => Promise<boolean>
  isAgentLayout: boolean
  loadTree: (rootPath: string) => Promise<void>
  prepareGitWorkspace: (workspacePath: string) => void
  refreshGitState: (
    workspacePath: string | null,
    options?: { silent?: boolean },
  ) => Promise<unknown>
  requestConfirmation: (options: ConfirmationOptions) => Promise<boolean>
  resetExpandedPaths: () => void
  resetGitWorkspaceState: () => void
  restoreWorkspaceTabs: (workspacePath: string, fallbackFilePath?: string | null) => Promise<void>
  setActiveWorkspaceContext: Dispatch<SetStateAction<ActiveWorkspaceContext>>
  setAgentWorkspaceState: Dispatch<SetStateAction<AgentWorkspaceState | null>>
  setIsAgentLayoutFixedTabActive: Dispatch<SetStateAction<boolean>>
  setStatusMessage: (message: string) => void
}

const conversationDraftContext: ActiveWorkspaceContext = { kind: 'conversationDraft' }

export function useWorkspaceProjectController({
  activeWorkspaceContext,
  confirmDiscardDirtyTabs,
  currentPathRef,
  flushDiffAutosave,
  flushWorkspaceAutosave,
  isAgentLayout,
  loadTree,
  prepareGitWorkspace,
  refreshGitState,
  requestConfirmation,
  resetExpandedPaths,
  resetGitWorkspaceState,
  restoreWorkspaceTabs,
  setActiveWorkspaceContext,
  setAgentWorkspaceState,
  setIsAgentLayoutFixedTabActive,
  setStatusMessage,
}: UseWorkspaceProjectControllerOptions) {
  const currentPath = useWorkspaceStore((state) => state.currentPath)
  const resetOpenTabs = useWorkspaceStore((state) => state.resetOpenTabs)
  const setCurrentPath = useWorkspaceStore((state) => state.setCurrentPath)
  const setTree = useWorkspaceStore((state) => state.setTree)
  const [projectState, setProjectState] = useState<ProjectState>(createEmptyProjectState)
  const [hasLoadedProjectState, setHasLoadedProjectState] = useState(false)
  const [isPickingWorkspace, setIsPickingWorkspace] = useState(false)
  const [isProjectActionBusy, setIsProjectActionBusy] = useState(false)
  const [projectMenuMode, setProjectMenuMode] = useState<ProjectMenuMode | null>(null)
  const [projectMenuSurface, setProjectMenuSurface] = useState<ProjectMenuSurface>('global')
  const [projectMenuAnchorRect, setProjectMenuAnchorRect] = useState<ProjectMenuAnchorRect | null>(null)
  const [isNewProjectDialogOpen, setIsNewProjectDialogOpen] = useState(false)
  const [shouldStartAgentSessionAfterProjectCreate, setShouldStartAgentSessionAfterProjectCreate] = useState(false)
  const [pendingAgentProjectSessionRequest, setPendingAgentProjectSessionRequest] = useState<AgentProjectSessionRequest | null>(null)
  const [workspaceUnavailableMessage, setWorkspaceUnavailableMessage] = useState<string | null>(null)
  const agentProjectSessionRequestIdRef = useRef(0)
  const activeProject = useMemo(
    () => resolveActiveProject(projectState, activeWorkspaceContext, currentPath),
    [activeWorkspaceContext, currentPath, projectState],
  )
  const needsProjectBootstrap = hasLoadedProjectState
    && !activeProject
    && activeWorkspaceContext.kind === 'project'

  const hydrateProjectState = useCallback((nextProjectState: ProjectState) => {
    setProjectState(nextProjectState)
    setHasLoadedProjectState(true)
  }, [])

  const clearPendingAgentProjectSessionRequest = useCallback(() => {
    setPendingAgentProjectSessionRequest(null)
  }, [])

  const completeAgentProjectSessionRequest = useCallback((requestId: number) => {
    setPendingAgentProjectSessionRequest((currentValue) => (
      currentValue?.requestId === requestId ? null : currentValue
    ))
  }, [])

  const queueCurrentProjectSession = useCallback((sessionPath: string, agentId: AgentId) => {
    const currentProject = getProjectByWorkspacePath(projectState, currentPath)

    if (!currentProject) {
      return false
    }

    agentProjectSessionRequestIdRef.current += 1
    setPendingAgentProjectSessionRequest({
      agentId,
      kind: 'session',
      projectId: currentProject.id,
      requestId: agentProjectSessionRequestIdRef.current,
      sessionPath,
    })
    return true
  }, [currentPath, projectState])

  async function connectWorkspace(nextPath: string) {
    if (currentPath && normalizeFilePath(currentPath) === normalizeFilePath(nextPath)) {
      return
    }

    await flushWorkspaceAutosave()
    await flushDiffAutosave()
    await window.appApi.stopWorkspaceWatch()

    try {
      await loadTree(nextPath)
      setWorkspaceUnavailableMessage(null)
      currentPathRef.current = nextPath
      setCurrentPath(nextPath)
      resetOpenTabs()
      setIsAgentLayoutFixedTabActive(false)
      prepareGitWorkspace(nextPath)
      await refreshGitState(nextPath, { silent: false })
      await window.appApi.startWorkspaceWatch(nextPath)
      await window.appApi.updateWorkspaceState(nextPath, { markAsLastOpened: true })
    } catch (error) {
      await window.appApi.stopWorkspaceWatch().catch(() => undefined)
      resetWorkspaceSurface({ unavailableMessage: '无法访问当前工作目录。' })
      throw error
    }
  }

  function resetWorkspaceSurface(options: WorkspaceSurfaceResetOptions = {}) {
    currentPathRef.current = null
    setCurrentPath(null)
    setTree([])
    resetExpandedPaths()
    resetOpenTabs()
    setIsAgentLayoutFixedTabActive(false)
    resetGitWorkspaceState()
    setAgentWorkspaceState(null)
    setPendingAgentProjectSessionRequest(null)
    setWorkspaceUnavailableMessage(options.unavailableMessage ?? null)
  }

  async function disconnectWorkspaceSurface(options: WorkspaceSurfaceResetOptions = {}) {
    await window.appApi.stopWorkspaceWatch()
    resetWorkspaceSurface(options)
  }

  async function switchActiveWorkspace(
    project: ProjectRecord,
    options: { restoreTabs?: boolean, skipDirtyConfirm?: boolean } = {},
  ) {
    if (currentPath && normalizeFilePath(currentPath) === normalizeFilePath(project.path)) {
      await window.appApi.setActiveProject(project.id)
      setProjectState(await window.appApi.getProjectState())
      setActiveWorkspaceContext({ kind: 'project', projectId: project.id })
      return true
    }

    if (!options.skipDirtyConfirm && !(await confirmDiscardDirtyTabs('switch-workspace'))) {
      return false
    }

    const nextProjectState = await window.appApi.setActiveProject(project.id)
    setProjectState(nextProjectState)
    setActiveWorkspaceContext({ kind: 'project', projectId: project.id })
    await connectWorkspace(project.path)

    if (options.restoreTabs !== false) {
      await restoreWorkspaceTabs(project.path)
    }

    return true
  }

  function openProjectMenu(
    mode: ProjectMenuMode,
    anchorRect?: ProjectMenuAnchorRect,
    options: ProjectMenuOpenOptions = {},
  ) {
    setProjectMenuSurface(options.surface ?? 'global')
    setProjectMenuAnchorRect(anchorRect ? serializeProjectMenuAnchorRect(anchorRect) : null)
    setProjectMenuMode(mode)
  }

  function closeProjectMenu() {
    setProjectMenuAnchorRect(null)
    setProjectMenuMode(null)
    setProjectMenuSurface('global')
  }

  function shouldStartNewAgentSessionForProjectMenu() {
    return projectMenuMode === 'agent-new-switch'
      || (projectMenuMode === 'editor-switch' && !isAgentLayout)
  }

  function openNewProjectDialog() {
    setShouldStartAgentSessionAfterProjectCreate(shouldStartNewAgentSessionForProjectMenu())
    setIsNewProjectDialogOpen(true)
    closeProjectMenu()
  }

  function handleNewProjectDialogOpenChange(isOpen: boolean) {
    setIsNewProjectDialogOpen(isOpen)
    if (!isOpen) {
      setShouldStartAgentSessionAfterProjectCreate(false)
    }
  }

  async function activateProjectFromState(
    nextProjectState: ProjectState,
    options: { restoreTabs?: boolean, startAgentNewSession?: boolean } = {},
  ) {
    setProjectState(nextProjectState)
    const nextActiveProject = getLastActiveProject(nextProjectState)

    if (!nextActiveProject) {
      return false
    }

    setActiveWorkspaceContext({ kind: 'project', projectId: nextActiveProject.id })
    let agentSessionRequestId: number | null = null

    if (options.startAgentNewSession) {
      agentProjectSessionRequestIdRef.current += 1
      agentSessionRequestId = agentProjectSessionRequestIdRef.current
      flushSync(() => {
        setPendingAgentProjectSessionRequest({
          kind: 'new',
          projectId: nextActiveProject.id,
          requestId: agentSessionRequestId!,
        })
      })
    }

    try {
      await connectWorkspace(nextActiveProject.path)

      if (options.restoreTabs !== false) {
        await restoreWorkspaceTabs(nextActiveProject.path, nextActiveProject.lastFilePath)
      }

      return true
    } catch (error) {
      if (agentSessionRequestId !== null) {
        setPendingAgentProjectSessionRequest((currentValue) => (
          currentValue?.requestId === agentSessionRequestId ? null : currentValue
        ))
      }
      throw error
    }
  }

  async function createEmptyProject(projectName: string) {
    const trimmedName = projectName.trim()

    if (!trimmedName) {
      return
    }

    if (!(await confirmDiscardDirtyTabs('switch-workspace'))) {
      return
    }

    setIsProjectActionBusy(true)
    try {
      const nextProjectState = await window.appApi.createEmptyProject(trimmedName)
      await activateProjectFromState(nextProjectState, {
        startAgentNewSession: shouldStartAgentSessionAfterProjectCreate,
      })
      setIsNewProjectDialogOpen(false)
      setShouldStartAgentSessionAfterProjectCreate(false)
      setStatusMessage('项目已创建')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to create project.'
      toast.danger('创建项目失败', { description: message })
      setStatusMessage(message)
    } finally {
      setIsProjectActionBusy(false)
    }
  }

  async function addExistingProject() {
    if (!(await confirmDiscardDirtyTabs('switch-workspace'))) {
      return
    }

    setIsProjectActionBusy(true)
    setIsPickingWorkspace(true)
    try {
      const nextProjectState = await window.appApi.addExistingProject()

      if (!nextProjectState) {
        return
      }

      await activateProjectFromState(nextProjectState, {
        startAgentNewSession: shouldStartNewAgentSessionForProjectMenu(),
      })
      closeProjectMenu()
      setStatusMessage('项目已打开')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to open project.'
      toast.danger('打开项目失败', { description: message })
      setStatusMessage(message)
    } finally {
      setIsPickingWorkspace(false)
      setIsProjectActionBusy(false)
    }
  }

  async function requestAgentProjectSession(
    project: ProjectRecord,
    request: { kind: 'new' } | { agentId: AgentId, kind: 'session', sessionPath: string },
  ) {
    agentProjectSessionRequestIdRef.current += 1
    const requestId = agentProjectSessionRequestIdRef.current
    const nextRequest = request.kind === 'session'
      ? {
          kind: 'session' as const,
          agentId: request.agentId,
          projectId: project.id,
          requestId,
          sessionPath: request.sessionPath,
        }
      : {
          kind: 'new' as const,
          projectId: project.id,
          requestId,
        }

    flushSync(() => {
      setPendingAgentProjectSessionRequest(nextRequest)
    })

    try {
      const didSwitch = await switchActiveWorkspace(project)

      if (!didSwitch) {
        setPendingAgentProjectSessionRequest((currentValue) => (
          currentValue?.requestId === requestId ? null : currentValue
        ))
        return false
      }

      return true
    } catch (error) {
      setPendingAgentProjectSessionRequest((currentValue) => (
        currentValue?.requestId === requestId ? null : currentValue
      ))
      const message = error instanceof Error ? error.message : 'Unable to open project conversation.'
      toast.danger('打开对话失败', { description: message })
      setStatusMessage(message)
      return false
    }
  }

  async function selectProject(project: ProjectRecord) {
    setIsProjectActionBusy(true)
    try {
      if (shouldStartNewAgentSessionForProjectMenu()) {
        const didSwitch = await requestAgentProjectSession(project, { kind: 'new' })
        if (didSwitch) {
          closeProjectMenu()
          setStatusMessage(`${project.name} 已激活`)
        }
        return
      }

      const didSwitch = await switchActiveWorkspace(project)
      if (didSwitch) {
        closeProjectMenu()
        setStatusMessage(`${project.name} 已激活`)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to switch project.'
      toast.danger('切换项目失败', { description: message })
      setStatusMessage(message)
    } finally {
      setIsProjectActionBusy(false)
    }
  }

  async function removeProject(project: ProjectRecord) {
    const confirmed = await requestConfirmation({
      title: '移除项目',
      message: `要从项目列表移除“${project.name}”吗？\n\n这不会删除本地文件夹。`,
      confirmLabel: '移除',
      isDanger: true,
    })

    if (!confirmed) {
      return
    }

    setIsProjectActionBusy(true)
    try {
      const wasActive = activeWorkspaceContext.kind === 'project'
        && activeWorkspaceContext.projectId === project.id
      const nextProjectState = await window.appApi.removeProject(project.id)
      setProjectState(nextProjectState)

      if (wasActive) {
        const nextActiveProject = getLastActiveProject(nextProjectState)
        if (nextActiveProject) {
          setActiveWorkspaceContext({ kind: 'project', projectId: nextActiveProject.id })
          await connectWorkspace(nextActiveProject.path)
          await restoreWorkspaceTabs(nextActiveProject.path, nextActiveProject.lastFilePath)
        } else {
          setActiveWorkspaceContext(conversationDraftContext)
          await disconnectWorkspaceSurface()
        }
      }

      setStatusMessage('项目已移除')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to remove project.'
      toast.danger('移除项目失败', { description: message })
      setStatusMessage(message)
    } finally {
      setIsProjectActionBusy(false)
    }
  }

  async function showProjectInFolder(project: ProjectRecord) {
    try {
      await window.appApi.openPath(project.path)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to open project folder.'
      toast.danger('打开文件夹失败', { description: message })
      setStatusMessage(message)
    }
  }

  async function enterProjectlessConversation(enterConversationDraft: () => Promise<boolean>) {
    setIsProjectActionBusy(true)
    try {
      const didEnterDraft = await enterConversationDraft()
      if (didEnterDraft) {
        closeProjectMenu()
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to start a projectless conversation.'
      toast.danger('进入普通对话失败', { description: message })
      setStatusMessage(message)
    } finally {
      setIsProjectActionBusy(false)
    }
  }

  async function openProjectSession(project: ProjectRecord, agentId: AgentId, sessionPath: string) {
    await requestAgentProjectSession(project, { agentId, kind: 'session', sessionPath })
  }

  async function startProjectSession(project: ProjectRecord) {
    await requestAgentProjectSession(project, { kind: 'new' })
  }

  return {
    activeProject,
    addExistingProject,
    clearPendingAgentProjectSessionRequest,
    closeProjectMenu,
    completeAgentProjectSessionRequest,
    connectWorkspace,
    createEmptyProject,
    disconnectWorkspaceSurface,
    enterProjectlessConversation,
    handleNewProjectDialogOpenChange,
    hydrateProjectState,
    isNewProjectDialogOpen,
    isPickingWorkspace,
    isProjectActionBusy,
    needsProjectBootstrap,
    openNewProjectDialog,
    openProjectMenu,
    openProjectSession,
    pendingAgentProjectSessionRequest,
    projectMenuAnchorRect,
    projectMenuMode,
    projectMenuSurface,
    projectState,
    queueCurrentProjectSession,
    removeProject,
    selectProject,
    showProjectInFolder,
    startProjectSession,
    workspaceUnavailableMessage,
  }
}
