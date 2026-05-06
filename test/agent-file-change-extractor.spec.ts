import { describe, expect, it } from 'vitest'
import type { SessionEntry } from '@mariozechner/pi-coding-agent'
import {
  collectDirectToolPathsByEntryId,
  extractExplicitBashFileChanges,
  extractWritableToolFilePath,
  filterAnnotationsByDirectToolPaths,
} from '../electron/main/agent-file-change-extractor'

describe('agent file change extractor', () => {
  it('extracts only explicit top-level bash file operations', () => {
    expect(extractExplicitBashFileChanges('C:/workspace', {
      command: 'rm notes/todo.md && mv draft.md final.md && python build.py',
    })).toEqual([
      {
        filePath: 'C:\\workspace\\notes\\todo.md',
        kind: 'deleted',
      },
      {
        filePath: 'C:\\workspace\\draft.md',
        kind: 'deleted',
      },
      {
        filePath: 'C:\\workspace\\final.md',
        kind: 'created',
      },
    ])
  })

  it('preserves Windows absolute paths without prefixing the host cwd', () => {
    expect(extractExplicitBashFileChanges('/Users/local/project', {
      command: 'rm C:\\workspace\\notes\\todo.md && mv C:\\workspace\\draft.md final.md',
    })).toEqual([
      {
        filePath: 'C:\\workspace\\notes\\todo.md',
        kind: 'deleted',
      },
      {
        filePath: 'C:\\workspace\\draft.md',
        kind: 'deleted',
      },
      {
        filePath: 'C:\\workspace\\final.md',
        kind: 'created',
      },
    ])
  })

  it('resolves direct write tool paths with the workspace path style', () => {
    expect(extractWritableToolFilePath('C:/workspace', 'write', {
      path: 'notes/worldview.md',
    })).toBe('C:\\workspace\\notes\\worldview.md')

    expect(extractWritableToolFilePath('/Users/local/project', 'write', {
      path: 'C:\\workspace\\absolute.md',
    })).toBe('C:\\workspace\\absolute.md')
  })

  it('filters stored annotations down to paths backed by session tool calls', () => {
    const entries: SessionEntry[] = [
      {
        id: 'assistant-1',
        parentId: null,
        timestamp: '2026-04-12T08:00:00.000Z',
        type: 'message',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'toolCall',
              id: 'tool-call-1',
              name: 'write',
              arguments: {
                path: 'worldview_summary.txt',
                content: 'hello',
              },
            },
          ],
          api: 'openai-completions',
          model: 'test-model',
          provider: 'openai',
          responseId: 'resp-1',
          stopReason: 'stop',
          timestamp: 1770000000000,
          usage: {
            cacheRead: 0,
            cacheWrite: 0,
            input: 0,
            output: 0,
            totalTokens: 0,
            cost: {
              cacheRead: 0,
              cacheWrite: 0,
              input: 0,
              output: 0,
              total: 0,
            },
          },
        },
      } as SessionEntry,
    ]

    const allowedPaths = collectDirectToolPathsByEntryId(entries, 'C:/workspace')

    expect(filterAnnotationsByDirectToolPaths({
      fileChangesByEntryId: {
        'assistant-1': [
          {
            filePath: 'C:\\workspace\\worldview_summary.txt',
            kind: 'created',
          },
          {
            filePath: 'C:\\workspace\\workspace.json',
            kind: 'updated',
          },
        ],
      },
    }, allowedPaths)).toEqual({
      fileChangesByEntryId: {
        'assistant-1': [
          {
            filePath: 'C:\\workspace\\worldview_summary.txt',
            kind: 'created',
          },
        ],
      },
    })
  })
})
