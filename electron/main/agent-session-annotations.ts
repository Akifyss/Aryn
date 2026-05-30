import { rm } from 'node:fs/promises'
import path from 'node:path'
import type {
  AgentMessageFileChange,
  AgentSessionAnnotations,
} from '../../src/features/agent/types'
import { mergeAgentMessageFileChangeKind } from '../../src/features/agent/file-change-utils'
import { AtomicJsonStore } from './json-file-store'

const AGENT_SESSION_ANNOTATIONS_SCHEMA_VERSION = 1
const EMPTY_ANNOTATIONS: AgentSessionAnnotations = {
  fileChangesByEntryId: {},
}

type StoredAgentSessionAnnotations = {
  fileChangesByEntryId: Record<string, AgentMessageFileChange[]>
  version: number
}

function isAgentMessageFileChangeKind(value: unknown): value is AgentMessageFileChange['kind'] {
  return value === 'created' || value === 'deleted' || value === 'updated'
}

function cloneAnnotations(annotations: AgentSessionAnnotations): AgentSessionAnnotations {
  return {
    fileChangesByEntryId: Object.fromEntries(
      Object.entries(annotations.fileChangesByEntryId).map(([entryId, changes]) => [
        entryId,
        changes.map((change) => ({ ...change })),
      ]),
    ),
  }
}

function normalizeAnnotations(value: unknown): StoredAgentSessionAnnotations {
  if (!value || typeof value !== 'object') {
    return createStoredAnnotations(EMPTY_ANNOTATIONS)
  }

  const storedValue = value as {
    fileChangesByEntryId?: Record<string, Array<Partial<AgentMessageFileChange> | null> | null>
  }
  const normalizedEntries = Object.fromEntries(
    Object.entries(storedValue.fileChangesByEntryId ?? {})
      .map(([entryId, changes]) => {
        if (!entryId.trim() || !Array.isArray(changes)) {
          return null
        }

        const normalizedChanges = changes
          .filter((change): change is Partial<AgentMessageFileChange> => Boolean(change) && typeof change === 'object')
          .map((change) => {
            const filePath = typeof change.filePath === 'string' ? change.filePath.trim() : ''
            const kind = change.kind

            if (!filePath || !isAgentMessageFileChangeKind(kind)) {
              return null
            }

            return {
              filePath,
              kind,
            }
          })
          .filter((change): change is AgentMessageFileChange => change !== null)

        return normalizedChanges.length > 0 ? [entryId, normalizedChanges] : null
      })
      .filter((entry): entry is [string, AgentMessageFileChange[]] => entry !== null),
  )

  return {
    fileChangesByEntryId: normalizedEntries,
    version: AGENT_SESSION_ANNOTATIONS_SCHEMA_VERSION,
  }
}

function getStoredAnnotationsPath(sessionPath: string) {
  return `${sessionPath}.annotations.json`
}

function createStoredAnnotations(annotations: AgentSessionAnnotations): StoredAgentSessionAnnotations {
  return {
    ...cloneAnnotations(annotations),
    version: AGENT_SESSION_ANNOTATIONS_SCHEMA_VERSION,
  }
}

function toClientAnnotations(annotations: StoredAgentSessionAnnotations): AgentSessionAnnotations {
  return {
    fileChangesByEntryId: cloneAnnotations(annotations).fileChangesByEntryId,
  }
}

export function upsertAgentSessionFileChange(
  annotations: AgentSessionAnnotations,
  entryId: string,
  change: AgentMessageFileChange,
): AgentSessionAnnotations {
  const normalizedEntryId = entryId.trim()
  const normalizedFilePath = change.filePath.trim()

  if (!normalizedEntryId || !normalizedFilePath) {
    return annotations
  }

  const currentChanges = annotations.fileChangesByEntryId[normalizedEntryId] ?? []
  const existingIndex = currentChanges.findIndex((candidate) => candidate.filePath === normalizedFilePath)
  const previousKind = existingIndex === -1 ? undefined : currentChanges[existingIndex]?.kind
  const mergedKind = mergeAgentMessageFileChangeKind(previousKind, change.kind)

  if (mergedKind === previousKind) {
    return annotations
  }

  const nextEntryChanges = [...currentChanges]

  if (mergedKind === null) {
    if (existingIndex === -1) {
      return annotations
    }

    nextEntryChanges.splice(existingIndex, 1)
  } else if (existingIndex === -1) {
    nextEntryChanges.push({
      filePath: normalizedFilePath,
      kind: mergedKind,
    })
  } else {
    nextEntryChanges[existingIndex] = {
      filePath: normalizedFilePath,
      kind: mergedKind,
    }
  }

  const nextFileChangesByEntryId = {
    ...annotations.fileChangesByEntryId,
  }

  if (nextEntryChanges.length === 0) {
    delete nextFileChangesByEntryId[normalizedEntryId]
  } else {
    nextFileChangesByEntryId[normalizedEntryId] = nextEntryChanges
  }

  return {
    fileChangesByEntryId: nextFileChangesByEntryId,
  }
}

export class AgentSessionAnnotationStore {
  private readonly stores = new Map<string, AtomicJsonStore<StoredAgentSessionAnnotations>>()

  async read(sessionPath: string): Promise<AgentSessionAnnotations> {
    const resolvedSessionPath = path.resolve(sessionPath)
    const annotations = await this.getStore(resolvedSessionPath).read()
    return toClientAnnotations(annotations)
  }

  async recordFileChange(
    sessionPath: string,
    entryId: string,
    change: AgentMessageFileChange,
  ): Promise<AgentSessionAnnotations> {
    const resolvedSessionPath = path.resolve(sessionPath)
    const nextStoredAnnotations = await this.getStore(resolvedSessionPath).update((currentState) => (
      createStoredAnnotations(upsertAgentSessionFileChange(
        toClientAnnotations(currentState),
        entryId,
        change,
      ))
    ))

    return toClientAnnotations(nextStoredAnnotations)
  }

  async delete(sessionPath: string) {
    const resolvedSessionPath = path.resolve(sessionPath)
    const annotationsPath = getStoredAnnotationsPath(resolvedSessionPath)
    this.stores.delete(resolvedSessionPath)

    await Promise.all([
      rm(annotationsPath, { force: true }),
      rm(`${annotationsPath}.bak`, { force: true }),
    ])
  }

  private getStore(sessionPath: string) {
    const resolvedSessionPath = path.resolve(sessionPath)
    const currentStore = this.stores.get(resolvedSessionPath)

    if (currentStore) {
      return currentStore
    }

    const nextStore = new AtomicJsonStore<StoredAgentSessionAnnotations>({
      defaultState: () => createStoredAnnotations(EMPTY_ANNOTATIONS),
      filePath: getStoredAnnotationsPath(resolvedSessionPath),
      normalize: normalizeAnnotations,
    })
    this.stores.set(resolvedSessionPath, nextStore)
    return nextStore
  }
}
