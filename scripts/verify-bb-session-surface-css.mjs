import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import postcss from 'postcss'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(scriptDirectory, '..')
const cssPath = path.join(root, 'packages', 'bb-session-surface', 'dist', 'style.css')
const entryPath = path.join(root, 'packages', 'bb-session-surface', 'dist', 'index.js')
const htmlPath = path.join(root, 'index.html')
const appCssPath = path.join(root, 'src', 'index.css')

if (!fs.existsSync(cssPath)) {
  throw new Error(`Missing built stylesheet: ${cssPath}`)
}

const css = fs.readFileSync(cssPath, 'utf8')
const cssBytes = Buffer.byteLength(css)
if (cssBytes > 400_000) {
  throw new Error(`Built bb stylesheet exceeds the 400 KB performance budget: ${cssBytes} bytes`)
}
if (css.includes('data:font/')) {
  throw new Error('Built bb stylesheet must emit fonts as lazy assets instead of inline data URLs')
}
const entrySource = fs.readFileSync(entryPath, 'utf8')
const entryChunkName = entrySource.match(/from["']\.\/([^"']+)["']/)?.[1]
if (!entryChunkName) {
  throw new Error('Built bb entry must statically forward to a preloadable implementation chunk')
}
const entryChunkBytes = fs.statSync(path.join(path.dirname(entryPath), entryChunkName)).size
if (entryChunkBytes > 2_500_000) {
  throw new Error(`Built bb entry chunk exceeds the 2.5 MB performance budget: ${entryChunkBytes} bytes`)
}
const stylesheet = postcss.parse(css)
const allowedStarts = [
  '.aryn-bb-session-surface',
  '.dark .aryn-bb-session-surface',
  '[data-bb-plugin-root]',
  '.dark [data-bb-plugin-root]',
  ':is(.aryn-bb-session-surface,[data-bb-plugin-root])',
]

function isInsideKeyframes(rule) {
  let parent = rule.parent
  while (parent) {
    if (parent.type === 'atrule' && parent.name.toLowerCase().endsWith('keyframes')) return true
    parent = parent.parent
  }
  return false
}

const unscoped = []
stylesheet.walkRules((rule) => {
  if (isInsideKeyframes(rule)) return
  for (const selector of rule.selectors) {
    const value = selector.trim()
    if (!allowedStarts.some((prefix) => value.startsWith(prefix))) unscoped.push(value)
  }
})

if (unscoped.length > 0) {
  throw new Error(`Unscoped bb selectors:\n${[...new Set(unscoped)].slice(0, 30).join('\n')}`)
}

if (!css.includes('.aryn-bb-session-surface')) {
  throw new Error('Built bb stylesheet does not contain the surface scope')
}

const bundledFiraCodeWeights = new Set()
stylesheet.walkAtRules('font-face', (fontFace) => {
  let family = ''
  let weight = ''
  fontFace.walkDecls('font-family', (declaration) => {
    family = declaration.value.replace(/["']/g, '').trim()
  })
  fontFace.walkDecls('font-weight', (declaration) => {
    weight = declaration.value.trim()
  })
  fontFace.walkDecls('src', (declaration) => {
    if (/\.(?:woff|ttf)(?:[?#)'"])/.test(declaration.value)) {
      throw new Error('Built bb stylesheet must target modern Electron with woff2-only font sources')
    }
  })
  if (family === 'Fira Code' && weight) bundledFiraCodeWeights.add(weight)
})

if (bundledFiraCodeWeights.size > 0) {
  throw new Error('Built bb stylesheet must not bundle Fira Code font files')
}

const html = fs.readFileSync(htmlPath, 'utf8')
const googleFontsUrls = [...html.matchAll(/href=["'](https:\/\/fonts\.googleapis\.com\/css2\?[^"']+)["']/g)].map(
  ([, url]) => new URL(url.replaceAll('&amp;', '&')),
)
if (googleFontsUrls.length !== 1) {
  throw new Error(`App shell must use one consolidated Google Fonts stylesheet, found ${googleFontsUrls.length}`)
}

const requiredWebfontFamilies = [
  'Cormorant Garamond:wght@500;600;700',
  'Fira Code:wght@400..500',
  'IBM Plex Mono:wght@400;500',
  'Instrument Sans:wght@400;500;600;700',
  'Inter:wght@400;500;600',
  'Noto Sans SC:wght@400..500',
]
const webfontUrl = googleFontsUrls[0]
const webfontFamilies = webfontUrl.searchParams.getAll('family')
if (
  webfontUrl.searchParams.get('display') !== 'swap' ||
  requiredWebfontFamilies.some((family) => !webfontFamilies.includes(family))
) {
  throw new Error('App shell Google Fonts request is missing a required family, weight, or display=swap')
}

const appCss = fs.readFileSync(appCssPath, 'utf8')
if (appCss.includes('fonts.googleapis.com')) {
  throw new Error('Google Fonts must be delivered by the app shell instead of a CSS @import')
}

const requiredMonoFallbacks = [
  'JetBrains Mono',
  'Cascadia Mono',
  'Cascadia Code',
  'SF Mono',
  'SFMono-Regular',
  'Menlo',
  'Monaco',
  'Consolas',
  'DejaVu Sans Mono',
  'Liberation Mono',
  'Noto Sans Mono',
  'Noto Sans SC',
  'Microsoft YaHei UI',
  'Microsoft YaHei',
  'PingFang SC',
  'Noto Sans CJK SC',
]

function parseFontFamilies(value) {
  return postcss.list.comma(value).map((family) => family.replace(/^["']|["']$/g, '').trim())
}

function findMonoDeclarations(targetStylesheet, primaryFamily) {
  const declarations = []
  targetStylesheet.walkDecls('--font-mono', (declaration) => {
    const families = parseFontFamilies(declaration.value)
    if (families.includes(primaryFamily) && requiredMonoFallbacks.every((family) => families.includes(family))) {
      declarations.push(declaration)
    }
  })
  return declarations
}

function verifyMonoDeclarations(declarations, label) {
  if (declarations.length === 0) {
    throw new Error(`${label} does not contain the required cross-platform monospace fallback stack`)
  }
  for (const declaration of declarations) {
    const families = parseFontFamilies(declaration.value)
    if (families.some((family) => ['monospace', 'ui-monospace'].includes(family.toLowerCase()))) {
      throw new Error(`${label} monospace token must not use a generic monospace fallback`)
    }
    if (families.at(-1)?.toLowerCase() !== 'sans-serif') {
      throw new Error(`${label} monospace token must end with a sans-serif fallback`)
    }
  }
}

const bbMonoDeclarations = findMonoDeclarations(stylesheet, 'Fira Code')
verifyMonoDeclarations(bbMonoDeclarations, 'Built bb stylesheet')

const allBbMonoDeclarations = []
stylesheet.walkDecls('--font-mono', (declaration) => {
  allBbMonoDeclarations.push(declaration)
})
const finalBbMonoDeclaration = allBbMonoDeclarations.at(-1)
if (!finalBbMonoDeclaration || !bbMonoDeclarations.includes(finalBbMonoDeclaration)) {
  throw new Error('Built bb stylesheet must end its monospace cascade with the safe host stack')
}
const finalBbMonoSelectors = finalBbMonoDeclaration.parent?.type === 'rule'
  ? finalBbMonoDeclaration.parent.selectors
  : []
for (const requiredSelector of [
  ':is(.aryn-bb-session-surface,[data-bb-plugin-root])',
  '.aryn-bb-session-surface[data-bb-theme]',
  '[data-bb-plugin-root][data-bb-theme]',
]) {
  if (!finalBbMonoSelectors.includes(requiredSelector)) {
    throw new Error(`Built bb monospace cascade is missing the final ${requiredSelector} override`)
  }
}

const appStylesheet = postcss.parse(appCss)
const appMonoDeclarations = findMonoDeclarations(appStylesheet, 'IBM Plex Mono')
verifyMonoDeclarations(appMonoDeclarations, 'App stylesheet')

const bbMonoSelectors = bbMonoDeclarations.flatMap((declaration) =>
  declaration.parent?.type === 'rule' ? declaration.parent.selectors : [],
)
for (const requiredScope of ['.aryn-bb-session-surface', '[data-bb-plugin-root]']) {
  if (!bbMonoSelectors.some((selector) => selector.includes(requiredScope))) {
    throw new Error(`Built bb monospace token is missing the ${requiredScope} scope`)
  }
}

console.log('Verified bb session surface CSS isolation.')
