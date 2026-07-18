export type CompatibleFileDiff = {
  name?: string
  oldName?: string
  [key: string]: unknown
}

export type RenderablePatch =
  | { kind: 'raw'; text: string }
  | { kind: 'files'; files: CompatibleFileDiff[] }

export function getRenderablePatch(value: string | null | undefined, _id: string): RenderablePatch | null {
  return value?.trim() ? { kind: 'raw', text: value } : null
}

export function resolveDiffThemeName(theme: 'light' | 'dark') {
  return theme === 'dark' ? 'github-dark' : 'github-light'
}

export function resolveFileDiffPath(file: CompatibleFileDiff) {
  return file.name ?? file.oldName ?? 'diff'
}
