import { describe, expect, it } from 'vitest'
import {
  applyComposerTextEdit,
  createComposerMentionToken,
  expandComposerSelectionToMentionBoundaries,
  findActiveComposerMentionQuery,
  flattenWorkspaceNodesForMentions,
  getComposerDeleteRange,
  normalizeComposerSelection,
  parseComposerMentionRanges,
  replaceComposerMentionQuery,
  searchComposerMentionItems,
  serializeComposerText,
  toWorkspaceRelativePath,
} from '../src/features/agent/lib/composer-mentions'
import type { WorkspaceNode } from '../src/features/workspace/types'

const workspacePath = '/workspace/project'

const tree: WorkspaceNode[] = [
  {
    children: [
      {
        kind: 'file',
        name: 'App.tsx',
        path: '/workspace/project/src/App.tsx',
      },
      {
        children: [
          {
            kind: 'file',
            name: 'app-titlebar.tsx',
            path: '/workspace/project/src/components/app-titlebar.tsx',
          },
        ],
        kind: 'directory',
        name: 'components',
        path: '/workspace/project/src/components',
      },
    ],
    kind: 'directory',
    name: 'src',
    path: '/workspace/project/src',
  },
  {
    kind: 'file',
    name: 'README.md',
    path: '/workspace/project/README.md',
  },
]

const searchTree: WorkspaceNode[] = [
  {
    children: [
      {
        kind: 'file',
        name: 'worldview_cn.txt',
        path: '/workspace/project/docs/worldview_cn.txt',
      },
      {
        kind: 'file',
        name: 'worldview_en.txt',
        path: '/workspace/project/docs/worldview_en.txt',
      },
    ],
    kind: 'directory',
    name: 'docs',
    path: '/workspace/project/docs',
  },
  {
    kind: 'file',
    name: 'workspace.json',
    path: '/workspace/project/.obsidian/workspace.json',
  },
  {
    children: [
      {
        kind: 'directory',
        name: 'plugins',
        path: '/workspace/project/.obsidian/plugins',
      },
    ],
    kind: 'directory',
    name: '.obsidian',
    path: '/workspace/project/.obsidian',
  },
]

describe('composer mentions', () => {
  it('converts absolute workspace paths to relative paths', () => {
    expect(toWorkspaceRelativePath(workspacePath, '/workspace/project/src/App.tsx')).toBe('src/App.tsx')
    expect(toWorkspaceRelativePath(workspacePath, '/workspace/project')).toBe('')
    expect(toWorkspaceRelativePath(workspacePath, '/outside/file.txt')).toBe('/outside/file.txt')
  })

  it('flattens workspace nodes with inline display paths', () => {
    const items = flattenWorkspaceNodesForMentions(tree, workspacePath)

    expect(items.map((item) => ({
      displayName: item.displayName,
      displayPath: item.displayPath,
      relativePath: item.relativePath,
    }))).toEqual([
      { displayName: 'src', displayPath: null, relativePath: 'src' },
      { displayName: 'App.tsx', displayPath: 'src', relativePath: 'src/App.tsx' },
      { displayName: 'components', displayPath: 'src', relativePath: 'src/components' },
      { displayName: 'app-titlebar.tsx', displayPath: 'src/components', relativePath: 'src/components/app-titlebar.tsx' },
      { displayName: 'README.md', displayPath: null, relativePath: 'README.md' },
    ])
  })

  it('prioritizes direct filename matches during search', () => {
    const items = flattenWorkspaceNodesForMentions(tree, workspacePath)
    const results = searchComposerMentionItems(items, 'app')

    expect(results.slice(0, 2).map((item) => item.relativePath)).toEqual([
      'src/App.tsx',
      'src/components/app-titlebar.tsx',
    ])
  })

  it('excludes unrelated directories from non-empty mention searches', () => {
    const items = flattenWorkspaceNodesForMentions(searchTree, workspacePath)
    const results = searchComposerMentionItems(items, 'wor')

    expect(results.map((item) => item.relativePath)).toEqual([
      'docs/worldview_cn.txt',
      'docs/worldview_en.txt',
      '.obsidian/workspace.json',
    ])
  })

  it('keeps matching directories slightly ahead of files when scores tie', () => {
    const items = flattenWorkspaceNodesForMentions([
      {
        kind: 'directory',
        name: 'world',
        path: '/workspace/project/world',
      },
      {
        kind: 'file',
        name: 'world.md',
        path: '/workspace/project/world.md',
      },
    ], workspacePath)

    expect(searchComposerMentionItems(items, 'world').map((item) => item.relativePath)).toEqual([
      'world',
      'world.md',
    ])
  })

  it('replaces an @ query with a visible label and serializes later', () => {
    const items = flattenWorkspaceNodesForMentions(tree, workspacePath)
    const result = replaceComposerMentionQuery({
      item: items[3],
      mentions: [],
      target: {
        end: 14,
        query: 'app-ti',
        start: 7,
      },
      value: 'Review @app-ti',
    })

    expect(result).toEqual({
      mentions: [
        {
          end: 23,
          id: 'file:src/components/app-titlebar.tsx',
          kind: 'file',
          label: 'app-titlebar.tsx',
          path: 'src/components/app-titlebar.tsx',
          start: 7,
          text: 'app-titlebar.tsx',
        },
      ],
      nextSelectionEnd: 23,
      nextSelectionStart: 23,
      value: 'Review app-titlebar.tsx',
    })
    expect(serializeComposerText(result.value, result.mentions)).toBe(
      'Review [app-titlebar.tsx](src/components/app-titlebar.tsx)',
    )
  })

  it('replaces an @ query without injecting extra spacing around the token', () => {
    const items = flattenWorkspaceNodesForMentions(tree, workspacePath)
    const result = replaceComposerMentionQuery({
      item: items[4],
      mentions: [],
      target: {
        end: 8,
        query: 'read',
        start: 3,
      },
      value: '看下 @read中文',
    })

    expect(result.value).toBe('看下 README.md中文')
    expect(result.nextSelectionStart).toBe(12)
    expect(serializeComposerText(result.value, result.mentions)).toBe('看下 [README.md](README.md)中文')
  })

  it('keeps visible mention labels atomic for selection and deletion', () => {
    const mention = createComposerMentionToken({
      absolutePath: '/workspace/project/src/App.tsx',
      displayName: 'App.tsx',
      displayPath: 'src',
      id: 'file:src/App.tsx',
      kind: 'file',
      name: 'App.tsx',
      relativePath: 'src/App.tsx',
      searchSegments: [],
      searchValue: '',
    }, 4)
    const value = `See ${mention.text} please`
    const ranges = parseComposerMentionRanges(value, [mention])

    expect(ranges).toEqual([mention])
    expect(normalizeComposerSelection({ start: 7, end: 7 }, ranges)).toEqual({ start: 4, end: 4 })
    expect(expandComposerSelectionToMentionBoundaries({ start: 2, end: 10 }, ranges)).toEqual({ start: 2, end: 11 })
    expect(getComposerDeleteRange({ start: 11, end: 11 }, ranges, 'backward')).toEqual({ start: 4, end: 11 })
    expect(getComposerDeleteRange({ start: 4, end: 4 }, ranges, 'forward')).toEqual({ start: 4, end: 11 })
  })

  it('applies edits while removing touched mention labels and shifting later mentions', () => {
    const firstMention = createComposerMentionToken({
      absolutePath: '/workspace/project/src/App.tsx',
      displayName: 'App.tsx',
      displayPath: 'src',
      id: 'file:src/App.tsx',
      kind: 'file',
      name: 'App.tsx',
      relativePath: 'src/App.tsx',
      searchSegments: [],
      searchValue: '',
    }, 5)
    const secondMention = createComposerMentionToken({
      absolutePath: '/workspace/project/README.md',
      displayName: 'README.md',
      displayPath: null,
      id: 'file:README.md',
      kind: 'file',
      name: 'README.md',
      relativePath: 'README.md',
      searchSegments: [],
      searchValue: '',
    }, 13)

    const value = `Open ${firstMention.text} ${secondMention.text}`
    const result = applyComposerTextEdit({
      insertText: 'that ',
      mentions: [firstMention, secondMention],
      selection: { start: 5, end: 12 },
      value,
    })

    expect(result).toEqual({
      mentions: [
        {
          ...secondMention,
          end: 20,
          start: 11,
        },
      ],
      nextSelectionEnd: 10,
      nextSelectionStart: 10,
      value: `Open that  ${secondMention.text}`,
    })
  })

  it('detects active @ queries but ignores emails and caret inside mentions', () => {
    const mentionValue = 'Inspect @app-ti'
    expect(findActiveComposerMentionQuery(mentionValue, { start: mentionValue.length, end: mentionValue.length }, [])).toEqual({
      end: mentionValue.length,
      query: 'app-ti',
      start: 8,
    })

    const emailValue = 'mail me at hello@example.com'
    expect(findActiveComposerMentionQuery(emailValue, { start: emailValue.length, end: emailValue.length }, [])).toBeNull()

    const mention = createComposerMentionToken({
      absolutePath: '/workspace/project/src/App.tsx',
      displayName: 'App.tsx',
      displayPath: 'src',
      id: 'file:src/App.tsx',
      kind: 'file',
      name: 'App.tsx',
      relativePath: 'src/App.tsx',
      searchSegments: [],
      searchValue: '',
    }, 8)
    expect(findActiveComposerMentionQuery('Inspect App.tsx', { start: 10, end: 10 }, [mention])).toBeNull()
  })
})
