import { describe, expect, it } from 'vitest'
import { upsertAgentSessionFileChange } from '../electron/main/agent-session-annotations'
import { mergeAgentMessageFileChangeKind } from '../src/features/agent/file-change-utils'

describe('agent session annotations', () => {
  it('keeps a created file as created through later updates', () => {
    const annotations = upsertAgentSessionFileChange(
      {
        fileChangesByEntryId: {},
      },
      'entry-1',
      {
        filePath: 'C:/workspace/story.md',
        kind: 'created',
      },
    )

    const nextAnnotations = upsertAgentSessionFileChange(annotations, 'entry-1', {
      filePath: 'C:/workspace/story.md',
      kind: 'updated',
    })

    expect(nextAnnotations).toEqual({
      fileChangesByEntryId: {
        'entry-1': [
          {
            filePath: 'C:/workspace/story.md',
            kind: 'created',
          },
        ],
      },
    })
  })

  it('drops a file tag when a created file is deleted in the same message', () => {
    const annotations = upsertAgentSessionFileChange(
      {
        fileChangesByEntryId: {},
      },
      'entry-2',
      {
        filePath: 'C:/workspace/temp.md',
        kind: 'created',
      },
    )

    expect(upsertAgentSessionFileChange(annotations, 'entry-2', {
      filePath: 'C:/workspace/temp.md',
      kind: 'deleted',
    })).toEqual({
      fileChangesByEntryId: {},
    })
  })

  it('treats delete followed by add as an update', () => {
    expect(mergeAgentMessageFileChangeKind('deleted', 'created')).toBe('updated')
  })
})
