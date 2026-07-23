import { readFile } from 'node:fs/promises'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  ProjectMenuLayer,
  type ProjectMenuLayerConfiguration,
} from '../src/features/workspace/components/project-menu/project-menu-layer'
import { shouldReplaceActiveTreeFile } from '../src/features/workspace/components/workspace-workbench/workspace-navigation-panels'

const noop = () => {}

function createProjectMenuConfiguration(): ProjectMenuLayerConfiguration {
  return {
    activeProjectId: null,
    activeSurface: 'global',
    anchorRect: null,
    canUseNoProject: false,
    isBusy: false,
    leftDrawerPortal: null,
    mode: null,
    projects: [],
    rightDrawerPortal: null,
    onAddExistingProject: noop,
    onClose: noop,
    onCreateProject: noop,
    onSelectProject: noop,
    onUseNoProject: noop,
  }
}

describe('workspace workbench behavior', () => {
  it('replaces the active file only for an unmodified primary click', () => {
    expect(shouldReplaceActiveTreeFile('replace-active-tab', {
      button: 0,
      ctrlKey: false,
      metaKey: false,
    })).toBe(true)
    expect(shouldReplaceActiveTreeFile('replace-active-tab', {
      button: 0,
      ctrlKey: true,
      metaKey: false,
    })).toBe(false)
    expect(shouldReplaceActiveTreeFile('replace-active-tab', {
      button: 0,
      ctrlKey: false,
      metaKey: true,
    })).toBe(false)
    expect(shouldReplaceActiveTreeFile('replace-active-tab', {
      button: 1,
      ctrlKey: false,
      metaKey: false,
    })).toBe(false)
    expect(shouldReplaceActiveTreeFile('open-tab', {
      button: 0,
      ctrlKey: false,
      metaKey: false,
    })).toBe(false)
  })

  it('renders a project menu only on its active surface', () => {
    const closedMarkup = renderToStaticMarkup(
      <ProjectMenuLayer
        configuration={createProjectMenuConfiguration()}
        surface='global'
      />,
    )
    const mismatchedMarkup = renderToStaticMarkup(
      <ProjectMenuLayer
        configuration={{
          ...createProjectMenuConfiguration(),
          mode: 'editor-switch',
        }}
        surface='left-drawer'
      />,
    )
    const detachedDrawerMarkup = renderToStaticMarkup(
      <ProjectMenuLayer
        configuration={{
          ...createProjectMenuConfiguration(),
          activeSurface: 'left-drawer',
          mode: 'editor-switch',
        }}
        surface='left-drawer'
      />,
    )

    expect(closedMarkup).toBe('')
    expect(mismatchedMarkup).toBe('')
    expect(detachedDrawerMarkup).toBe('')
  })
})

describe('workspace workbench ownership', () => {
  it('keeps navigation and editor composition out of App without creating new large files', async () => {
    const componentUrls = [
      '../src/features/workspace/components/project-menu/project-menu-layer.tsx',
      '../src/features/workspace/components/workspace-workbench/workspace-navigation-panels.tsx',
      '../src/features/workspace/components/workspace-workbench/workspace-navigation-surface.tsx',
      '../src/features/workspace/components/workspace-workbench/workspace-editor-workbench.tsx',
    ]
    const [appSource, ...componentSources] = await Promise.all([
      readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
      ...componentUrls.map((path) => readFile(new URL(path, import.meta.url), 'utf8')),
    ])

    expect(appSource).toContain('<WorkspaceNavigationSurface')
    expect(appSource).toContain('<WorkspaceEditorWorkbench')
    expect(appSource).not.toContain('function renderWorkspaceTreePanel')
    expect(appSource).not.toContain('function renderGitPanel')
    expect(appSource).not.toContain('function renderDirectorySidebar')

    for (const source of componentSources) {
      expect(source.split(/\r?\n/).length).toBeLessThan(300)
    }
  })
})
