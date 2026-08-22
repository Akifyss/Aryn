import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import type { ActiveWorkspaceContext } from '../src/features/conversations/types'
import {
  createEmptyProjectState,
  getLastActiveProject,
  getProjectByWorkspacePath,
  resolveActiveProject,
} from '../src/features/workspace/lib/workspace-project-state'
import type { ProjectRecord, ProjectState } from '../src/features/workspace/types'

const firstProject: ProjectRecord = {
  addedAt: '2026-07-20T00:00:00.000Z',
  id: 'project-one',
  lastFilePath: 'C:/workspace-one/readme.md',
  lastOpenedAt: '2026-07-20T01:00:00.000Z',
  name: 'Workspace One',
  path: 'C:/workspace-one',
}

const secondProject: ProjectRecord = {
  addedAt: '2026-07-20T02:00:00.000Z',
  id: 'project-two',
  lastFilePath: null,
  lastOpenedAt: '2026-07-20T03:00:00.000Z',
  name: 'Workspace Two',
  path: 'D:\\Workspace-Two',
}

const projectState: ProjectState = {
  lastProjectId: secondProject.id,
  projects: [firstProject, secondProject],
}

describe('workspace project state', () => {
  it('creates independent empty project states', () => {
    const firstState = createEmptyProjectState()
    const secondState = createEmptyProjectState()

    expect(firstState).toEqual({ lastProjectId: null, projects: [] })
    expect(firstState.projects).not.toBe(secondState.projects)
  })

  it('resolves the last active project and handles a stale identifier', () => {
    expect(getLastActiveProject(projectState)).toBe(secondProject)
    expect(getLastActiveProject({ ...projectState, lastProjectId: 'missing' })).toBeNull()
  })

  it('matches project workspace paths without separator or case sensitivity', () => {
    expect(getProjectByWorkspacePath(projectState, 'd:/workspace-two')).toBe(secondProject)
    expect(getProjectByWorkspacePath(projectState, null)).toBeNull()
    expect(getProjectByWorkspacePath(projectState, 'C:/unrelated')).toBeNull()
  })

  it('treats an explicit project context as authoritative', () => {
    const context: ActiveWorkspaceContext = {
      kind: 'project',
      projectId: firstProject.id,
    }

    expect(resolveActiveProject(projectState, context, secondProject.path)).toBe(firstProject)
    expect(resolveActiveProject(
      projectState,
      { kind: 'project', projectId: 'missing' },
      firstProject.path,
    )).toBeNull()
  })

  it('falls back to the connected workspace outside project context', () => {
    expect(resolveActiveProject(
      projectState,
      { kind: 'conversationDraft' },
      'c:\\WORKSPACE-ONE',
    )).toBe(firstProject)
    expect(resolveActiveProject(
      projectState,
      { kind: 'conversation', conversationId: 'conversation-one' },
      null,
    )).toBeNull()
  })
})

describe('workspace project controller ownership', () => {
  it('keeps project and workspace switching orchestration out of App', async () => {
    const [appSource, controllerSource, mainSource] = await Promise.all([
      readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../src/features/workspace/hooks/use-workspace-project-controller.ts', import.meta.url), 'utf8'),
      readFile(new URL('../electron/main/index.ts', import.meta.url), 'utf8'),
    ])

    expect(appSource).toContain('useWorkspaceProjectController({')
    expect(appSource).not.toContain('async function switchActiveWorkspace')
    expect(appSource).not.toContain('agentProjectSessionRequestIdRef')
    expect(appSource).not.toContain('pickWorkspace: handlePickWorkspace')
    expect(appSource).toContain('useConversationController({')
    expect(controllerSource).toContain('async function addExistingProject')
    expect(controllerSource).toContain('navigationCoordinator.runDurable(intent')
    expect(controllerSource).not.toContain('async function pickWorkspace')
    expect(controllerSource).toContain('const queueCurrentProjectSession = useCallback')
    expect(controllerSource).toContain('sessionLabel: request.sessionLabel')
    expect(controllerSource).toContain('async function connectWorkspace')
    expect(controllerSource).toContain('async function requestAgentProjectSession')
    expect(controllerSource).toMatch(/setActiveWorkspaceContext\(\{ kind: 'project', projectId: project\.id \}\)[\s\S]*?navigationCoordinator\.run\(intent/)
    expect(controllerSource).toContain('loadTree(nextPath, { shouldApply })')
    expect(controllerSource).toContain('watchedWorkspacePathRef.current = null')
    expect(controllerSource).toContain('isWorkspaceSurfaceConnected(project.path)')
    expect(controllerSource).not.toContain('setProjectState(await window.appApi.getProjectState())')
    const switchWorkspaceSource = controllerSource.slice(
      controllerSource.indexOf('async function switchActiveWorkspace'),
      controllerSource.indexOf('function openProjectMenu'),
    )
    expect(switchWorkspaceSource.indexOf('navigationCoordinator.begin(')).toBeGreaterThan(
      switchWorkspaceSource.indexOf("confirmDiscardDirtyTabs('switch-workspace')"),
    )
    expect(switchWorkspaceSource).toContain('isWorkspacePathCurrent(project.path)')
    expect(switchWorkspaceSource.indexOf("setActiveWorkspaceContext({ kind: 'project', projectId: project.id })")).toBeLessThan(
      switchWorkspaceSource.indexOf('options.onAccepted?.(intent)'),
    )
    const activateProjectSource = controllerSource.slice(
      controllerSource.indexOf('async function activateProjectFromState'),
      controllerSource.indexOf('async function createEmptyProject'),
    )
    expect(activateProjectSource.indexOf('setProjectState(nextProjectState)')).toBeLessThan(
      activateProjectSource.indexOf('if (!nextActiveProject || !stillCurrent())'),
    )
    const projectSessionSource = controllerSource.slice(
      controllerSource.indexOf('async function requestAgentProjectSession'),
      controllerSource.indexOf('async function selectProject'),
    )
    expect(projectSessionSource).toContain('navigationTarget: `project-session:${project.id}`')
    expect(projectSessionSource).toMatch(/onAccepted: \(acceptedIntent\) => \{[\s\S]*?setPendingAgentProjectSessionRequest\(nextRequest\)/)
    expect(appSource).toContain('const handleOpenSession = useCallback((sessionPath: string, sessionLabel: string) => {')
    expect(appSource).toContain('navigationCoordinator: workspaceNavigationCoordinator')
    expect(appSource).toMatch(/queueCurrentProjectSession\(\s*sessionPath,[\s\S]*?sessionLabel,/)
    const setActiveProjectHandler = mainSource.slice(
      mainSource.indexOf("ipcMain.handle('project:set-active'"),
      mainSource.indexOf("ipcMain.handle('project:remove'"),
    )
    expect(setActiveProjectHandler).toContain('workspacePathExists(currentProject.path)')
    expect(setActiveProjectHandler).not.toContain('getVisibleProjectState')
  })
})
