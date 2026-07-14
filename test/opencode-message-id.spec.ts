import { describe, expect, it } from 'vitest'
import {
  createOpenCodeMessageId,
  createOpenCodePartId,
  isOpenCodeMessageId,
  isOpenCodePartId,
} from '../src/features/agent/lib/opencode-message-id'

describe('OpenCode native optimistic identifiers', () => {
  it('creates IDs accepted by the OpenCode message and part namespaces', () => {
    const messageID = createOpenCodeMessageId()
    const partID = createOpenCodePartId()

    expect(isOpenCodeMessageId(messageID)).toBe(true)
    expect(isOpenCodePartId(partID)).toBe(true)
    expect(messageID).toMatch(/^msg_[0-9a-f]{12}[0-9A-Za-z]{14}$/)
    expect(partID).toMatch(/^prt_[0-9a-f]{12}[0-9A-Za-z]{14}$/)
  })

  it('does not accept optimistic-only or cross-namespace IDs', () => {
    expect(isOpenCodeMessageId('optimistic-user-1')).toBe(false)
    expect(isOpenCodeMessageId(createOpenCodePartId())).toBe(false)
    expect(isOpenCodePartId(createOpenCodeMessageId())).toBe(false)
  })
})
