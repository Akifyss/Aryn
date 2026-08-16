import {
  createBundledHighlighter,
  createSingletonShorthands,
} from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'

export * from 'shiki/core'
export { createJavaScriptRegexEngine }
export { createOnigurumaEngine } from 'shiki/engine/oniguruma'

type LanguageLoader = () => Promise<{ default: unknown }>

const languageLoaders = {
  c: () => import('@shikijs/langs/c'),
  cpp: () => import('@shikijs/langs/cpp'),
  csharp: () => import('@shikijs/langs/csharp'),
  css: () => import('@shikijs/langs/css'),
  docker: () => import('@shikijs/langs/docker'),
  go: () => import('@shikijs/langs/go'),
  html: () => import('@shikijs/langs/html'),
  ini: () => import('@shikijs/langs/ini'),
  java: () => import('@shikijs/langs/java'),
  javascript: () => import('@shikijs/langs/javascript'),
  json: () => import('@shikijs/langs/json'),
  jsonc: () => import('@shikijs/langs/jsonc'),
  jsx: () => import('@shikijs/langs/jsx'),
  markdown: () => import('@shikijs/langs/markdown'),
  php: () => import('@shikijs/langs/php'),
  proto: () => import('@shikijs/langs/proto'),
  python: () => import('@shikijs/langs/python'),
  ruby: () => import('@shikijs/langs/ruby'),
  rust: () => import('@shikijs/langs/rust'),
  scss: () => import('@shikijs/langs/scss'),
  shellscript: () => import('@shikijs/langs/shellscript'),
  sql: () => import('@shikijs/langs/sql'),
  toml: () => import('@shikijs/langs/toml'),
  tsx: () => import('@shikijs/langs/tsx'),
  typescript: () => import('@shikijs/langs/typescript'),
  vue: () => import('@shikijs/langs/vue'),
  xml: () => import('@shikijs/langs/xml'),
  yaml: () => import('@shikijs/langs/yaml'),
} satisfies Record<string, LanguageLoader>

export const bundledLanguagesBase = languageLoaders

export const bundledLanguagesAlias = {
  bash: languageLoaders.shellscript,
  cjs: languageLoaders.javascript,
  cs: languageLoaders.csharp,
  cts: languageLoaders.typescript,
  dockerfile: languageLoaders.docker,
  js: languageLoaders.javascript,
  md: languageLoaders.markdown,
  mjs: languageLoaders.javascript,
  mts: languageLoaders.typescript,
  protobuf: languageLoaders.proto,
  py: languageLoaders.python,
  rb: languageLoaders.ruby,
  rs: languageLoaders.rust,
  sh: languageLoaders.shellscript,
  shell: languageLoaders.shellscript,
  ts: languageLoaders.typescript,
  yml: languageLoaders.yaml,
  zsh: languageLoaders.shellscript,
} satisfies Record<string, LanguageLoader>

export const bundledLanguages = {
  ...bundledLanguagesBase,
  ...bundledLanguagesAlias,
}

// Pierre supplies resolved theme objects at runtime, so no Shiki theme bundle
// is needed here. Keeping this map empty avoids transforming every stock theme.
export const bundledThemes = {}
export const bundledThemesInfo: never[] = []

export const createHighlighter = createBundledHighlighter({
  langs: bundledLanguages,
  themes: bundledThemes,
  engine: createJavaScriptRegexEngine,
})

export const {
  codeToHast,
  codeToHtml,
  codeToTokens,
  codeToTokensBase,
  codeToTokensWithThemes,
  getLastGrammarState,
  getSingletonHighlighter,
} = createSingletonShorthands(createHighlighter)
