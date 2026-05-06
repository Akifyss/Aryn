export type MeoIframeSourceOptions = {
  channelId: string
  parentOrigin: string
  theme?: string | null
}

export function buildMeoIframeSource(wrapperUrl: string, options: MeoIframeSourceOptions) {
  const url = new URL(wrapperUrl)
  url.searchParams.set('channel', options.channelId)
  url.searchParams.set('parentOrigin', options.parentOrigin)

  if (options.theme) {
    url.searchParams.set('theme', options.theme)
  } else {
    url.searchParams.delete('theme')
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
