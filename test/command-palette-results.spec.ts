import { describe, expect, it } from 'vitest'
import type { AgentSessionListItem } from '../src/features/agent/types'
import {
  buildCommandPaletteResultSections,
} from '../src/features/command-palette/lib/search-results'
import type { WorkspaceNode } from '../src/features/workspace/types'

function createSession(overrides: Partial<AgentSessionListItem>): AgentSessionListItem {
  return {
    createdAt: '2026-06-01T00:00:00.000Z',
    id: 'session-1',
    messageCount: 1,
    modifiedAt: '2026-06-01T00:00:00.000Z',
    name: null,
    path: 'C:/workspace/.pi/sessions/session-1.jsonl',
    preview: 'Initial session preview',
    ...overrides,
  }
}

describe('command palette result sections', () => {
  const files: WorkspaceNode[] = [
    {
      children: [
        {
          kind: 'file',
          name: 'README.md',
          path: 'C:/workspace/README.md',
        },
        {
          kind: 'file',
          name: 'search-panel.tsx',
          path: 'C:/workspace/src/search-panel.tsx',
        },
      ],
      kind: 'directory',
      name: 'workspace',
      path: 'C:/workspace',
    },
  ]

  it('shows file and session sections on an empty query', () => {
    const sections = buildCommandPaletteResultSections({
      files,
      query: '',
      sessions: [
        createSession({
          id: 'session-a',
          name: 'Planning notes',
          path: 'C:/workspace/.pi/sessions/session-a.jsonl',
        }),
      ],
    })

    expect(sections.map((section) => section.label)).toEqual(['会话', '文件'])
    expect(sections[0].items).toHaveLength(1)
  })

  it('matches sessions by preview text', () => {
    const sections = buildCommandPaletteResultSections({
      files,
      query: 'search panel',
      sessions: [
        createSession({
          id: 'session-a',
          name: null,
          path: 'C:/workspace/.pi/sessions/session-a.jsonl',
          preview: 'Discussed the command search panel rollout',
        }),
      ],
    })

    const sessionSection = sections.find((section) => section.category === 'session')

    expect(sessionSection?.items).toEqual([
      expect.objectContaining({
        category: 'session',
        description: 'Discussed the command search panel rollout',
        label: '未命名会话',
      }),
    ])
  })

  it('hides duplicated session preview text', () => {
    const sections = buildCommandPaletteResultSections({
      files: [],
      query: '',
      sessions: [
        createSession({
          id: 'session-a',
          name: '番茄钟HTML原型',
          path: 'C:/workspace/.pi/sessions/session-a.jsonl',
          preview: '番茄钟HTML原型',
        }),
      ],
    })

    const sessionSection = sections.find((section) => section.category === 'session')

    expect(sessionSection?.items).toEqual([
      expect.not.objectContaining({
        description: '番茄钟HTML原型',
      }),
    ])
  })

  it('does not match files by path-only text', () => {
    const sections = buildCommandPaletteResultSections({
      files: [
        {
          kind: 'file',
          name: 'README.md',
          path: 'C:/workspace/docs/product/README.md',
        },
      ],
      query: 'product',
      sessions: [],
    })

    expect(sections.find((section) => section.category === 'file')).toBeUndefined()
  })

  it('does not match sessions by hidden path-only text', () => {
    const sections = buildCommandPaletteResultSections({
      files: [],
      query: 'session-a.jsonl',
      sessions: [
        createSession({
          id: 'session-a',
          name: 'Visible title',
          path: 'C:/workspace/.pi/sessions/session-a.jsonl',
          preview: 'Visible preview',
        }),
      ],
    })

    expect(sections.find((section) => section.category === 'session')).toBeUndefined()
  })

  it('limits each section independently', () => {
    const manyFiles: WorkspaceNode[] = Array.from({ length: 8 }, (_, index) => ({
      kind: 'file',
      name: `match-${index}.ts`,
      path: `C:/workspace/match-${index}.ts`,
    }))

    const sections = buildCommandPaletteResultSections({
      files: manyFiles,
      maxItemsPerSection: 3,
      query: 'match',
      sessions: [
        createSession({
          id: 'session-a',
          name: 'Match planning',
          path: 'C:/workspace/.pi/sessions/session-a.jsonl',
        }),
      ],
    })

    expect(sections.find((section) => section.category === 'file')?.items).toHaveLength(3)
    expect(sections.find((section) => section.category === 'session')?.items).toHaveLength(1)
  })
})
