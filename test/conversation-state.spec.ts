import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import {
  conversationDraftContext,
  createEmptyConversationState,
  getConversationById,
  getConversationForContext,
  isConversationWorkspaceCurrent,
  resolveSuggestedConversationTitle,
  shouldDisconnectConversationWorkspace,
} from '../src/features/conversations/lib/conversation-state'
import type {
  ConversationRecord,
  ConversationState,
} from '../src/features/conversations/types'

const conversation: ConversationRecord = {
  agentId: 'pi',
  agentSessionPath: 'C:/workspace/.pi/session.jsonl',
  createdAt: '2026-07-20T00:00:00.000Z',
  id: 'conversation-one',
  lastMessagePreview: 'Review the implementation',
  status: 'active',
  title: 'Implementation review',
  titleSource: 'agent',
  updatedAt: '2026-07-20T01:00:00.000Z',
  workspacePath: 'C:\\Workspace',
}

const conversationState: ConversationState = {
  version: 2,
  conversations: [conversation],
}

describe('conversation state', () => {
  it('creates independent empty states and exposes the draft context', () => {
    const firstState = createEmptyConversationState()
    const secondState = createEmptyConversationState()

    expect(firstState).toEqual({ version: 2, conversations: [] })
    expect(firstState.conversations).not.toBe(secondState.conversations)
    expect(conversationDraftContext).toEqual({ kind: 'conversationDraft' })
  })

  it('finds conversations by identifier and active context', () => {
    expect(getConversationById(conversationState, conversation.id)).toBe(conversation)
    expect(getConversationById(conversationState, 'missing')).toBeNull()
    expect(getConversationForContext(conversationState, {
      kind: 'conversation',
      conversationId: conversation.id,
    })).toBe(conversation)
    expect(getConversationForContext(conversationState, {
      kind: 'project',
      projectId: 'project-one',
    })).toBeNull()
  })

  it('matches connected conversation workspaces across separator and case differences', () => {
    expect(isConversationWorkspaceCurrent('c:/workspace', conversation.workspacePath)).toBe(true)
    expect(isConversationWorkspaceCurrent(null, conversation.workspacePath)).toBe(false)
    expect(isConversationWorkspaceCurrent('C:/other', conversation.workspacePath)).toBe(false)
  })

  it('disconnects only missing or currently connected conversation workspaces', () => {
    expect(shouldDisconnectConversationWorkspace('C:/workspace', null)).toBe(true)
    expect(shouldDisconnectConversationWorkspace('c:/workspace', conversation.workspacePath)).toBe(true)
    expect(shouldDisconnectConversationWorkspace(null, conversation.workspacePath)).toBe(false)
    expect(shouldDisconnectConversationWorkspace('C:/other', conversation.workspacePath)).toBe(false)
  })

  it('accepts only current, non-user-authored title suggestions', () => {
    expect(resolveSuggestedConversationTitle(conversation, {
      agentSessionPath: conversation.agentSessionPath!,
      title: '  Better title  ',
    })).toBe('Better title')
    expect(resolveSuggestedConversationTitle(null, {
      agentSessionPath: conversation.agentSessionPath!,
      title: 'Better title',
    })).toBeNull()
    expect(resolveSuggestedConversationTitle(conversation, {
      agentSessionPath: 'C:/other/session.jsonl',
      title: 'Better title',
    })).toBeNull()
    expect(resolveSuggestedConversationTitle({ ...conversation, titleSource: 'user' }, {
      agentSessionPath: conversation.agentSessionPath!,
      title: 'Better title',
    })).toBeNull()
    expect(resolveSuggestedConversationTitle(conversation, {
      agentSessionPath: conversation.agentSessionPath!,
      title: ` ${conversation.title} `,
    })).toBeNull()
    expect(resolveSuggestedConversationTitle(conversation, {
      agentSessionPath: conversation.agentSessionPath!,
      title: '   ',
    })).toBeNull()
  })
})

describe('conversation controller ownership', () => {
  it('keeps conversation lifecycle orchestration out of App', async () => {
    const [appSource, controllerSource] = await Promise.all([
      readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../src/features/conversations/hooks/use-conversation-controller.ts', import.meta.url), 'utf8'),
    ])

    expect(appSource).toContain('useConversationController({')
    expect(appSource).not.toContain('async function handleOpenConversation')
    expect(appSource).not.toContain('async function enterConversationDraft')
    expect(appSource).not.toContain('setConversationState')
    expect(appSource).toContain('async function handleStartContextualConversation')
    expect(controllerSource).toContain('async function createConversationWorkspace')
    expect(controllerSource).toContain('async function openConversation')
    expect(controllerSource).toContain('async function restoreInitialConversationContext')
  })
})
