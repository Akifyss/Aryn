import path from 'node:path'
import type { SessionEntry } from '@mariozechner/pi-coding-agent'
import type {
  AgentMessageFileChange,
  AgentSessionAnnotations,
} from '../../src/features/agent/types'

type DirectToolFileChangeKind = Extract<AgentMessageFileChange['kind'], 'created' | 'updated'>

function usesWindowsPathSemantics(...values: Array<string | undefined>) {
  return values.some((value) => (
    typeof value === 'string'
    && (/^[a-zA-Z]:/.test(value) || value.startsWith('\\\\'))
  ))
}

function getPathModule(...values: Array<string | undefined>) {
  return usesWindowsPathSemantics(...values) ? path.win32 : path
}

function unquoteShellToken(value: string) {
  if (
    (value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith('\'') && value.endsWith('\''))
  ) {
    return value.slice(1, -1)
  }

  return value
}

function tokenizeShellCommand(command: string) {
  const matches = command.match(/"[^"]*"|'[^']*'|[^\s]+/g)
  return matches?.map((token) => token.trim()).filter(Boolean) ?? []
}

function getOptionValue(tokens: string[], names: string[]) {
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]?.toLowerCase()

    if (!token || !names.includes(token)) {
      continue
    }

    const nextToken = tokens[index + 1]
    if (!nextToken || nextToken.startsWith('-')) {
      return null
    }

    return unquoteShellToken(nextToken)
  }

  return null
}

function resolveShellPath(cwd: string, candidate: string | null, relativeBasePath?: string) {
  if (!candidate) {
    return null
  }

  const normalizedCandidate = unquoteShellToken(candidate).trim()
  if (!normalizedCandidate || normalizedCandidate.startsWith('-')) {
    return null
  }

  const pathModule = getPathModule(cwd, normalizedCandidate, relativeBasePath)

  if (relativeBasePath && !/[\\/]/.test(normalizedCandidate) && !pathModule.isAbsolute(normalizedCandidate)) {
    return pathModule.resolve(pathModule.dirname(relativeBasePath), normalizedCandidate)
  }

  return pathModule.resolve(cwd, normalizedCandidate)
}

export function extractWritableToolFilePath(cwd: string, toolName: string, args: unknown) {
  if (!args || typeof args !== 'object') {
    return null
  }

  if (toolName !== 'write' && toolName !== 'edit') {
    return null
  }

  const candidate = (args as { path?: unknown }).path
  if (typeof candidate !== 'string' || !candidate.trim()) {
    return null
  }

  return getPathModule(cwd, candidate).resolve(cwd, candidate)
}

// This only recognizes explicit, top-level file commands. It intentionally
// avoids inferring side effects from arbitrary scripts or nested shell logic.
export function extractExplicitBashFileChanges(cwd: string, args: unknown): AgentMessageFileChange[] {
  if (!args || typeof args !== 'object') {
    return []
  }

  const command = (args as { command?: unknown }).command
  if (typeof command !== 'string' || !command.trim()) {
    return []
  }

  const changes: AgentMessageFileChange[] = []
  const segments = command
    .split(/\r?\n|&&|\|\||;/)
    .map((segment) => segment.trim())
    .filter(Boolean)

  for (const segment of segments) {
    const tokens = tokenizeShellCommand(segment)
    if (tokens.length === 0) {
      continue
    }

    const commandName = unquoteShellToken(tokens[0]).toLowerCase()

    if (commandName === 'rm' || commandName === 'del' || commandName === 'erase' || commandName === 'unlink') {
      tokens
        .slice(1)
        .filter((token) => token && !token.startsWith('-'))
        .forEach((token) => {
          const filePath = resolveShellPath(cwd, token)
          if (filePath) {
            changes.push({ filePath, kind: 'deleted' })
          }
        })
      continue
    }

    if (commandName === 'remove-item') {
      const candidate = getOptionValue(tokens, ['-path', '-literalpath'])
      const filePath = resolveShellPath(cwd, candidate)

      if (filePath) {
        changes.push({ filePath, kind: 'deleted' })
      }

      continue
    }

    if (commandName === 'mv' || commandName === 'move' || commandName === 'ren') {
      const positionalArgs = tokens.slice(1).filter((token) => token && !token.startsWith('-'))
      if (positionalArgs.length >= 2) {
        const sourcePath = resolveShellPath(cwd, positionalArgs[0])
        const targetPath = resolveShellPath(cwd, positionalArgs[1], sourcePath ?? undefined)

        if (sourcePath && targetPath) {
          changes.push({ filePath: sourcePath, kind: 'deleted' })
          changes.push({ filePath: targetPath, kind: 'created' })
        }
      }

      continue
    }

    if (commandName === 'move-item' || commandName === 'rename-item') {
      const sourcePath = resolveShellPath(cwd, getOptionValue(tokens, ['-path', '-literalpath']))
      const targetToken = getOptionValue(tokens, ['-destination', '-newname'])
      const targetPath = resolveShellPath(cwd, targetToken, sourcePath ?? undefined)

      if (sourcePath && targetPath) {
        changes.push({ filePath: sourcePath, kind: 'deleted' })
        changes.push({ filePath: targetPath, kind: 'created' })
      }
    }
  }

  return changes
}

export function resolveDirectToolFileChangeKind(
  toolName: string,
  existedBeforeWrite: boolean | null,
): DirectToolFileChangeKind | null {
  if (toolName === 'edit') {
    return 'updated'
  }

  if (toolName === 'write') {
    return existedBeforeWrite === false ? 'created' : 'updated'
  }

  return null
}

export function collectDirectToolPathsByEntryId(entries: SessionEntry[], cwd: string) {
  const filePathsByEntryId = new Map<string, Set<string>>()

  for (const entry of entries) {
    if (entry.type !== 'message' || !('role' in entry.message) || entry.message.role !== 'assistant') {
      continue
    }

    const toolCalls = entry.message.content.filter((block) => block.type === 'toolCall')
    if (toolCalls.length === 0) {
      continue
    }

    const entryPaths = filePathsByEntryId.get(entry.id) ?? new Set<string>()

    for (const toolCall of toolCalls) {
      const directFilePath = extractWritableToolFilePath(cwd, toolCall.name, toolCall.arguments)
      if (directFilePath) {
        entryPaths.add(directFilePath)
      }

      if (toolCall.name === 'bash') {
        extractExplicitBashFileChanges(cwd, toolCall.arguments).forEach((change) => {
          entryPaths.add(change.filePath)
        })
      }
    }

    if (entryPaths.size > 0) {
      filePathsByEntryId.set(entry.id, entryPaths)
    }
  }

  return filePathsByEntryId
}

export function filterAnnotationsByDirectToolPaths(
  annotations: AgentSessionAnnotations,
  directToolPathsByEntryId: Map<string, Set<string>>,
): AgentSessionAnnotations {
  return {
    fileChangesByEntryId: Object.fromEntries(
      Object.entries(annotations.fileChangesByEntryId)
        .map(([entryId, changes]) => {
          const allowedPaths = directToolPathsByEntryId.get(entryId)

          if (!allowedPaths) {
            return null
          }

          const filteredChanges = changes.filter((change) => allowedPaths.has(change.filePath))
          return filteredChanges.length > 0 ? [entryId, filteredChanges] : null
        })
        .filter((entry): entry is [string, AgentMessageFileChange[]] => entry !== null),
    ),
  }
}
