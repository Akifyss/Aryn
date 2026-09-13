import { randomUUID } from 'node:crypto'
import path from 'node:path'

/** Session-local command boundaries; never infer activity from visible prompt text. */
export class TerminalShellActivity {
  readonly nonce = randomUUID()
  status: 'idle' | 'busy' | 'unknown' = 'unknown'
  revision = 0

  onInput(data: string) {
    this.revision++
    // Close may arrive before the shell's execution marker. Until a fresh
    // read/execute boundary arrives, Enter must not reuse the previous idle state.
    if (/[\r\n]/.test(data) && this.status === 'idle') this.status = 'unknown'
  }

  onOsc(data: string) {
    const status = data.startsWith(`Aryn;${this.nonce};`) ? data.slice(`Aryn;${this.nonce};`.length) : ''
    if (status === 'idle' || status === 'busy' || status === 'unknown') {
      this.status = status
      this.revision++
      return true
    }
    return false
  }

  launchArgs(file: string, args: string[]) {
    if (!/^(pwsh|powershell)(\.exe)?$/i.test(path.basename(file))) return args
    // Hook the interactive reader, not the prompt. This preserves custom prompts,
    // $? / LASTEXITCODE and existing PSReadLine bindings, and detects cmdlets that
    // run inside PowerShell without creating a child process (e.g. Start-Sleep).
    // No profile writes, command text reporting, or execution-policy bypass.
    const script = `
if ($ExecutionContext.SessionState.LanguageMode -eq 'FullLanguage' -and (Test-Path Function:\\PSConsoleHostReadLine)) {
  $global:__ArynReadLine = $function:PSConsoleHostReadLine
  function global:PSConsoleHostReadLine {
    $arynState = 'idle'
    if ($NestedPromptLevel -gt 0) { $arynState = 'unknown' }
    foreach ($arynJob in @(Microsoft.PowerShell.Core\\Get-Job)) {
      if ($arynJob.State -notin @('Completed', 'Failed', 'Stopped')) { $arynState = 'unknown'; break }
    }
    [Console]::Write("$([char]27)]633;Aryn;${this.nonce};$arynState$([char]7)")
    $arynLine = $global:__ArynReadLine.Invoke()
    [Console]::Write("$([char]27)]633;Aryn;${this.nonce};busy$([char]7)")
    $arynLine
  }
}
`
    return [...args, '-NoExit', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')]
  }
}
