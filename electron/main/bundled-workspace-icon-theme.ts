import { readdir } from 'node:fs/promises'
import path from 'node:path'

const flowIconsVsixPattern = /^thang-nm\.flow-icons-(\d+(?:\.\d+)*)\.vsix$/u

type BundledWorkspaceIconThemeCandidate = {
  fileName: string
  versionParts: number[]
}

function parseBundledWorkspaceIconThemeCandidate(fileName: string): BundledWorkspaceIconThemeCandidate | null {
  const match = flowIconsVsixPattern.exec(fileName)

  if (!match) {
    return null
  }

  return {
    fileName,
    versionParts: match[1].split('.').map((part) => Number.parseInt(part, 10)),
  }
}

function compareVersionParts(left: number[], right: number[]) {
  const maxLength = Math.max(left.length, right.length)

  for (let index = 0; index < maxLength; index += 1) {
    const leftPart = left[index] ?? 0
    const rightPart = right[index] ?? 0

    if (leftPart !== rightPart) {
      return leftPart - rightPart
    }
  }

  return 0
}

export function isFlowIconsVsixPath(vsixPath: string) {
  return parseBundledWorkspaceIconThemeCandidate(path.basename(vsixPath)) !== null
}

export function isBundledWorkspaceIconThemePath(vsixPath: string, bundledThemeDirectoryPath: string) {
  const resolvedVsixPath = path.resolve(vsixPath)

  return path.dirname(resolvedVsixPath) === path.resolve(bundledThemeDirectoryPath)
    && isFlowIconsVsixPath(resolvedVsixPath)
}

export async function resolveBundledWorkspaceIconThemePath(bundledThemeDirectoryPath: string) {
  const entries = await readdir(bundledThemeDirectoryPath)
  const candidates = entries
    .map(parseBundledWorkspaceIconThemeCandidate)
    .filter((candidate): candidate is BundledWorkspaceIconThemeCandidate => candidate !== null)
    .sort((left, right) => compareVersionParts(right.versionParts, left.versionParts))

  if (candidates.length === 0) {
    throw new Error(`No bundled Flow Icons VSIX package was found in "${bundledThemeDirectoryPath}".`)
  }

  return path.join(bundledThemeDirectoryPath, candidates[0].fileName)
}
