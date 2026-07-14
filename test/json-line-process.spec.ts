import { describe, expect, it } from 'vitest'
import { JsonLineProcess } from '../electron/main/json-line-process'

describe('JsonLineProcess', () => {
  it('correlates split JSONL responses while delivering unrelated events', async () => {
    const events: Array<Record<string, unknown>> = []
    const childScript = [
      "let buffer = '';",
      "process.stdin.setEncoding('utf8');",
      "process.stdin.on('data', (chunk) => {",
      '  buffer += chunk;',
      "  const index = buffer.indexOf('\\n');",
      '  if (index < 0) return;',
      '  const request = JSON.parse(buffer.slice(0, index));',
      "  process.stdout.write(JSON.stringify({ type: 'notice', value: 1 }) + '\\n');",
      "  process.stdout.write('{\\\"id\\\":\\\"' + request.id);",
      "  setTimeout(() => process.stdout.write('\\\",\\\"success\\\":true,\\\"data\\\":{\\\"ok\\\":true}}\\n'), 5);",
      '});',
    ].join('\n')
    const processClient = new JsonLineProcess({
      args: ['-e', childScript],
      command: process.execPath,
      onEvent: (event) => events.push(event),
    })

    try {
      const response = await processClient.request({ type: 'ping' })
      expect(response.data).toEqual({ ok: true })
      expect(events).toContainEqual({ type: 'notice', value: 1 })
    } finally {
      processClient.stop()
    }
  })

  it('surfaces malformed protocol lines without poisoning the next response', async () => {
    const events: Array<Record<string, unknown>> = []
    const childScript = [
      "let buffer = '';",
      "process.stdin.setEncoding('utf8');",
      "process.stdin.on('data', (chunk) => {",
      '  buffer += chunk;',
      "  const index = buffer.indexOf('\\n');",
      '  if (index < 0) return;',
      '  const request = JSON.parse(buffer.slice(0, index));',
      "  process.stdout.write('not-json\\n');",
      "  process.stdout.write(JSON.stringify({ id: request.id, success: true }) + '\\n');",
      '});',
    ].join('\n')
    const processClient = new JsonLineProcess({
      args: ['-e', childScript],
      command: process.execPath,
      onEvent: (event) => events.push(event),
    })

    try {
      await expect(processClient.request({ type: 'ping' })).resolves.toMatchObject({ success: true })
      expect(events).toEqual([expect.objectContaining({ type: 'protocol_error' })])
    } finally {
      processClient.stop()
    }
  })

  it('reports non-object JSON protocol lines instead of silently dropping them', async () => {
    const events: Array<Record<string, unknown>> = []
    const childScript = [
      "process.stdin.setEncoding('utf8');",
      "process.stdin.once('data', (chunk) => {",
      '  const request = JSON.parse(chunk.trim());',
      "  process.stdout.write('[]\\n');",
      "  process.stdout.write(JSON.stringify({ id: request.id, success: true }) + '\\n');",
      '});',
    ].join('\n')
    const processClient = new JsonLineProcess({
      args: ['-e', childScript],
      command: process.execPath,
      onEvent: (event) => events.push(event),
    })

    try {
      await expect(processClient.request({ type: 'ping' })).resolves.toMatchObject({ success: true })
      expect(events).toEqual([
        expect.objectContaining({ message: expect.stringContaining('Non-object JSON'), type: 'protocol_error' }),
      ])
    } finally {
      processClient.stop()
    }
  })

  it('rejects a duplicate explicit request id without orphaning the original request', async () => {
    const childScript = [
      "process.stdin.setEncoding('utf8');",
      "process.stdin.once('data', (chunk) => {",
      '  const request = JSON.parse(chunk.trim());',
      "  setTimeout(() => process.stdout.write(JSON.stringify({ id: request.id, success: true }) + '\\n'), 20);",
      '});',
    ].join('\n')
    const processClient = new JsonLineProcess({
      args: ['-e', childScript],
      command: process.execPath,
      onEvent: () => undefined,
    })

    try {
      const firstRequest = processClient.request({ id: 'shared-id', type: 'first' })
      await expect(processClient.request({ id: 'shared-id', type: 'second' })).rejects.toThrow('already pending')
      await expect(firstRequest).resolves.toMatchObject({ id: 'shared-id', success: true })
    } finally {
      processClient.stop()
    }
  })

  it('contains event-handler failures and makes the connection terminal', async () => {
    const exits: string[] = []
    const childScript = [
      "process.stdin.once('data', () => {",
      "  process.stdout.write(JSON.stringify({ type: 'notice' }) + '\\n');",
      '});',
    ].join('\n')
    const processClient = new JsonLineProcess({
      args: ['-e', childScript],
      command: process.execPath,
      onEvent: () => {
        throw new Error('projection failed')
      },
      onExit: (error) => exits.push(error.message),
    })

    await expect(processClient.request({ type: 'ping' }, 5_000)).rejects.toThrow('event handler failed')
    expect(exits).toEqual([expect.stringContaining('projection failed')])
    await expect(processClient.request({ type: 'again' })).rejects.toThrow('event handler failed')
  })

  it('does not silently restart a stopped protocol process without adapter initialization', async () => {
    const childScript = [
      "process.stdin.setEncoding('utf8');",
      "process.stdin.on('data', (chunk) => {",
      "  const request = JSON.parse(chunk.trim());",
      "  process.stdout.write(JSON.stringify({ id: request.id, success: true }) + '\\n');",
      '});',
    ].join('\n')
    const processClient = new JsonLineProcess({
      args: ['-e', childScript],
      command: process.execPath,
      onEvent: () => undefined,
    })

    await expect(processClient.request({ type: 'first' })).resolves.toMatchObject({ success: true })
    processClient.stop()
    await expect(processClient.request({ type: 'second' })).rejects.toThrow('process was stopped')
  })

  it('reports an unexpected process exit once and keeps the connection terminal', async () => {
    const exits: string[] = []
    const processClient = new JsonLineProcess({
      args: ['-e', 'process.exit(7)'],
      command: process.execPath,
      onEvent: () => undefined,
      onExit: (error) => exits.push(error.message),
    })

    await expect(processClient.request({ type: 'ping' })).rejects.toThrow(/exited with code 7|EPIPE/)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(exits).toHaveLength(1)
    await expect(processClient.request({ type: 'again' })).rejects.toThrow()
  })

  it('fails pending requests immediately when a protocol line exceeds the configured safety limit', async () => {
    const events: Array<Record<string, unknown>> = []
    const childScript = [
      "process.stdin.once('data', () => {",
      "  process.stdout.write(JSON.stringify({ id: 'ignored', payload: 'x'.repeat(256) }) + '\\n');",
      '});',
    ].join('\n')
    const processClient = new JsonLineProcess({
      args: ['-e', childScript],
      command: process.execPath,
      maxProtocolLineLength: 128,
      onEvent: (event) => events.push(event),
    })

    try {
      await expect(processClient.request({ type: 'large-response' }, 5_000)).rejects.toThrow('Oversized')
      expect(events).toEqual([expect.objectContaining({ type: 'protocol_error' })])
    } finally {
      processClient.stop()
    }
  })
})
