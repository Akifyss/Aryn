import { describe, expect, it } from 'vitest'
import {
  buildMeoIframeSource,
  getMeoIframeOrigin,
} from '../src/features/editor/lib/meo-transport'

describe('meo transport helpers', () => {
  it('builds a wrapper URL with a stable channel and parent origin', () => {
    const source = buildMeoIframeSource('http://127.0.0.1:4312/meo/demo/.aryn-meo-wrapper.html', {
      channelId: 'channel-123',
      parentOrigin: 'http://127.0.0.1:7777',
      theme: 'dark',
    })

    const url = new URL(source)

    expect(url.origin).toBe('http://127.0.0.1:4312')
    expect(url.searchParams.get('channel')).toBe('channel-123')
    expect(url.searchParams.get('parentOrigin')).toBe('http://127.0.0.1:7777')
    expect(url.searchParams.get('theme')).toBe('dark')
  })

  it('resolves the iframe origin from a wrapper URL', () => {
    expect(getMeoIframeOrigin('http://127.0.0.1:4312/meo/demo/.aryn-meo-wrapper.html')).toBe('http://127.0.0.1:4312')
    expect(getMeoIframeOrigin('not-a-valid-url')).toBeNull()
  })
})
