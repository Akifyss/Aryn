import type { AgentSession } from '@earendil-works/pi-coding-agent'
import {
  complete,
  type Api,
  type AssistantMessage,
  type Model,
  type UserMessage,
} from '@earendil-works/pi-ai'
import {
  buildFallbackSessionTitle,
  getAutoNamingContext,
  normalizeSessionTitle,
} from './session-presentation'

const OPENROUTER_PROVIDER = 'openrouter'
const AUTO_SESSION_NAME_MODEL_ID = 'openrouter/free'
const AUTO_SESSION_NAME_MAX_TOKENS = 48
const AUTO_SESSION_NAME_SYSTEM_PROMPT = [
  'You generate short chat session titles.',
  'Reply with title text only.',
  'Use the same language as the user when possible.',
  'Do not use quotes, markdown, labels, prefixes, numbering, or ending punctuation.',
  'Keep it compact and specific.',
].join(' ')
const AUTO_SESSION_NAME_MODEL: Model<Api> = {
  api: 'openai-completions',
  baseUrl: 'https://openrouter.ai/api/v1',
  contextWindow: 200000,
  cost: {
    cacheRead: 0,
    cacheWrite: 0,
    input: 0,
    output: 0,
  },
  id: AUTO_SESSION_NAME_MODEL_ID,
  input: ['text'],
  maxTokens: 256,
  name: 'OpenRouter Free Router',
  provider: OPENROUTER_PROVIDER,
  reasoning: false,
}

/** Generates a first-turn title without coupling naming to event projection. */
export class BuiltinPiSessionNamer {
  private readonly namingSessions = new Set<string>()

  constructor(
    private readonly onRenamed: (session: AgentSession) => Promise<void>,
  ) {}

  async maybeName(session: AgentSession) {
    if (session.sessionName?.trim() || this.namingSessions.has(session.sessionId)) return
    const context = getAutoNamingContext(session.sessionManager.getBranch())
    if (!context || context.userMessageCount !== 1) return

    this.namingSessions.add(session.sessionId)
    try {
      const title = await this.generate(session, context)
      if (!title || session.sessionName?.trim()) return
      session.setSessionName(title)
      await this.onRenamed(session)
    } finally {
      this.namingSessions.delete(session.sessionId)
    }
  }

  private getModels(session: AgentSession) {
    const models: Model<Api>[] = []
    const preferred = session.modelRegistry.find(
      OPENROUTER_PROVIDER,
      AUTO_SESSION_NAME_MODEL_ID,
    ) ?? AUTO_SESSION_NAME_MODEL
    if (
      session.model
      && session.modelRegistry.hasConfiguredAuth(session.model)
      && !models.some((model) => (
        model.provider === session.model?.provider && model.id === session.model?.id
      ))
    ) models.push(session.model)
    if (
      session.modelRegistry.hasConfiguredAuth(preferred)
      && !models.some((model) => model.provider === preferred.provider && model.id === preferred.id)
    ) models.push(preferred)
    return models
  }

  private async generateWithModel(
    session: AgentSession,
    model: Model<Api>,
    sourceText: string,
  ) {
    const auth = await session.modelRegistry.getApiKeyAndHeaders(model)
    if (!auth.ok) return null
    const response = await complete(
      model,
      {
        messages: [{
          content: [{ type: 'text', text: sourceText }],
          role: 'user',
          timestamp: Date.now(),
        } satisfies UserMessage],
        systemPrompt: AUTO_SESSION_NAME_SYSTEM_PROMPT,
      },
      {
        apiKey: auth.apiKey,
        headers: auth.headers,
        maxTokens: AUTO_SESSION_NAME_MAX_TOKENS,
      },
    )
    if (response.stopReason === 'aborted' || response.stopReason === 'error') return null
    const text = response.content
      .filter((block): block is Extract<AssistantMessage['content'][number], { type: 'text' }> => (
        block.type === 'text'
      ))
      .map((block) => block.text)
      .join('\n')
    return normalizeSessionTitle(text)
  }

  private async generate(
    session: AgentSession,
    context: NonNullable<ReturnType<typeof getAutoNamingContext>>,
  ) {
    const source = [
      `First user message:\n${context.firstUserText}`,
      context.firstAssistantText ? `\nFirst assistant reply:\n${context.firstAssistantText}` : '',
    ].join('\n').trim()
    for (const model of this.getModels(session)) {
      try {
        const title = await this.generateWithModel(session, model, source)
        if (title) return title
      } catch {
        // Continue to the next configured model or the deterministic fallback.
      }
    }
    return buildFallbackSessionTitle(context.firstUserText)
  }
}
