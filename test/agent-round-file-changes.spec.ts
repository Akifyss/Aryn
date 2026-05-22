import { describe, expect, it } from 'vitest'
import {
  findLatestOpenableAgentFileChange,
  initialAgentFileAutoOpenState,
  resolveNextAgentFileAutoOpen,
} from '../src/features/agent/auto-open-file'
import { buildRoundFileChangesByMessageId } from '../src/features/agent/round-file-changes'

describe('agent round file changes', () => {
  it('attaches file changes to the last message in a completed round', () => {
    const roundFileChanges = buildRoundFileChangesByMessageId({
      annotations: {
        fileChangesByEntryId: {
          'assistant-entry': [
            {
              filePath: 'C:/workspace/worldview_summary.txt',
              kind: 'created',
            },
          ],
        },
      },
      hasInFlightRound: false,
      messages: [
        {
          id: 'user-1',
          kind: 'user',
          text: 'Create a file',
          timestamp: 1,
        },
        {
          id: 'tool-1',
          kind: 'tool',
          sessionEntryId: 'assistant-entry',
          text: 'Tool output',
          timestamp: 2,
          title: 'write',
        },
        {
          id: 'assistant-1',
          kind: 'assistant',
          text: 'Created the file.',
          timestamp: 3,
        },
      ],
    })

    expect([...roundFileChanges.entries()]).toEqual([
      ['assistant-1', [
        {
          filePath: 'C:/workspace/worldview_summary.txt',
          kind: 'created',
        },
      ]],
    ])
  })

  it('suppresses trailing file changes while the current round is still in flight', () => {
    const roundFileChanges = buildRoundFileChangesByMessageId({
      annotations: {
        fileChangesByEntryId: {
          'assistant-entry': [
            {
              filePath: 'C:/workspace/worldview_summary.txt',
              kind: 'created',
            },
          ],
        },
      },
      hasInFlightRound: true,
      messages: [
        {
          id: 'user-1',
          kind: 'user',
          text: 'Create a file',
          timestamp: 1,
        },
        {
          id: 'tool-1',
          kind: 'tool',
          sessionEntryId: 'assistant-entry',
          text: 'Tool output',
          timestamp: 2,
          title: 'write',
        },
      ],
    })

    expect([...roundFileChanges.entries()]).toEqual([])
  })

  it('drops create-then-delete noise within the same round', () => {
    const roundFileChanges = buildRoundFileChangesByMessageId({
      annotations: {
        fileChangesByEntryId: {
          'assistant-entry': [
            {
              filePath: 'C:/workspace/temp.txt',
              kind: 'created',
            },
            {
              filePath: 'C:/workspace/temp.txt',
              kind: 'deleted',
            },
          ],
        },
      },
      hasInFlightRound: false,
      messages: [
        {
          id: 'user-1',
          kind: 'user',
          text: 'Do temp work',
          timestamp: 1,
        },
        {
          id: 'assistant-1',
          kind: 'assistant',
          sessionEntryId: 'assistant-entry',
          text: 'Done.',
          timestamp: 2,
        },
      ],
    })

    expect([...roundFileChanges.entries()]).toEqual([])
  })

  it('does not auto-open historical file chips while a selected session is loading', () => {
    const historicalChange = {
      filePath: 'C:/workspace/calculator.html',
      kind: 'created' as const,
    }
    const latestFileChange = {
      change: historicalChange,
      key: `assistant-1:${historicalChange.kind}:${historicalChange.filePath}`,
    }

    const selectingSession = resolveNextAgentFileAutoOpen(initialAgentFileAutoOpenState, {
      activeSessionPath: 'C:/workspace/.pi/sessions/session-a.json',
      isViewingActiveRuntime: false,
      latestFileChange: null,
    })
    expect(selectingSession.fileChange).toBeNull()

    const loadedSession = resolveNextAgentFileAutoOpen(selectingSession.state, {
      activeSessionPath: 'C:/workspace/.pi/sessions/session-a.json',
      isViewingActiveRuntime: true,
      latestFileChange,
    })
    expect(loadedSession.fileChange).toBeNull()

    const temporarilyHiddenFiles = resolveNextAgentFileAutoOpen(loadedSession.state, {
      activeSessionPath: 'C:/workspace/.pi/sessions/session-a.json',
      isViewingActiveRuntime: true,
      latestFileChange: null,
    })
    expect(temporarilyHiddenFiles.fileChange).toBeNull()

    const restoredHistoricalFiles = resolveNextAgentFileAutoOpen(temporarilyHiddenFiles.state, {
      activeSessionPath: 'C:/workspace/.pi/sessions/session-a.json',
      isViewingActiveRuntime: true,
      latestFileChange,
    })
    expect(restoredHistoricalFiles.fileChange).toBeNull()

    const newChange = {
      filePath: 'C:/workspace/story.md',
      kind: 'updated' as const,
    }
    const nextChange = resolveNextAgentFileAutoOpen(restoredHistoricalFiles.state, {
      activeSessionPath: 'C:/workspace/.pi/sessions/session-a.json',
      isViewingActiveRuntime: true,
      latestFileChange: {
        change: newChange,
        key: `assistant-2:${newChange.kind}:${newChange.filePath}`,
      },
    })
    expect(nextChange.fileChange).toEqual(newChange)
  })

  it('finds the latest non-deleted file change from rendered rounds', () => {
    expect(findLatestOpenableAgentFileChange([
      {
        id: 'assistant-1',
        kind: 'assistant',
        text: 'Deleted temp.',
        timestamp: 1,
      },
      {
        id: 'assistant-2',
        kind: 'assistant',
        text: 'Updated story.',
        timestamp: 2,
      },
    ], new Map([
      ['assistant-1', [{ filePath: 'C:/workspace/temp.md', kind: 'deleted' }]],
      ['assistant-2', [{ filePath: 'C:/workspace/story.md', kind: 'updated' }]],
    ]))).toEqual({
      change: {
        filePath: 'C:/workspace/story.md',
        kind: 'updated',
      },
      key: 'assistant-2:updated:C:/workspace/story.md',
    })
  })
})
