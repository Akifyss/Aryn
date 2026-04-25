import type {
  GitBaselinePayload,
  GitBlameResult,
  GitChangeItem,
  GitDiffBlockAction,
  GitDiffSelection,
} from '@/features/git/types'
import type { MeoSettings } from '@/hooks/use-settings-store'
import type { MeoHostEnvironment } from '@/features/editor/lib/meo-host-environment'

export type MeoOpenGitDiffHandler = (
  filePath: string,
  options?: {
    lineNumber?: number
    source: 'revision' | 'worktree'
  },
) => void

export type NativeMeoMessage =
  | { type: 'openLink', href?: string }
  | { type: 'resolveImageSrc', requestId?: string, url?: string }
  | { type: 'resolveLocalLinks', requestId?: string, targets?: unknown[] }
  | { type: 'resolveWikiLinks', requestId?: string, targets?: unknown[] }
  | { type: 'saveDocument' }
  | { type: 'saveImageFromClipboard', requestId?: string, fileName?: string, imageData?: string }
  | { type: 'setFindOptions', findOptions?: { caseSensitive?: boolean, wholeWord?: boolean } }
  | { type: 'setGitChangesGutter', enabled?: boolean, visible?: boolean }
  | { type: 'setLineNumbers', enabled?: boolean, visible?: boolean }
  | { type: 'setMode', mode?: MeoEditorMode }
  | { type: 'setOutlineVisible', visible?: boolean }
  | { type: 'viewPositionChanged', topLine?: number, topLineOffset?: number }
  | { type: string, [key: string]: unknown }

export type NativeMeoController = {
  destroy: () => void
  focus: () => void
  refreshLayout: () => void
  setGitChangeContext: (context: MeoDiffSplitGitChangeContext) => void
  setGitBaseline: (baseline: GitBaselinePayload) => void
  setGitDiffLineHighlightsEnabled: (enabled: boolean) => void
  setOutlinePosition: (position: 'left' | 'right') => void
  setSavedText: (text: string) => void
  setText: (text: string) => void
}

export type MountNativeMeoEditorOptions = {
  environment: MeoHostEnvironment
  filePath: string
  gitChangeContext: MeoDiffSplitGitChangeContext
  initialValue: string
  meoSettings: MeoSettings
  onChange: (nextValue: string) => void
  onCompositionChange?: (isComposing: boolean) => void
  onOpenFile?: (filePath: string) => void
  onOpenGitDiff?: MeoOpenGitDiffHandler
  onApplyGitDiffSelection?: (change: GitChangeItem, selection: GitDiffSelection, action: GitDiffBlockAction) => Promise<void>
  onSave?: (nextValue: string) => void
  root: HTMLElement
  savedValue: string
  workspacePath?: string | null
}

export type MeoEditorInsertFormat =
  | 'bold'
  | 'bulletList'
  | 'codeBlock'
  | 'heading'
  | 'hr'
  | 'image'
  | 'inlineCode'
  | 'italic'
  | 'kbd'
  | 'link'
  | 'lineover'
  | 'numberedList'
  | 'quote'
  | 'strike'
  | 'table'
  | 'task'
  | 'wikiLink'

export type MeoEditorMode = 'diff-split' | 'live' | 'source'

export type MeoDiffSplitGitChangeContext = {
  stagedChange: GitChangeItem | null
  unstagedChange: GitChangeItem | null
}

export type MeoEditorViewportPosition = {
  line: number
  lineOffset: number
}

export type MeoEditorSelectionState = {
  anchorX?: number
  anchorY?: number
  visible?: boolean
} | null

export type MeoHeading = {
  from: number
  level: number
  line: number
  text: string
}

export type MeoEditorInstance = {
  destroy: () => void
  focus: () => void
  getHeadings: () => MeoHeading[]
  getText: () => string
  getTopVisiblePosition: () => MeoEditorViewportPosition
  hasFocus: () => boolean
  insertFormat: (action: MeoEditorInsertFormat, options?: unknown) => void
  moveHeadingSection: (sourceFrom: number, targetFrom: number, placement: 'before' | 'after') => boolean
  refreshDecorations: () => void
  refreshLayout: () => void
  refreshSelectionOverlay: () => void
  restoreTopLine: (line: number, lineOffset: number) => void
  scrollToLine: (line: number, position: string) => void
  setGitBaseline: (baseline: GitBaselinePayload) => void
  setGitGutterVisible: (visible: boolean) => void
  setLineNumbers: (visible: boolean) => void
  setMode: (mode: 'live' | 'source') => void
  setText: (text: string) => void
  view: {
    state: {
      doc: {
        lineAt: (position: number) => { from: number, number: number }
      }
      selection: {
        main: {
          head: number
        }
      }
    }
  }
}

export type MeoEditorCreateOptions = {
  initialGitGutter: boolean
  initialLineNumbers: boolean
  initialMode: 'live' | 'source'
  initialTopLine?: number
  initialTopLineOffset?: number
  initialVimMode: boolean
  onApplyChanges: (nextText: string) => void
  onOpenGitRevisionForLine: (options: { lineNumber?: number }) => void
  onOpenGitWorktreeForLine: (options: { lineNumber?: number }) => void
  onOpenLink: (href: string) => void
  onRequestGitBlame: (request: { lineNumber?: number }) => Promise<GitBlameResult>
  onSelectionChange: (selectionState: MeoEditorSelectionState) => void
  onViewportChange: () => void
  parent: HTMLElement
  text: string
}
