import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.join(__dirname, 'src'),
    },
  },
  test: {
    root: __dirname,
    include: ['test/**/*.{test,spec}.?(c|m)[jt]s?(x)'],
    testTimeout: 1000 * 29,
  },
})
