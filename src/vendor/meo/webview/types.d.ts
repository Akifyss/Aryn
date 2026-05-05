// @ts-nocheck
declare function acquireVsCodeApi(): VsCodeWebviewApi;

interface VsCodeWebviewApi {
  getState?(): unknown;
  setState?(state: unknown): void;
  postMessage(message: WebviewMessage): void;
}

type WebviewMessage =
  | { type: 'ready' }
  | { type: 'applyChanges'; content?: string; baseVersion: number; changes?: { from: number; to: number; insert: string }[] }
  | { type: 'draftChanged'; text: string | null }
  | { type: 'setMode'; mode: 'live' | 'source' }
  | { type: 'setLineNumbers'; visible: boolean }
  | { type: 'setGitChangesGutter'; visible: boolean }
  | { type: 'setOutlineVisible'; visible: boolean }
  | { type: 'setFindOptions'; findOptions: { wholeWord: boolean; caseSensitive: boolean } }
  | { type: 'viewPositionChanged'; topLine: number; topLineOffset?: number }
  | { type: 'openLink'; href: string }
  | { type: 'resolveImageSrc'; requestId: string; url: string }
  | { type: 'resolveWikiLinks'; requestId: string; targets: string[] }
  | { type: 'resolveLocalLinks'; requestId: string; targets: string[] }
  | { type: 'saveDocument' }
  | { type: 'exportDocument'; format: 'html' | 'pdf' }
  | { type: 'exportSnapshot'; requestId: string; text: string; environment?: Record<string, unknown> }
  | { type: 'exportSnapshotError'; requestId: string; error: string; message?: string }
  | { type: 'saveImageFromClipboard'; requestId: string; imageData: string; fileName: string };

type ExtensionMessage =
  | { type: 'init'; text: string; version: number; mode: 'live' | 'source'; outlinePosition: 'left' | 'right'; outlineVisible: boolean; lineNumbers: boolean; gitChangesGutter: boolean; gitDiffLineHighlights: boolean; focusedLineHighlight: boolean; vimMode: boolean; findOptions: { wholeWord: boolean; caseSensitive: boolean }; restoreTopLine?: number; restoreTopLineOffset?: number }
  | { type: 'docChanged'; text: string; version: number }
  | { type: 'applied'; version: number }
  | { type: 'focusEditor' }
  | { type: 'revealSelection'; anchor: number; head: number; focus?: boolean }
  | { type: 'outlinePositionChanged'; position: 'left' | 'right' }
  | { type: 'outlineVisibilityChanged'; visible: boolean }
  | { type: 'lineNumbersChanged'; enabled: boolean }
  | { type: 'gitChangesGutterChanged'; enabled: boolean }
  | { type: 'gitDiffLineHighlightsChanged'; enabled: boolean }
  | { type: 'focusedLineHighlightChanged'; enabled: boolean }
  | { type: 'vimModeChanged'; enabled: boolean }
  | { type: 'findOptionsChanged'; findOptions: { wholeWord: boolean; caseSensitive: boolean } }
  | { type: 'resolvedImageSrc'; requestId: string; resolvedUrl: string }
  | { type: 'resolvedWikiLinks'; requestId: string; results: Array<{ target: string; exists: boolean }> }
  | { type: 'resolvedLocalLinks'; requestId: string; results: Array<{ target: string; exists: boolean }> }
  | { type: 'savedImagePath'; requestId: string; success: boolean; path?: string; error?: string };

interface WikiLinkStatus {
  exists: boolean;
  path?: string;
}

interface HeadingInfo {
  text: string;
  level: number;
  from: number;
  to: number;
  lineFrom: number;
  lineTo: number;
  id: string;
}

interface GitDiffLine {
  type: 'added' | 'removed' | 'modified' | 'unchanged';
  oldLineNumber?: number;
  newLineNumber?: number;
  content: string;
}

interface GitBlameInfo {
  hash: string;
  author: string;
  date: string;
  message: string;
}


