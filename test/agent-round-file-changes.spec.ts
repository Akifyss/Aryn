import { describe, expect, it } from 'vitest'
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
})
