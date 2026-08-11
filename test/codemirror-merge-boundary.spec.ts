import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const testDirectory = path.dirname(fileURLToPath(import.meta.url))
const sourceRoot = path.resolve(testDirectory, '../src')

const allowedForkImportPaths = new Set([
  path.normalize('features/editor/lib/meo-native-diff-split.ts'),
  path.normalize('features/editor/lib/meo-native-live-inline-diff.ts'),
  path.normalize('vendor/meo/shared/gitDiffLineFlags.ts'),
])

async function collectSourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name)

    if (entry.isDirectory()) {
      if (entryPath === path.join(sourceRoot, 'vendor/codemirror-merge')) {
        return []
      }

      return collectSourceFiles(entryPath)
    }

    if (!entry.isFile() || !/\.(ts|tsx)$/.test(entry.name)) {
      return []
    }

    return [entryPath]
  }))

  return files.flat()
}

describe('CodeMirror merge fork boundaries', () => {
  it('keeps the Aryn CodeMirror merge fork isolated to Meo diff internals', async () => {
    const files = await collectSourceFiles(sourceRoot)
    const directOfficialImports: string[] = []
    const unexpectedForkImports: string[] = []

    await Promise.all(files.map(async (filePath) => {
      const source = await readFile(filePath, 'utf8')
      const relativePath = path.relative(sourceRoot, filePath)

      if (source.includes('@codemirror/merge')) {
        directOfficialImports.push(relativePath)
      }

      if (source.includes('@aryn/codemirror-merge') && !allowedForkImportPaths.has(path.normalize(relativePath))) {
        unexpectedForkImports.push(relativePath)
      }
    }))

    expect(directOfficialImports).toEqual([])
    expect(unexpectedForkImports).toEqual([])
  })

  it('pins Meo diff split to the modified side for shared outer scroll viewport', async () => {
    const source = await readFile(path.join(sourceRoot, 'features/editor/lib/meo-native-diff-split.ts'), 'utf8')

    expect(source).toContain("outerScrollPrimarySide: config.outerScrollPrimarySide ?? 'b'")
  })

  it('owns cleanup for lifecycle-aware custom merge controls', async () => {
    const [mergeSource, mergeViewSource, unifiedSource] = await Promise.all([
      readFile(path.join(sourceRoot, 'vendor/codemirror-merge/src/merge.ts'), 'utf8'),
      readFile(path.join(sourceRoot, 'vendor/codemirror-merge/src/mergeview.ts'), 'utf8'),
      readFile(path.join(sourceRoot, 'vendor/codemirror-merge/src/unified.ts'), 'utf8'),
    ])

    expect(mergeSource).toContain('export type MergeControlRenderResult = HTMLElement | {')
    expect(mergeSource).toContain('destroy?: () => void')
    expect(mergeViewSource).toContain('this.revertControlCleanups.set(elt, rendered.destroy)')
    expect(mergeViewSource).toContain('this.clearRevertControls()')
    expect(mergeViewSource).toContain('elt.className = "cm-merge-defaultControl"')
    expect(unifiedSource).toContain('appendRenderedControl(buttons, mergeControls("accept", onAccept), widget)')
    expect(unifiedSource).toContain('widget.addCleanup(rendered.destroy)')
    expect(unifiedSource.match(/className = "cm-merge-defaultControl"/g)).toHaveLength(2)
  })
})
