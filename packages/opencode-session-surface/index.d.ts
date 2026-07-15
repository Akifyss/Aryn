import type { Event as OpenCodeEvent } from '@opencode-ai/sdk/v2'

export type OpenCodeSurfaceRequest =
  | { method: 'app.agents' }
  | { method: 'provider.list' }
  | { method: 'session.get'; sessionID: string }
  | { method: 'session.messages'; before?: string; limit: number; sessionID: string }
  | { method: 'session.message'; messageID: string; sessionID: string }
  | { method: 'session.diff'; sessionID: string }
  | { method: 'session.todo'; sessionID: string }
  | { method: 'session.status'; sessionID: string }

export type OpenCodeSurfaceResponse = {
  data: unknown
  nextCursor?: string
}

export type OpenCodeSurfaceEvent =
  | {
      event: OpenCodeEvent
      type: 'event'
      workspacePath: string
    }
  | {
      sessionID: string
      type: 'refresh'
      workspacePath: string
    }

export type OpenCodeOptimisticUserMessage = {
  attachments?: Array<{
    fileName: string
    mimeType?: string
    partId: string
    url: string
  }>
  id: string
  text: string
  textPartId: string
  timestamp: number
}

export type OpenCodeSessionSurfaceOptions = {
  bridge: {
    openExternal?: (href: string) => Promise<unknown> | unknown
    openWorkspaceFile?: (filePath: string) => Promise<unknown> | unknown
    request: (workspacePath: string, request: OpenCodeSurfaceRequest) => Promise<OpenCodeSurfaceResponse>
    subscribe: (listener: (event: OpenCodeSurfaceEvent) => void) => () => void
  }
  locale?: string
  onNavigateToSession?: (sessionID: string) => void
  sessionID: string
  workspacePath: string
}

export type OpenCodeSessionSurface = {
  dispose: () => void
  setOptimisticUserMessages: (messages: OpenCodeOptimisticUserMessage[]) => void
}

export declare function mountOpenCodeSessionSurface(
  element: HTMLElement,
  options: OpenCodeSessionSurfaceOptions,
): OpenCodeSessionSurface
