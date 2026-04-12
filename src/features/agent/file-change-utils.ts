import type {
  AgentMessageFileChange,
  AgentMessageFileChangeKind,
} from './types'

export function mergeAgentMessageFileChangeKind(
  previousKind: AgentMessageFileChangeKind | undefined,
  nextKind: AgentMessageFileChangeKind,
): AgentMessageFileChangeKind | null {
  if (!previousKind) {
    return nextKind
  }

  if (previousKind === 'created') {
    return nextKind === 'deleted' ? null : 'created'
  }

  if (previousKind === 'deleted') {
    return nextKind === 'created' || nextKind === 'updated' ? 'updated' : 'deleted'
  }

  return nextKind === 'deleted' ? 'deleted' : 'updated'
}

export function mergeFileChangesByPath(fileChanges: AgentMessageFileChange[]) {
  const mergedChanges = new Map<string, AgentMessageFileChange>()

  for (const change of fileChanges) {
    const previousChange = mergedChanges.get(change.filePath)
    const nextKind = mergeAgentMessageFileChangeKind(previousChange?.kind, change.kind)

    if (!nextKind) {
      mergedChanges.delete(change.filePath)
      continue
    }

    mergedChanges.set(change.filePath, {
      filePath: change.filePath,
      kind: nextKind,
    })
  }

  return [...mergedChanges.values()]
}
