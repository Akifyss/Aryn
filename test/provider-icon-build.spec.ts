import { build } from 'esbuild'
import { expect, it } from 'vitest'

it('builds provider SVGs without loading the unused Lobe UI and Ant Design dependency trees', async () => {
  const result = await build({
    entryPoints: ['src/features/settings/components/settings-dialog/provider-settings-section/provider-icon.tsx'],
    bundle: true,
    write: false,
    metafile: true,
    platform: 'browser',
    format: 'esm',
    external: ['react'],
  })
  const inputs = Object.keys(result.metafile.inputs).map(file => file.replaceAll('\\', '/'))
  expect(inputs.some(file => file.includes('/@lobehub/icons/'))).toBe(true)
  // Tree shaking the final output is too late: merely traversing these imports
  // added thousands of modules to Vite's graph and exhausted the macOS CI heap.
  expect(inputs.filter(file => /\/node_modules\/(?:@lobehub\/ui|antd|antd-style)\//.test(`/${file}`))).toEqual([])
})
