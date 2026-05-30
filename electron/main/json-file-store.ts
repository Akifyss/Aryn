import { randomUUID } from 'node:crypto'
import type { Dirent } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

const JSON_WRITE_TEMP_FILE_PATTERN = /^\.[^\\/]+\.json\.\d+\.\d+\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.tmp$/i
const DEFAULT_STALE_JSON_TEMP_FILE_AGE_MS = 60_000

function isFileSystemErrorWithCode(error: unknown, codes: string[]) {
  const code = error && typeof error === 'object' && 'code' in error
    ? (error as { code?: unknown }).code
    : null

  return typeof code === 'string' && codes.includes(code)
}

function isRetriableFileAccessError(error: unknown) {
  return isFileSystemErrorWithCode(error, ['EPERM', 'EACCES', 'EBUSY'])
}

function isMissingJsonFileError(error: unknown) {
  return isFileSystemErrorWithCode(error, ['ENOENT', 'ENOTDIR'])
}

function isMalformedJsonFileError(error: unknown) {
  return error instanceof SyntaxError
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function retryFileAccess<T>(operation: () => Promise<T>) {
  const retryDelays = [20, 50, 100, 200, 400]

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      if (!isRetriableFileAccessError(error) || attempt >= retryDelays.length) {
        throw error
      }

      await sleep(retryDelays[attempt])
    }
  }
}

async function renameWithRetry(sourcePath: string, targetPath: string) {
  await retryFileAccess(() => rename(sourcePath, targetPath))
}

async function writeFileWithRetry(filePath: string, value: string) {
  await retryFileAccess(() => writeFile(filePath, value, {
    encoding: 'utf8',
    mode: 0o600,
  }))
}

async function readJsonFileWithRetry(filePath: string) {
  const raw = await retryFileAccess(() => readFile(filePath, 'utf8'))
  return JSON.parse(raw) as unknown
}

function getJsonBackupFilePath(filePath: string) {
  return `${filePath}.bak`
}

function getJsonTempFileTimestamp(fileName: string) {
  if (!JSON_WRITE_TEMP_FILE_PATTERN.test(fileName)) {
    return null
  }

  const parts = fileName.split('.')
  const timestamp = Number(parts.at(-3))
  return Number.isFinite(timestamp) ? timestamp : null
}

function isStaleJsonTempFile(fileName: string, now: number, maxAgeMs: number) {
  const timestamp = getJsonTempFileTimestamp(fileName)
  return timestamp !== null && now - timestamp >= maxAgeMs
}

export async function cleanupStaleJsonTempFiles(
  directoryPath: string,
  options: { maxAgeMs?: number; recursive?: boolean } = {},
) {
  const now = Date.now()
  const maxAgeMs = Number.isFinite(options.maxAgeMs)
    ? Math.max(0, options.maxAgeMs ?? DEFAULT_STALE_JSON_TEMP_FILE_AGE_MS)
    : DEFAULT_STALE_JSON_TEMP_FILE_AGE_MS
  const recursive = options.recursive ?? false

  async function cleanupDirectory(currentDirectoryPath: string): Promise<number> {
    let entries: Dirent[]

    try {
      entries = await readdir(currentDirectoryPath, { withFileTypes: true })
    } catch (error) {
      if (isMissingJsonFileError(error)) {
        return 0
      }

      throw error
    }

    const removedCounts = await Promise.all(entries.map(async (entry) => {
      const entryPath = path.join(currentDirectoryPath, entry.name)

      if (entry.isFile()) {
        if (!isStaleJsonTempFile(entry.name, now, maxAgeMs)) {
          return 0
        }

        try {
          await rm(entryPath, { force: true })
          return 1
        } catch {
          return 0
        }
      }

      if (recursive && entry.isDirectory()) {
        return cleanupDirectory(entryPath)
      }

      return 0
    }))

    return removedCounts.reduce((sum, count) => sum + count, 0)
  }

  return cleanupDirectory(directoryPath)
}

async function cleanupStaleJsonTempFilesBestEffort(directoryPath: string) {
  try {
    await cleanupStaleJsonTempFiles(directoryPath)
  } catch {
    // Stale temp files should not block the state write that would replace them.
  }
}

async function preserveExistingJsonFileBackup(filePath: string) {
  try {
    const currentValue = await retryFileAccess(() => readFile(filePath, 'utf8'))
    JSON.parse(currentValue)
    await writeFileWithRetry(getJsonBackupFilePath(filePath), currentValue)
  } catch (error) {
    if (!isMissingJsonFileError(error)) {
      throw error
    }
  }
}

async function preserveExistingJsonFileBackupBestEffort(filePath: string) {
  try {
    await preserveExistingJsonFileBackup(filePath)
  } catch {
    // The primary write path is still atomic via temp file + rename. A missing
    // backup should not block saving fresh state if the target can be replaced.
  }
}

export type PersistedJsonReadResult =
  | { found: false; source: null; value: null }
  | { found: true; source: 'backup' | 'primary'; value: unknown }

export async function readPersistedJsonFile(filePath: string): Promise<PersistedJsonReadResult> {
  try {
    return {
      found: true as const,
      source: 'primary' as const,
      value: await readJsonFileWithRetry(filePath),
    }
  } catch (error) {
    if (isMissingJsonFileError(error)) {
      return {
        found: false as const,
        source: null,
        value: null,
      }
    }

    if (isMalformedJsonFileError(error)) {
      try {
        return {
          found: true as const,
          source: 'backup' as const,
          value: await readJsonFileWithRetry(getJsonBackupFilePath(filePath)),
        }
      } catch {
        throw error
      }
    }

    throw error
  }
}

export async function writeJsonFileAtomic(filePath: string, value: unknown) {
  const directoryPath = path.dirname(filePath)
  const temporaryFilePath = path.join(directoryPath, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`)
  const serializedValue = `${JSON.stringify(value, null, 2)}\n`

  await mkdir(directoryPath, { mode: 0o700, recursive: true })
  await cleanupStaleJsonTempFilesBestEffort(directoryPath)

  try {
    await writeFileWithRetry(temporaryFilePath, serializedValue)
    await preserveExistingJsonFileBackupBestEffort(filePath)
    try {
      await renameWithRetry(temporaryFilePath, filePath)
    } catch (error) {
      if (process.platform !== 'win32' || !isRetriableFileAccessError(error)) {
        throw error
      }

      // Windows can reject replacing an existing file even after the temp file
      // is fully written. After bounded retries, write the already-serialized
      // payload directly so the logical state update can still complete.
      await preserveExistingJsonFileBackupBestEffort(filePath)
      await writeFileWithRetry(filePath, serializedValue)
      await rm(temporaryFilePath, { force: true }).catch(() => undefined)
    }
  } catch (error) {
    await rm(temporaryFilePath, { force: true }).catch(() => undefined)
    throw error
  }
}

export type AtomicJsonStoreMissingResult<TState> = {
  persist?: boolean
  state: TState
}

export type AtomicJsonStoreOptions<TState> = {
  defaultState: () => TState
  filePath: string
  loadMissing?: () => Promise<AtomicJsonStoreMissingResult<TState> | null>
  normalize: (value: unknown) => TState
}

export class AtomicJsonStore<TState> {
  private cachedState: TState | null = null
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(private readonly options: AtomicJsonStoreOptions<TState>) {}

  async read() {
    await this.writeQueue.catch(() => undefined)
    return structuredClone(await this.getCachedState())
  }

  async update(updater: (currentState: TState) => TState) {
    let nextState: TState | null = null

    this.writeQueue = this.writeQueue
      .catch(() => undefined)
      .then(async () => {
        nextState = this.options.normalize(updater(structuredClone(await this.getCachedState())))
        await writeJsonFileAtomic(this.options.filePath, nextState)
        this.cachedState = nextState
      })

    await this.writeQueue
    return structuredClone(nextState!)
  }

  private async getCachedState() {
    if (!this.cachedState) {
      this.cachedState = await this.load()
    }

    return this.cachedState
  }

  private async load() {
    const persistedJson = await readPersistedJsonFile(this.options.filePath)

    if (!persistedJson.found) {
      const missingState = await this.options.loadMissing?.()
      const nextState = this.options.normalize(missingState?.state ?? this.options.defaultState())

      if (missingState?.persist) {
        await this.persistRecoveredState(nextState)
      }

      return nextState
    }

    const nextState = this.options.normalize(persistedJson.value)

    if (persistedJson.source === 'backup') {
      await this.persistRecoveredState(nextState)
    }

    return nextState
  }

  private async persistRecoveredState(state: TState) {
    try {
      await writeJsonFileAtomic(this.options.filePath, state)
    } catch {
      // The recovered state remains usable in memory. A later successful write
      // can repair the primary file.
    }
  }
}
