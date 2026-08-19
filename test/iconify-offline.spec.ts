import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Iconify runtime loading', () => {
  it('keeps application and embedded package icon rendering offline', async () => {
    const sourceRoots = [
      path.resolve('src'),
      path.resolve('packages/bb-session-surface/src'),
    ]
    const onlinePatterns = [
      /['"]@iconify\/react['"]/,
      /api\.iconify\.design/,
      /api\.simplesvg\.com/,
      /api\.unisvg\.com/,
    ]
    const violations: string[] = []

    await Promise.all(sourceRoots.map(async (sourceRoot) => {
      const sourcePaths = (await readdir(sourceRoot, { recursive: true }))
        .filter((relativePath) => /\.[cm]?[jt]sx?$/.test(relativePath))

      await Promise.all(sourcePaths.map(async (relativePath) => {
        const absolutePath = path.join(sourceRoot, relativePath)
        const source = await readFile(absolutePath, 'utf8')

        if (onlinePatterns.some((pattern) => pattern.test(source))) {
          violations.push(path.relative(process.cwd(), absolutePath))
        }
      }))
    }))

    expect(violations.sort()).toEqual([])
  })
})
