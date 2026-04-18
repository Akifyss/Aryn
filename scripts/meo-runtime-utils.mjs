import { access, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

export const MEO_RUNTIME_PATCHES = [
  {
    description: 'Enable Git gutter navigation for added lines in the vendored MEO runtime',
    filePattern: /^editor-.*\.js$/,
    id: 'git-gutter-added-line-navigation',
    nextSnippet: 'if(F1==="added"||F1==="modified"){z?.({lineNumber:r});return}G?.({lineNumber:z1})',
    previousSnippet: 'if(F1==="added")return;if(F1==="modified"){z?.({lineNumber:r});return}G?.({lineNumber:z1})',
  },
]

export function resolveMeoRuntimeEntryPath(runtimeRootPath) {
  return path.join(runtimeRootPath, 'webview', 'dist', 'index.js')
}

async function hasFile(filePath) {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

async function resolvePatchedRuntimeFile(runtimeRootPath, filePattern) {
  const distDirectoryPath = path.join(runtimeRootPath, 'webview', 'dist')
  const entries = await readdir(distDirectoryPath, { withFileTypes: true })
  const matchingFiles = entries
    .filter((entry) => entry.isFile() && filePattern.test(entry.name))
    .map((entry) => path.join(distDirectoryPath, entry.name))

  if (matchingFiles.length !== 1) {
    throw new Error(
      `Expected exactly one vendored MEO runtime file matching ${filePattern} in ${distDirectoryPath}, found ${matchingFiles.length}.`,
    )
  }

  return matchingFiles[0]
}

export async function verifyMeoRuntimeLayout(runtimeRootPath) {
  const requiredFiles = [
    resolveMeoRuntimeEntryPath(runtimeRootPath),
    path.join(runtimeRootPath, 'webview', 'dist', 'index.css'),
    path.join(runtimeRootPath, 'webview', 'dist', 'katex', 'katex.min.css'),
  ]

  for (const filePath of requiredFiles) {
    if (!(await hasFile(filePath))) {
      throw new Error(`The vendored MEO runtime is missing a required file: ${filePath}`)
    }
  }
}

export async function ensureMeoRuntimePatches(runtimeRootPath, options = {}) {
  const { apply = false } = options

  await verifyMeoRuntimeLayout(runtimeRootPath)

  for (const patch of MEO_RUNTIME_PATCHES) {
    const targetFilePath = await resolvePatchedRuntimeFile(runtimeRootPath, patch.filePattern)
    const currentSource = await readFile(targetFilePath, 'utf8')

    if (currentSource.includes(patch.nextSnippet)) {
      continue
    }

    if (!currentSource.includes(patch.previousSnippet)) {
      throw new Error(
        `Unable to verify vendored MEO patch "${patch.id}" in ${targetFilePath}. The upstream runtime likely changed and the patch must be reviewed.`,
      )
    }

    if (!apply) {
      throw new Error(
        `Vendored MEO runtime is missing patch "${patch.id}". Run "npm run meo:apply-patches" before building.`,
      )
    }

    const nextSource = currentSource.replace(patch.previousSnippet, patch.nextSnippet)
    await writeFile(targetFilePath, nextSource, 'utf8')
  }
}
