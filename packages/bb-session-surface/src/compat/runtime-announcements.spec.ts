import { describe, expect, it } from 'vitest'
import {
  runtimeAnnouncementKey,
  runtimeAnnouncementMessage,
} from './runtime-announcements'

describe('bb runtime announcements', () => {
  it('announces only high-level lifecycle changes', () => {
    expect(runtimeAnnouncementKey({ isStopping: false, status: 'active' })).toBe('active:working')
    expect(runtimeAnnouncementMessage('active:working', 'idle')).toBe('Agent is working.')
    expect(runtimeAnnouncementMessage('active:Working', 'idle')).toBe('Agent is working.')
    expect(runtimeAnnouncementMessage('idle', 'active:working')).toBe('Agent finished working.')
    expect(runtimeAnnouncementMessage('idle', null)).toBe('')
  })

  it('preserves meaningful non-token runtime labels and host states', () => {
    expect(runtimeAnnouncementKey({
      isStopping: false,
      label: 'Compacting context',
      status: 'active',
    })).toBe('active:Compacting context')
    expect(runtimeAnnouncementMessage('active:Compacting context', 'active:working'))
      .toBe('Compacting context.')
    expect(runtimeAnnouncementMessage('host-reconnecting', 'active:working'))
      .toBe('Reconnecting to agent host.')
    expect(runtimeAnnouncementMessage('waiting-for-host', 'host-reconnecting'))
      .toBe('Waiting for agent host.')
  })

  it('prioritizes stopping and error states', () => {
    expect(runtimeAnnouncementKey({ isStopping: true, status: 'active' })).toBe('stopping')
    expect(runtimeAnnouncementMessage('stopping', 'active:working')).toBe('Agent is stopping.')
    expect(runtimeAnnouncementMessage('error', 'active:working')).toBe('Agent encountered an error.')
  })
})
