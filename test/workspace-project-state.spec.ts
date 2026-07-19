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
    const [appSource, controllerSource] = await Promise.all([
      readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../src/features/workspace/hooks/use-workspace-project-controller.ts', import.meta.url), 'utf8'),
    ])

    expect(appSource).toContain('useWorkspaceProjectController({')
    expect(appSource).not.toContain('async function switchActiveWorkspace')
    expect(appSource).not.toContain('agentProjectSessionRequestIdRef')
    expect(appSource).not.toContain('pickWorkspace: handlePickWorkspace')
    expect(appSource).toContain('useConversationController({')
    expect(controllerSource).toContain('async function addExistingProject')
    expect(controllerSource).not.toContain('async function pickWorkspace')
    expect(controllerSource).toContain('const queueCurrentProjectSession = useCallback')
    expect(controllerSource).toContain('async function connectWorkspace')
    expect(controllerSource).toContain('async function requestAgentProjectSession')
  })
})
