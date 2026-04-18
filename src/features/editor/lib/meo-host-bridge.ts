import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { GitBaselinePayload, GitRepositoryState } from '@/features/git/types'
import type { MeoSettings } from '@/hooks/use-settings-store'
import type { MeoHostMessage } from '@/features/editor/lib/meo-protocol'
import {
  getRelativeFsPath,
  isExternalHref,
  resolveImageUrl,
  resolveLocalLinkResults,
  resolveOpenLinkFilePath,
  resolveWikiLinkResults,
} from '@/features/editor/lib/meo-links'
import {
  DEFAULT_FIND_OPTIONS,
  readStoredState,
  resolveFindOptions,
  resolveGitChangesGutterEnabled,
  shouldRememberViewPosition,
  writeStoredState,
} from '@/features/editor/lib/meo-state'
import { MEO_HOST_CHANNEL_KEY } from '@/features/editor/lib/meo-transport'

type MeoOpenGitDiffHandler = (
  filePath: string,
  options?: {
    lineNumber?: number
    source: 'revision' | 'worktree'
  },
) => void

type MeoWindowMessageEnvelope = {
  __arynMeo: boolean
  channel?: unknown
  payload?: MeoHostMessage
}

type MeoHostPayloadHandlerOptions = {
  channelId: string
  filePath: string
  iframeWindow: Window
  meoSettings: MeoSettings
  modeRef: MutableRefObject<'live' | 'source'>
  onChange: (nextValue: string) => void
  onOpenFile?: (filePath: string) => void
  onOpenGitDiff?: MeoOpenGitDiffHandler
  onSave?: (nextValue: string) => void
  payload: MeoHostMessage
  preferredTheme: 'light' | 'dark'
  setIsReady: Dispatch<SetStateAction<boolean>>
  setStatusMessage: Dispatch<SetStateAction<string | null>>
  versionRef: MutableRefObject<number>
  valueRef: MutableRefObject<string>
  workspacePath?: string | null
}

function buildUnavailableGitBaseline(reason: GitBaselinePayload['reason']): GitBaselinePayload {
  return {
    available: false,
    baseText: null,
    gitPath: null,
    headOid: null,
    reason,
    repoRoot: null,
    tracked: false,
  }
}

function buildInitPayload(
  filePath: string,
  meoSettings: MeoSettings,
  mode: 'live' | 'source',
  preferredTheme: 'light' | 'dark',
  value: string,
  version: number,
) {
  const storedState = readStoredState(filePath)
  const gitChangesGutter = resolveGitChangesGutterEnabled(storedState)
  const restoreViewPosition = shouldRememberViewPosition(
    value,
    meoSettings.rememberPositionLines,
  )

  return {
    gitChangesGutter,
    message: {
      findOptions: storedState.findOptions ?? DEFAULT_FIND_OPTIONS,
      gitChangesGutter,
      gitDiffLineHighlights: meoSettings.gitDiffLineHighlights,
      lineNumbers: storedState.lineNumbers ?? true,
      mode,
      outlinePosition: meoSettings.outlinePosition,
      outlineVisible: storedState.outlineVisible ?? false,
      restoreTopLine: restoreViewPosition ? storedState.topLine : undefined,
      restoreTopLineOffset: restoreViewPosition ? storedState.topLineOffset : undefined,
      text: value,
      theme: undefined,
      themeKind: preferredTheme,
      type: 'init',
      version,
      vimMode: false,
    },
  }
}

export function postMessageToMeoIframe(
  iframeWindow: Window,
  channelId: string,
  payload: Record<string, unknown>,
  iframeOrigin?: string | null,
) {
  iframeWindow.postMessage({
    [MEO_HOST_CHANNEL_KEY]: channelId,
    ...payload,
  }, iframeOrigin ?? '*')
}

export function postGitBaselineChanged(
  iframeWindow: Window,
  channelId: string,
  payload: GitBaselinePayload,
) {
  postMessageToMeoIframe(iframeWindow, channelId, {
    payload,
    type: 'gitBaselineChanged',
    version: undefined,
  })
}

export function postThemeChanged(
  iframeWindow: Window,
  channelId: string,
  theme: 'light' | 'dark',
) {
  postMessageToMeoIframe(iframeWindow, channelId, {
    theme: undefined,
    themeKind: theme,
    type: 'themeChanged',
  })
}

export function getGitStateRefreshKey(repositoryState: GitRepositoryState | null | undefined) {
  if (!repositoryState) {
    return 'no-state'
  }

  return JSON.stringify({
    ahead: repositoryState.ahead,
    behind: repositoryState.behind,
    branch: repositoryState.branch,
    hasChanges: repositoryState.hasChanges,
    hasCommits: repositoryState.hasCommits,
    isRepository: repositoryState.isRepository,
    repositoryRootPath: repositoryState.repositoryRootPath,
    stagedChanges: repositoryState.stagedChanges.map((change) => ({
      kind: change.kind,
      path: change.path,
      scope: change.scope,
      statusCode: change.statusCode,
    })),
    unstagedChanges: repositoryState.unstagedChanges.map((change) => ({
      kind: change.kind,
      path: change.path,
      scope: change.scope,
      statusCode: change.statusCode,
    })),
  })
}

export function resolveMeoHostMessageFromEvent(
  event: MessageEvent<unknown>,
  options: {
    channelId: string
    iframeOrigin?: string | null
    iframeWindow: Window | null | undefined
  },
) {
  if (event.source !== options.iframeWindow) {
    return null
  }

  const message = event.data
  if (!message || typeof message !== 'object' || !('__arynMeo' in message)) {
    return null
  }

  const { channel, payload } = message as MeoWindowMessageEnvelope

  if (typeof channel !== 'string' || channel !== options.channelId) {
    return null
  }

  if (options.iframeOrigin && event.origin !== options.iframeOrigin) {
    return null
  }

  if (!payload || typeof payload !== 'object' || typeof payload.type !== 'string') {
    return null
  }

  return payload
}

function applyTextChanges(
  content: string,
  changes: Array<{
    from: number
    insert: string
    to: number
  }>,
) {
  let nextContent = content
  const sortedChanges = [...changes].sort((left, right) => right.from - left.from)

  for (const change of sortedChanges) {
    nextContent = `${nextContent.slice(0, change.from)}${change.insert}${nextContent.slice(change.to)}`
  }

  return nextContent
}

export function handleMeoHostPayload({
  channelId,
  filePath,
  iframeWindow,
  meoSettings,
  modeRef,
  onChange,
  onOpenFile,
  onOpenGitDiff,
  onSave,
  payload,
  preferredTheme,
  setIsReady,
  setStatusMessage,
  valueRef,
  versionRef,
  workspacePath,
}: MeoHostPayloadHandlerOptions) {
  switch (payload.type) {
    case 'ready': {
      const initPayload = buildInitPayload(
        filePath,
        meoSettings,
        modeRef.current,
        preferredTheme,
        valueRef.current,
        versionRef.current,
      )

      setIsReady(true)
      setStatusMessage(null)
      postThemeChanged(iframeWindow, channelId, preferredTheme)
      postMessageToMeoIframe(iframeWindow, channelId, initPayload.message)
      postMessageToMeoIframe(iframeWindow, channelId, {
        enabled: initPayload.gitChangesGutter,
        type: 'gitChangesGutterChanged',
      })
      return
    }

    case 'applyChanges': {
      if (!Array.isArray(payload.changes)) {
        return
      }

      if (payload.baseVersion !== versionRef.current) {
        postMessageToMeoIframe(iframeWindow, channelId, {
          text: valueRef.current,
          type: 'docChanged',
          version: versionRef.current,
        })
        return
      }

      const nextContent = applyTextChanges(valueRef.current, payload.changes)
      valueRef.current = nextContent
      versionRef.current += 1
      onChange(nextContent)
      postMessageToMeoIframe(iframeWindow, channelId, {
        type: 'applied',
        version: versionRef.current,
      })
      return
    }

    case 'saveDocument': {
      onSave?.(valueRef.current)
      return
    }

    case 'setMode': {
      if (payload.mode === 'live' || payload.mode === 'source') {
        modeRef.current = payload.mode
        writeStoredState(filePath, { mode: payload.mode })
      }
      return
    }

    case 'setLineNumbers': {
      const lineNumbers = payload.visible ?? payload.enabled
      if (typeof lineNumbers === 'boolean') {
        writeStoredState(filePath, { lineNumbers })
      }
      return
    }

    case 'setGitChangesGutter': {
      const gitChangesGutter = payload.visible ?? payload.enabled
      if (typeof gitChangesGutter === 'boolean') {
        writeStoredState(filePath, {
          gitChangesGutter,
          gitChangesGutterConfigured: true,
        })
      }
      return
    }

    case 'setOutlineVisible': {
      if (typeof payload.visible === 'boolean') {
        writeStoredState(filePath, { outlineVisible: payload.visible })
      }
      return
    }

    case 'setFindOptions': {
      writeStoredState(filePath, {
        findOptions: resolveFindOptions(payload.findOptions ?? {
          caseSensitive: payload.caseSensitive,
          wholeWord: payload.wholeWord,
        }),
      })
      return
    }

    case 'viewPositionChanged': {
      const shouldPersistViewPosition = shouldRememberViewPosition(
        valueRef.current,
        meoSettings.rememberPositionLines,
      )
      writeStoredState(filePath, {
        topLine: shouldPersistViewPosition && typeof payload.topLine === 'number'
          ? payload.topLine
          : undefined,
        topLineOffset: shouldPersistViewPosition && typeof payload.topLineOffset === 'number'
          ? payload.topLineOffset
          : undefined,
      })
      return
    }

    case 'openLink': {
      if (typeof payload.href !== 'string' || !payload.href.trim()) {
        return
      }

      const href = payload.href
      if (href.startsWith('#')) {
        return
      }

      if (isExternalHref(href)) {
        window.open(href, '_blank', 'noopener,noreferrer')
        return
      }

      void resolveOpenLinkFilePath(filePath, workspacePath, href)
        .then((result) => {
          if (result.exists && result.filePath) {
            onOpenFile?.(result.filePath)
          }
        })
      return
    }

    case 'openGitRevisionForLine':
    case 'openGitWorktreeForLine': {
      onOpenGitDiff?.(filePath, {
        lineNumber: typeof payload.lineNumber === 'number' ? payload.lineNumber : undefined,
        source: payload.type === 'openGitRevisionForLine' ? 'revision' : 'worktree',
      })
      return
    }

    case 'requestGitBlame': {
      void (async () => {
        if (!workspacePath) {
          postMessageToMeoIframe(iframeWindow, channelId, {
            lineNumber: payload.lineNumber,
            localEditGeneration: payload.localEditGeneration,
            requestId: payload.requestId,
            result: { kind: 'unavailable', reason: 'not-repo' },
            type: 'gitBlameResult',
          })
          return
        }

        const result = await window.appApi.getGitLineBlame(
          workspacePath,
          filePath,
          typeof payload.lineNumber === 'number' ? payload.lineNumber : 1,
          typeof payload.text === 'string' ? payload.text : undefined,
        )

        postMessageToMeoIframe(iframeWindow, channelId, {
          lineNumber: payload.lineNumber,
          localEditGeneration: payload.localEditGeneration,
          requestId: payload.requestId,
          result,
          type: 'gitBlameResult',
        })
      })()
      return
    }

    case 'resolveImageSrc': {
      postMessageToMeoIframe(iframeWindow, channelId, {
        requestId: payload.requestId,
        resolvedUrl: typeof payload.url === 'string' ? resolveImageUrl(filePath, payload.url) : '',
        type: 'resolvedImageSrc',
      })
      return
    }

    case 'resolveLocalLinks': {
      void resolveLocalLinkResults(filePath, workspacePath, Array.isArray(payload.targets) ? payload.targets : [])
        .then((results) => {
          postMessageToMeoIframe(iframeWindow, channelId, {
            requestId: payload.requestId,
            results: results.map(({ exists, target }) => ({ exists, target })),
            type: 'resolvedLocalLinks',
          })
        })
      return
    }

    case 'resolveWikiLinks': {
      void resolveWikiLinkResults(filePath, workspacePath, Array.isArray(payload.targets) ? payload.targets : [])
        .then((results) => {
          postMessageToMeoIframe(iframeWindow, channelId, {
            requestId: payload.requestId,
            results: results.map(({ exists, target }) => ({ exists, target })),
            type: 'resolvedWikiLinks',
          })
        })
      return
    }

    case 'saveImageFromClipboard': {
      void (async () => {
        if (!workspacePath) {
          postMessageToMeoIframe(iframeWindow, channelId, {
            error: 'No workspace folder is open.',
            requestId: payload.requestId,
            success: false,
            type: 'savedImagePath',
          })
          return
        }

        try {
          const { filePath: savedImagePath } = await window.appApi.saveWorkspaceImage(
            workspacePath,
            meoSettings.imageFolder,
            typeof payload.fileName === 'string' ? payload.fileName : 'pasted-image.png',
            typeof payload.imageData === 'string' ? payload.imageData : '',
          )

          postMessageToMeoIframe(iframeWindow, channelId, {
            path: getRelativeFsPath(filePath, savedImagePath),
            requestId: payload.requestId,
            success: true,
            type: 'savedImagePath',
          })
        } catch (error) {
          postMessageToMeoIframe(iframeWindow, channelId, {
            error: error instanceof Error ? error.message : 'Failed to save image.',
            requestId: payload.requestId,
            success: false,
            type: 'savedImagePath',
          })
        }
      })()
      return
    }

    default:
      return
  }
}

export function getUnavailableGitBaseline(reason: GitBaselinePayload['reason']) {
  return buildUnavailableGitBaseline(reason)
}
