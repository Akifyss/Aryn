import { readdir } from 'node:fs/promises'
import path from 'node:path'

const bundledVsixPattern = /^(.+)-(\d+(?:\.\d+)*)\.vsix$/u
const bundledIconThemePackageOrder = [
  'catppuccin.catppuccin-vsc-icons',
  'pkief.material-icon-theme',
  'miguelsolorio.symbols',
  'teabyii.ayu',
]

type BundledWorkspaceIconThemeCandidate = {
  fileName: string
  packageName: string
  versionParts: number[]
}

function parseBundledWorkspaceIconThemeCandidate(fileName: string): BundledWorkspaceIconThemeCandidate | null {
  if (!fileName.toLowerCase().endsWith('.vsix')) {
    return null
  }

  const match = bundledVsixPattern.exec(fileName)

  if (!match) {
    return {
      fileName,
      packageName: fileName.replace(/\.vsix$/iu, ''),
      versionParts: [],
    }
  }

  return {
    fileName,
    packageName: match[1],
    versionParts: match[2].split('.').map((part) => Number.parseInt(part, 10)),
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

function getBundledIconThemePackageOrder(packageName: string) {
  const index = bundledIconThemePackageOrder.indexOf(packageName.toLowerCase())
  return index === -1 ? bundledIconThemePackageOrder.length : index
}

export function isBundledWorkspaceIconThemePath(vsixPath: string, bundledThemeDirectoryPath: string) {
  const resolvedVsixPath = path.resolve(vsixPath)

  return path.dirname(resolvedVsixPath) === path.resolve(bundledThemeDirectoryPath)
    && parseBundledWorkspaceIconThemeCandidate(path.basename(resolvedVsixPath)) !== null
}

export async function resolveBundledWorkspaceIconThemePaths(bundledThemeDirectoryPath: string) {
  const entries = await readdir(bundledThemeDirectoryPath)
  const candidates = entries
    .map(parseBundledWorkspaceIconThemeCandidate)
    .filter((candidate): candidate is BundledWorkspaceIconThemeCandidate => candidate !== null)
  const latestCandidatesByPackage = new Map<string, BundledWorkspaceIconThemeCandidate>()

  for (const candidate of candidates) {
    const key = candidate.packageName.toLowerCase()
    const currentCandidate = latestCandidatesByPackage.get(key)

    if (!currentCandidate || compareVersionParts(candidate.versionParts, currentCandidate.versionParts) > 0) {
      latestCandidatesByPackage.set(key, candidate)
    }
  }

  const latestCandidates = Array.from(latestCandidatesByPackage.values())
    .sort((left, right) => {
      const orderDiff = getBundledIconThemePackageOrder(left.packageName)
        - getBundledIconThemePackageOrder(right.packageName)

      return orderDiff || left.fileName.toLowerCase().localeCompare(right.fileName.toLowerCase())
    })

  if (latestCandidates.length === 0) {
    throw new Error(`No bundled VSIX icon theme package was found in "${bundledThemeDirectoryPath}".`)
  }

  return latestCandidates.map((candidate) => path.join(bundledThemeDirectoryPath, candidate.fileName))
}

export async function resolveBundledWorkspaceIconThemePath(bundledThemeDirectoryPath: string) {
  const candidates = await resolveBundledWorkspaceIconThemePaths(bundledThemeDirectoryPath)

  if (candidates.length === 0) {
    throw new Error(`No bundled VSIX icon theme package was found in "${bundledThemeDirectoryPath}".`)
  }

  return candidates[0]
}
