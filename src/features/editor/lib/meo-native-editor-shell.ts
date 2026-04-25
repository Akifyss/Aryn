import {
  Brackets,
  ChevronDown,
  ChevronUp,
  Code,
  Columns2,
  GitCompare,
  Hash,
  Heading,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  Image,
  Link,
  List,
  ListOrdered,
  ListTodo,
  ListTree,
  Minus,
  Quote,
  Search,
  Table2,
  createElement,
} from 'lucide'
import { createFindPanel } from '@/vendor/meo/webview/helpers/findPanel'
import { createSelectionMenu } from '@/vendor/meo/webview/helpers/selectionMenu'

type NativeMeoButtonMap = {
  bulletListBtn: HTMLButtonElement
  codeBlockBtn: HTMLButtonElement
  diffNextChangeBtn: HTMLButtonElement
  diffPreviousChangeBtn: HTMLButtonElement
  diffSplitButton: HTMLButtonElement
  findToggleBtn: HTMLButtonElement
  gitChangesGutterBtn: HTMLButtonElement
  headingDropdown: HTMLDivElement
  hrBtn: HTMLButtonElement
  imageBtn: HTMLButtonElement
  lineNumbersBtn: HTMLButtonElement
  linkBtn: HTMLButtonElement
  liveButton: HTMLButtonElement
  numberedListBtn: HTMLButtonElement
  outlineBtn: HTMLButtonElement
  quoteBtn: HTMLButtonElement
  sourceButton: HTMLButtonElement
  tableBtn: HTMLButtonElement
  taskBtn: HTMLButtonElement
  wikiLinkBtn: HTMLButtonElement
}

export type NativeMeoEditorShell = {
  buttons: NativeMeoButtonMap
  editorHost: HTMLDivElement
  editorWrapper: HTMLDivElement
  findPanelElements: ReturnType<typeof createFindPanel>
  modeGroup: HTMLDivElement
  selectionMenuElements: ReturnType<typeof createSelectionMenu>
  toolbar: HTMLDivElement
}

function createIconButton(
  title: string,
  action: string,
  IconComponent: Parameters<typeof createElement>[0],
  className = 'format-button',
) {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = className
  button.dataset.action = action
  button.title = title
  button.setAttribute('aria-label', title)
  button.appendChild(createElement(IconComponent, { width: 18, height: 18 }))
  return button
}

export function createNativeMeoEditorShell(): NativeMeoEditorShell {
  const toolbar = document.createElement('div')
  toolbar.className = 'mode-toolbar'
  toolbar.setAttribute('role', 'toolbar')
  toolbar.setAttribute('aria-label', 'Markdown editor toolbar')

  const formatGroup = document.createElement('div')
  formatGroup.className = 'format-group'

  const rightGroup = document.createElement('div')
  rightGroup.className = 'right-group'

  const modeGroup = document.createElement('div')
  modeGroup.className = 'mode-group'
  modeGroup.setAttribute('role', 'tablist')
  modeGroup.setAttribute('aria-label', 'Markdown mode')

  const headingBtn = createIconButton('Heading', 'heading', Heading)
  const headingDropdown = document.createElement('div')
  headingDropdown.className = 'heading-dropdown'
  const headingDropdownWrapper = document.createElement('div')
  headingDropdownWrapper.className = 'heading-dropdown-wrapper'
  const headingWrapper = document.createElement('div')
  headingWrapper.className = 'heading-wrapper'
  const headingIcons = [Heading1, Heading2, Heading3, Heading4, Heading5, Heading6]

  headingIcons.forEach((IconComponent, index) => {
    const option = document.createElement('button')
    option.type = 'button'
    option.className = 'heading-dropdown-option'
    option.dataset.level = String(index + 1)
    option.title = `Heading ${index + 1}`
    option.appendChild(createElement(IconComponent, { width: 18, height: 18 }))
    headingDropdown.appendChild(option)
  })

  headingDropdownWrapper.appendChild(headingDropdown)
  headingWrapper.append(headingBtn, headingDropdownWrapper)

  const bulletListBtn = createIconButton('Bullet List', 'bulletList', List)
  const numberedListBtn = createIconButton('Numbered List', 'numberedList', ListOrdered)
  const taskBtn = createIconButton('Task List', 'task', ListTodo)
  const tableBtn = createIconButton('Table', 'table', Table2)
  const codeBlockBtn = createIconButton('Code Block', 'codeBlock', Code)
  const linkBtn = createIconButton('Link', 'link', Link)
  const wikiLinkBtn = createIconButton('Wiki Link', 'wikiLink', Brackets)
  const imageBtn = createIconButton('Image', 'image', Image)
  const quoteBtn = createIconButton('Quote', 'quote', Quote)
  const hrBtn = createIconButton('Horizontal Rule', 'hr', Minus)

  const separator = document.createElement('div')
  separator.className = 'format-separator'
  separator.setAttribute('role', 'separator')

  const outlineBtn = createIconButton('Toggle Outline', 'outline', ListTree, 'format-button toggle-button')
  const findToggleBtn = createIconButton('Find and Replace', 'find', Search, 'format-button toggle-button')
  const lineNumbersBtn = createIconButton('Toggle Line Numbers', 'lineNumbers', Hash, 'format-button toggle-button')
  const gitChangesGutterBtn = createIconButton('Toggle Git Changes', 'gitChangesGutter', GitCompare, 'format-button toggle-button')
  const diffPreviousChangeBtn = createIconButton('Previous Change', 'diffPreviousChange', ChevronUp, 'format-button diff-split-only-button')
  const diffNextChangeBtn = createIconButton('Next Change', 'diffNextChange', ChevronDown, 'format-button diff-split-only-button')

  formatGroup.append(
    headingWrapper,
    bulletListBtn,
    numberedListBtn,
    taskBtn,
    separator,
    tableBtn,
    codeBlockBtn,
    linkBtn,
    wikiLinkBtn,
    imageBtn,
    quoteBtn,
    hrBtn,
  )

  rightGroup.append(outlineBtn, findToggleBtn, diffPreviousChangeBtn, diffNextChangeBtn, lineNumbersBtn, gitChangesGutterBtn)

  const liveButton = document.createElement('button')
  liveButton.type = 'button'
  liveButton.className = 'mode-button'
  liveButton.dataset.mode = 'live'
  liveButton.textContent = 'Live'
  liveButton.setAttribute('role', 'tab')

  const sourceButton = document.createElement('button')
  sourceButton.type = 'button'
  sourceButton.className = 'mode-button'
  sourceButton.dataset.mode = 'source'
  sourceButton.textContent = 'Source'
  sourceButton.setAttribute('role', 'tab')

  const diffSplitButton = document.createElement('button')
  diffSplitButton.type = 'button'
  diffSplitButton.className = 'mode-button mode-button-icon'
  diffSplitButton.dataset.mode = 'diff-split'
  diffSplitButton.title = 'Diff Split'
  diffSplitButton.setAttribute('aria-label', 'Diff Split')
  diffSplitButton.setAttribute('role', 'tab')
  diffSplitButton.appendChild(createElement(Columns2, { width: 16, height: 16 }))

  modeGroup.append(liveButton, sourceButton, diffSplitButton)

  const findPanelElements = createFindPanel(findToggleBtn)
  const selectionMenuElements = createSelectionMenu()

  const editorWrapper = document.createElement('div')
  editorWrapper.className = 'editor-wrapper'
  const editorHost = document.createElement('div')
  editorHost.className = 'editor-host'

  toolbar.replaceChildren(formatGroup, rightGroup, modeGroup, findPanelElements.panel)

  return {
    buttons: {
      bulletListBtn,
      codeBlockBtn,
      diffNextChangeBtn,
      diffPreviousChangeBtn,
      diffSplitButton,
      findToggleBtn,
      gitChangesGutterBtn,
      headingDropdown,
      hrBtn,
      imageBtn,
      lineNumbersBtn,
      linkBtn,
      liveButton,
      numberedListBtn,
      outlineBtn,
      quoteBtn,
      sourceButton,
      tableBtn,
      taskBtn,
      wikiLinkBtn,
    },
    editorHost,
    editorWrapper,
    findPanelElements,
    modeGroup,
    selectionMenuElements,
    toolbar,
  }
}
