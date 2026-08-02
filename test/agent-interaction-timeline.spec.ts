import { describe, expect, it } from 'vitest'
import type { AgentInteractionTimelineRecord } from '../electron/shared/agent-contracts/types'
import { resolveInteractionTimelineRecords } from '../src/features/agent/runtime/use-agent-runtime-events'

function pendingPermission(): AgentInteractionTimelineRecord {
  return {
    request: {
      agentId: 'codex',
      id: 'permission-1',
      kind: 'permission',
      message: 'Allow command?',
      options: [{ id: 'deny', label: 'Deny' }, { id: 'allow_once', label: 'Allow once' }],
      sessionId: 'thread-1',
      title: 'Run command',
      workspacePath: 'C:\\workspace',
    },
    requestedAt: 10,
    status: 'pending',
  }
}

function pendingQuestion(): AgentInteractionTimelineRecord {
  return {
    request: {
      agentId: 'opencode',
      id: 'question-1',
      kind: 'question',
      message: 'Choose?',
      options: [{ id: 'reject', label: 'Cancel' }],
      sessionId: 'session-1',
      title: 'Choose',
      workspacePath: 'C:\\workspace',
    },
    requestedAt: 10,
    status: 'pending',
  }
}

describe('agent interaction timeline lifecycle', () => {
  it('retains the authoritative response when a request resolves', () => {
    const response = {
      agentId: 'codex' as const,
      optionId: 'allow_once',
      requestId: 'permission-1',
      sessionId: 'thread-1',
    }
    const [record] = resolveInteractionTimelineRecords([pendingPermission()], {
      agentId: 'codex',
      requestId: 'permission-1',
      response,
      resumeRun: true,
      sessionId: 'thread-1',
      type: 'interaction_resolved',
    }, 20)

    expect(record).toMatchObject({ resolvedAt: 20, response, status: 'resolved' })
  })

  it('marks teardown without an answer as interrupted, never allowed', () => {
    const [record] = resolveInteractionTimelineRecords([pendingPermission()], {
      agentId: 'codex',
      requestId: 'permission-1',
      resumeRun: false,
      sessionId: 'thread-1',
      type: 'interaction_resolved',
    }, 30)

    expect(record).toMatchObject({
      resolvedAt: 30,
      status: 'interrupted',
      statusReason: 'Request ended before Aryn received an answer.',
    })
    expect(record?.response).toBeUndefined()
  })

  it('records a rejected question as cancelled instead of answered', () => {
    const response = {
      agentId: 'opencode' as const,
      optionId: 'reject',
      requestId: 'question-1',
      sessionId: 'session-1',
    }
    const [record] = resolveInteractionTimelineRecords([pendingQuestion()], {
      agentId: 'opencode',
      requestId: 'question-1',
      response,
      resumeRun: true,
      sessionId: 'session-1',
      type: 'interaction_resolved',
    }, 40)

    expect(record).toMatchObject({
      response,
      status: 'interrupted',
      statusReason: 'User cancelled the request.',
    })
  })
})
