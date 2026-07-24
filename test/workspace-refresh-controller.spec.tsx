import { readFile } from 'node:fs/promises'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { useWorkspaceRefreshController } from '../src/features/workspace/hooks/use-workspace-refresh-controller'

type WorkspaceRefreshController = ReturnType<
  typeof useWorkspaceRefreshController
>
type WorkspaceRefreshControllerOptions = Parameters<
  typeof useWorkspaceRefreshController
>[0]

function ControllerProbe({
  onController,
  options,
}: {
  onController: (controller: WorkspaceRefreshController) => void
  options: WorkspaceRefreshControllerOptions
}) {
  onController(useWorkspaceRefreshController(options))
  return null
}

function renderController(options: WorkspaceRefreshControllerOptions) {
  let controller: WorkspaceRefreshController | null = null
  renderToStaticMarkup(
    <ControllerProbe
      options={options}
      onController={(nextController) => {
        controller = nextController
      }}
    />,
  )

  if (!controller) {
    throw new Error('Workspace refresh controller did not render.')
  }

  return controller
}

describe('useWorkspaceRefreshController', () => {
  it('refreshes only the requested active-workspace resources', async () => {
    const refreshGitState = vi.fn().mockResolvedValue(null)
    const reloadActiveWorkspaceTree = vi.fn().mockResolvedValue(undefined)
    const controller = renderController({
      isActiveWorkspacePath: (rootPath) => rootPath === 'C:\\workspace',
      refreshGitState,
      reloadActiveWorkspaceTree,
    })

    await controller.performWorkspaceRefresh('C:\\other', {
      refreshGit: true,
      refreshTree: true,
    })
    expect(refreshGitState).not.toHaveBeenCalled()
    expect(reloadActiveWorkspaceTree).not.toHaveBeenCalled()

    await controller.performWorkspaceRefresh('C:\\workspace', {
      gitSilent: false,
      refreshGit: true,
      refreshTree: false,
    })
    expect(refreshGitState).toHaveBeenCalledWith('C:\\workspace', {
      silent: false,
    })
    expect(reloadActiveWorkspaceTree).not.toHaveBeenCalled()
  })

  it('uses the complete silent refresh after a document save', async () => {
    const refreshGitState = vi.fn().mockResolvedValue(null)
    const reloadActiveWorkspaceTree = vi.fn().mockResolvedValue(undefined)
    const controller = renderController({
      isActiveWorkspacePath: () => true,
      refreshGitState,
      reloadActiveWorkspaceTree,
    })

    await controller.refreshWorkspaceAfterDocumentSave('C:\\workspace')

    expect(reloadActiveWorkspaceTree).toHaveBeenCalledWith('C:\\workspace')
    expect(refreshGitState).toHaveBeenCalledWith('C:\\workspace', {
      silent: true,
    })
  })

  it('routes scheduled requests through the current refresh executor', async () => {
    const refreshGitState = vi.fn().mockResolvedValue(null)
    const reloadActiveWorkspaceTree = vi.fn().mockResolvedValue(undefined)
    const controller = renderController({
      isActiveWorkspacePath: () => true,
      refreshGitState,
      reloadActiveWorkspaceTree,
    })

    await controller.requestWorkspaceRefresh({
      refreshTree: true,
      rootPath: 'C:\\workspace',
    })

    expect(reloadActiveWorkspaceTree).toHaveBeenCalledWith('C:\\workspace')
    expect(refreshGitState).not.toHaveBeenCalled()
  })
})

describe('workspace refresh ownership', () => {
  it('keeps refresh coordination out of the application composition root', async () => {
    const [appSource, controllerSource] = await Promise.all([
      readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
      readFile(
        new URL(
          '../src/features/workspace/hooks/use-workspace-refresh-controller.ts',
          import.meta.url,
        ),
        'utf8',
      ),
    ])

    expect(appSource).toContain('useWorkspaceRefreshController({')
    expect(appSource).not.toContain('createWorkspaceRefreshCoordinator({')
    expect(appSource).not.toContain('workspaceRefreshCoordinatorRef')
    expect(controllerSource).toContain('createWorkspaceRefreshCoordinator({')
    expect(controllerSource.split(/\r?\n/).length).toBeLessThan(120)
  })
})
