import { describe, expect, it } from 'vitest'
import {
  buildCodexApprovalResult,
  buildCodexPermissionApprovalResult,
  projectCodexThread,
  type CodexThreadRecord,
} from '../electron/main/codex-agent'
import { projectPiFileAnnotations } from '../electron/main/pi-cli-agent'
import {
  AGENT_DEFINITIONS,
  DEFAULT_AGENT_ID,
  getAgentDefinition,
  normalizeAgentId,
} from '../src/features/agent/agent-definition'
import {
  formatOpenCodeVersionCompatibilityError,
  isCompatibleOpenCodeVersion,
  parseOpenCodeVersion,
} from '../src/features/agent/lib/opencode-version'

describe('Agent definitions', () => {
  it('keeps the embedded PI adapter as the safe migration fallback', () => {
    expect(DEFAULT_AGENT_ID).toBe('builtin-pi')
    expect(normalizeAgentId(undefined)).toBe('builtin-pi')
    expect(normalizeAgentId('unknown-agent')).toBe('builtin-pi')
  })

  it('describes every first-phase adapter with a distinct transport', () => {
    expect(AGENT_DEFINITIONS.map((definition) => definition.id)).toEqual([
      'builtin-pi',
      'pi',
      'opencode',
      'codex',
    ])
    expect(getAgentDefinition('opencode')).toMatchObject({ requiresCli: true, transport: 'http-server' })
    expect(getAgentDefinition('codex')).toMatchObject({ requiresCli: true, transport: 'app-server' })
  })

  it('accepts only the pinned OpenCode protocol minor series', () => {
    expect(parseOpenCodeVersion('opencode 1.17.18')).toEqual({ major: 1, minor: 17, patch: 18 })
    expect(isCompatibleOpenCodeVersion('1.17.22')).toBe(true)
    expect(isCompatibleOpenCodeVersion('1.18.0')).toBe(false)
    expect(isCompatibleOpenCodeVersion('unexpected output')).toBe(false)
    expect(formatOpenCodeVersionCompatibilityError('1.18.0')).toContain('1.17.18')
  })
})

describe('external Agent message projection', () => {
  it('projects PI write tool calls into file-change annotations', () => {
    expect(projectPiFileAnnotations([{
      role: 'assistant',
      content: [{
        type: 'toolCall',
        id: 'write-1',
        name: 'write',
        arguments: { path: 'src/new-file.ts' },
      }],
    }])).toEqual({
      fileChangesByEntryId: {
        'write-1': [{ filePath: 'src/new-file.ts', kind: 'updated' }],
      },
    })
  })

  it('projects Codex turns without discarding reasoning or execution state', () => {
    const record: CodexThreadRecord = {
      createdAt: '2026-07-11T00:00:00.000Z',
      cwd: 'C:/workspace',
      id: 'thread-1',
      materialized: true,
      model: 'gpt-5.4',
      modelExplicit: true,
      name: 'Codex task',
      reasoningEffort: 'high',
      updatedAt: '2026-07-11T00:01:00.000Z',
    }

    const snapshot = projectCodexThread({
      turns: [{
        items: [
          {
            id: 'user-1',
            type: 'userMessage',
            content: [
              { type: 'text', text: 'Fix it' },
              { type: 'image', url: 'data:image/png;base64,YWJj' },
              { type: 'localImage', path: 'C:/workspace/reference.png' },
            ],
          },
          { id: 'reason-1', type: 'reasoning', summary: ['Checking the failure'], content: [] },
          { id: 'command-1', type: 'commandExecution', command: 'npm test', status: 'completed', aggregatedOutput: 'passed' },
          { id: 'change-1', type: 'fileChange', status: 'completed', changes: [{ path: 'src/App.tsx', kind: { type: 'update' }, diff: '@@' }] },
          { id: 'assistant-1', type: 'agentMessage', text: 'Done' },
        ],
      }],
    }, record)

    expect(snapshot).toMatchObject({ sessionId: 'thread-1', sessionPath: 'thread-1', workspacePath: 'C:/workspace' })
    expect(snapshot.messages).toEqual([
      expect.objectContaining({
        id: 'user-1',
        kind: 'user',
        text: 'Fix it',
        attachments: [
          expect.objectContaining({ data: 'data:image/png;base64,YWJj', kind: 'image' }),
          expect.objectContaining({ path: 'C:/workspace/reference.png', kind: 'image' }),
        ],
      }),
      expect.objectContaining({ id: 'reason-1', kind: 'assistant', thinkingText: 'Checking the failure' }),
      expect.objectContaining({ id: 'command-1', kind: 'tool', status: 'done', text: 'passed', title: 'Terminal' }),
      expect.objectContaining({ id: 'change-1', kind: 'tool', sessionEntryId: 'change-1', title: 'File changes' }),
      expect.objectContaining({ id: 'assistant-1', kind: 'assistant', text: 'Done' }),
    ])
    expect(snapshot.annotations.fileChangesByEntryId).toEqual({
      'change-1': [{ filePath: 'src/App.tsx', kind: 'updated' }],
    })
  })

  it('projects a failed Codex turn as a visible assistant error', () => {
    const record: CodexThreadRecord = {
      createdAt: '2026-07-11T00:00:00.000Z',
      cwd: 'C:/workspace',
      id: 'thread-failed',
      materialized: true,
      model: null,
      modelExplicit: false,
      name: null,
      reasoningEffort: 'medium',
      updatedAt: '2026-07-11T00:01:00.000Z',
    }

    const snapshot = projectCodexThread({
      turns: [{
        id: 'turn-failed',
        status: 'failed',
        error: {
          message: JSON.stringify({
            type: 'error',
            status: 400,
            error: { message: 'The selected model is unavailable for this account.' },
          }),
        },
        items: [{
          id: 'user-failed',
          type: 'userMessage',
          content: [{ type: 'text', text: 'Hello' }],
        }],
      }],
    }, record)

    expect(snapshot.messages).toEqual([
      expect.objectContaining({ id: 'user-failed', kind: 'user', text: 'Hello' }),
      expect.objectContaining({
        id: 'turn-failed-error',
        isError: true,
        kind: 'assistant',
        status: 'error',
        text: 'The selected model is unavailable for this account.',
      }),
    ])
  })

  it('uses the dedicated Codex permission-profile response shape', () => {
    const requested = {
      fileSystem: { read: ['C:/outside'], write: ['C:/output'] },
      network: { enabled: true },
    }
    expect(buildCodexPermissionApprovalResult(requested, 'allow_always')).toEqual({
      permissions: requested,
      scope: 'session',
    })
    expect(buildCodexPermissionApprovalResult(requested, 'deny')).toEqual({
      permissions: {},
      scope: 'turn',
    })
  })

  it('uses protocol-specific decisions for current and legacy Codex approvals', () => {
    expect(buildCodexApprovalResult('allow_once', 'v2')).toEqual({ decision: 'accept' })
    expect(buildCodexApprovalResult('allow_always', 'v2')).toEqual({ decision: 'acceptForSession' })
    expect(buildCodexApprovalResult('allow_once', 'legacy')).toEqual({ decision: 'approved' })
    expect(buildCodexApprovalResult('allow_always', 'legacy')).toEqual({ decision: 'approved_for_session' })
    expect(buildCodexApprovalResult('deny', 'legacy')).toEqual({ decision: 'denied' })
  })

})
