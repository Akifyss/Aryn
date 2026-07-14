import path from 'node:path'
import { realpath } from 'node:fs/promises'

const READ_ONLY_TOOLS = new Set(['read', 'grep', 'find', 'ls'])

async function isPathInsideWorkspace(value, cwd) {
  if (typeof value !== 'string' || !value.trim()) return false
  let workspacePath
  let targetPath
  try {
    workspacePath = await realpath(path.resolve(cwd))
    targetPath = await realpath(path.resolve(workspacePath, value))
  } catch {
    return false
  }
  const relativePath = path.relative(workspacePath, targetPath)
  return relativePath === '' || (
    relativePath !== '..'
    && !relativePath.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relativePath)
  )
}

async function isWorkspaceReadOnlyCall(event, cwd) {
  if (!READ_ONLY_TOOLS.has(event.toolName)) return false
  const input = event.input && typeof event.input === 'object' ? event.input : {}
  const targetPath = input.path ?? input.filePath
  if ((targetPath === undefined || targetPath === null || targetPath === '') && event.toolName !== 'read') {
    return true
  }
  return isPathInsideWorkspace(targetPath, cwd)
}

function summarizeInput(input) {
  if (!input || typeof input !== 'object') return ''
  const priorityKeys = ['command', 'path', 'filePath', 'query', 'pattern']
  for (const key of priorityKeys) {
    if (typeof input[key] === 'string' && input[key].trim()) {
      return input[key].trim().slice(0, 800)
    }
  }

  try {
    return JSON.stringify(input).slice(0, 800)
  } catch {
    return ''
  }
}

export default function arynPermissionGate(pi) {
  pi.on('tool_call', async (event, ctx) => {
    if (await isWorkspaceReadOnlyCall(event, ctx.cwd)) return

    const detail = summarizeInput(event.input)
    const confirmed = await ctx.ui.confirm(
      `允许 PI 执行 ${event.toolName}？`,
      detail || '该工具可能修改文件、执行命令或访问外部资源。',
    )

    if (!confirmed) {
      return { block: true, reason: 'User denied this tool request in Aryn.' }
    }
  })
}
