import path from 'node:path'
import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'

const source = path.resolve(__dirname, 'src')
const surfaceScopes = [
  '.aryn-opencode-session-surface',
  'body > .aryn-opencode-portal-theme',
] as const

type PostCssContainer = {
  name?: string
  parent?: PostCssContainer
  type?: string
}

type PostCssRule = PostCssContainer & {
  remove: () => void
  selectors?: string[]
}

type PostCssAtRule = PostCssContainer & {
  params: string
  walkDecls?: (callback: (declaration: PostCssDeclaration) => void) => void
}

type PostCssDeclaration = {
  parent?: PostCssContainer
  prop: string
  value: string
}

type PostCssRoot = {
  walkAtRules: (callback: (rule: PostCssAtRule) => void) => void
  walkDecls: (callback: (declaration: PostCssDeclaration) => void) => void
}

const OPEN_CODE_CSS_NAMESPACE = 'aryn-opencode'

export function namespaceOpenCodeLayerParams(params: string) {
  return params
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => `${OPEN_CODE_CSS_NAMESPACE}.${name}`)
    .join(', ')
}

export function namespaceOpenCodeAnimationName(name: string) {
  return `${OPEN_CODE_CSS_NAMESPACE}-${name}`
}

export function namespaceOpenCodeFontFamilyName(name: string) {
  return `${OPEN_CODE_CSS_NAMESPACE}-${name}`
}

function unquoteCssValue(value: string) {
  const trimmed = value.trim()
  const quote = trimmed.at(0)
  if ((quote === '"' || quote === "'") && trimmed.at(-1) === quote) {
    return { name: trimmed.slice(1, -1), quote }
  }
  return { name: trimmed, quote: '' }
}

function isInsideFontFace(declaration: PostCssDeclaration) {
  const parent = declaration.parent
  return parent?.type === 'atrule' && parent.name?.toLowerCase() === 'font-face'
}

function isInsideKeyframes(rule: PostCssRule) {
  let parent = rule.parent
  while (parent) {
    if (parent.type === 'atrule' && parent.name?.toLowerCase().endsWith('keyframes')) return true
    parent = parent.parent
  }
  return false
}

function isNestedStyleRule(rule: PostCssRule) {
  let parent = rule.parent
  while (parent) {
    if (parent.type === 'rule') return true
    parent = parent.parent
  }
  return false
}

export function shouldScopeOpenCodeRule(rule: PostCssRule) {
  return !isInsideKeyframes(rule) && !isNestedStyleRule(rule)
}

/**
 * The official CSS is authored for a whole OpenCode document. Aryn embeds the
 * same components in one panel, so every selector must be constrained to the
 * surface or to an official portal mounted under body.
 */
export function scopeOpenCodeSelector(selector: string) {
  const value = selector.trim()
  if (!value || value.includes('body:not([data-new-layout])')) return []
  // Preserve native CSS nesting. Its parent rule is scoped separately and the
  // browser/build transform resolves `&` relative to that scoped parent.
  if (value.includes('&')) return [value]
  if (surfaceScopes.some((scope) => value.startsWith(scope))) return [value]

  return surfaceScopes.map((scope) => {
    const withoutDocumentTheme = value
      .replace(/^html\[data-theme=(?:"|')?oc-2(?:"|')?\](?:\s+|$)/, '')
      .replace(/^(?::root|:host|html|body\[data-new-layout\]|body)(?:\s+|$)/, '')
      .trim()

    if (withoutDocumentTheme.startsWith('.dark ')) {
      return `.dark ${scope} ${withoutDocumentTheme.slice('.dark '.length)}`
    }
    if (!withoutDocumentTheme) return scope
    return `${scope} ${withoutDocumentTheme}`
  })
}

const scopeOpenCodeCss = {
  postcssPlugin: 'aryn-scope-opencode-css',
  Once(root: PostCssRoot) {
    const animationNames = new Map<string, string>()
    const customProperties = new Map<string, string>()
    const fontFamilyNames = new Map<string, string>()

    root.walkAtRules((rule) => {
      const name = rule.name?.toLowerCase() ?? ''
      if (name.endsWith('keyframes')) {
        const original = rule.params.trim()
        if (!original) return
        const namespaced = namespaceOpenCodeAnimationName(original)
        animationNames.set(original, namespaced)
        rule.params = namespaced
        return
      }
      if (name === 'layer' && rule.params.trim()) {
        rule.params = namespaceOpenCodeLayerParams(rule.params)
        return
      }
      if (name === 'property' && rule.params.trim().startsWith('--')) {
        const original = rule.params.trim()
        const namespaced = `--${OPEN_CODE_CSS_NAMESPACE}-${original.slice(2)}`
        customProperties.set(original, namespaced)
        rule.params = namespaced
        return
      }
      if (name === 'font-face') {
        rule.walkDecls?.((declaration) => {
          if (declaration.prop.toLowerCase() !== 'font-family') return
          const { name: original, quote } = unquoteCssValue(declaration.value)
          if (!original) return
          const namespaced = namespaceOpenCodeFontFamilyName(original)
          fontFamilyNames.set(original, namespaced)
          declaration.value = `${quote}${namespaced}${quote}`
        })
      }
    })

    root.walkDecls((declaration) => {
      if (declaration.prop === 'animation' || declaration.prop === 'animation-name'
        || declaration.prop === '-webkit-animation' || declaration.prop === '-webkit-animation-name') {
        for (const [original, namespaced] of animationNames) {
          const escaped = original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          declaration.value = declaration.value.replace(
            new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`, 'g'),
            namespaced,
          )
        }
      }
      for (const [original, namespaced] of customProperties) {
        if (declaration.prop === original) declaration.prop = namespaced
        declaration.value = declaration.value.replaceAll(original, namespaced)
      }
      if (!isInsideFontFace(declaration)) {
        for (const [original, namespaced] of fontFamilyNames) {
          const escaped = original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          declaration.value = declaration.value.replace(
            new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`, 'g'),
            namespaced,
          )
        }
      }
    })
  },
  Rule(rule: PostCssRule) {
    // Native CSS nesting is relative to its parent selector. Scoping a nested
    // selector again produces `.surface .surface ...`, which can never match
    // our single host and silently drops layout rules such as tool flex/gap.
    if (!rule.selectors || !shouldScopeOpenCodeRule(rule)) return
    const selectors = rule.selectors.flatMap(scopeOpenCodeSelector)
    if (selectors.length === 0) {
      rule.remove()
      return
    }
    rule.selectors = [...new Set(selectors)]
  },
}

export default defineConfig({
  plugins: [solid()],
  css: {
    postcss: {
      plugins: [scopeOpenCodeCss],
    },
  },
  resolve: {
    // The official UI package and this host must share one Solid owner/context
    // graph. A second Solid runtime makes context providers invisible to the
    // official message components as soon as a message is rendered.
    dedupe: ['solid-js'],
    alias: {
      '@opencode-ai/core/util/binary': path.join(source, 'upstream/core/util/binary.ts'),
      '@opencode-ai/core/util/encode': path.join(source, 'upstream/core/util/encode.ts'),
      '@opencode-ai/core/util/path': path.join(source, 'upstream/core/util/path.ts'),
      '@opencode-ai/core/util/retry': path.join(source, 'upstream/core/util/retry.ts'),
      '@/context/global-sync/session-cache': path.join(source, 'upstream/app/context/global-sync/session-cache.ts'),
      '@/utils/diffs': path.join(source, 'upstream/app/utils/diffs.ts'),
      '@/utils/server-errors': path.join(source, 'upstream/app/utils/server-errors.ts'),
      '@/utils/session-route': path.join(source, 'adapters/root-session.ts'),
    },
  },
  build: {
    // Aryn ships on Electron 42 (Chromium), so CSS nesting and :is() can be
    // compiled for the actual desktop runtime instead of Vite's legacy web
    // browser baseline. The legacy target leaves a few official nested rules
    // unresolved and produces misleading build warnings.
    cssTarget: 'chrome120',
    cssCodeSplit: false,
    emptyOutDir: true,
    lib: {
      entry: path.join(source, 'index.tsx'),
      formats: ['es'],
      fileName: () => 'index.js',
    },
    rollupOptions: {
      output: {
        assetFileNames: (asset) => asset.name?.endsWith('.css') ? 'style.css' : 'assets/[name][extname]',
      },
    },
  },
  worker: {
    format: 'es',
  },
})
