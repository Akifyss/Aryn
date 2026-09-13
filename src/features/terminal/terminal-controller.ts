import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { TERMINAL_CSI_QUERIES, TERMINAL_MAX_INPUT, TERMINAL_SCROLLBACK, type TerminalApi, type TerminalEvent, type TerminalRef } from '../../../electron/shared/contracts/terminal'

export type TerminalPresentation = {
  status: 'starting' | 'running' | 'exited' | 'error'
  cwd: string; shell: string; exitCode: number | null; error: string | null
}
export const initialTerminalPresentation: TerminalPresentation = { status: 'starting', cwd: '', shell: '', exitCode: null, error: null }

// Workbench shortcuts keep their existing meaning. Other chords (Ctrl+K/S,
// arrows, Tab, Escape...) belong to the shell while its input has focus.
export function isTerminalWorkbenchShortcut(event: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'key'>) {
  return (event.ctrlKey || event.metaKey) && ['w', 'tab', 'pageup', 'pagedown'].includes(event.key.toLowerCase())
}

export class TerminalController {
  readonly terminal: Terminal
  readonly search = new SearchAddon()
  private fit = new FitAddon()
  private subscriptions: Array<{ dispose: () => void }> = []
  private stopEvents: () => void
  private observer: ResizeObserver
  private themeObserver: MutationObserver
  private disposed = false
  private visible = false
  private focused = false
  private ready = false
  private replaying = true
  private frame = 0
  private reference: TerminalRef | null = null
  private sequence = 0
  private id = ''
  private readonly viewId = crypto.randomUUID()
  private queued: TerminalEvent[] = []
  private state = { ...initialTerminalPresentation }
  private input = Promise.resolve()
  private requestedSize = ''

  constructor(private readonly host: HTMLElement, private readonly api: TerminalApi,
    private readonly changed: (state: TerminalPresentation) => void, private readonly find: () => void) {
    const activateLink = (event: MouseEvent, url: string) => {
      if (!(event.ctrlKey || event.metaKey) || !/^https?:\/\//i.test(url)) return
      void window.appApi.openExternalLink(url).catch(error => this.showError(error))
    }
    this.terminal = new Terminal({ cursorBlink: true, cursorStyle: 'bar', fontSize: 13, lineHeight: 1.3,
      fontFamily: '"Cascadia Code", "Cascadia Mono", Consolas, "SFMono-Regular", Menlo, monospace',
      scrollback: TERMINAL_SCROLLBACK, allowProposedApi: true, scrollOnUserInput: true, disableStdin: true,
      theme: this.theme(), linkHandler: { activate: activateLink } })
    this.terminal.loadAddon(this.fit)
    this.terminal.loadAddon(this.search)
    for (const identifier of TERMINAL_CSI_QUERIES) this.subscriptions.push(this.terminal.parser.registerCsiHandler(identifier, () => true))
    this.subscriptions.push(this.terminal.parser.registerDcsHandler({ intermediates: '$', final: 'q' }, () => true))
    this.terminal.loadAddon(new WebLinksAddon(activateLink))
    this.terminal.open(host)
    this.terminal.textarea?.setAttribute('aria-label', '终端输入')
    this.subscriptions.push(this.terminal.onData(data => {
      if (!this.replaying && this.state.status === 'running') this.send(data)
    }))
    this.terminal.attachCustomKeyEventHandler(event => {
      if (isTerminalWorkbenchShortcut(event)) return false
      event.stopPropagation()
      if (event.type !== 'keydown') return true
      const key = event.key.toLowerCase()
      const modifier = event.ctrlKey || event.metaKey
      if (modifier && key === 'f') { event.preventDefault(); this.find(); return false }
      if (modifier && key === 'c' && (event.shiftKey || this.terminal.hasSelection())) {
        event.preventDefault(); void this.copy(); return false
      }
      if (modifier && key === 'v' && (event.shiftKey || event.metaKey)) {
        event.preventDefault(); void this.paste(); return false
      }
      return true
    })
    this.stopEvents = api.onEvent(event => {
      if (event.id !== this.id) return
      if (!this.reference) this.queued.push(event)
      else this.accept(event)
    })
    this.observer = new ResizeObserver(() => this.scheduleFit())
    this.observer.observe(host)
    this.themeObserver = new MutationObserver(() => { this.terminal.options.theme = this.theme() })
    this.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] })
  }

  private theme() {
    // Canvas cannot resolve var()/oklch() consistently. Resolve tokens through
    // the browser to concrete sRGB colors, following the surrounding app theme.
    const probe = document.createElement('span')
    const canvas = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!
    this.host.appendChild(probe)
    const resolve = (token: string, fallback: string) => {
      probe.style.color = `var(${token}, ${fallback})`
      canvas.fillStyle = getComputedStyle(probe).color
      canvas.fillRect(0, 0, 1, 1)
      const [r, g, b] = canvas.getImageData(0, 0, 1, 1).data
      return `#${[r, g, b].map(value => value.toString(16).padStart(2, '0')).join('')}`
    }
    const background = resolve('--background-primary', '#ffffff')
    const foreground = resolve('--foreground-primary', '#20242c')
    probe.remove()
    const dark = parseInt(background.slice(1, 3), 16) < 128
    return { background, foreground, cursor: foreground, cursorAccent: background,
      selectionBackground: dark ? '#36567d' : '#c8ddf6',
      black: dark ? '#454b55' : '#20242c', red: dark ? '#ff8b92' : '#b32238', green: dark ? '#92d69f' : '#216b35',
      yellow: dark ? '#e8c775' : '#806009', blue: dark ? '#88baff' : '#165eaf', magenta: dark ? '#d9a3ee' : '#8342a6',
      cyan: dark ? '#77ced6' : '#176f79', white: dark ? '#dfe4ed' : '#626b79',
      brightBlack: dark ? '#a4adbb' : '#626b79', brightRed: dark ? '#ffb3b8' : '#b32238', brightGreen: dark ? '#b4e8bd' : '#216b35',
      brightYellow: dark ? '#f4dfa8' : '#806009', brightBlue: dark ? '#b0d0ff' : '#165eaf', brightMagenta: dark ? '#ebc5f8' : '#8342a6',
      brightCyan: dark ? '#abe5ea' : '#176f79', brightWhite: dark ? '#ffffff' : '#20242c' }
  }

  async open(id: string, projectId: string) {
    this.id = id
    try {
      const dimensions = this.fit.proposeDimensions()
      const snapshot = await this.api.open({ id, projectId, viewId: this.viewId, cols: Math.min(500, Math.max(2, dimensions?.cols ?? 80)),
        rows: Math.min(300, Math.max(1, dimensions?.rows ?? 24)) })
      if (this.disposed) return // StrictMode/remount detaches the view, never kills its session.
      this.reference = { id, generation: snapshot.generation }
      this.sequence = snapshot.sequence
      this.terminal.options.screenReaderMode = snapshot.screenReaderMode
      this.terminal.options.windowsPty = snapshot.windowsPty ?? {}
      this.terminal.resize(snapshot.cols, snapshot.rows)
      await new Promise<void>(resolve => this.terminal.write(snapshot.screen, resolve))
      if (this.disposed) return
      this.replaying = false
      this.ready = true
      this.update({ status: snapshot.status, cwd: snapshot.cwd, shell: snapshot.shell, exitCode: snapshot.exitCode, error: null })
      for (const event of this.queued) this.accept(event)
      this.queued = []
      this.scheduleFit()
      if (this.visible && this.focused) this.focus()
    } catch (error) { if (!this.disposed) this.update({ status: 'error', error: String(error instanceof Error ? error.message : error) }) }
  }

  private accept(event: TerminalEvent) {
    if (this.disposed || event.id !== this.reference?.id || event.generation !== this.reference.generation) return
    if (!this.ready) { this.queued.push(event); return }
    if (event.type === 'data' || event.type === 'resize') {
      if (event.sequence <= this.sequence) return
      this.sequence = event.sequence
      if (event.type === 'resize') {
        // xterm.write is asynchronous. Keep resize behind all preceding bytes.
        this.terminal.write('', () => {
          if (this.disposed) return
          this.terminal.resize(event.cols, event.rows)
          this.scheduleFit()
        })
        return
      }
      this.terminal.write(event.data, () => {
        if (!this.disposed) this.api.acknowledge({ ...this.reference!, viewId: this.viewId, sequence: event.sequence })
      })
    } else if (event.type === 'error') this.showError(event.message)
    else if (event.type === 'exit') this.update({ status: 'exited', exitCode: event.exitCode })
    else this.update({ status: 'exited', error: null })
  }

  private update(patch: Partial<TerminalPresentation>) {
    this.state = { ...this.state, ...patch }
    this.terminal.options.disableStdin = this.state.status !== 'running'
    this.changed(this.state)
  }
  private showError(error: unknown) { if (!this.disposed) this.update({ error: error instanceof Error ? error.message : String(error) }) }
  private send(data: string) {
    const reference = this.reference
    if (!reference) return
    // Serialize large pastes and normal keystrokes; bounded IPC messages preserve
    // bracketed paste and surrogate pairs instead of interleaving user input.
    for (let offset = 0; offset < data.length;) {
      let end = Math.min(offset + TERMINAL_MAX_INPUT, data.length)
      if (end < data.length && /[\uD800-\uDBFF]/.test(data[end - 1])) end--
      const chunk = data.slice(offset, end)
      offset = end
      this.input = this.input.then(async () => {
        if (!this.disposed && this.state.status === 'running') await this.api.write({ ...reference, data: chunk })
      }).catch(error => this.showError(error))
    }
  }
  setVisible(visible: boolean, focus = false) {
    this.visible = visible
    this.focused = focus
    if (visible) { this.scheduleFit(); if (focus && this.ready) this.focus() }
  }
  private scheduleFit() {
    if (this.frame || this.disposed || !this.visible || !this.ready) return
    this.frame = requestAnimationFrame(() => {
      this.frame = 0
      if (!this.visible || !this.host.getClientRects().length) return
      const dimensions = this.fit.proposeDimensions()
      if (!dimensions) return
      const cols = Math.min(500, Math.max(2, dimensions.cols)), rows = Math.min(300, Math.max(1, dimensions.rows))
      const size = `${cols}:${rows}`
      if (size === this.requestedSize) return
      this.requestedSize = size
      void this.api.resize({ ...this.reference!, cols, rows }).catch(error => { this.requestedSize = ''; this.showError(error) })
    })
  }
  focus() { this.terminal.focus() }
  async copy() {
    try { if (this.terminal.hasSelection()) await navigator.clipboard.writeText(this.terminal.getSelection()) }
    catch (error) { this.showError(error) }
  }
  async paste() {
    try { const text = await navigator.clipboard.readText(); if (!this.disposed && this.state.status === 'running') this.terminal.paste(text) }
    catch (error) { this.showError(error) }
    this.focus()
  }
  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.frame)
    this.stopEvents()
    if (this.id) this.api.detach({ id: this.id, viewId: this.viewId })
    this.observer.disconnect()
    this.themeObserver.disconnect()
    this.subscriptions.forEach(subscription => subscription.dispose())
    this.terminal.dispose()
    this.queued = []
  }
}
