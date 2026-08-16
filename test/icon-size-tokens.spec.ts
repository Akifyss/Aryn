import { readdir, readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

async function collectApplicationSources(directory: URL): Promise<URL[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      if (entry.name === 'vendor') {
        return []
      }

      const entryUrl = new URL(
        entry.name + (entry.isDirectory() ? '/' : ''),
        directory,
      )

      if (entry.isDirectory()) {
        return collectApplicationSources(entryUrl)
      }

      return /\.[jt]sx?$/.test(entry.name) ? [entryUrl] : []
    }),
  )

  return files.flat()
}

describe('shared icon-size tokens', () => {
  it('defines one semantic scale for compact interface glyphs', async () => {
    const [
      indexCss,
      iconSizeSource,
      nativeIconSource,
      projectIconCss,
      projectIconSource,
      promptCss,
      promptSource,
      sessionTreeCss,
      queuedComposerCss,
      appShellCss,
      segmentedTabsCss,
    ] = await Promise.all([
      readFile(new URL('../src/index.css', import.meta.url), 'utf8'),
      readFile(new URL('../src/components/icon-size.ts', import.meta.url), 'utf8'),
      readFile(
        new URL('../src/features/editor/lib/meo-native-icon.ts', import.meta.url),
        'utf8',
      ),
      readFile(new URL('../src/components/project-icon/styles.css', import.meta.url), 'utf8'),
      readFile(new URL('../src/components/project-icon/project-icon.tsx', import.meta.url), 'utf8'),
      readFile(
        new URL('../src/features/agent/components/agent-new-conversation-prompt/styles.css', import.meta.url),
        'utf8',
      ),
      readFile(
        new URL('../src/features/agent/components/agent-new-conversation-prompt/agent-new-conversation-prompt.tsx', import.meta.url),
        'utf8',
      ),
      readFile(
        new URL('../src/features/agent/components/agent-session-tree/styles.css', import.meta.url),
        'utf8',
      ),
      readFile(
        new URL('../src/features/agent/components/agent-queued-composer-tray/styles.css', import.meta.url),
        'utf8',
      ),
      readFile(
        new URL('../src/features/layout/components/app-shell/styles.css', import.meta.url),
        'utf8',
      ),
      readFile(
        new URL('../src/components/ui/segmented-tabs/styles.css', import.meta.url),
        'utf8',
      ),
    ])

    expect(indexCss).toContain('--icon-size-md: 16px;')
    expect(indexCss).toContain('--icon-size-lg: 20px;')
    expect(indexCss).toContain('--icon-size-xl: 24px;')
    expect(iconSizeSource).toContain("export type AppIconSize = 'md' | 'lg' | 'xl'")
    expect(projectIconSource).toContain("size = 'md'")
    expect(projectIconSource).toContain('data-size={size}')
    expect(projectIconCss).toContain(".project-icon[data-size='xl']")
    expect(promptSource).toContain("iconSize='xl'")
    expect(promptCss).not.toMatch(/\.project-icon\s*\{[^}]*(?:width|height):/)
    expect(nativeIconSource).toContain(
      "const COMPACT_ICON_STYLE = 'width:var(--icon-size-md);height:var(--icon-size-md)'",
    )
    expect(sessionTreeCss).toMatch(/\.agent-session-new-button > svg[\s\S]*width: var\(--icon-size-md\)/)
    expect(queuedComposerCss).toMatch(/\.agent-queued-row-leading > svg[\s\S]*width: var\(--icon-size-md\)/)
    expect(appShellCss).toMatch(/\.panel-toggle-icon > svg[\s\S]*width: 100%/)
    expect(segmentedTabsCss).toMatch(/\.segmented-tabs-icon[\s\S]*width: var\(--icon-size-md\)/)
  })

  it('does not reintroduce numeric glyph props or Tailwind size aliases', async () => {
    const sourceFiles = await collectApplicationSources(
      new URL('../src/', import.meta.url),
    )
    const violations = (
      await Promise.all(
        sourceFiles.map(async (url) => {
          const source = await readFile(url, 'utf8')
          const iconOpeningTags = source.match(
            /<(?:Icon|Spinner|[A-Z][A-Za-z0-9]*(?:Icon|Line))\b[^>]*>/gs,
          ) ?? []
          const hasNumericGlyphProp = iconOpeningTags.some((openingTag) =>
            /(?:size|width|height)=(?:\{[0-9]+(?:\.[0-9]+)?\}|['"][0-9]+(?:\.[0-9]+)?['"])/.test(openingTag),
          )
          const hasTailwindGlyphAlias = iconOpeningTags.some((openingTag) =>
            /(?:size-[0-9]+(?:\.5)?(?![/\w.-])|w-[0-9]+(?:\.5)?\s+h-[0-9]+(?:\.5)?|h-[0-9]+(?:\.5)?\s+w-[0-9]+(?:\.5)?)/.test(openingTag),
          )
          const hasNumericLucideSize = /createElement\([^,]+,\s*\{\s*width:\s*([0-9]+),\s*height:\s*\1/.test(source)

          return hasNumericGlyphProp || hasTailwindGlyphAlias || hasNumericLucideSize
            ? url.pathname.replaceAll('\\', '/')
            : null
        }),
      )
    ).filter((path): path is string => path !== null)

    expect(violations).toEqual([])
  })
})
