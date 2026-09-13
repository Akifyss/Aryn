import { expect, it, vi } from 'vitest'

const execute = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', () => ({ execFile: execute }))
import { inspectTerminalProcesses, parseTerminalProcesses, terminalProcessActivity } from '../electron/main/terminal/terminal-processes'

it('does not mistake ConPTY helpers for work, but keeps their children and background jobs', () => {
  const rows = [
    { pid: 1, parentPid: 0, name: 'pwsh.exe', started: 100 },
    { pid: 2, parentPid: 1, name: 'conhost.exe', started: 101 },
    { pid: 3, parentPid: 2, name: 'node.exe', started: 102 },
    { pid: 4, parentPid: 1, name: 'pwsh.exe', started: 103 },
    { pid: 5, parentPid: 1, name: 'old-unrelated.exe', started: 90 },
  ]
  expect(terminalProcessActivity(1, rows.slice(0, 2), 'win32').status).toBe('idle')
  expect(terminalProcessActivity(1, rows, 'win32')).toEqual({ status: 'busy', processes: ['pwsh.exe', 'node.exe'] })
})
it('handles macOS/Linux process paths, stopped jobs, zombies, and unrelated processes', () => {
  const rows = parseTerminalProcesses(' 10 1 S /bin/zsh\n11 10 T /usr/bin/vim\n12 10 Z defunct\n13 99 S other\n14 11 S /usr/bin/python3\n', 'darwin')
  expect(terminalProcessActivity(10, rows, 'darwin')).toEqual({ status: 'busy', processes: ['vim', 'python3'] })
  expect(terminalProcessActivity(99, rows, 'darwin').status).toBe('unknown')
})
it('rejects malformed or incomplete snapshots instead of assuming idle', () => {
  expect(() => parseTerminalProcesses('[{"ProcessId":1}]', 'win32')).toThrow()
  expect(() => parseTerminalProcesses('ps: permission denied', 'linux')).toThrow()
  expect(terminalProcessActivity(10, [], 'win32').status).toBe('unknown')
  expect(parseTerminalProcesses('{"ProcessId":1,"ParentProcessId":0,"Name":"pwsh.exe","Started":123}', 'win32'))
    .toEqual([{ pid: 1, parentPid: 0, name: 'pwsh.exe', started: 123 }])
})
it('bounds and sanitizes process labels, and terminates traversal even with a malformed cycle', () => {
  const rows = [{ pid: 1, parentPid: 2, name: 'shell' }, { pid: 2, parentPid: 1, name: 'evil\n\u001bname' }]
  expect(terminalProcessActivity(1, rows, 'linux')).toEqual({ status: 'busy', processes: ['evilname'] })
})
it('bounds and hides OS probes; errors and timeouts remain unknown', async () => {
  execute.mockImplementation((_file, _args, _options, callback) => callback(new Error('timeout'), '', ''))
  const controller = new AbortController()
  expect(await inspectTerminalProcesses(123, controller.signal)).toEqual({ status: 'unknown', processes: [] })
  expect(execute.mock.calls.at(-1)?.[2]).toMatchObject({ timeout: 2500, windowsHide: true, signal: controller.signal })
})
