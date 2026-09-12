import path from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS_SECTION,
  SETTINGS_SECTIONS,
  normalizeSettingsSection,
} from '../src/features/settings/lib/settings-sections'

describe('settings command boundaries', () => {
  it('type-checks valid bindings and rejects event/section command confusion', () => {
    const configPath = path.resolve('tsconfig.json')
    const config = ts.readConfigFile(configPath, ts.sys.readFile)
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath))
    const fixture = path.resolve('test/fixtures/settings-command-contract.ts')
    const program = ts.createProgram([fixture], parsed.options)
    const source = program.getSourceFile(fixture)!
    const diagnostics = [...program.getSyntacticDiagnostics(source), ...program.getSemanticDiagnostics(source)]
    expect(diagnostics.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))).toEqual([])
  })

  it('preserves every known section and recovers invalid retained state to the default', () => {
    for (const section of SETTINGS_SECTIONS) {
      expect(normalizeSettingsSection(section.id)).toBe(section.id)
    }
    for (const value of [{ type: 'click' }, 'removed-section', undefined, null, '', 0]) {
      expect(normalizeSettingsSection(value)).toBe(DEFAULT_SETTINGS_SECTION)
    }
  })
})
