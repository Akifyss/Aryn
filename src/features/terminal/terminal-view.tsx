import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { CloseLine, Copy2Line, DownLine, PasteLine, Refresh2Line, SearchLine, UpLine } from '@mingcute/react'
import { AppIconButton } from '@/components/app-icon-button'
import { AppButton } from '@/components/app-button'
import { TerminalController, initialTerminalPresentation } from './terminal-controller'
import { TerminalScrollArea } from './terminal-scroll-area'
import '@xterm/xterm/css/xterm.css'
import './styles.css'

export function TerminalView({ id, projectId, visible, focused }: { id: string; projectId: string; visible: boolean; focused: boolean }) {
  const host = useRef<HTMLDivElement>(null)
  const controller = useRef<TerminalController | null>(null)
  const [instance, setInstance] = useState<TerminalController | null>(null)
  const [presentation, setPresentation] = useState(initialTerminalPresentation)
  const [attempt, setAttempt] = useState(0)
  const [restarting, setRestarting] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [found, setFound] = useState(true)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!host.current) return
    if (!window.appApi?.terminal) {
      setPresentation({ ...initialTerminalPresentation, status: 'error', error: '终端需要桌面应用，请在 Aryn 中打开。' })
      return
    }
    setPresentation(initialTerminalPresentation)
    const current = new TerminalController(host.current, window.appApi.terminal, setPresentation, () => setSearchOpen(true))
    controller.current = current
    setInstance(current)
    void current.open(id, projectId)
    return () => { controller.current = null; current.dispose() }
  }, [id, projectId, attempt])
  useLayoutEffect(() => controller.current?.setVisible(visible, visible && focused), [visible, focused, instance])
  useEffect(() => { if (searchOpen) input.current?.focus() }, [searchOpen])
  const search = (previous = false, value = query, incremental = false) => {
    if (!instance || !value) { setFound(true); instance?.search.clearDecorations(); return }
    setFound(previous ? instance.search.findPrevious(value) : instance.search.findNext(value, { incremental }))
  }
  const closeSearch = () => { setSearchOpen(false); instance?.search.clearDecorations(); instance?.focus() }
  const restart = async () => {
    if (restarting) return
    setRestarting(true)
    try {
      if (!window.appApi?.terminal || await window.appApi.terminal.close(id, 'restart')) setAttempt(value => value + 1)
    } catch (error) {
      setPresentation(state => ({ ...state, error: error instanceof Error ? error.message : String(error) }))
    } finally { setRestarting(false) }
  }
  const status = presentation.status === 'starting' ? '正在启动…' : presentation.status === 'running' ? '运行中'
    : presentation.status === 'exited' ? `已退出${presentation.exitCode === null ? '' : ` · ${presentation.exitCode}`}` : '启动失败'
  return <section className='terminal-surface' data-terminal-surface data-terminal-id={id} aria-label='终端'>
    <div className='terminal-toolbar'>
      <div className='terminal-caption' title={presentation.cwd}>
        <span className='terminal-shell'>{presentation.shell || '终端'}</span>
        <span className='terminal-status' role='status'>{status}</span>
        {presentation.cwd ? <span className='terminal-cwd'>{presentation.cwd}</span> : null}
      </div>
      <div className='terminal-actions'>
        <AppIconButton aria-label='复制终端选中内容' tooltip='复制选中内容 · Ctrl+Shift+C' onClick={() => { void instance?.copy() }}><Copy2Line /></AppIconButton>
        <AppIconButton aria-label='粘贴到终端' tooltip='粘贴 · Ctrl+Shift+V' disabled={presentation.status !== 'running'} onClick={() => { void instance?.paste() }}><PasteLine /></AppIconButton>
        <AppIconButton aria-label='查找终端内容' tooltip='查找 · Ctrl+F' onClick={() => setSearchOpen(value => !value)}><SearchLine /></AppIconButton>
        <AppIconButton aria-label='重新启动终端' tooltip='重新启动终端' disabled={restarting} onClick={() => { void restart() }}><Refresh2Line /></AppIconButton>
      </div>
    </div>
    {searchOpen ? <div className='terminal-search' role='search' onKeyDown={event => {
      event.stopPropagation()
      if (event.key === 'Escape') closeSearch()
      if (event.key === 'Enter') { event.preventDefault(); search(event.shiftKey) }
    }}>
      <input ref={input} aria-label='查找终端内容' value={query} placeholder='查找' onChange={event => { setQuery(event.target.value); search(false, event.target.value, true) }} />
      {!found ? <span role='status'>无匹配项</span> : null}
      <AppIconButton aria-label='上一个匹配项' tooltip='上一个' onClick={() => search(true)}><UpLine /></AppIconButton>
      <AppIconButton aria-label='下一个匹配项' tooltip='下一个' onClick={() => search()}><DownLine /></AppIconButton>
      <AppIconButton aria-label='关闭终端查找' tooltip='关闭查找' onClick={closeSearch}><CloseLine /></AppIconButton>
    </div> : null}
    {presentation.error ? <div className='terminal-error' role='alert'>
      <span>{presentation.error}</span>
      {presentation.status === 'error' ? <AppButton size='sm' variant='ghost' onClick={() => { void restart() }}>重试</AppButton> : null}
    </div> : null}
    <TerminalScrollArea terminal={instance?.terminal ?? null}>
      <div className='terminal-viewport' ref={host} />
    </TerminalScrollArea>
  </section>
}
