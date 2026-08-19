import {
  BlockquoteLine,
  BoldLine,
  BracketsLine,
  CodeLine,
  Columns2Line,
  DownLine,
  EditLine,
  FontSizeLine,
  GitCompareLine,
  HashtagLine,
  ItalicLine,
  Keyboard2Line,
  LinkLine,
  ListCheck3Line,
  ListCheckLine,
  ListOrderedLine,
  PicLine,
  Rows2Line,
  SearchLine,
  StrikethroughLine,
  Table2Line,
  UpLine,
} from '@mingcute/react'
import { Input } from '@heroui/react'
import headingIcon from '@iconify-icons/lucide/heading'
import heading1Icon from '@iconify-icons/lucide/heading-1'
import heading2Icon from '@iconify-icons/lucide/heading-2'
import heading3Icon from '@iconify-icons/lucide/heading-3'
import heading4Icon from '@iconify-icons/lucide/heading-4'
import heading5Icon from '@iconify-icons/lucide/heading-5'
import heading6Icon from '@iconify-icons/lucide/heading-6'
import listTreeIcon from '@iconify-icons/lucide/list-tree'
import minusIcon from '@iconify-icons/lucide/minus'
import replaceIcon from '@iconify-icons/lucide/replace'
import replaceAllIcon from '@iconify-icons/lucide/replace-all'
import wholeWordIcon from '@iconify-icons/lucide/whole-word'
import { Icon as OfflineIcon } from '@iconify/react/offline'
import {
  forwardRef,
  memo,
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from 'react'
import {
  AppIconButton,
  type AppIconButtonSize,
} from '@/components/app-icon-button'
import { AppMenu as Menu } from '@/components/app-menu'
import {
  ViewerToolbar,
  ViewerToolbarGroup,
  ViewerToolbarSeparator,
} from '@/components/ui/document-viewer-controls'
import {
  SegmentedTabs,
  type SegmentedTabOption,
} from '@/components/ui/segmented-tabs/segmented-tabs'
import {
  MeoNativeOutline,
  type MeoNativeOutlineController,
} from '@/features/editor/lib/meo-native-outline'
import type {
  MeoEditorInstance,
  MeoEditorMode,
} from '@/features/editor/lib/meo-native-editor-types'
import type { FindPanelElements } from '@/vendor/meo/webview/helpers/findPanel'
import type { SelectionMenuElements } from '@/vendor/meo/webview/helpers/selectionMenu'
import './meo-native-editor-shell.css'

const HEADING_LEVELS = [
  { icon: heading1Icon, level: 1 },
  { icon: heading2Icon, level: 2 },
  { icon: heading3Icon, level: 3 },
  { icon: heading4Icon, level: 4 },
  { icon: heading5Icon, level: 5 },
  { icon: heading6Icon, level: 6 },
] as const

const MODE_OPTIONS = [
  {
    ariaLabel: 'Live preview mode',
    icon: <EditLine aria-hidden='true' />,
    tooltip: 'Live preview',
    value: 'live',
  },
  {
    ariaLabel: 'Markdown source mode',
    icon: <CodeLine aria-hidden='true' />,
    tooltip: 'Markdown source',
    value: 'source',
  },
  {
    ariaLabel: 'Split diff mode',
    icon: <Columns2Line aria-hidden='true' />,
    tooltip: 'Split diff',
    value: 'diff-split',
  },
  {
    ariaLabel: 'Unified diff mode',
    icon: <Rows2Line aria-hidden='true' />,
    tooltip: 'Unified diff',
    value: 'diff-unified',
  },
] satisfies readonly SegmentedTabOption<MeoEditorMode>[]

type NativeMeoButtonMap = {
  bulletListBtn: HTMLButtonElement
  codeBlockBtn: HTMLButtonElement
  diffNextChangeBtn: HTMLButtonElement
  diffPreviousChangeBtn: HTMLButtonElement
  findToggleBtn: HTMLButtonElement
  gitChangesGutterBtn: HTMLButtonElement
  hrBtn: HTMLButtonElement
  imageBtn: HTMLButtonElement
  lineNumbersBtn: HTMLButtonElement
  linkBtn: HTMLButtonElement
  numberedListBtn: HTMLButtonElement
  outlineBtn: HTMLButtonElement
  quoteBtn: HTMLButtonElement
  tableBtn: HTMLButtonElement
  taskBtn: HTMLButtonElement
  wikiLinkBtn: HTMLButtonElement
}

type NativeMeoEditorShellActions = {
  getEditor: () => NativeMeoShellEditor | null
  onHeadingLevel: ((level: number) => void) | null
  onModeChange: ((mode: MeoEditorMode) => void) | null
}

type MeoHeadingMenuController = {
  close: () => void
}

type ElementSlot<T extends Element> = {
  current: T | null
}

type NativeMeoEditorChromeRefs = {
  buttons: {
    bulletListBtn: ElementSlot<HTMLButtonElement>
    codeBlockBtn: ElementSlot<HTMLButtonElement>
    diffNextChangeBtn: ElementSlot<HTMLButtonElement>
    diffPreviousChangeBtn: ElementSlot<HTMLButtonElement>
    findToggleBtn: ElementSlot<HTMLButtonElement>
    gitChangesGutterBtn: ElementSlot<HTMLButtonElement>
    hrBtn: ElementSlot<HTMLButtonElement>
    imageBtn: ElementSlot<HTMLButtonElement>
    lineNumbersBtn: ElementSlot<HTMLButtonElement>
    linkBtn: ElementSlot<HTMLButtonElement>
    numberedListBtn: ElementSlot<HTMLButtonElement>
    outlineBtn: ElementSlot<HTMLButtonElement>
    quoteBtn: ElementSlot<HTMLButtonElement>
    tableBtn: ElementSlot<HTMLButtonElement>
    taskBtn: ElementSlot<HTMLButtonElement>
    wikiLinkBtn: ElementSlot<HTMLButtonElement>
  }
  findPanel: {
    caseSensitiveBtn: ElementSlot<HTMLButtonElement>
    findInput: ElementSlot<HTMLInputElement>
    findNextBtn: ElementSlot<HTMLButtonElement>
    findPanel: ElementSlot<HTMLDivElement>
    findPrevBtn: ElementSlot<HTMLButtonElement>
    findStatus: ElementSlot<HTMLSpanElement>
    replaceAllBtn: ElementSlot<HTMLButtonElement>
    replaceBtn: ElementSlot<HTMLButtonElement>
    replaceInput: ElementSlot<HTMLInputElement>
    wholeWordBtn: ElementSlot<HTMLButtonElement>
  }
  modeGroup: ElementSlot<HTMLDivElement>
}

type MeoToolbarIconButtonProps = {
  action: string
  buttonRef: ElementSlot<HTMLButtonElement>
  children: ReactNode
  className?: string
  label: string
  pressed?: boolean
  size?: AppIconButtonSize
}

type NativeMeoShellEditor = Pick<
  MeoEditorInstance,
  'getHeadings' | 'moveHeadingSection' | 'scrollToLine'
>

export type NativeMeoEditorShell = {
  buttons: NativeMeoButtonMap
  disconnectController: () => void
  editorHost: HTMLDivElement
  editorWrapper: HTMLDivElement
  findPanelElements: FindPanelElements
  modeGroup: HTMLDivElement
  outlineController: MeoNativeOutlineController
  root: HTMLDivElement
  selectionMenuElements: SelectionMenuElements
  setEditorGetter: (handler: (() => NativeMeoShellEditor | null) | null) => void
  setHeadingLevelHandler: (handler: ((level: number) => void) | null) => void
  setMode: (mode: MeoEditorMode) => void
  setModeChangeHandler: (handler: ((mode: MeoEditorMode) => void) | null) => void
  toolbar: HTMLElement
}

function createElementSlot<T extends Element>(): ElementSlot<T> {
  return { current: null }
}

function bindElementSlot<T extends Element>(slot: ElementSlot<T>) {
  return (element: T | null) => {
    slot.current = element
  }
}

function requireElement<T extends Element>(slot: ElementSlot<T>, label: string): T {
  if (!slot.current) {
    throw new Error(`MEO React chrome did not mount ${label}`)
  }

  return slot.current
}

function createChromeRefs(): NativeMeoEditorChromeRefs {
  return {
    buttons: {
      bulletListBtn: createElementSlot(),
      codeBlockBtn: createElementSlot(),
      diffNextChangeBtn: createElementSlot(),
      diffPreviousChangeBtn: createElementSlot(),
      findToggleBtn: createElementSlot(),
      gitChangesGutterBtn: createElementSlot(),
      hrBtn: createElementSlot(),
      imageBtn: createElementSlot(),
      lineNumbersBtn: createElementSlot(),
      linkBtn: createElementSlot(),
      numberedListBtn: createElementSlot(),
      outlineBtn: createElementSlot(),
      quoteBtn: createElementSlot(),
      tableBtn: createElementSlot(),
      taskBtn: createElementSlot(),
      wikiLinkBtn: createElementSlot(),
    },
    findPanel: {
      caseSensitiveBtn: createElementSlot(),
      findInput: createElementSlot(),
      findNextBtn: createElementSlot(),
      findPanel: createElementSlot(),
      findPrevBtn: createElementSlot(),
      findStatus: createElementSlot(),
      replaceAllBtn: createElementSlot(),
      replaceBtn: createElementSlot(),
      replaceInput: createElementSlot(),
      wholeWordBtn: createElementSlot(),
    },
    modeGroup: createElementSlot(),
  }
}

function MeoToolbarIconButton({
  action,
  buttonRef,
  children,
  className,
  label,
  pressed,
  size = 'md',
}: MeoToolbarIconButtonProps) {
  return (
    <AppIconButton
      ref={bindElementSlot(buttonRef)}
      type='button'
      size={size}
      variant='ghost'
      className={['format-button', className].filter(Boolean).join(' ')}
      data-action={action}
      aria-label={label}
      aria-pressed={pressed}
      tooltip={label}
    >
      {children}
    </AppIconButton>
  )
}

const MeoHeadingMenu = forwardRef(function MeoHeadingMenu({
  actions,
}: {
  actions: NativeMeoEditorShellActions
}, forwardedRef: Ref<MeoHeadingMenuController>) {
  const [open, setOpen] = useState(false)

  useImperativeHandle(forwardedRef, () => ({
    close: () => setOpen(false),
  }), [])

  return (
    <Menu.Root modal={false} open={open} onOpenChange={setOpen}>
      <Menu.Trigger
        type='button'
        size='md'
        variant='icon'
        iconTooltip='Heading'
        className='format-button meo-heading-menu-trigger'
        aria-label='Heading'
      >
        <OfflineIcon aria-hidden='true' icon={headingIcon} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner align='start' side='bottom' sideOffset={4}>
          <Menu.Popup className='meo-heading-menu-popup' size='sm'>
            <Menu.List aria-label='Heading level'>
              {HEADING_LEVELS.map(({ icon, level }) => (
                <Menu.Item
                  key={level}
                  className='meo-heading-menu-item'
                  icon={<OfflineIcon aria-hidden='true' icon={icon} />}
                  text={`Heading ${level}`}
                  onClick={() => actions.onHeadingLevel?.(level)}
                />
              ))}
            </Menu.List>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
})

function MeoFindPanel({
  refs,
}: {
  refs: NativeMeoEditorChromeRefs['findPanel']
}) {
  return (
    <div
      ref={bindElementSlot(refs.findPanel)}
      className='find-panel'
      role='search'
      aria-label='Find and replace'
      aria-hidden='true'
    >
      <div className='find-row'>
        <div className='find-input-wrap'>
          <Input
            ref={bindElementSlot(refs.findInput)}
            type='search'
            variant='secondary'
            className='find-input'
            aria-label='Find'
            autoComplete='off'
            placeholder='Find'
            spellCheck={false}
          />
          <span
            ref={bindElementSlot(refs.findStatus)}
            className='find-status'
            role='status'
            aria-atomic='true'
            aria-live='polite'
          />
        </div>
        <MeoToolbarIconButton
          action='findWholeWord'
          buttonRef={refs.wholeWordBtn}
          className='toggle-button find-option-button'
          label='Whole word'
          pressed={false}
          size='sm'
        >
          <OfflineIcon aria-hidden='true' icon={wholeWordIcon} />
        </MeoToolbarIconButton>
        <MeoToolbarIconButton
          action='findCaseSensitive'
          buttonRef={refs.caseSensitiveBtn}
          className='toggle-button find-option-button'
          label='Case sensitive'
          pressed={false}
          size='sm'
        >
          <FontSizeLine aria-hidden='true' />
        </MeoToolbarIconButton>
        <MeoToolbarIconButton
          action='findPrevious'
          buttonRef={refs.findPrevBtn}
          label='Previous match'
          size='sm'
        >
          <UpLine aria-hidden='true' />
        </MeoToolbarIconButton>
        <MeoToolbarIconButton
          action='findNext'
          buttonRef={refs.findNextBtn}
          label='Next match'
          size='sm'
        >
          <DownLine aria-hidden='true' />
        </MeoToolbarIconButton>
      </div>
      <div className='find-row'>
        <Input
          ref={bindElementSlot(refs.replaceInput)}
          type='text'
          variant='secondary'
          className='find-input'
          aria-label='Replace'
          autoComplete='off'
          placeholder='Replace'
          spellCheck={false}
        />
        <MeoToolbarIconButton
          action='replaceCurrent'
          buttonRef={refs.replaceBtn}
          label='Replace current match'
          size='sm'
        >
          <OfflineIcon aria-hidden='true' icon={replaceIcon} />
        </MeoToolbarIconButton>
        <MeoToolbarIconButton
          action='replaceAll'
          buttonRef={refs.replaceAllBtn}
          label='Replace all matches'
          size='sm'
        >
          <OfflineIcon aria-hidden='true' icon={replaceAllIcon} />
        </MeoToolbarIconButton>
      </div>
    </div>
  )
}

function MeoSelectionMenu() {
  const actions = [
    { action: 'bold', icon: <BoldLine aria-hidden='true' />, label: 'Bold' },
    { action: 'italic', icon: <ItalicLine aria-hidden='true' />, label: 'Italic' },
    { action: 'lineover', icon: <StrikethroughLine aria-hidden='true' />, label: 'Strikethrough' },
    { action: 'inlineCode', icon: <CodeLine aria-hidden='true' />, label: 'Inline code' },
    { action: 'link', icon: <LinkLine aria-hidden='true' />, label: 'Link' },
    { action: 'wikiLink', icon: <BracketsLine aria-hidden='true' />, label: 'Wiki link' },
    { action: 'kbd', icon: <Keyboard2Line aria-hidden='true' />, label: 'Keyboard key' },
  ]

  return actions.map(({ action, icon, label }) => (
    <AppIconButton
      key={action}
      type='button'
      size='sm'
      variant='ghost'
      className='selection-inline-button'
      data-action={action}
      aria-label={label}
      tooltip={label}
    >
      {icon}
    </AppIconButton>
  ))
}

function MeoEditorToolbar({
  actions,
  headingMenuControllerRef,
  mode,
  refs,
}: {
  actions: NativeMeoEditorShellActions
  headingMenuControllerRef: Ref<MeoHeadingMenuController>
  mode: MeoEditorMode
  refs: NativeMeoEditorChromeRefs
}) {
  const { buttons } = refs

  return (
    <>
      <ViewerToolbarGroup>
        <MeoHeadingMenu ref={headingMenuControllerRef} actions={actions} />
        <MeoToolbarIconButton action='bulletList' buttonRef={buttons.bulletListBtn} label='Bullet list'>
          <ListCheckLine aria-hidden='true' />
        </MeoToolbarIconButton>
        <MeoToolbarIconButton action='numberedList' buttonRef={buttons.numberedListBtn} label='Numbered list'>
          <ListOrderedLine aria-hidden='true' />
        </MeoToolbarIconButton>
        <MeoToolbarIconButton action='task' buttonRef={buttons.taskBtn} label='Task list'>
          <ListCheck3Line aria-hidden='true' />
        </MeoToolbarIconButton>
        <ViewerToolbarSeparator />
        <MeoToolbarIconButton action='table' buttonRef={buttons.tableBtn} label='Table'>
          <Table2Line aria-hidden='true' />
        </MeoToolbarIconButton>
        <MeoToolbarIconButton action='codeBlock' buttonRef={buttons.codeBlockBtn} label='Code block'>
          <CodeLine aria-hidden='true' />
        </MeoToolbarIconButton>
        <MeoToolbarIconButton action='link' buttonRef={buttons.linkBtn} label='Link'>
          <LinkLine aria-hidden='true' />
        </MeoToolbarIconButton>
        <MeoToolbarIconButton action='wikiLink' buttonRef={buttons.wikiLinkBtn} label='Wiki link'>
          <BracketsLine aria-hidden='true' />
        </MeoToolbarIconButton>
        <MeoToolbarIconButton action='image' buttonRef={buttons.imageBtn} label='Image'>
          <PicLine aria-hidden='true' />
        </MeoToolbarIconButton>
        <MeoToolbarIconButton action='quote' buttonRef={buttons.quoteBtn} label='Quote'>
          <BlockquoteLine aria-hidden='true' />
        </MeoToolbarIconButton>
        <MeoToolbarIconButton action='hr' buttonRef={buttons.hrBtn} label='Horizontal rule'>
          <OfflineIcon aria-hidden='true' icon={minusIcon} />
        </MeoToolbarIconButton>
      </ViewerToolbarGroup>

      <ViewerToolbarGroup align='end'>
        <MeoToolbarIconButton
          action='outline'
          buttonRef={buttons.outlineBtn}
          className='toggle-button'
          label='Toggle document outline'
          pressed={false}
        >
          <OfflineIcon aria-hidden='true' icon={listTreeIcon} />
        </MeoToolbarIconButton>
        <MeoToolbarIconButton
          action='find'
          buttonRef={buttons.findToggleBtn}
          className='toggle-button'
          label='Find and replace'
          pressed={false}
        >
          <SearchLine aria-hidden='true' />
        </MeoToolbarIconButton>
        <MeoToolbarIconButton
          action='diffPreviousChange'
          buttonRef={buttons.diffPreviousChangeBtn}
          className='diff-split-only-button'
          label='Previous change'
        >
          <UpLine aria-hidden='true' />
        </MeoToolbarIconButton>
        <MeoToolbarIconButton
          action='diffNextChange'
          buttonRef={buttons.diffNextChangeBtn}
          className='diff-split-only-button'
          label='Next change'
        >
          <DownLine aria-hidden='true' />
        </MeoToolbarIconButton>
        <MeoToolbarIconButton
          action='lineNumbers'
          buttonRef={buttons.lineNumbersBtn}
          className='toggle-button'
          label='Toggle line numbers'
          pressed={false}
        >
          <HashtagLine aria-hidden='true' />
        </MeoToolbarIconButton>
        <MeoToolbarIconButton
          action='gitChangesGutter'
          buttonRef={buttons.gitChangesGutterBtn}
          className='toggle-button'
          label='Toggle Git changes'
          pressed={false}
        >
          <GitCompareLine aria-hidden='true' />
        </MeoToolbarIconButton>
      </ViewerToolbarGroup>

      <div
        ref={bindElementSlot(refs.modeGroup)}
        className='meo-editor-mode-switch'
      >
        <SegmentedTabs<MeoEditorMode>
          ariaLabel='Markdown editor mode'
          options={MODE_OPTIONS}
          value={mode}
          onValueChange={(nextMode) => actions.onModeChange?.(nextMode)}
        />
      </div>

      <MeoFindPanel refs={refs.findPanel} />
    </>
  )
}

function resolveButtons(refs: NativeMeoEditorChromeRefs): NativeMeoButtonMap {
  return {
    bulletListBtn: requireElement(refs.buttons.bulletListBtn, 'bullet list button'),
    codeBlockBtn: requireElement(refs.buttons.codeBlockBtn, 'code block button'),
    diffNextChangeBtn: requireElement(refs.buttons.diffNextChangeBtn, 'next change button'),
    diffPreviousChangeBtn: requireElement(refs.buttons.diffPreviousChangeBtn, 'previous change button'),
    findToggleBtn: requireElement(refs.buttons.findToggleBtn, 'find button'),
    gitChangesGutterBtn: requireElement(refs.buttons.gitChangesGutterBtn, 'Git gutter button'),
    hrBtn: requireElement(refs.buttons.hrBtn, 'horizontal rule button'),
    imageBtn: requireElement(refs.buttons.imageBtn, 'image button'),
    lineNumbersBtn: requireElement(refs.buttons.lineNumbersBtn, 'line numbers button'),
    linkBtn: requireElement(refs.buttons.linkBtn, 'link button'),
    numberedListBtn: requireElement(refs.buttons.numberedListBtn, 'numbered list button'),
    outlineBtn: requireElement(refs.buttons.outlineBtn, 'outline button'),
    quoteBtn: requireElement(refs.buttons.quoteBtn, 'quote button'),
    tableBtn: requireElement(refs.buttons.tableBtn, 'table button'),
    taskBtn: requireElement(refs.buttons.taskBtn, 'task list button'),
    wikiLinkBtn: requireElement(refs.buttons.wikiLinkBtn, 'wiki link button'),
  }
}

function resolveFindPanelElements(
  refs: NativeMeoEditorChromeRefs,
  toggleBtn: HTMLButtonElement,
): FindPanelElements {
  return {
    panel: requireElement(refs.findPanel.findPanel, 'find panel'),
    findInput: requireElement(refs.findPanel.findInput, 'find input'),
    wholeWordBtn: requireElement(refs.findPanel.wholeWordBtn, 'whole word button'),
    caseSensitiveBtn: requireElement(refs.findPanel.caseSensitiveBtn, 'case sensitive button'),
    replaceInput: requireElement(refs.findPanel.replaceInput, 'replace input'),
    findStatus: requireElement(refs.findPanel.findStatus, 'find status'),
    findPrevBtn: requireElement(refs.findPanel.findPrevBtn, 'previous match button'),
    findNextBtn: requireElement(refs.findPanel.findNextBtn, 'next match button'),
    replaceBtn: requireElement(refs.findPanel.replaceBtn, 'replace button'),
    replaceAllBtn: requireElement(refs.findPanel.replaceAllBtn, 'replace all button'),
    toggleBtn,
  }
}

const MeoNativeEditorChromeImpl = forwardRef(function MeoNativeEditorChrome(
  {
    leadingToolbarAction,
  }: {
    leadingToolbarAction?: ReactNode
  },
  forwardedRef: Ref<NativeMeoEditorShell>,
) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const toolbarRef = useRef<HTMLElement | null>(null)
  const editorWrapperRef = useRef<HTMLDivElement | null>(null)
  const editorHostRef = useRef<HTMLDivElement | null>(null)
  const selectionMenuRef = useRef<HTMLDivElement | null>(null)
  const headingMenuControllerRef = useRef<MeoHeadingMenuController | null>(null)
  const outlineControllerRef = useRef<MeoNativeOutlineController | null>(null)
  const chromeRefsRef = useRef<NativeMeoEditorChromeRefs | null>(null)
  const actionsRef = useRef<NativeMeoEditorShellActions | null>(null)
  const [mode, setMode] = useState<MeoEditorMode>('live')

  if (!chromeRefsRef.current) {
    chromeRefsRef.current = createChromeRefs()
  }
  if (!actionsRef.current) {
    actionsRef.current = {
      getEditor: () => null,
      onHeadingLevel: null,
      onModeChange: null,
    }
  }

  const refs = chromeRefsRef.current
  const actions = actionsRef.current
  const getEditor = useCallback(() => actions.getEditor(), [actions])
  const getEditorWrapper = useCallback(() => editorWrapperRef.current, [])
  const getOutlineButton = useCallback(
    () => refs.buttons.outlineBtn.current,
    [refs],
  )
  const getRoot = useCallback(() => rootRef.current, [])

  useImperativeHandle(forwardedRef, () => {
    const root = requireElement(rootRef, 'editor root')
    const toolbar = requireElement(toolbarRef, 'toolbar')
    const editorWrapper = requireElement(editorWrapperRef, 'editor wrapper')
    const editorHost = requireElement(editorHostRef, 'editor host')
    const selectionMenu = requireElement(selectionMenuRef, 'selection menu')
    const buttons = resolveButtons(refs)
    const findPanelElements = resolveFindPanelElements(refs, buttons.findToggleBtn)
    const outlineController = outlineControllerRef.current

    if (!outlineController) {
      throw new Error('MEO React chrome did not mount the outline controller')
    }

    return {
      buttons,
      disconnectController() {
        actions.getEditor = () => null
        actions.onHeadingLevel = null
        actions.onModeChange = null
        headingMenuControllerRef.current?.close()
        outlineController.destroy()
        const activeElement = document.activeElement
        if (
          activeElement instanceof HTMLElement
          && (
            findPanelElements.panel.contains(activeElement)
            || selectionMenu.contains(activeElement)
          )
        ) {
          activeElement.blur()
        }
        findPanelElements.panel.classList.remove('is-visible')
        findPanelElements.panel.setAttribute('aria-hidden', 'true')
        findPanelElements.panel.style.removeProperty('right')
        findPanelElements.toggleBtn.classList.remove('is-active')
        findPanelElements.toggleBtn.setAttribute('aria-pressed', 'false')
        findPanelElements.toggleBtn.removeAttribute('data-active')
        findPanelElements.findInput.value = ''
        findPanelElements.replaceInput.value = ''
        findPanelElements.findStatus.textContent = ''
        findPanelElements.findStatus.classList.remove('is-error')
        selectionMenu.classList.remove('is-visible')
        selectionMenu.setAttribute('aria-hidden', 'true')
        selectionMenu.style.removeProperty('left')
        selectionMenu.style.removeProperty('top')
      },
      editorHost,
      editorWrapper,
      findPanelElements,
      modeGroup: requireElement(refs.modeGroup, 'mode group'),
      outlineController,
      root,
      selectionMenuElements: { menu: selectionMenu },
      setEditorGetter(handler) {
        actions.getEditor = handler ?? (() => null)
      },
      setHeadingLevelHandler(handler) {
        actions.onHeadingLevel = handler
      },
      setMode,
      setModeChangeHandler(handler) {
        actions.onModeChange = handler
      },
      toolbar,
    }
  }, [actions, refs])

  return (
    <div
      ref={rootRef}
      className='meo-editor-root-host meo-native-root editor-root'
    >
      <ViewerToolbar
        ref={toolbarRef}
        className='mode-toolbar'
        aria-label='Markdown 编辑器工具栏'
      >
        {leadingToolbarAction ? (
          <ViewerToolbarGroup>{leadingToolbarAction}</ViewerToolbarGroup>
        ) : null}
        <MeoEditorToolbar
          actions={actions}
          headingMenuControllerRef={headingMenuControllerRef}
          mode={mode}
          refs={refs}
        />
      </ViewerToolbar>
      <div ref={editorWrapperRef} className='editor-wrapper'>
        <div ref={editorHostRef} className='editor-host' />
        <nav className='outline-sidebar' aria-label='Document outline'>
          <MeoNativeOutline
            ref={outlineControllerRef}
            getEditor={getEditor}
            getEditorWrapper={getEditorWrapper}
            getOutlineButton={getOutlineButton}
            getRoot={getRoot}
          />
        </nav>
        <div
          ref={selectionMenuRef}
          className='selection-inline-menu'
          role='toolbar'
          aria-label='Inline markdown formatting'
          aria-hidden='true'
        >
          <MeoSelectionMenu />
        </div>
      </div>
    </div>
  )
})

export const MeoNativeEditorChrome = memo(MeoNativeEditorChromeImpl)
