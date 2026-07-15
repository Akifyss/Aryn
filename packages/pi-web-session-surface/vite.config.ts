import { readFile } from 'node:fs/promises'
import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

const source = path.resolve(__dirname, 'src')
const upstreamGlobalsCss = path.join(source, 'upstream', 'pi-web', 'app', 'globals.css')
const SURFACE = '.aryn-pi-web-session-surface'
const CSS_NAMESPACE = 'aryn-pi-web'
const VIRTUAL_GLOBALS_ID = 'virtual:aryn-pi-web-globals.css'
const RESOLVED_VIRTUAL_GLOBALS_ID = `\0${VIRTUAL_GLOBALS_ID}`

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
}

type PostCssDeclaration = {
  prop: string
  value: string
}

type PostCssRoot = {
  walkAtRules: (callback: (rule: PostCssAtRule) => void) => void
  walkDecls: (callback: (declaration: PostCssDeclaration) => void) => void
}

function isInsideKeyframes(rule: PostCssRule) {
  let parent = rule.parent
  while (parent) {
    if (parent.type === 'atrule' && parent.name?.toLowerCase().endsWith('keyframes')) return true
    parent = parent.parent
  }
  return false
}

export function scopePiWebSelector(selector: string) {
  const value = selector.trim()
  if (!value || value.startsWith('::view-transition-')) return []
  if (value.startsWith(SURFACE) || value.startsWith(`.dark ${SURFACE}`)) return [value]
  if (value === ':root') return [SURFACE]
  // The upstream document shell owns viewport geometry. Mapping its html/body
  // rules onto an embedded message root turns height:100dvh into artificial
  // chat content and can scroll every real message above the viewport.
  if (value === 'html' || value === 'body') return []
  if (value === 'html.dark' || value === '.dark') return [`.dark ${SURFACE}`]
  if (value.startsWith('html.dark ')) return [`.dark ${SURFACE} ${value.slice('html.dark '.length)}`]
  return [`${SURFACE} ${value}`]
}

/**
 * pi-web's globals.css targets a whole Next.js document. The vendored source is
 * kept byte-for-byte; this build-only transform constrains it to the embedded
 * surface so no `*`, `body`, markdown, scrollbar or keyframe rule can leak.
 */
const scopePiWebCss = {
  postcssPlugin: 'aryn-scope-pi-web-css',
  Once(root: PostCssRoot) {
    const animationNames = new Map<string, string>()
    root.walkAtRules((rule) => {
      const name = rule.name?.toLowerCase() ?? ''
      if (!name.endsWith('keyframes')) return
      const original = rule.params.trim()
      if (!original) return
      const namespaced = `${CSS_NAMESPACE}-${original}`
      animationNames.set(original, namespaced)
      rule.params = namespaced
    })
    root.walkDecls((declaration) => {
      if (!['animation', 'animation-name', '-webkit-animation', '-webkit-animation-name'].includes(declaration.prop)) return
      for (const [original, namespaced] of animationNames) {
        const escaped = original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        declaration.value = declaration.value.replace(
          new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`, 'g'),
          namespaced,
        )
      }
    })
  },
  Rule(rule: PostCssRule) {
    if (!rule.selectors || isInsideKeyframes(rule)) return
    const selectors = rule.selectors.flatMap(scopePiWebSelector)
    if (selectors.length === 0) {
      rule.remove()
      return
    }
    rule.selectors = [...new Set(selectors)]
  },
}

export function preparePiWebCssSource(code: string) {
  return code
    .replace(/^\s*@import\s+["']tailwindcss["'];\s*/m, '')
    .replace(/@theme\s*\{[\s\S]*?\}\s*/m, '')
}

const prepareVendoredPiWebCss = (): Plugin => ({
  name: 'aryn-prepare-vendored-pi-web-css',
  enforce: 'pre',
  resolveId(id) {
    if (id === VIRTUAL_GLOBALS_ID) return RESOLVED_VIRTUAL_GLOBALS_ID
    return null
  },
  async load(id) {
    if (id !== RESOLVED_VIRTUAL_GLOBALS_ID) return null
    return preparePiWebCssSource(await readFile(upstreamGlobalsCss, 'utf8'))
  },
})

export default defineConfig({
  plugins: [prepareVendoredPiWebCss(), react()],
  // Vite deliberately preserves process.env references in library mode. The
  // surface runs in Aryn's sandboxed Electron renderer, where Node globals are
  // unavailable, so browser-safe values must be fixed at the bundle boundary.
  // Mermaid also carries optional Node fallbacks for cwd/platform in lazy
  // chunks; replacing those keeps every emitted chunk renderer-only.
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    'process.cwd': 'String',
    'process.platform': JSON.stringify('browser'),
  },
  css: {
    postcss: {
      plugins: [scopePiWebCss],
    },
  },
  resolve: {
    alias: {
      '@': path.join(source, 'upstream/pi-web'),
    },
    dedupe: ['react', 'react-dom'],
  },
  build: {
    cssTarget: 'chrome120',
    cssCodeSplit: false,
    emptyOutDir: true,
    lib: {
      entry: {
        index: path.join(source, 'index.tsx'),
        'session-state': path.join(source, 'session-state.ts'),
      },
      formats: ['es'],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    rollupOptions: {
      output: {
        assetFileNames: (asset) => asset.name?.endsWith('.css') ? 'style.css' : 'assets/[name][extname]',
      },
    },
  },
})
