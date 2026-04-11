import { app, dialog } from 'electron'
import { appendFileSync, mkdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

function toErrorText(error: unknown) {
  if (error instanceof Error) {
    return error.stack || `${error.name}: ${error.message}`
  }

  return String(error)
}

function writeStartupErrorLog(error: unknown) {
  try {
    const logDirectoryPath = path.join(os.tmpdir(), 'aryn')
    const logFilePath = path.join(logDirectoryPath, 'startup-error.log')
    mkdirSync(logDirectoryPath, { recursive: true })
    appendFileSync(
      logFilePath,
      `[${new Date().toISOString()}] ${toErrorText(error)}\n\n`,
      'utf8',
    )
  } catch {
    // Ignore logging failures so the original startup error remains primary.
  }
}

function writeStartupMarker(message: string) {
  try {
    const logDirectoryPath = path.join(os.tmpdir(), 'aryn')
    const logFilePath = path.join(logDirectoryPath, 'startup-marker.log')
    mkdirSync(logDirectoryPath, { recursive: true })
    appendFileSync(logFilePath, `[${new Date().toISOString()}] ${message}\n`, 'utf8')
  } catch {
    // Ignore marker failures.
  }
}

function reportStartupError(error: unknown) {
  const errorText = toErrorText(error)
  writeStartupErrorLog(error)
  dialog.showErrorBox('Aryn Startup Error', errorText)
}

writeStartupMarker('bootstrap-loaded')

if (app.isPackaged) {
  process.env.PI_FORCE_VIRTUAL_MODULES = '1'
  writeStartupMarker('pi-virtual-modules-enabled')
}

process.on('uncaughtException', (error) => {
  reportStartupError(error)
  app.exit(1)
})

process.on('unhandledRejection', (reason) => {
  reportStartupError(reason)
  app.exit(1)
})

void import('./index').then(() => {
  writeStartupMarker('main-import-resolved')
}).catch((error) => {
  reportStartupError(error)
  app.exit(1)
})
