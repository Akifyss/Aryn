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
import {
  type WorkspaceNavigationCoordinator,
  type WorkspaceNavigationIntent,
} from '@/features/workspace/lib/workspace-navigation-coordinator'
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

type WorkspaceNavigationOptions = {
  intent?: WorkspaceNavigationIntent
}

type UseWorkspaceProjectControllerOptions = {
  activeWorkspaceContext: ActiveWorkspaceContext
  confirmDiscardDirtyTabs: (reason: 'close' | 'switch-workspace') => Promise<boolean>
  currentPathRef: { current: string | null }
  flushDiffAutosave: () => Promise<boolean>
  flushWorkspaceAutosave: (filePath?: string) => Promise<boolean>
  isAgentLayout: boolean
  loadTree: (
    rootPath: string,
    options?: { shouldApply?: () => boolean },
  ) => Promise<boolean | undefined>
  navigationCoordinator: WorkspaceNavigationCoordinator
  prepareGitWorkspace: (workspacePath: string) => void
  refreshGitState: (
    workspacePath: string | null,
    options?: { silent?: boolean },
  ) => Promise<unknown>
  requestConfirmation: (options: ConfirmationOptions) => Promise<boolean>
  resetExpandedPaths: () => void
  resetGitWorkspaceState: () => void
  restoreWorkspaceTabs: (
    workspacePath: string,
    fallbackFilePath?: string | null,
    options?: { shouldApply?: () => boolean },
  ) => Promise<void>
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
  navigationCoordinator,
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
  const activeWorkspaceContextRef = useRef(activeWorkspaceContext)
  const agentProjectSessionRequestIdRef = useRef(0)
  const watchedWorkspacePathRef = useRef<string | null>(null)
  activeWorkspaceContextRef.current = activeWorkspaceContext
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

  const queueCurrentProjectSession = useCallback((
    sessionPath: string,
    agentId: AgentId,
    sessionLabel: string,
  ) => {
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
      sessionLabel,
      sessionPath,
    })
    return true
  }, [currentPath, projectState])

  function isNavigationCurrent(intent?: WorkspaceNavigationIntent) {
    return !intent || navigationCoordinator.isCurrent(intent)
  }

  function isWorkspacePathCurrent(workspacePath: string) {
    return Boolean(
      currentPathRef.current
      && normalizeFilePath(currentPathRef.current) === normalizeFilePath(workspacePath),
    )
  }

  function isWorkspaceSurfaceConnected(workspacePath: string) {
    return Boolean(
      isWorkspacePathCurrent(workspacePath)
      && watchedWorkspacePathRef.current
      && normalizeFilePath(watchedWorkspacePathRef.current) === normalizeFilePath(workspacePath),
    )
  }

  async function connectWorkspace(
    nextPath: string,
    options: WorkspaceNavigationOptions = {},
  ) {
    const shouldApply = () => isNavigationCurrent(options.intent)

    if (!shouldApply()) {
      return false
    }

    if (isWorkspaceSurfaceConnected(nextPath)) {
      return true
    }

    await flushWorkspaceAutosave()

    if (!shouldApply()) {
      return false
    }

    await flushDiffAutosave()

    if (!shouldApply()) {
      return false
    }

    await window.appApi.stopWorkspaceWatch()
    watchedWorkspacePathRef.current = null

    if (!shouldApply()) {
      return false
    }

    try {
      const didLoadTree = await loadTree(nextPath, { shouldApply })

      if (didLoadTree === false || !shouldApply()) {
        return false
      }

      setWorkspaceUnavailableMessage(null)
      currentPathRef.current = nextPath
      setCurrentPath(nextPath)
      resetOpenTabs()
      setIsAgentLayoutFixedTabActive(false)
      prepareGitWorkspace(nextPath)
      await refreshGitState(nextPath, { silent: false })

      if (!shouldApply()) {
        return false
      }

      await window.appApi.startWorkspaceWatch(nextPath)

      if (shouldApply()) {
        watchedWorkspacePathRef.current = nextPath
      }

      if (!shouldApply()) {
        return false
      }

      await window.appApi.updateWorkspaceState(nextPath, { markAsLastOpened: true })
      return shouldApply()
    } catch (error) {
      if (!shouldApply()) {
        return false
      }

      await window.appApi.stopWorkspaceWatch().catch(() => undefined)
      watchedWorkspacePathRef.current = null

      if (shouldApply()) {
        resetWorkspaceSurface({ unavailableMessage: '无法访问当前工作目录。' })
      }

      throw error
    }
  }

  function resetWorkspaceSurface(options: WorkspaceSurfaceResetOptions = {}) {
    watchedWorkspacePathRef.current = null
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

  async function disconnectWorkspaceSurface(
    options: WorkspaceSurfaceResetOptions & WorkspaceNavigationOptions = {},
  ) {
    if (!isNavigationCurrent(options.intent)) {
      return false
    }

    await window.appApi.stopWorkspaceWatch()
    watchedWorkspacePathRef.current = null

    if (!isNavigationCurrent(options.intent)) {
      return false
    }

    resetWorkspaceSurface(options)
    return true
  }

  async function switchActiveWorkspace(
    project: ProjectRecord,
    options: {
      navigationTarget?: string
      onAccepted?: (intent: WorkspaceNavigationIntent) => void
      restoreTabs?: boolean
      skipDirtyConfirm?: boolean
    } = {},
  ) {
    if (
      !isWorkspacePathCurrent(project.path)
      && !options.skipDirtyConfirm
      && !(await confirmDiscardDirtyTabs('switch-workspace'))
    ) {
      return false
    }

    const intent = navigationCoordinator.begin(
      options.navigationTarget ?? `project:${project.id}`,
    )
    const isCurrent = navigationCoordinator.guard(intent)
    const previousWorkspaceContext = activeWorkspaceContextRef.current
    let didPersistProject = false
    const isCurrentWorkspace = isWorkspaceSurfaceConnected(project.path)

    if (!isCurrent()) {
      return false
    }

    // The message snapshot owns the foreground transition. Persisting the
    // project and preparing its filesystem/runtime happen after this commit.
    setActiveWorkspaceContext({ kind: 'project', projectId: project.id })
    // Project-session requests use flushSync in this callback. Scheduling the
    // context first lets React commit the target context and request together.
    options.onAccepted?.(intent)
    try {
      const result = await navigationCoordinator.run(intent, async (stillCurrent) => {
        const nextProject = await window.appApi.setActiveProject(project.id)
        didPersistProject = true

        if (!stillCurrent()) {
          return false
        }

        setProjectState((currentState) => ({
          lastProjectId: nextProject.id,
          projects: currentState.projects.map((currentProject) => (
            currentProject.id === nextProject.id ? nextProject : currentProject
          )),
        }))

        if (!isCurrentWorkspace) {
          const didConnect = await connectWorkspace(project.path, { intent })

          if (!didConnect || !stillCurrent()) {
            return false
          }
        }

        if (options.restoreTabs !== false && !isCurrentWorkspace) {
          await restoreWorkspaceTabs(project.path, undefined, {
            shouldApply: stillCurrent,
          })
        }

        return stillCurrent()
      })

      return result.status === 'completed' && result.value
    } catch (error) {
      if (!isCurrent()) {
        return false
      }

      if (!didPersistProject) {
        setActiveWorkspaceContext(previousWorkspaceContext)
      }
      throw error
    }
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
    intent: WorkspaceNavigationIntent,
    stillCurrent: () => boolean,
    options: { restoreTabs?: boolean, startAgentNewSession?: boolean } = {},
  ) {
    const nextActiveProject = getLastActiveProject(nextProjectState)
    setProjectState(nextProjectState)

    if (!nextActiveProject || !stillCurrent()) {
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
      const didConnect = await connectWorkspace(nextActiveProject.path, { intent })

      if (!didConnect || !stillCurrent()) {
        return false
      }

      if (options.restoreTabs !== false) {
        await restoreWorkspaceTabs(
          nextActiveProject.path,
          nextActiveProject.lastFilePath,
          { shouldApply: stillCurrent },
        )
      }

      return stillCurrent()
    } catch (error) {
      if (agentSessionRequestId !== null && stillCurrent()) {
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

    const intent = navigationCoordinator.begin('project:create')
    setIsProjectActionBusy(true)
    try {
      const result = await navigationCoordinator.runDurable(intent, async (stillCurrent) => {
        const nextProjectState = await window.appApi.createEmptyProject(trimmedName)
        return activateProjectFromState(nextProjectState, intent, stillCurrent, {
          startAgentNewSession: shouldStartAgentSessionAfterProjectCreate,
        })
      })

      if (result.value !== undefined) {
        setIsNewProjectDialogOpen(false)
        setShouldStartAgentSessionAfterProjectCreate(false)
      }

      if (result.status === 'completed' && result.value) {
        setStatusMessage('项目已创建')
      }
    } catch (error) {
      if (!navigationCoordinator.isCurrent(intent)) {
        return
      }

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

    const intent = navigationCoordinator.begin('project:add-existing')
    setIsProjectActionBusy(true)
    setIsPickingWorkspace(true)
    try {
      const result = await navigationCoordinator.run(intent, async (stillCurrent) => {
        const nextProjectState = await window.appApi.addExistingProject()

        if (!nextProjectState) {
          return false
        }

        return activateProjectFromState(nextProjectState, intent, stillCurrent, {
          startAgentNewSession: shouldStartNewAgentSessionForProjectMenu(),
        })
      })

      if (result.status === 'completed' && result.value) {
        closeProjectMenu()
        setStatusMessage('项目已打开')
      }
    } catch (error) {
      if (!navigationCoordinator.isCurrent(intent)) {
        return
      }

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
    request: { kind: 'new' } | {
      agentId: AgentId
      kind: 'session'
      sessionLabel: string
      sessionPath: string
    },
  ) {
    agentProjectSessionRequestIdRef.current += 1
    const requestId = agentProjectSessionRequestIdRef.current
    let intent: WorkspaceNavigationIntent | null = null
    const nextRequest = request.kind === 'session'
      ? {
          kind: 'session' as const,
          agentId: request.agentId,
          projectId: project.id,
          requestId,
          sessionLabel: request.sessionLabel,
          sessionPath: request.sessionPath,
        }
      : {
          kind: 'new' as const,
          projectId: project.id,
          requestId,
        }

    try {
      const didSwitch = await switchActiveWorkspace(project, {
        navigationTarget: `project-session:${project.id}`,
        onAccepted: (acceptedIntent) => {
          intent = acceptedIntent
          flushSync(() => {
            setPendingAgentProjectSessionRequest(nextRequest)
          })
        },
      })

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

      if (intent && !navigationCoordinator.isCurrent(intent)) {
        return false
      }

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

    const currentWorkspaceContext = activeWorkspaceContextRef.current
    const wasActive = currentWorkspaceContext.kind === 'project'
      && currentWorkspaceContext.projectId === project.id
    const intent = wasActive
      ? navigationCoordinator.begin(`project-remove:${project.id}`)
      : null
    setIsProjectActionBusy(true)
    try {
      const nextProjectState = await window.appApi.removeProject(project.id)
      setProjectState(nextProjectState)

      if (intent && navigationCoordinator.isCurrent(intent)) {
        const nextActiveProject = getLastActiveProject(nextProjectState)

        if (nextActiveProject) {
          setActiveWorkspaceContext({ kind: 'project', projectId: nextActiveProject.id })
          await navigationCoordinator.run(intent, async (stillCurrent) => {
            const didConnect = await connectWorkspace(nextActiveProject.path, { intent })

            if (!didConnect || !stillCurrent()) {
              return
            }

            await restoreWorkspaceTabs(
              nextActiveProject.path,
              nextActiveProject.lastFilePath,
              { shouldApply: stillCurrent },
            )
          })
        } else {
          setActiveWorkspaceContext(conversationDraftContext)
          await navigationCoordinator.run(intent, async () => {
            await disconnectWorkspaceSurface({ intent })
          })
        }
      }

      if (!intent || navigationCoordinator.isCurrent(intent)) {
        setStatusMessage('项目已移除')
      }
    } catch (error) {
      if (intent && !navigationCoordinator.isCurrent(intent)) {
        return
      }

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

  async function openProjectSession(
    project: ProjectRecord,
    agentId: AgentId,
    sessionPath: string,
    sessionLabel: string,
  ) {
    await requestAgentProjectSession(project, {
      agentId,
      kind: 'session',
      sessionLabel,
      sessionPath,
    })
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
