import { rmSync } from 'node:fs'
import { builtinModules } from 'node:module'
import path from 'node:path'
import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron/simple'
import pkg from './package.json'

const bundledElectronRuntimeExternals = new Set([
  'electron',
  'bufferutil',
  ...builtinModules,
  ...builtinModules.map((moduleName) => `node:${moduleName}`),
  'utf-8-validate',
  'ws',
])

const bundledElectronPackageExternals = [
  '@mariozechner/pi-agent-core',
  '@mariozechner/pi-ai',
  '@mariozechner/pi-coding-agent',
  '@mariozechner/pi-tui',
  '@silvia-odwyer/photon-node',
  ...Object.keys(pkg.dependencies ?? {}),
]

function isBundledElectronRuntimeExternal(id: string) {
  if (bundledElectronRuntimeExternals.has(id)) {
    return true
  }

  if (bundledElectronPackageExternals.some((packageName) => id === packageName || id.startsWith(`${packageName}/`))) {
    return true
  }

  if (id.startsWith('node:')) {
    return true
  }

  if (id === 'ws' || id.startsWith('ws/')) {
    return true
  }

  if (id === 'bufferutil' || id.startsWith('bufferutil/')) {
    return true
  }

  if (id === 'utf-8-validate' || id.startsWith('utf-8-validate/')) {
    return true
  }

  // Handle subpath imports such as `fs/promises` without matching local paths like `electron/preload/index.ts`.
  return builtinModules.some((moduleName) => id === moduleName || id.startsWith(`${moduleName}/`))
}

// https://vitejs.dev/config/
export default defineConfig(({ command }) => {
  rmSync('dist-electron', { recursive: true, force: true })

  const isServe = command === 'serve'
  const isBuild = command === 'build'
  const sourcemap = isServe || !!process.env.VSCODE_DEBUG
  const devServerOptions = process.env.VSCODE_DEBUG
    ? (() => {
        const url = new URL(pkg.debug.env.VITE_DEV_SERVER_URL)
        return {
          host: url.hostname,
          port: +url.port,
        }
      })()
    : {}

  return {
    resolve: {
      alias: {
        '@': path.join(__dirname, 'src')
      },
    },
    plugins: [
      tailwindcss(),
      react(),
      electron({
        main: {
          // Shortcut of `build.lib.entry`
          entry: 'electron/main/entry.ts',
          onstart(args) {
            if (process.env.VSCODE_DEBUG) {
              console.log(/* For `.vscode/.debug.script.mjs` */'[startup] Electron App')
            } else {
              args.startup()
            }
          },
          vite: {
            build: {
              cssMinify: false,
              sourcemap,
              minify: isBuild,
              outDir: 'dist-electron/main',
              rollupOptions: {
                external: isBundledElectronRuntimeExternal,
                output: {
                  entryFileNames: 'index.js',
                  chunkFileNames: 'chunks/[name].js',
                },
              },
            },
          },
        },
        preload: {
          // Shortcut of `build.rollupOptions.input`.
          // Preload scripts may contain Web assets, so use the `build.rollupOptions.input` instead `build.lib.entry`.
          input: 'electron/preload/index.ts',
          vite: {
            build: {
              cssMinify: false,
              sourcemap: sourcemap ? 'inline' : undefined, // #332
              minify: isBuild,
              outDir: 'dist-electron/preload',
              rollupOptions: {
                external: isBundledElectronRuntimeExternal,
                output: {
                  chunkFileNames: 'chunks/[name].js',
                },
              },
            },
          },
        },
        // Ployfill the Electron and Node.js API for Renderer process.
        // If you want use Node.js in Renderer process, the `nodeIntegration` needs to be enabled in the Main process.
        // See 👉 https://github.com/electron-vite/vite-plugin-electron-renderer
        renderer: {},
      }),
    ],
    server: {
      ...devServerOptions,
      watch: {
        ignored: [
          '**/.git/**',
          '**/.tmp/**',
          '**/dist/**',
          '**/dist-electron/**',
          '**/release/**',
          '**/tmp/**',
        ],
      },
    },
    clearScreen: false,
    build: {
      cssMinify: false,
    },
  }
})
