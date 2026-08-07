import { describe, expect, it } from 'vitest'
import type {
  BbAgentId,
  BbInteractionTimelineRecord,
  BbNativeFileChange,
  BbNativeSessionSnapshot,
  BbSessionRuntimeState,
} from '../contracts'
import type { TimelineRow } from '../compat/server-contract'
import { projectNativeSession } from './index'

const AGENT_IDS = ['codex', 'opencode', 'pi', 'builtin-pi'] as const satisfies readonly BbAgentId[]
const LONG_DIFF = `@@ -1,3 +1,103 @@\n-old line\n${Array.from(
  { length: 100 },
  (_, index) => `+matrix line ${index + 1}`,
).join('\n')}`

function flattenRows(rows: readonly TimelineRow[]): TimelineRow[] {
  return rows.flatMap((row) => {
    if (row.kind === 'turn' && row.children) return [row, ...flattenRows(row.children)]
    if (row.kind === 'work' && row.workKind === 'delegation') {
      return [row, ...flattenRows(row.childRows)]
    }
    return [row]
  })
}

function count(value: string, needle: string) {
  return value.split(needle).length - 1
}

function sessionId(agentId: BbAgentId) {
  return `matrix-${agentId}`
}

function prompt(agentId: BbAgentId) {
  return `matrix-user-${agentId}`
}

function markdown(agentId: BbAgentId) {
  return [
    `matrix-markdown-${agentId}`,
    '',
    `A [matrix link](https://example.com/${agentId}).`,
    '',
    '```ts',
    `const provider = '${agentId}'`,
    '```',
    '',
    'Long paragraph. '.repeat(40),
  ].join('\n')
}

function codexUserContent() {
  const agentId = 'codex' as const
  return [{ type: 'text', text: prompt(agentId), text_elements: [] }, {
    type: 'image',
    url: `https://example.com/matrix-${agentId}.png`,
  }, {
    type: 'mention',
    name: `matrix-${agentId}.txt`,
    path: `C:/workspace/matrix-${agentId}.txt`,
  }]
}

function openCodeUserContent() {
  const agentId = 'opencode' as const
  return [{
    id: `text-${agentId}`,
    messageID: `user-${agentId}`,
    sessionID: sessionId(agentId),
    text: prompt(agentId),
    type: 'text',
  }, {
    id: `image-${agentId}`,
    messageID: `user-${agentId}`,
    sessionID: sessionId(agentId),
    filename: `matrix-${agentId}.png`,
    mime: 'image/png',
    type: 'file',
    url: `https://example.com/matrix-${agentId}.png`,
  }, {
    id: `file-${agentId}`,
    messageID: `user-${agentId}`,
    sessionID: sessionId(agentId),
    filename: `matrix-${agentId}.txt`,
    mime: 'text/plain',
    type: 'file',
    url: `file:///C:/workspace/matrix-${agentId}.txt`,
  }, {
    id: `synthetic-${agentId}`,
    messageID: `user-${agentId}`,
    sessionID: sessionId(agentId),
    synthetic: true,
    text: `matrix-synthetic-${agentId}`,
    type: 'text',
  }]
}

function fileChanges(agentId: BbAgentId): BbNativeFileChange[] {
  return [{
    kind: 'created',
    path: `src/${agentId}-created.ts`,
    diff: '+created',
  }, {
    kind: 'updated',
    path: `src/${agentId}-updated.ts`,
    diff: LONG_DIFF,
  }, {
    kind: 'deleted',
    path: `src/${agentId}-deleted.ts`,
    diff: '-deleted',
  }, {
    kind: 'renamed',
    path: `src/${agentId}-before.ts`,
    movePath: `src/${agentId}-after.ts`,
  }]
}

function codexSnapshot(): BbNativeSessionSnapshot {
  const agentId = 'codex' as const
  const changes = fileChanges(agentId)
  return {
    agentId,
    itemRuntime: {
      'command-success': {
        output: 'matrix-command-success-codex',
        terminalInput: 'matrix-terminal-input-codex',
      },
      'child-tool': { output: 'matrix-nested-child-codex' },
    },
    status: { type: 'busy' },
    thread: {
      createdAt: 1_700_000_000,
      id: sessionId(agentId),
      turns: [{
        id: `turn-${agentId}`,
        startedAt: 1_700_000_001,
        status: 'in_progress',
        items: [{
          clientId: `user-${agentId}`,
          content: codexUserContent(),
          id: `user-${agentId}`,
          type: 'userMessage',
        }, {
          id: `assistant-${agentId}`,
          text: markdown(agentId),
          type: 'agentMessage',
        }, {
          content: ['matrix-reasoning-codex'],
          id: 'reasoning-codex',
          summary: ['matrix-reasoning-summary-codex'],
          type: 'reasoning',
        }, {
          command: 'npm test',
          id: 'command-success',
          status: 'completed',
          type: 'commandExecution',
        }, {
          aggregatedOutput: 'matrix-command-failure-codex',
          command: 'exit 1',
          exitCode: 1,
          id: 'command-failure',
          status: 'failed',
          type: 'commandExecution',
        }, {
          arguments: { marker: 'matrix-tool-input-codex' },
          contentItems: [{ type: 'inputText', text: 'matrix-tool-success-codex' }],
          id: 'parent-tool',
          status: 'completed',
          tool: 'matrix_tool',
          type: 'dynamicToolCall',
        }, {
          arguments: { marker: 'matrix-tool-failure-codex' },
          contentItems: [{ type: 'inputText', text: 'matrix-tool-failure-result-codex' }],
          id: 'failed-tool',
          status: 'failed',
          success: false,
          tool: 'matrix_failed_tool',
          type: 'dynamicToolCall',
        }, {
          agentsStates: { child: 'completed' },
          id: 'delegation-codex',
          prompt: 'matrix-delegation-codex',
          receiverThreadIds: ['child-thread'],
          status: 'completed',
          tool: 'spawnAgent',
          type: 'collabAgentToolCall',
        }, {
          arguments: { marker: 'matrix-unknown-tool-codex' },
          contentItems: null,
          id: 'child-tool',
          parentToolCallId: 'delegation-codex',
          status: 'completed',
          tool: 'future_tool',
          type: 'dynamicToolCall',
        }, {
          agentPath: 'matrix-nested-work-codex',
          agentThreadId: 'matrix-subagent-thread-codex',
          id: 'subagent-codex',
          kind: 'started',
          parentToolCallId: 'delegation-codex',
          status: 'completed',
          type: 'subAgentActivity',
        }, {
          changes,
          id: 'files-codex',
          status: 'completed',
          type: 'fileChange',
        }, {
          id: 'plan-codex',
          text: '- [x] matrix-plan-codex',
          type: 'plan',
        }, {
          id: 'unknown-codex',
          payload: { marker: 'matrix-unknown-native-codex' },
          type: 'futureCodexEvent',
        }],
      }],
    },
    turnRuntime: {
      'turn-codex': {
        diff: LONG_DIFF,
        plan: { steps: [{ status: 'completed', step: 'matrix-runtime-plan-codex' }] },
      },
    },
  }
}

function openCodeSnapshot(): BbNativeSessionSnapshot {
  const agentId = 'opencode' as const
  return {
    agentId,
    diffs: fileChanges(agentId).map((change) => ({
      diff: change.diff,
      file: change.path,
      movePath: change.movePath,
      status: change.kind,
    })),
    messages: [{
      info: { id: `user-${agentId}`, role: 'user', time: { created: 1_700_000_000_000 } },
      parts: openCodeUserContent(),
    }, {
      info: { id: `assistant-${agentId}`, role: 'assistant', time: { created: 1_700_000_000_100 } },
      parts: [{ id: 'text-opencode', text: markdown(agentId), type: 'text' }, {
        id: 'reasoning-opencode',
        text: 'matrix-reasoning-opencode',
        type: 'reasoning',
      }, {
        id: 'command-success-opencode',
        state: {
          input: {
            command: 'npm test',
            terminalInput: 'matrix-terminal-input-opencode',
          },
          output: 'matrix-command-success-opencode',
          status: 'completed',
        },
        tool: 'bash',
        type: 'tool',
      }, {
        id: 'command-failure-opencode',
        state: {
          error: 'matrix-command-failure-opencode',
          input: { command: 'exit 1' },
          metadata: { exitCode: 1 },
          status: 'failed',
        },
        tool: 'bash',
        type: 'tool',
      }, {
        id: 'parent-tool-opencode',
        state: {
          attachments: [{
            id: 'tool-attachment-opencode',
            messageID: `assistant-${agentId}`,
            sessionID: sessionId(agentId),
            filename: 'matrix-tool-attachment-opencode.txt',
            mime: 'text/plain',
            type: 'file',
            url: 'file:///C:/workspace/matrix-tool-attachment-opencode.txt',
          }],
          input: { marker: 'matrix-tool-input-opencode' },
          metadata: {},
          output: 'matrix-tool-success-opencode',
          status: 'completed',
          time: { start: 1_700_000_000_110, end: 1_700_000_000_120 },
          title: 'Matrix tool',
        },
        tool: 'matrix_tool',
        type: 'tool',
      }, {
        id: 'failed-tool-opencode',
        state: {
          error: 'matrix-tool-failure-opencode',
          input: { marker: 'matrix-tool-failure-input-opencode' },
          status: 'failed',
        },
        tool: 'matrix_failed_tool',
        type: 'tool',
      }, {
        id: 'unknown-tool-opencode',
        state: {
          input: { marker: 'matrix-unknown-tool-opencode' },
          output: 'matrix-nested-child-opencode',
          status: 'completed',
        },
        tool: 'future_tool',
        type: 'tool',
      }, {
        id: 'delegation-opencode',
        state: {
          input: { prompt: 'matrix-delegation-opencode' },
          output: 'matrix-delegation-result-opencode',
          status: 'completed',
        },
        tool: 'task',
        type: 'tool',
      }, {
        id: 'nested-child-opencode',
        state: {
          input: { marker: 'matrix-nested-child-input-opencode' },
          output: 'matrix-nested-child-opencode',
          status: 'completed',
        },
        tool: 'future_child_tool',
        type: 'tool',
      }, {
        description: 'matrix-nested-work-opencode',
        id: 'subtask-opencode',
        prompt: 'matrix-subtask-prompt-opencode',
        type: 'subtask',
      }, {
        id: 'unknown-opencode',
        marker: 'matrix-unknown-native-opencode',
        type: 'futureOpenCodePart',
      }, {
        id: 'retry-opencode',
        attempt: 2,
        error: { message: 'matrix-native-retry-opencode' },
        type: 'retry',
      }, {
        id: 'compaction-opencode',
        type: 'compaction',
      }],
    }],
    status: { type: 'busy' },
    todos: [{ content: 'matrix-plan-opencode', status: 'completed' }],
  }
}

function piSnapshot(agentId: 'pi' | 'builtin-pi'): BbNativeSessionSnapshot {
  return {
    agentId,
    entryIds: [
      `user-${agentId}`,
      `assistant-${agentId}`,
      `tool-success-${agentId}`,
      `tool-failure-${agentId}`,
      `bash-${agentId}`,
      `compaction-${agentId}`,
      `unknown-role-${agentId}`,
    ],
    messages: [{
      content: [{
        type: 'text',
        text: `${prompt(agentId)}\n\nAttachments:\n- ${JSON.stringify({
          fileName: `matrix-${agentId}.txt`,
          kind: 'file',
          path: `C:/workspace/matrix-${agentId}.txt`,
          status: 'referenced',
        })}`,
      }, {
        source: { url: `https://example.com/matrix-${agentId}.png` },
        type: 'image',
      }],
      role: 'user',
      timestamp: 1_700_000_000_000,
    }, {
      content: [{ text: markdown(agentId), type: 'text' }, {
        thinking: `matrix-reasoning-${agentId}`,
        type: 'thinking',
      }, {
        input: {
          command: 'npm test',
          stdin: `matrix-terminal-input-${agentId}`,
        },
        toolCallId: `command-${agentId}`,
        toolName: 'bash',
        type: 'toolCall',
      }, {
        input: { marker: `matrix-tool-input-${agentId}` },
        toolCallId: `tool-success-${agentId}`,
        toolName: 'matrix_tool',
        type: 'toolCall',
      }, {
        input: { marker: `matrix-tool-failure-input-${agentId}` },
        toolCallId: `tool-failure-${agentId}`,
        toolName: 'matrix_failed_tool',
        type: 'toolCall',
      }, {
        input: { prompt: `matrix-delegation-${agentId}` },
        toolCallId: `delegation-${agentId}`,
        toolName: 'spawn_agent',
        type: 'toolCall',
      }, {
        input: { marker: `matrix-unknown-tool-${agentId}` },
        parentToolCallId: `delegation-${agentId}`,
        toolCallId: `unknown-tool-${agentId}`,
        toolName: 'future_tool',
        type: 'toolCall',
      }, {
        marker: `matrix-unknown-native-${agentId}`,
        type: 'futurePiBlock',
      }],
      role: 'assistant',
      timestamp: 1_700_000_000_100,
    }, {
      content: [{ text: `matrix-tool-success-${agentId}`, type: 'text' }],
      role: 'toolResult',
      toolCallId: `tool-success-${agentId}`,
      toolName: 'matrix_tool',
    }, {
      content: [{ text: `matrix-tool-failure-${agentId}`, type: 'text' }],
      isError: true,
      role: 'toolResult',
      toolCallId: `tool-failure-${agentId}`,
      toolName: 'matrix_failed_tool',
    }, {
      content: [{ text: `matrix-delegation-result-${agentId}`, type: 'text' }],
      role: 'toolResult',
      toolCallId: `delegation-${agentId}`,
      toolName: 'spawn_agent',
    }, {
      command: 'printf matrix',
      output: `matrix-command-success-${agentId}`,
      role: 'bashExecution',
      stdin: `matrix-bash-terminal-input-${agentId}`,
    }, {
      role: 'compactionSummary',
      summary: `matrix-plan-${agentId}`,
    }, {
      payload: { marker: `matrix-unknown-role-${agentId}` },
      role: 'futurePiRole',
    }],
    sessionId: sessionId(agentId),
  }
}

function snapshot(agentId: BbAgentId): BbNativeSessionSnapshot {
  if (agentId === 'codex') return codexSnapshot()
  if (agentId === 'opencode') return openCodeSnapshot()
  return piSnapshot(agentId)
}

function interactions(agentId: BbAgentId): BbInteractionTimelineRecord[] {
  return [{
    request: {
      fields: [{
        id: `field-${agentId}`,
        label: `matrix-question-${agentId}`,
        options: [{ id: 'yes', label: `matrix-answer-${agentId}` }],
      }],
      id: `question-${agentId}`,
      kind: 'question',
      message: `matrix-question-${agentId}`,
      options: [],
      sessionId: sessionId(agentId),
      title: `matrix-question-title-${agentId}`,
    },
    requestedAt: 1_700_000_000_200,
    resolvedAt: 1_700_000_000_201,
    response: {
      answers: { [`field-${agentId}`]: ['yes'] },
      optionId: 'submit',
    },
    status: 'resolved',
  }, {
    request: {
      id: `permission-${agentId}`,
      kind: 'permission',
      message: `matrix-permission-${agentId}`,
      options: [{ id: 'allow', label: 'Allow' }],
      sessionId: sessionId(agentId),
      title: `matrix-permission-title-${agentId}`,
    },
    requestedAt: 1_700_000_000_202,
    status: 'pending',
  }]
}

function project(agentId: BbAgentId, runtimeState?: BbSessionRuntimeState) {
  return projectNativeSession({
    fileChanges: fileChanges(agentId),
    interactionRecords: interactions(agentId),
    optimisticMessages: [{
      id: `user-${agentId}`,
      text: prompt(agentId),
      timestamp: 1_700_000_000_000,
    }, {
      id: `pending-${agentId}`,
      text: `matrix-optimistic-${agentId}`,
      timestamp: 1_700_000_000_300,
    }],
    runtimeState,
    sessionId: sessionId(agentId),
    snapshot: snapshot(agentId),
    workspacePath: 'C:/workspace',
  })
}

describe('bb unified provider acceptance matrix', () => {
  it.each(AGENT_IDS)('preserves the user-facing conversation vocabulary for %s', (agentId) => {
    const result = project(agentId)
    const rows = flattenRows(result.rows)
    const serialized = JSON.stringify(rows)
    const userRows = rows.filter((row) => (
      row.kind === 'conversation' && row.role === 'user' && row.text === prompt(agentId)
    ))
    const assistantRows = rows.filter((row) => (
      row.kind === 'conversation' && row.role === 'assistant' && row.text === markdown(agentId)
    ))

    expect(userRows).toHaveLength(1)
    expect(assistantRows).toHaveLength(1)
    expect(serialized).toContain(`https://example.com/matrix-${agentId}.png`)
    expect(serialized).toContain(`C:/workspace/matrix-${agentId}.txt`)
    expect(serialized).toContain(`matrix-command-success-${agentId}`)
    expect(serialized).toContain(`matrix-tool-success-${agentId}`)
    expect(serialized).toContain(`matrix-tool-failure-${agentId}`)
    expect(serialized).toContain(`matrix-unknown-tool-${agentId}`)
    expect(serialized).toContain(`src/${agentId}-created.ts`)
    expect(serialized).toContain(`src/${agentId}-updated.ts`)
    expect(serialized).toContain(`src/${agentId}-deleted.ts`)
    expect(serialized).toContain(`src/${agentId}-before.ts`)
    expect(serialized).toContain(`src/${agentId}-after.ts`)
    expect(serialized).toContain('matrix line 100')
    expect(serialized).toContain(`matrix-plan-${agentId}`)
    expect(serialized).toContain(`matrix-delegation-${agentId}`)
    expect(serialized).toContain(agentId === 'codex'
      ? 'matrix-nested-child-codex'
      : agentId === 'opencode'
        ? 'matrix-nested-child-opencode'
        : `matrix-unknown-tool-${agentId}`)
    expect(serialized).toContain(`matrix-question-${agentId}`)
    expect(serialized).toContain(`matrix-answer-${agentId}`)
    expect(serialized).toContain(`matrix-permission-title-${agentId}`)
    expect(serialized).not.toContain(`matrix-unknown-native-${agentId}`)
    if (agentId === 'opencode') {
      expect(serialized).toContain('matrix-tool-attachment-opencode.txt')
      expect(serialized).not.toContain('matrix-synthetic-opencode')
    }
    expect(serialized).toContain(`matrix-optimistic-${agentId}`)
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'work', workKind: 'question' }),
      expect.objectContaining({ kind: 'work', workKind: 'approval' }),
    ]))
    expect(serialized).not.toContain('"operationKind":"provider-unhandled"')
    expect(count(serialized, `matrix-optimistic-${agentId}`)).toBeGreaterThan(0)
  })

  it.each(AGENT_IDS)('covers idle, streaming, stopping, error, and retry lifecycle for %s', (agentId) => {
    const idle = projectNativeSession({
      fileChanges: [],
      optimisticMessages: [],
      sessionId: sessionId(agentId),
      snapshot: agentId === 'codex'
        ? { agentId, thread: { id: sessionId(agentId), turns: [] } }
        : agentId === 'opencode'
          ? { agentId, messages: [] }
          : { agentId, messages: [], sessionId: sessionId(agentId) },
    })
    const streaming = project(agentId, { isStreaming: true })
    const stopping = project(agentId, { isStopping: true, isStreaming: true, stoppingAnchorAt: 42 })
    const errored = project(agentId, { error: `matrix-runtime-error-${agentId}` })
    const retrying = project(agentId, {
      executionState: { attempt: 2, message: `matrix-retry-${agentId}`, type: 'retry' },
      retryMaxAttempts: 4,
    })

    expect(idle).toMatchObject({ rows: [], runtimeStatus: 'idle' })
    expect(streaming.runtimeStatus).toBe('active')
    expect(stopping).toMatchObject({
      isStopping: true,
      runtimeStatus: 'stopping',
      stoppingAnchorAt: 42,
    })
    expect(errored.runtimeStatus).toBe('error')
    expect(JSON.stringify(errored.rows)).toContain(`matrix-runtime-error-${agentId}`)
    expect(retrying.runtimeStatus).toBe('active')
    expect(JSON.stringify(retrying.rows)).toContain(`matrix-retry-${agentId}`)
  })
})
