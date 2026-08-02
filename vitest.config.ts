import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.join(__dirname, 'src'),
      '@bb/domain': path.join(__dirname, 'packages/bb-session-surface/src/upstream/bb/packages/domain/src/index.ts'),
      '@bb/server-contract': path.join(__dirname, 'packages/bb-session-surface/src/compat/server-contract.ts'),
      '@bb/thread-view': path.join(__dirname, 'packages/bb-session-surface/src/upstream/bb/packages/thread-view/src/index.ts'),
    },
  },
  test: {
    root: __dirname,
    include: ['test/**/*.{test,spec}.?(c|m)[jt]s?(x)'],
    testTimeout: 1000 * 29,
  },
})
