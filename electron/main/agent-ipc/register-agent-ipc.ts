import { dialog, ipcMain, shell, type BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import type {
  AgentInteractionResponse,
  AgentPromptAttachment,
  AgentPromptSendOptions,
  AgentProviderAuthUiEvent,
  AgentQueuedMessageUpdate,
  AgentRequestScope,
  AgentRunningPromptBehavior,
  AgentSessionCreateOptions,
  OpenCodeSurfaceRequest,
} from '../../shared/agent-contracts/types'
import type { AgentApplicationService } from '../agent-host/application/agent-application-service'
import { discoverAgentCatalog } from '../agent-host/infrastructure/cli-discovery'

const MAX_PICKED_IMAGE_ATTACHMENT_BYTES = 12 * 1024 * 1024

type PendingProviderAuthPrompt = {
  flowId: string
  provider: string
  reject: (error: Error) => void
  resolve: (value: string) => void
}

type ActiveProviderAuthFlow = {
  controller: AbortController
  flowId: string
}

type RegisterAgentIpcOptions = {
  agentHost: AgentApplicationService
  getWindow: () => BrowserWindow | null
}

function getAgentAttachmentMimeType(filePath: string) {
  const extension = path.extname(filePath).toLowerCase()
  switch (extension) {
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.webp':
      return 'image/webp'
    case '.gif':
      return 'image/gif'
    default:
      return undefined
  }
}

function normalizeAgentIpcScope(scopeOrWorkspacePath: AgentRequestScope | string): AgentRequestScope {
  if (typeof scopeOrWorkspacePath !== 'string') return scopeOrWorkspacePath
  return {
    agentId: 'builtin-pi',
    sessionPath: null,
    workspacePath: scopeOrWorkspacePath,
  }
}

export function registerAgentIpc(options: RegisterAgentIpcOptions) {
  const activeProviderAuthFlows = new Map<string, ActiveProviderAuthFlow>()
  const pendingProviderAuthPrompts = new Map<string, PendingProviderAuthPrompt>()
  const registeredChannels = new Set<string>()
  let disposed = false
  let legacyBuiltinAgentScope: AgentRequestScope | null = null

  function handle(
    channel: string,
    listener: Parameters<typeof ipcMain.handle>[1],
  ) {
    ipcMain.handle(channel, listener)
    registeredChannels.add(channel)
  }

  function rememberLegacyBuiltinScope(
    scope: AgentRequestScope,
    state: Awaited<ReturnType<AgentApplicationService['loadWorkspaceState']>>,
  ) {
    if (scope.agentId !== 'builtin-pi' || !scope.workspacePath) return
    legacyBuiltinAgentScope = {
      agentId: 'builtin-pi',
      sessionPath: state.activeSession?.sessionPath ?? null,
      workspacePath: scope.workspacePath,
    }
  }

  function requireLegacyBuiltinScope() {
    if (!legacyBuiltinAgentScope?.workspacePath || !legacyBuiltinAgentScope.sessionPath) {
      throw new Error('No embedded PI session is active for this legacy Agent request.')
    }
    return legacyBuiltinAgentScope
  }

  function emitProviderAuthUiEvent(event: AgentProviderAuthUiEvent) {
    const win = options.getWindow()
    if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return false
    win.webContents.send('agent:provider-auth-ui-event', event)
    return true
  }

  function requestProviderAuthInput(
    provider: string,
    flowId: string,
    prompt: { allowEmpty?: boolean, message: string, placeholder?: string },
  ) {
    const win = options.getWindow()
    if (!win || win.isDestroyed() || win.webContents.isDestroyed()) {
      throw new Error('No renderer window is available for provider login.')
    }

    return new Promise<string>((resolve, reject) => {
      const requestId = randomUUID()
      pendingProviderAuthPrompts.set(requestId, {
        flowId,
        provider,
        reject,
        resolve,
      })
      try {
        const emitted = emitProviderAuthUiEvent({
          type: 'prompt',
          allowEmpty: prompt.allowEmpty,
          message: prompt.message,
          placeholder: prompt.placeholder,
          provider,
          requestId,
        })
        if (emitted) return
        pendingProviderAuthPrompts.delete(requestId)
        reject(new Error('No renderer window is available for provider login.'))
      } catch (error) {
        pendingProviderAuthPrompts.delete(requestId)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  function rejectProviderAuthPrompts(
    provider: string,
    flowId?: string,
    message = 'Login cancelled.',
  ) {
    for (const [requestId, pendingPrompt] of pendingProviderAuthPrompts.entries()) {
      if (pendingPrompt.provider !== provider || (flowId && pendingPrompt.flowId !== flowId)) continue
      pendingProviderAuthPrompts.delete(requestId)
      pendingPrompt.reject(new Error(message))
    }
  }

  function cancelProviderAuthFlow(provider: string, message = 'Login cancelled.') {
    const activeFlow = activeProviderAuthFlows.get(provider)
    if (!activeFlow) {
      rejectProviderAuthPrompts(provider, undefined, message)
      return false
    }

    activeProviderAuthFlows.delete(provider)
    rejectProviderAuthPrompts(provider, activeFlow.flowId, message)
    if (!activeFlow.controller.signal.aborted) {
      activeFlow.controller.abort(new Error(message))
    }
    return true
  }

  function cancelProviderAuthFlows(message = 'Login cancelled.') {
    for (const provider of [...activeProviderAuthFlows.keys()]) {
      cancelProviderAuthFlow(provider, message)
    }
  }

  handle('agent:get-catalog', async (_event, catalogOptions?: { force?: boolean }) => (
    discoverAgentCatalog({ force: catalogOptions?.force === true })
  ))

  handle('agent:load-workspace', async (
    _event,
    scopeOrWorkspacePath: AgentRequestScope | string,
    preferredSessionPath?: string | null,
    loadOptions?: { restoreSession?: boolean },
  ) => {
    const scope = normalizeAgentIpcScope(scopeOrWorkspacePath)
    const state = await options.agentHost.loadWorkspaceState(
      scope,
      preferredSessionPath ?? null,
      loadOptions,
    )
    rememberLegacyBuiltinScope(scope, state)
    return state
  })

  handle('agent:load-draft-state', async (_event, agentId?: AgentRequestScope['agentId']) => (
    options.agentHost.loadDraftState(agentId)
  ))

  handle('agent:list-sessions', async (
    _event,
    scopeOrWorkspacePath: AgentRequestScope | string,
  ) => options.agentHost.listSessionItems(normalizeAgentIpcScope(scopeOrWorkspacePath)))

  handle('agent:read-session', async (
    _event,
    scopeOrWorkspacePath: AgentRequestScope | string,
    sessionPath: string,
  ) => options.agentHost.readSession(normalizeAgentIpcScope(scopeOrWorkspacePath), sessionPath))

  handle('agent:opencode-surface-request', async (
    _event,
    scope: AgentRequestScope,
    request: OpenCodeSurfaceRequest,
  ) => options.agentHost.requestOpenCodeSurface(scope, request))

  handle('agent:session-exists', async (
    _event,
    scopeOrWorkspacePath: AgentRequestScope | string,
    sessionPath: string,
  ) => ({
    exists: await options.agentHost.sessionExists(
      normalizeAgentIpcScope(scopeOrWorkspacePath),
      sessionPath,
    ),
  }))

  handle('agent:create-session', async (
    _event,
    scopeOrWorkspacePath: AgentRequestScope | string,
    createOptions?: string | AgentSessionCreateOptions,
  ) => {
    const scope = normalizeAgentIpcScope(scopeOrWorkspacePath)
    const state = await options.agentHost.createSession(scope, createOptions)
    rememberLegacyBuiltinScope(scope, state)
    return state
  })

  handle('agent:open-session', async (
    _event,
    scopeOrWorkspacePath: AgentRequestScope | string,
    sessionPath: string,
  ) => {
    const scope = normalizeAgentIpcScope(scopeOrWorkspacePath)
    const state = await options.agentHost.openSession(scope, sessionPath)
    rememberLegacyBuiltinScope(scope, state)
    return state
  })

  handle('agent:delete-session', async (
    _event,
    scopeOrWorkspacePath: AgentRequestScope | string,
    sessionPath: string,
  ) => {
    const scope = normalizeAgentIpcScope(scopeOrWorkspacePath)
    const state = await options.agentHost.deleteSession(scope, sessionPath)
    rememberLegacyBuiltinScope(scope, state)
    return state
  })

  handle('agent:rename-session', async (
    _event,
    scopeOrWorkspacePath: AgentRequestScope | string,
    sessionPath: string,
    name: string,
  ) => {
    const scope = normalizeAgentIpcScope(scopeOrWorkspacePath)
    const state = await options.agentHost.renameSession(scope, sessionPath, name)
    rememberLegacyBuiltinScope(scope, state)
    return state
  })

  handle('agent:pick-attachments', async () => {
    const win = options.getWindow()
    if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return []

    const result = await dialog.showOpenDialog(win, {
      filters: [
        {
          name: 'Supported attachments',
          extensions: [
            'png', 'jpg', 'jpeg', 'webp', 'gif', 'txt', 'md', 'markdown', 'json', 'csv',
            'tsv', 'yaml', 'yml', 'xml', 'html', 'css', 'js', 'jsx', 'ts', 'tsx', 'py',
            'go', 'rs', 'java', 'cpp', 'c', 'h', 'hpp', 'sql', 'docx', 'pdf',
          ],
        },
        { name: 'All files', extensions: ['*'] },
      ],
      properties: ['openFile', 'multiSelections'],
      title: 'Attach Files',
    })

    if (result.canceled || result.filePaths.length === 0) return []

    return Promise.all(result.filePaths.map(async (filePath): Promise<AgentPromptAttachment> => {
      const mimeType = getAgentAttachmentMimeType(filePath)
      const fileStats = await stat(filePath).catch(() => null)
      const isImage = Boolean(mimeType)
      const shouldInlineImage = isImage
        && (!fileStats || fileStats.size <= MAX_PICKED_IMAGE_ATTACHMENT_BYTES)
      const data = shouldInlineImage
        ? `data:${mimeType};base64,${(await readFile(filePath)).toString('base64')}`
        : undefined

      return {
        ...(data ? { data } : {}),
        fileName: path.basename(filePath),
        kind: isImage ? 'image' : 'file',
        ...(mimeType ? { mimeType } : {}),
        path: filePath,
        ...(fileStats ? { size: fileStats.size } : {}),
      }
    }))
  })

  handle('agent:send-prompt', async (
    _event,
    scopeOrPrompt: AgentRequestScope | string,
    promptOrStreamingBehavior?: string | AgentRunningPromptBehavior,
    streamingBehaviorOrAttachments?: AgentRunningPromptBehavior | AgentPromptAttachment[],
    attachmentsOrOptions?: AgentPromptAttachment[] | AgentPromptSendOptions,
    sendOptions?: AgentPromptSendOptions,
  ) => {
    if (typeof scopeOrPrompt !== 'string') {
      return options.agentHost.sendPrompt(
        scopeOrPrompt,
        String(promptOrStreamingBehavior ?? ''),
        streamingBehaviorOrAttachments as AgentRunningPromptBehavior | undefined,
        attachmentsOrOptions as AgentPromptAttachment[] | undefined,
        sendOptions,
      )
    }
    return options.agentHost.sendPrompt(
      requireLegacyBuiltinScope(),
      scopeOrPrompt,
      promptOrStreamingBehavior as AgentRunningPromptBehavior | undefined,
      streamingBehaviorOrAttachments as AgentPromptAttachment[] | undefined,
    )
  })

  handle('agent:update-queued-message', async (
    _event,
    scopeOrUpdate: AgentRequestScope | AgentQueuedMessageUpdate,
    maybeUpdate?: AgentQueuedMessageUpdate,
  ) => (
    scopeOrUpdate && typeof scopeOrUpdate === 'object' && 'agentId' in scopeOrUpdate
      ? options.agentHost.updateQueuedMessage(scopeOrUpdate, maybeUpdate as AgentQueuedMessageUpdate)
      : options.agentHost.updateQueuedMessage(requireLegacyBuiltinScope(), scopeOrUpdate)
  ))

  handle('agent:select-model', async (
    _event,
    scopeOrModelKey: AgentRequestScope | string,
    maybeModelKey?: string,
  ) => (
    typeof scopeOrModelKey === 'string'
      ? options.agentHost.selectModel(requireLegacyBuiltinScope(), scopeOrModelKey)
      : options.agentHost.selectModel(scopeOrModelKey, String(maybeModelKey ?? ''))
  ))

  handle('agent:select-thinking-level', async (
    _event,
    scopeOrLevel: AgentRequestScope | string,
    levelOrModelKey?: string,
    maybeModelKey?: string,
  ) => (
    typeof scopeOrLevel === 'string'
      ? options.agentHost.selectThinkingLevel(
          requireLegacyBuiltinScope(),
          scopeOrLevel,
          levelOrModelKey,
        )
      : options.agentHost.selectThinkingLevel(
          scopeOrLevel,
          String(levelOrModelKey ?? ''),
          maybeModelKey,
        )
  ))

  handle('agent:update-provider-auth', async (
    _event,
    rootPath: string | null,
    provider: string,
    apiKey: string | null,
  ) => options.agentHost.updateProviderAuth(rootPath, provider, apiKey))

  handle('agent:login-provider-auth', async (
    _event,
    rootPath: string | null,
    provider: string,
  ) => {
    cancelProviderAuthFlow(provider, 'A new login was started.')
    const controller = new AbortController()
    const flowId = randomUUID()
    activeProviderAuthFlows.set(provider, { controller, flowId })

    try {
      return await options.agentHost.loginProviderAuth(rootPath, provider, {
        emitAuth: (providerId, info) => emitProviderAuthUiEvent({
          type: 'auth',
          instructions: info.instructions,
          provider: providerId,
          url: info.url,
        }),
        emitComplete: (providerId, ok, message) => emitProviderAuthUiEvent({
          type: 'complete',
          message,
          ok,
          provider: providerId,
        }),
        emitProgress: (providerId, message) => emitProviderAuthUiEvent({
          type: 'progress',
          message,
          provider: providerId,
        }),
        openExternal: async (url) => {
          await shell.openExternal(url)
        },
        requestInput: (providerId, prompt) => requestProviderAuthInput(
          providerId,
          flowId,
          prompt,
        ),
        signal: controller.signal,
      })
    } finally {
      const activeFlow = activeProviderAuthFlows.get(provider)
      if (activeFlow?.flowId === flowId) activeProviderAuthFlows.delete(provider)
      rejectProviderAuthPrompts(provider, flowId)
    }
  })

  handle('agent:logout-provider-auth', async (
    _event,
    rootPath: string | null,
    provider: string,
  ) => {
    cancelProviderAuthFlow(provider)
    return options.agentHost.logoutProviderAuth(rootPath, provider)
  })

  handle('agent:cancel-provider-auth', async (_event, provider: string) => ({
    ok: cancelProviderAuthFlow(provider),
  }))

  handle('agent:respond-provider-auth-prompt', async (
    _event,
    requestId: string,
    value: string | null,
  ) => {
    const pendingPrompt = pendingProviderAuthPrompts.get(requestId)
    if (!pendingPrompt) return { ok: false }
    pendingProviderAuthPrompts.delete(requestId)
    if (value === null) {
      pendingPrompt.reject(new Error('Login cancelled.'))
    } else {
      pendingPrompt.resolve(value)
    }
    return { ok: true }
  })

  handle('agent:abort', async (_event, scope?: AgentRequestScope) => (
    options.agentHost.abortActivePrompt(scope ?? requireLegacyBuiltinScope())
  ))

  handle('agent:respond-interaction', async (
    _event,
    response: AgentInteractionResponse,
  ) => ({ ok: await options.agentHost.respondToInteraction(response) }))

  return {
    cancelProviderAuthFlows,
    dispose() {
      if (disposed) return
      disposed = true
      cancelProviderAuthFlows('Application closed.')
      legacyBuiltinAgentScope = null
      for (const channel of registeredChannels) ipcMain.removeHandler(channel)
      registeredChannels.clear()
    },
  }
}
