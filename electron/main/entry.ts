import { app, dialog } from 'electron'
import { appendFileSync, mkdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { assertPiAgentRuntimeCompatible } from './runtime-requirements'

function toErrorText(error: unknown) {
  if (error instanceof Error) {
    return error.stack || `${error.name}: ${error.message}`
  }

  return String(error)
}

function writeFatalErrorLog(error: unknown) {
  try {
    const logDirectoryPath = path.join(os.tmpdir(), 'aryn')
    const logFilePath = path.join(logDirectoryPath, 'fatal-error.log')
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

function reportFatalError(title: string, error: unknown) {
  const errorText = toErrorText(error)
  writeFatalErrorLog(error)
  dialog.showErrorBox(title, errorText)
}

function reportStartupError(error: unknown) {
  reportFatalError('Aryn Startup Error', error)
}

function reportRuntimeError(error: unknown) {
  reportFatalError('Aryn Runtime Error', error)
}

writeStartupMarker('bootstrap-loaded')

assertPiAgentRuntimeCompatible()

if (app.isPackaged) {
  process.env.PI_FORCE_VIRTUAL_MODULES = '1'
  writeStartupMarker('pi-virtual-modules-enabled')
}

process.on('uncaughtException', (error) => {
  reportRuntimeError(error)
  app.exit(1)
})

process.on('unhandledRejection', (reason) => {
  reportRuntimeError(reason)
  app.exit(1)
})

void import('./index').then(() => {
  writeStartupMarker('main-import-resolved')
}).catch((error) => {
  reportStartupError(error)
  app.exit(1)
})
