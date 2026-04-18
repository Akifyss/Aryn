export const MEO_HOST_CHANNEL_KEY = '__arynMeoChannel'

export function createMeoChannelId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `meo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function buildMeoIframeSource(
  wrapperUrl: string,
  options: {
    channelId: string
    parentOrigin?: string | null
    theme: 'light' | 'dark'
  },
) {
  const url = new URL(wrapperUrl)
  url.searchParams.set('channel', options.channelId)
  url.searchParams.set('theme', options.theme)

  if (options.parentOrigin) {
    url.searchParams.set('parentOrigin', options.parentOrigin)
  }

  return url.toString()
}

export function getMeoIframeOrigin(wrapperUrl: string) {
  try {
    return new URL(wrapperUrl).origin
  } catch {
    return null
  }
}
