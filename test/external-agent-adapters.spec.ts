import { describe, expect, it } from 'vitest'
import {
  buildCodexApprovalResult,
  buildCodexPermissionApprovalResult,
  buildCodexUserInputs,
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

  it('accepts compatible OpenCode v1 updates at or above the protocol baseline', () => {
    expect(parseOpenCodeVersion('opencode 1.17.18')).toEqual({ major: 1, minor: 17, patch: 18 })
    expect(isCompatibleOpenCodeVersion('1.17.17')).toBe(false)
    expect(isCompatibleOpenCodeVersion('1.17.22')).toBe(true)
    expect(isCompatibleOpenCodeVersion('1.18.4')).toBe(true)
    expect(isCompatibleOpenCodeVersion('1.99.0')).toBe(true)
    expect(isCompatibleOpenCodeVersion('2.0.0')).toBe(false)
    expect(isCompatibleOpenCodeVersion('unexpected output')).toBe(false)
    expect(formatOpenCodeVersionCompatibilityError('2.0.0')).toContain('>=1.17.18 <2.0.0')
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

  it('sends files and images through official structured Codex user-input variants', () => {
    expect(buildCodexUserInputs('inspect these', [{
      fileName: 'App.tsx',
      kind: 'file',
      path: 'C:/workspace/src/App.tsx',
    }, {
      data: 'data:image/png;base64,AA==',
      fileName: 'screen.png',
      kind: 'image',
      mimeType: 'image/png',
    }])).toEqual([{
      text: 'inspect these',
      text_elements: [],
      type: 'text',
    }, {
      name: 'App.tsx',
      path: 'C:/workspace/src/App.tsx',
      type: 'mention',
    }, {
      type: 'image',
      url: 'data:image/png;base64,AA==',
    }])
  })

})
