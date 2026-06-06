import type { AgentSessionListItem } from '@/features/agent/types'
import type { WorkspaceNode } from '@/features/workspace/types'

export const COMMAND_PALETTE_MAX_RESULTS_PER_SECTION = 30

export type CommandPaletteResultCategory = 'file' | 'session'

export type CommandPaletteFileResult = {
  category: 'file'
  description: string
  fileName: string
  id: string
  label: string
  path: string
}

export type CommandPaletteSessionResult = {
  category: 'session'
  description?: string
  id: string
  label: string
  path: string
}

export type CommandPaletteResult = CommandPaletteFileResult | CommandPaletteSessionResult

export type CommandPaletteResultSection = {
  category: CommandPaletteResultCategory
  items: CommandPaletteResult[]
  label: string
}

export function flattenCommandPaletteFiles(nodes: WorkspaceNode[]) {
  const list: WorkspaceNode[] = []

  function visit(nextNodes: WorkspaceNode[]) {
    nextNodes.forEach((node) => {
      if (node.kind === 'file') {
        list.push(node)
      }

      if (node.children) {
        visit(node.children)
      }
    })
  }

  visit(nodes)
  return list
}

function normalizeQuery(query: string) {
  return query.trim().toLowerCase()
}

function includesQuery(query: string, values: Array<string | null | undefined>) {
  if (!query) {
    return true
  }

  return values.some((value) => value?.toLowerCase().includes(query))
}

function getSessionLabel(session: AgentSessionListItem) {
  return session.name?.trim() || '未命名会话'
}

function normalizeDisplayText(value: string) {
  return value.trim().toLowerCase()
}

function getSessionDescription(session: AgentSessionListItem, label: string) {
  const preview = session.preview?.trim()

  if (!preview || normalizeDisplayText(preview) === normalizeDisplayText(label)) {
    return undefined
  }

  return preview
}

export function buildCommandPaletteResultSections({
  files,
  maxItemsPerSection = COMMAND_PALETTE_MAX_RESULTS_PER_SECTION,
  query,
  sessions,
}: {
  files: WorkspaceNode[]
  maxItemsPerSection?: number
  query: string
  sessions: AgentSessionListItem[]
}): CommandPaletteResultSection[] {
  const normalizedQuery = normalizeQuery(query)
  const sections: CommandPaletteResultSection[] = []

  const sessionItems = sessions
    .filter((session) => (
      includesQuery(normalizedQuery, [
        session.name,
        session.preview,
      ])
    ))
    .slice(0, maxItemsPerSection)
    .map((session): CommandPaletteSessionResult => {
      const label = getSessionLabel(session)

      return {
        category: 'session',
        description: getSessionDescription(session, label),
        id: `session-${session.path}`,
        label,
        path: session.path,
      }
    })

  if (sessionItems.length > 0) {
    sections.push({
      category: 'session',
      items: sessionItems,
      label: '会话',
    })
  }

  const fileItems = flattenCommandPaletteFiles(files)
    .filter((file) => includesQuery(normalizedQuery, [file.name]))
    .slice(0, maxItemsPerSection)
    .map((file): CommandPaletteFileResult => ({
      category: 'file',
      description: file.path,
      fileName: file.name,
      id: `file-${file.path}`,
      label: file.name,
      path: file.path,
    }))

  if (fileItems.length > 0) {
    sections.push({
      category: 'file',
      items: fileItems,
      label: '文件',
    })
  }

  return sections
}
