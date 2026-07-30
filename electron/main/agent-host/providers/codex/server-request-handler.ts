import type { ServerRequest } from '../../../../shared/agent-contracts/providers/codex/protocol/generated/ServerRequest'
import type { McpServerElicitationRequestResponse } from '../../../../shared/agent-contracts/providers/codex/protocol/generated/v2/McpServerElicitationRequestResponse'
import type { RequestPermissionProfile } from '../../../../shared/agent-contracts/providers/codex/protocol/generated/v2/RequestPermissionProfile'
import {
  getAgentInteractionKey,
  type AgentClientEventPayload,
} from '../../../../shared/agent-contracts/types'
import type { SessionRuntimeLease } from '../../runtime/session-runtime-coordinator'
import type { CodexRpcClient } from './rpc-client'

type JsonRecord = Record<string, unknown>

export type PendingCodexInteraction = {
  approvalProtocol?: 'legacy' | 'v2'
  client: CodexRpcClient
  kind: 'approval' | 'permissions' | 'question'
  lease: SessionRuntimeLease
  originalId: ServerRequest['id']
  questionIds?: string[]
  requestId: string
  requestedPermissions?: RequestPermissionProfile
  sessionId: string
}

type HandleCodexServerRequestOptions = {
  currentClient: CodexRpcClient | null
  disposed: boolean
  emitEvent: (event: AgentClientEventPayload) => void
  findLease: (threadId: string) => SessionRuntimeLease | undefined
  findWorkspace: (threadId: string) => string
  pendingInteractions: Map<string, PendingCodexInteraction>
  request: ServerRequest
  sourceClient: CodexRpcClient | null
  sourceLease?: SessionRuntimeLease
}

function describeApproval(request: ServerRequest) {
  switch (request.method) {
    case 'item/commandExecution/requestApproval':
      return request.params.command ?? request.params.reason ?? 'Codex 请求执行受保护的命令。'
    case 'item/fileChange/requestApproval':
      return request.params.reason ?? request.params.grantRoot ?? 'Codex 请求修改工作区文件。'
    case 'item/permissions/requestApproval':
      return request.params.reason ?? 'Codex 请求扩展当前权限。'
    case 'execCommandApproval':
      return request.params.command.join(' ')
    case 'applyPatchApproval':
      return request.params.reason ?? Object.keys(request.params.fileChanges).join('\n')
    default:
      return 'Codex 请求批准操作。'
  }
}

function describeRequestedPermissions(
  permissions: RequestPermissionProfile,
  fallback: string,
) {
  const fileSystem = permissions.fileSystem
  const network = permissions.network
  const lines: string[] = []
  if (Array.isArray(fileSystem?.read) && fileSystem.read.length > 0) {
    lines.push(`读取：${fileSystem.read.map(String).join('\n')}`)
  }
  if (Array.isArray(fileSystem?.write) && fileSystem.write.length > 0) {
    lines.push(`写入：${fileSystem.write.map(String).join('\n')}`)
  }
  if (network?.enabled === true) lines.push('网络：允许访问')
  return lines.join('\n\n') || fallback
}

/**
 * Handles App Server initiated requests at the Codex protocol boundary.
 *
 * The manager supplies generation ownership and workspace routing; this module
 * owns protocol validation, fail-closed fallbacks, interaction projection and
 * the exact response shapes required by Codex.
 */
export function handleCodexServerRequest(options: HandleCodexServerRequestOptions) {
  const {
    currentClient,
    emitEvent,
    findLease,
    findWorkspace,
    pendingInteractions,
    request,
    sourceClient,
    sourceLease,
  } = options
  if (!sourceClient || sourceClient !== currentClient || options.disposed) return
  if (
    request.method === 'account/chatgptAuthTokens/refresh'
    || request.method === 'attestation/generate'
  ) {
    sourceClient.respondError(request.id, -32601, `Unsupported Codex server request: ${request.method}.`)
    return
  }
  const threadId = 'threadId' in request.params
    ? request.params.threadId
    : 'conversationId' in request.params
      ? String(request.params.conversationId)
      : null
  if (!threadId) {
    sourceClient.respondError(request.id, -32602, `${request.method} did not include a thread identifier.`)
    return
  }

  const lease = sourceLease ?? findLease(threadId)

  if (
    request.method === 'item/commandExecution/requestApproval'
    || request.method === 'item/fileChange/requestApproval'
    || request.method === 'item/permissions/requestApproval'
    || request.method === 'applyPatchApproval'
    || request.method === 'execCommandApproval'
  ) {
    if (!lease?.isCurrent()) {
      sourceClient.respondError(request.id, -32000, 'Codex thread binding is no longer active.')
      return
    }
    const params = request.params as unknown as JsonRecord
    const isPermissions = request.method === 'item/permissions/requestApproval'
    const isLegacy = request.method === 'applyPatchApproval' || request.method === 'execCommandApproval'
    const requestedPermissions = isPermissions
      ? request.params.permissions
      : null
    const detail = describeApproval(request)
    const requestId = `codex:${String(request.id)}`
    pendingInteractions.set(getAgentInteractionKey(threadId, requestId), {
      approvalProtocol: isLegacy ? 'legacy' : 'v2',
      client: sourceClient,
      kind: isPermissions ? 'permissions' : 'approval',
      lease,
      originalId: request.id,
      requestId,
      ...(requestedPermissions ? { requestedPermissions } : {}),
      sessionId: threadId,
    })
    emitEvent({
      type: 'interaction_requested',
      request: {
        agentId: 'codex',
        id: requestId,
        kind: 'permission',
        message: requestedPermissions
          ? describeRequestedPermissions(requestedPermissions, detail)
          : detail,
        options: [
          { id: 'deny', label: '拒绝' },
          { id: 'allow_once', label: '允许本次' },
          { id: 'allow_always', label: '本会话始终允许' },
        ],
        sessionId: threadId,
        title: isPermissions
          ? 'Codex 请求扩展权限'
          : request.method.includes('fileChange') || request.method === 'applyPatchApproval'
            ? 'Codex 请求修改文件'
            : 'Codex 请求执行命令',
        workspacePath: findWorkspace(threadId) || String(params.cwd ?? ''),
      },
    })
    return
  }

  if (request.method === 'item/tool/requestUserInput') {
    if (!lease?.isCurrent()) {
      sourceClient.respondError(request.id, -32000, 'Codex thread binding is no longer active.')
      return
    }
    const questions = request.params.questions
    if (questions.length === 0) {
      sourceClient.respondError(request.id, -32602, 'Codex user-input request contained no questions.')
      return
    }
    const requestId = `codex:${String(request.id)}`
    const questionIds = questions.map((question) => question.id)
    pendingInteractions.set(getAgentInteractionKey(threadId, requestId), {
      client: sourceClient,
      kind: 'question',
      lease,
      originalId: request.id,
      questionIds,
      requestId,
      sessionId: threadId,
    })
    emitEvent({
      type: 'interaction_requested',
      request: {
        agentId: 'codex',
        fields: questions.map((question) => ({
          allowsCustomAnswer: question.isOther || !question.options?.length,
          id: question.id,
          isSecret: question.isSecret,
          label: question.header,
          message: question.question,
          options: question.options?.map((option) => ({
            description: option.description,
            id: option.label,
            label: option.label,
          })) ?? [],
        })),
        id: requestId,
        kind: 'question',
        message: questions.length === 1
          ? questions[0].question
          : `Codex 有 ${questions.length} 个问题需要回答。`,
        options: [{ id: 'deny', label: '取消' }],
        sessionId: threadId,
        title: questions.length === 1 ? questions[0].header : 'Codex 提问',
        workspacePath: findWorkspace(threadId),
      },
    })
    return
  }

  if (request.method === 'mcpServer/elicitation/request') {
    const response: McpServerElicitationRequestResponse = {
      _meta: null,
      action: 'decline',
      content: null,
    }
    sourceClient.respond(request.id, response)
    console.warn(`[codex app-server] Declined unsupported MCP elicitation from ${request.params.serverName}.`)
    return
  }
  if (request.method === 'item/tool/call') {
    sourceClient.respond(request.id, {
      contentItems: [{ type: 'inputText', text: 'Aryn did not register this dynamic tool.' }],
      success: false,
    })
    return
  }
  const unsupportedRequest = request as unknown as { id: string | number, method: string }
  sourceClient.respondError(
    unsupportedRequest.id,
    -32601,
    `Unsupported Codex server request: ${unsupportedRequest.method}.`,
  )
}
