import { readdir, readFile } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { EDITOR_FONT_FAMILY } from '../src/features/editor/lib/editor-font-family'

const PROJECT_ROOT = fileURLToPath(new URL('../', import.meta.url))
const RUNTIME_SOURCE_ROOT = join(PROJECT_ROOT, 'src')
const RUNTIME_SOURCE_EXTENSIONS = new Set(['.css', '.ts', '.tsx'])
const UNSAFE_GENERIC_MONO_DECLARATIONS = [
  /(?:font-family|font|--font-mono)\s*:[^;}]*\b(?:monospace|ui-monospace)\b[^;}]*[;}]/gi,
  /(?:fontFamily|\.font)\s*[:=][^;\n}]*\b(?:monospace|ui-monospace)\b[^;\n}]*/gi,
]

async function collectRuntimeSourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(entries.map((entry) => {
    const entryPath = join(directory, entry.name)

    if (entry.isDirectory()) {
      return collectRuntimeSourceFiles(entryPath)
    }

    return RUNTIME_SOURCE_EXTENSIONS.has(extname(entry.name)) ? [entryPath] : []
  }))

  return files.flat()
}

describe('editor font family', () => {
  it('uses sans-serif CJK fallbacks before the final generic family', () => {
    const families = EDITOR_FONT_FAMILY.split(', ')
    const cjkFallbacks = [
      '"Noto Sans SC"',
      '"Microsoft YaHei UI"',
      '"Microsoft YaHei"',
      '"PingFang SC"',
      '"Noto Sans CJK SC"',
    ]

    expect(families).toContain('"Cascadia Mono"')
    expect(families).toContain('Consolas')
    expect(families.at(-1)).toBe('sans-serif')
    expect(families).not.toContain('monospace')

    for (const fallback of cjkFallbacks) {
      expect(families.indexOf(fallback)).toBeGreaterThan(-1)
      expect(families.indexOf(fallback)).toBeLessThan(families.indexOf('sans-serif'))
    }
  })

  it('keeps the Monaco offline fallback synchronized with the root token', async () => {
    const globalCss = await readFile(join(RUNTIME_SOURCE_ROOT, 'index.css'), 'utf8')
    const rootFontFamily = globalCss.match(/--font-mono:\s*([^;]+);/)?.[1]

    expect(rootFontFamily?.replace(/\s+/g, ' ').trim()).toBe(EDITOR_FONT_FAMILY)
  })

  it('routes editor surfaces through the shared safe font contract', async () => {
    const codeEditor = await readFile(
      join(RUNTIME_SOURCE_ROOT, 'features', 'editor', 'components', 'code-editor', 'code-editor.tsx'),
      'utf8',
    )
    const gitDiffEditor = await readFile(
      join(RUNTIME_SOURCE_ROOT, 'features', 'editor', 'components', 'git-diff-editor', 'git-diff-editor.tsx'),
      'utf8',
    )
    const meoStyles = await readFile(
      join(RUNTIME_SOURCE_ROOT, 'vendor', 'meo', 'webview', 'styles.css'),
      'utf8',
    )

    expect(codeEditor).toContain('fontFamily: EDITOR_FONT_FAMILY')
    const usesSafeMonacoFont = gitDiffEditor.includes('fontFamily: EDITOR_FONT_FAMILY')
    const usesSafePierreFont = gitDiffEditor.includes('--diffs-font-family: var(--font-mono);')
    expect(usesSafeMonacoFont || usesSafePierreFont).toBe(true)
    expect(meoStyles).toContain('font-family: var(--editor-font-family, var(--font-mono));')
  })

  it('does not bypass the shared token with a generic monospace declaration', async () => {
    const runtimeFiles = await collectRuntimeSourceFiles(RUNTIME_SOURCE_ROOT)
    const bbSurfaceCss = join(PROJECT_ROOT, 'packages', 'bb-session-surface', 'src', 'index.css')
    const unsafeDeclarations: string[] = []

    for (const file of [...runtimeFiles, bbSurfaceCss]) {
      const source = await readFile(file, 'utf8')
      const matches = UNSAFE_GENERIC_MONO_DECLARATIONS.flatMap((pattern) => source.match(pattern) ?? [])

      for (const match of matches) {
        unsafeDeclarations.push(`${relative(PROJECT_ROOT, file)}: ${match}`)
      }
    }

    expect(unsafeDeclarations).toEqual([])
  })
})
