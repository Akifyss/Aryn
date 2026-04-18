import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  resolveBundledMeoRuntimePath,
  resolveBuiltMeoRuntimeDirectory,
  resolveMeoRuntimeEntryPath,
  resolveMeoRuntimeWebviewDistPath,
  resolveVendoredMeoRuntimeDirectory,
} from '../config/meo-runtime'
import {
  ensureMeoRuntimePatches,
  verifyMeoRuntimeLayout,
} from '../scripts/meo-runtime-utils.mjs'

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((rootPath) => rm(rootPath, { force: true, recursive: true })))
})

async function createTempDir(prefix: string) {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), prefix))
  tempRoots.push(rootPath)
  return rootPath
}

async function createRuntimeFixture(options?: {
  editorSource?: string
  includeKatex?: boolean
}) {
  const rootPath = await createTempDir('meo-runtime-')
  const distRootPath = path.join(rootPath, 'webview', 'dist')
  const katexRootPath = path.join(distRootPath, 'katex')

  await mkdir(distRootPath, { recursive: true })

  await writeFile(path.join(distRootPath, 'index.js'), 'console.log("meo")', 'utf8')
  await writeFile(path.join(distRootPath, 'index.css'), 'body{}', 'utf8')
  await writeFile(
    path.join(distRootPath, 'editor-test.js'),
    options?.editorSource ?? 'if(F1==="added")return;if(F1==="modified"){z?.({lineNumber:r});return}G?.({lineNumber:z1})',
    'utf8',
  )

  if (options?.includeKatex !== false) {
    await mkdir(katexRootPath, { recursive: true })
    await writeFile(path.join(katexRootPath, 'katex.min.css'), '.katex{}', 'utf8')
  }

  return rootPath
}

describe('meo runtime helpers', () => {
  it('resolves bundled runtime directories for dev and packaged app modes', () => {
    expect(resolveVendoredMeoRuntimeDirectory('C:\\repo')).toBe(path.resolve('C:\\repo', 'vendor', 'meo-runtime'))
    expect(resolveBuiltMeoRuntimeDirectory('C:\\repo')).toBe(path.resolve('C:\\repo', 'dist', 'meo-runtime'))
    expect(resolveBundledMeoRuntimePath({
      appRoot: 'C:\\repo',
      isDev: true,
      rendererDist: 'C:\\repo\\dist',
    })).toBe(path.join('C:\\repo', 'vendor', 'meo-runtime'))
    expect(resolveBundledMeoRuntimePath({
      appRoot: 'C:\\repo',
      isDev: false,
      rendererDist: 'C:\\repo\\dist',
    })).toBe(path.join('C:\\repo', 'dist', 'meo-runtime'))
    expect(resolveMeoRuntimeWebviewDistPath('C:\\repo\\vendor\\meo-runtime')).toBe(
      path.join('C:\\repo', 'vendor', 'meo-runtime', 'webview', 'dist'),
    )
    expect(resolveMeoRuntimeEntryPath('C:\\repo\\vendor\\meo-runtime')).toBe(
      path.join('C:\\repo', 'vendor', 'meo-runtime', 'webview', 'dist', 'index.js'),
    )
  })

  it('verifies the vendored runtime layout', async () => {
    const runtimeRootPath = await createRuntimeFixture()
    await expect(verifyMeoRuntimeLayout(runtimeRootPath)).resolves.toBeUndefined()
  })

  it('fails verification when a required runtime file is missing', async () => {
    const runtimeRootPath = await createRuntimeFixture({ includeKatex: false })
    await expect(verifyMeoRuntimeLayout(runtimeRootPath)).rejects.toThrow('missing a required file')
  })

  it('applies the tracked local patch to the vendored runtime', async () => {
    const runtimeRootPath = await createRuntimeFixture()
    await expect(ensureMeoRuntimePatches(runtimeRootPath, { apply: true })).resolves.toBeUndefined()

    const patchedEditorPath = path.join(runtimeRootPath, 'webview', 'dist', 'editor-test.js')
    const patchedSource = await readFile(patchedEditorPath, 'utf8')
    expect(patchedSource).toContain('if(F1==="added"||F1==="modified"){z?.({lineNumber:r});return}G?.({lineNumber:z1})')
  })

  it('fails when the vendored runtime drifts away from the expected patch target', async () => {
    const runtimeRootPath = await createRuntimeFixture({
      editorSource: 'console.log("different upstream chunk")',
    })

    await expect(ensureMeoRuntimePatches(runtimeRootPath)).rejects.toThrow('patch must be reviewed')
  })
})
