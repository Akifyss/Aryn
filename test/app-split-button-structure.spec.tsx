import { readFile } from 'node:fs/promises'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AppSplitButton } from '../src/components/app-split-button'

describe('shared split button', () => {
  it('renders two independently accessible segments with one shared contract', () => {
    const markup = renderToStaticMarkup(
      <AppSplitButton.Root
        aria-label='提交操作'
        size='sm'
        variant='outline'
      >
        <AppSplitButton.Action type='submit'>
          提交
        </AppSplitButton.Action>
        <AppSplitButton.Trigger
          aria-label='提交选项'
          tooltip='提交选项'
        >
          ▼
        </AppSplitButton.Trigger>
      </AppSplitButton.Root>,
    )

    expect(markup).toContain('role="group"')
    expect(markup).toContain('aria-label="提交操作"')
    expect(markup).toContain('class="app-split-button"')
    expect(markup).toContain('data-size="sm"')
    expect(markup).toContain('data-variant="outline"')
    expect(markup).toContain(
      'class="app-button app-split-button-segment app-split-button-action"',
    )
    expect(markup).toContain('type="submit"')
    expect(markup).toContain(
      'class="app-icon-button app-split-button-segment app-split-button-trigger"',
    )
    expect(markup).toContain('aria-label="提交选项"')
  })

  it('shares AppButton size and variant types without duplicating the visual skin', async () => {
    const [buttonCss, splitSource, splitCss, gitSource, gitCss] = await Promise.all([
      readFile(new URL('../src/components/app-button/styles.css', import.meta.url), 'utf8'),
      readFile(
        new URL(
          '../src/components/app-split-button/app-split-button.tsx',
          import.meta.url,
        ),
        'utf8',
      ),
      readFile(
        new URL('../src/components/app-split-button/styles.css', import.meta.url),
        'utf8',
      ),
      readFile(
        new URL(
          '../src/features/git/components/git-panel/git-panel.tsx',
          import.meta.url,
        ),
        'utf8',
      ),
      readFile(
        new URL(
          '../src/features/git/components/git-panel/styles.css',
          import.meta.url,
        ),
        'utf8',
      ),
    ])

    expect(splitSource).toContain('type AppButtonSize')
    expect(splitSource).toContain('type AppButtonVariant')
    expect(splitSource).toContain('AppSplitButtonContext')
    expect(buttonCss).toContain('.app-button,\n.app-split-button')
    expect(splitCss).toContain('var(--app-button-current-height)')
    expect(splitCss).toContain('var(--app-button-border-color)')
    expect(splitCss).toContain('var(--app-button-shadow)')
    expect(splitCss).toContain('var(--app-button-separator-color)')
    expect(splitCss).toContain('var(--app-button-base-disabled-opacity)')
    expect(splitCss).toMatch(
      /\.app-split-button > \.app-icon-button\.app-split-button-trigger:focus-visible\s*\{[^}]*color:\s*var\(--app-button-foreground\);/s,
    )
    expect(splitCss).not.toContain('var(--accent)')
    expect(splitCss).not.toContain('var(--danger)')
    expect(splitCss).not.toContain('var(--shadow-xs)')
    expect(gitSource).toContain('<AppSplitButton.Root')
    expect(gitSource).toContain('<AppSplitButton.Action')
    expect(gitSource).toContain('<AppSplitButton.Trigger')
    expect(gitCss).not.toContain('.git-commit-submit-button')
    expect(gitCss).not.toContain('.git-commit-menu-trigger')
    expect(gitCss).not.toContain('box-shadow: 0 6px 16px')
  })
})
