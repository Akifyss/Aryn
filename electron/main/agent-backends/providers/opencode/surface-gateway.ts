import type {
  Message,
  OpencodeClient,
  Part,
  Session,
  SessionStatus,
  SnapshotFileDiff,
  Todo,
} from '@opencode-ai/sdk/v2'
import type {
  OpenCodeSurfaceRequest,
  OpenCodeSurfaceResponse,
} from '../../../../../src/features/agent/types'
import { unwrapOpenCodeSdkResult } from './session-model'

export async function requestOpenCodeSurfaceData(
  client: OpencodeClient,
  cwd: string,
  request: OpenCodeSurfaceRequest,
): Promise<OpenCodeSurfaceResponse> {
  switch (request.method) {
    case 'app.agents': {
      const response = await client.app.agents({ directory: cwd }, { throwOnError: true })
      return { data: unwrapOpenCodeSdkResult<unknown>(response, 'load surface agents') }
    }
    case 'provider.list': {
      const response = await client.provider.list({ directory: cwd }, { throwOnError: true })
      return { data: unwrapOpenCodeSdkResult<unknown>(response, 'load surface providers') }
    }
    case 'session.get': {
      const response = await client.session.get({ directory: cwd, sessionID: request.sessionID }, { throwOnError: true })
      return { data: unwrapOpenCodeSdkResult<Session>(response, 'load surface session') }
    }
    case 'session.messages': {
      const response = await client.session.messages({
        directory: cwd,
        sessionID: request.sessionID,
        limit: Math.max(1, Math.min(500, request.limit)),
        ...(request.before ? { before: request.before } : {}),
      }, { throwOnError: true })
      const result = unwrapOpenCodeSdkResult<Array<{ info: Message, parts: Part[] }>>(
        response,
        'load surface messages',
      )
      const nextCursor = response && typeof response === 'object' && 'response' in response
        ? response.response.headers.get('x-next-cursor') ?? undefined
        : undefined
      return { data: result, nextCursor }
    }
    case 'session.message': {
      const response = await client.session.message({
        directory: cwd,
        messageID: request.messageID,
        sessionID: request.sessionID,
      }, { throwOnError: true })
      return {
        data: unwrapOpenCodeSdkResult<{ info: Message, parts: Part[] }>(response, 'load surface message'),
      }
    }
    case 'session.diff': {
      const response = await client.session.diff({ directory: cwd, sessionID: request.sessionID }, { throwOnError: true })
      return { data: unwrapOpenCodeSdkResult<SnapshotFileDiff[]>(response, 'load surface diff') }
    }
    case 'session.todo': {
      const response = await client.session.todo({ directory: cwd, sessionID: request.sessionID }, { throwOnError: true })
      return { data: unwrapOpenCodeSdkResult<Todo[]>(response, 'load surface todos') }
    }
    case 'session.status': {
      const response = await client.session.status({ directory: cwd }, { throwOnError: true })
      const statuses = unwrapOpenCodeSdkResult<Record<string, SessionStatus>>(response, 'load surface status')
      return { data: statuses[request.sessionID] ?? { type: 'idle' } }
    }
  }
}
