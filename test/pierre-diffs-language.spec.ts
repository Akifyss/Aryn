import { describe, expect, it } from 'vitest'
import { getPierreDiffLanguage } from '../src/lib/pierre-diffs-language'

describe('getPierreDiffLanguage', () => {
  it.each([
    ['README.md', 'markdown'],
    ['src/app.tsx', 'tsx'],
    ['src/vite.config.cts', 'typescript'],
    ['src/index.css', 'css'],
    ['src/main.go', 'go'],
    ['public/logo.svg', 'xml'],
    ['proto/message.proto', 'proto'],
    ['Dockerfile', 'docker'],
    ['dev.Dockerfile', 'docker'],
    ['scripts/build.ps1', 'text'],
  ])('maps %s to a safe Pierre language', (fileName, expected) => {
    expect(getPierreDiffLanguage(fileName)).toBe(expected)
  })

  it('falls back to plain text instead of requesting an unavailable Shiki grammar', () => {
    expect(getPierreDiffLanguage('assets/model.unknown-language')).toBe('text')
    expect(getPierreDiffLanguage('LICENSE')).toBe('text')
  })
})
