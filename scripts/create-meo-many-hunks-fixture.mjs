#!/usr/bin/env node
import { existsSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const defaultOutputPath = path.resolve('tmp', 'meo-many-hunks-workspace')

function readArgs(argv) {
  const options = {
    outputPath: defaultOutputPath,
    lineCount: 2400,
    replace: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (arg === 'replace') {
      options.replace = true
      continue
    }

    if (arg.startsWith('lines=')) {
      options.lineCount = Number.parseInt(arg.slice('lines='.length), 10)
      continue
    }

    if (arg.startsWith('out=')) {
      options.outputPath = path.resolve(arg.slice('out='.length))
      continue
    }

    if (arg === '--out') {
      options.outputPath = path.resolve(argv[index + 1] ?? '')
      index += 1
      continue
    }

    if (arg === '--lines') {
      options.lineCount = Number.parseInt(argv[index + 1] ?? '', 10)
      index += 1
      continue
    }

    if (arg === '--replace' || arg === '--force') {
      options.replace = true
      continue
    }

    throw new Error(`Unknown argument: ${arg}`)
  }

  if (!Number.isFinite(options.lineCount) || options.lineCount < 100) {
    throw new Error('--lines must be a number greater than or equal to 100')
  }

  return options
}

function baselineLine(lineNumber) {
  if (lineNumber % 120 === 0) {
    return `## Section ${lineNumber}`
  }

  if (lineNumber % 65 === 0) {
    return `| Row ${lineNumber} | baseline value ${lineNumber} | [link](https://example.com/${lineNumber}) |`
  }

  if (lineNumber % 7 === 0) {
    return `- item ${lineNumber} with **bold baseline** text and [link](https://example.com/${lineNumber})`
  }

  return `Paragraph ${lineNumber} with enough baseline text to wrap in split mode and keep the markdown renderer busy while scrolling.`
}

function createBaselineDocument(lineCount) {
  const lines = [
    '# Many hunks scroll fixture',
    '',
    'This generated file is intentionally long and markdown-heavy.',
    '',
  ]

  for (let lineNumber = 1; lineNumber <= lineCount; lineNumber += 1) {
    if (lineNumber % 260 === 0) {
      lines.push('| Case | Baseline | Score |')
      lines.push('|---|---:|---:|')
      lines.push(`| table block ${lineNumber} | baseline | ${lineNumber % 10} |`)
      continue
    }

    lines.push(baselineLine(lineNumber))
  }

  return `${lines.join('\n')}\n`
}

function createModifiedDocument(lineCount) {
  const lines = [
    '# Many hunks scroll fixture',
    '',
    'This generated file is intentionally long and markdown-heavy.',
    '',
  ]

  for (let lineNumber = 1; lineNumber <= lineCount; lineNumber += 1) {
    if (lineNumber % 53 === 0) {
      continue
    }

    if (lineNumber % 260 === 0) {
      lines.push('| Case | Modified | Score |')
      lines.push('|---|---:|---:|')
      lines.push(`| table block ${lineNumber} | changed | ${(lineNumber % 10) + 1} | EXTRA-HUNK-${lineNumber}`)
      continue
    }

    let line = baselineLine(lineNumber)
    if (lineNumber % 11 === 0) {
      line = line.replaceAll('baseline', 'changed')
      line = line.replace('Paragraph', 'Paragraph')
      line = `${line} EXTRA-HUNK-${lineNumber}`
    }

    lines.push(line)

    if (lineNumber % 37 === 0) {
      lines.push(`Inserted detail after ${lineNumber} to force split spacer layout and hunk action alignment.`)
    }
  }

  return `${lines.join('\n')}\n`
}

async function runGit(cwd, args) {
  await execFileAsync('git', args, { cwd })
}

async function main() {
  const options = readArgs(process.argv.slice(2))
  const workspacePath = options.outputPath
  const filePath = path.join(workspacePath, 'many-hunks.md')

  if (existsSync(workspacePath)) {
    if (!options.replace) {
      throw new Error(`Output path already exists: ${workspacePath}. Re-run with --replace to replace it.`)
    }
    await rm(workspacePath, { recursive: true, force: true })
  }

  await mkdir(workspacePath, { recursive: true })
  await writeFile(filePath, createBaselineDocument(options.lineCount), 'utf8')

  await runGit(workspacePath, ['init'])
  await runGit(workspacePath, ['config', 'core.autocrlf', 'false'])
  await runGit(workspacePath, ['config', 'user.name', 'Meo Fixture'])
  await runGit(workspacePath, ['config', 'user.email', 'meo-fixture@example.invalid'])
  await runGit(workspacePath, ['add', 'many-hunks.md'])
  await runGit(workspacePath, ['commit', '-m', 'Create baseline many-hunks fixture'])

  await writeFile(filePath, createModifiedDocument(options.lineCount), 'utf8')

  const { stdout } = await execFileAsync('git', ['status', '--short'], { cwd: workspacePath })
  console.log(`Created Meo many-hunks fixture workspace: ${workspacePath}`)
  console.log(`Open file in Aryn: ${filePath}`)
  console.log('')
  console.log(stdout.trimEnd())
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
