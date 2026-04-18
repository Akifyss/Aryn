export type MeoEditorBootstrap = {
  extensionLabel: string
  wrapperUrl: string
}

export type MeoHostMessage =
  | { type: 'ready' }
  | {
    type: 'applyChanges'
    baseVersion: number
    changes: Array<{
      from: number
      insert: string
      to: number
    }>
  }
  | { type: 'saveDocument' }
  | { type: 'setMode', mode: 'live' | 'source' }
  | { type: 'setLineNumbers', enabled?: boolean, visible?: boolean }
  | { type: 'setGitChangesGutter', enabled?: boolean, visible?: boolean }
  | { type: 'setOutlineVisible', visible?: boolean }
  | {
    type: 'setFindOptions'
    caseSensitive?: boolean
    wholeWord?: boolean
    findOptions?: {
      caseSensitive?: boolean
      wholeWord?: boolean
    }
  }
  | { type: 'viewPositionChanged', topLine?: number, topLineOffset?: number }
  | { type: 'openLink', href?: string }
  | { type: 'openGitRevisionForLine', lineNumber?: number, text?: string }
  | { type: 'openGitWorktreeForLine', lineNumber?: number, text?: string }
  | { type: 'requestGitBlame', lineNumber?: number, localEditGeneration?: number, requestId?: string, text?: string }
  | { type: 'resolveImageSrc', requestId?: string, url?: string }
  | { type: 'resolveLocalLinks', requestId?: string, targets?: unknown[] }
  | { type: 'resolveWikiLinks', requestId?: string, targets?: unknown[] }
  | { type: 'saveImageFromClipboard', requestId?: string, fileName?: string, imageData?: string }
  | {
    type: string
    [key: string]: unknown
  }
