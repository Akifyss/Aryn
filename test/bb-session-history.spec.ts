import { describe, expect, it } from 'vitest'
import {
  decorateOpenCodeSnapshot,
  mergeOpenCodeMessages,
} from '@/features/agent/components/bb-session-timeline/bb-session-timeline'

function message(id: string, created: number, text: string) {
  return {
    info: { id, role: 'user', time: { created } },
    parts: [{ type: 'text', text }],
  }
}

describe('bb OpenCode history pagination', () => {
  it('prepends older pages, deduplicates by native id, and keeps live records authoritative', () => {
    const merged = mergeOpenCodeMessages(
      [message('current', 200, 'live value')],
      [message('older', 100, 'older value'), message('current', 200, 'stale value')],
    ) as ReturnType<typeof message>[]

    expect(merged.map((entry) => entry.info.id)).toEqual(['older', 'current'])
    expect(merged[1]?.parts[0]?.text).toBe('live value')
  })

  it('keeps loaded history and todos when a live OpenCode snapshot refreshes', () => {
    const decorated = decorateOpenCodeSnapshot({
      agentId: 'opencode',
      messages: [message('current', 200, 'current')],
    }, [{ id: 'todo-1' }], [message('older', 100, 'older')])

    expect((decorated.messages as ReturnType<typeof message>[]).map((entry) => entry.info.id))
      .toEqual(['older', 'current'])
    expect(decorated.todos).toEqual([{ id: 'todo-1' }])
  })
})
