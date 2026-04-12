import { readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type {
  AgentMessageFileChange,
  AgentSessionAnnotations,
} from '../../src/features/agent/types'
import { mergeAgentMessageFileChangeKind } from '../../src/features/agent/file-change-utils'

const EMPTY_ANNOTATIONS: AgentSessionAnnotations = {
  fileChangesByEntryId: {},
}

type StoredAgentSessionAnnotations = {
  fileChangesByEntryId?: Record<string, Array<Partial<AgentMessageFileChange> | null> | null>
  version?: number
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

function normalizeAnnotations(value: unknown): AgentSessionAnnotations {
  if (!value || typeof value !== 'object') {
    return cloneAnnotations(EMPTY_ANNOTATIONS)
  }

  const storedValue = value as StoredAgentSessionAnnotations
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
  }
}

function getStoredAnnotationsPath(sessionPath: string) {
  return `${sessionPath}.annotations.json`
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
  private readonly cache = new Map<string, AgentSessionAnnotations>()
  private readonly writes = new Map<string, Promise<void>>()

  async read(sessionPath: string): Promise<AgentSessionAnnotations> {
    const resolvedSessionPath = path.resolve(sessionPath)
    const cachedValue = this.cache.get(resolvedSessionPath)

    if (cachedValue) {
      return cachedValue
    }

    try {
      const rawContent = await readFile(getStoredAnnotationsPath(resolvedSessionPath), 'utf8')
      const parsedValue = normalizeAnnotations(JSON.parse(rawContent))
      this.cache.set(resolvedSessionPath, parsedValue)
      return parsedValue
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }

      const emptyValue = cloneAnnotations(EMPTY_ANNOTATIONS)
      this.cache.set(resolvedSessionPath, emptyValue)
      return emptyValue
    }
  }

  async recordFileChange(
    sessionPath: string,
    entryId: string,
    change: AgentMessageFileChange,
  ): Promise<AgentSessionAnnotations> {
    const resolvedSessionPath = path.resolve(sessionPath)
    const currentAnnotations = await this.read(resolvedSessionPath)
    const nextAnnotations = upsertAgentSessionFileChange(currentAnnotations, entryId, change)

    if (nextAnnotations === currentAnnotations) {
      return currentAnnotations
    }

    this.cache.set(resolvedSessionPath, nextAnnotations)
    await this.queueWrite(resolvedSessionPath, nextAnnotations)
    return nextAnnotations
  }

  async delete(sessionPath: string) {
    const resolvedSessionPath = path.resolve(sessionPath)
    this.cache.delete(resolvedSessionPath)
    this.writes.delete(resolvedSessionPath)

    await rm(getStoredAnnotationsPath(resolvedSessionPath), {
      force: true,
    }).catch((error) => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
    })
  }

  private async queueWrite(sessionPath: string, annotations: AgentSessionAnnotations) {
    const nextWrite = (this.writes.get(sessionPath) ?? Promise.resolve())
      .catch(() => undefined)
      .then(async () => {
        await writeFile(
          getStoredAnnotationsPath(sessionPath),
          JSON.stringify({
            fileChangesByEntryId: annotations.fileChangesByEntryId,
            version: 1,
          }, null, 2),
          'utf8',
        )
      })

    this.writes.set(sessionPath, nextWrite)
    await nextWrite
  }
}
