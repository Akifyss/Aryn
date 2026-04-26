// @ts-nocheck
import { createElement, Bold, Italic, Strikethrough, Terminal, Link, Brackets, Keyboard } from 'lucide';
import { syntaxTree } from '@codemirror/language';
import { collectLatexMathRanges } from './math';

export interface SelectionMenuElements {
  menu: HTMLDivElement;
}

const createSelectionActionButton = (action: string, label: string, Icon: any): HTMLButtonElement => {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'selection-inline-button';
  button.dataset.action = action;
  button.title = label;
  button.setAttribute('aria-label', label);
  button.appendChild(createElement(Icon, { width: 16, height: 16 }));
  return button;
};

export const createSelectionMenu = (): SelectionMenuElements => {
  const menu = document.createElement('div');
  menu.className = 'selection-inline-menu';
  menu.setAttribute('role', 'toolbar');
  menu.setAttribute('aria-label', 'Inline markdown formatting');

  const selectionBoldBtn = createSelectionActionButton('bold', 'Bold', Bold);
  const selectionItalicBtn = createSelectionActionButton('italic', 'Italic', Italic);
  const selectionLineoverBtn = createSelectionActionButton('lineover', 'Lineover', Strikethrough);
  const selectionInlineCodeBtn = createSelectionActionButton('inlineCode', 'Inline Code', Terminal);
  const selectionLinkBtn = createSelectionActionButton('link', 'Link', Link);
  const selectionWikiLinkBtn = createSelectionActionButton('wikiLink', 'Wiki Link', Brackets);
  const selectionKbdBtn = createSelectionActionButton('kbd', 'Kbd', Keyboard);

  menu.append(
    selectionBoldBtn,
    selectionItalicBtn,
    selectionLineoverBtn,
    selectionInlineCodeBtn,
    selectionLinkBtn,
    selectionWikiLinkBtn,
    selectionKbdBtn
  );

  return { menu };
};

export const createSelectionMenuController = (
  elements: SelectionMenuElements,
  getEditor: () => any
) => {
  const hide = (): void => {
    elements.menu.classList.remove('is-visible');
  };

  const update = (selectionState: { visible?: boolean; anchorX?: number; anchorY?: number } | null): void => {
    if (!selectionState?.visible) {
      hide();
      return;
    }

    elements.menu.classList.add('is-visible');
    const margin = 8;
    const halfWidth = elements.menu.offsetWidth / 2;
    const minLeft = halfWidth + margin;
    const maxLeft = window.innerWidth - halfWidth - margin;
    const clampedLeft = Math.min(maxLeft, Math.max(minLeft, selectionState.anchorX ?? 0));
    elements.menu.style.left = `${clampedLeft}px`;
    elements.menu.style.top = `${Math.max(margin, (selectionState.anchorY ?? 0) - margin)}px`;
  };

  const handleAction = (action: string): void => {
    const editor = getEditor();
    if (!editor) return;
    editor.insertFormat(action);
    editor.focus();
  };

  return {
    hide,
    update,
    handleAction,
    elements
  };
};

export type SelectionMenuController = ReturnType<typeof createSelectionMenuController>;

const blockedInlineSelectionAncestors = new Set([
  'FencedCode',
  'CodeBlock',
  'CodeText',
  'InlineCode',
  'URL',
  'Autolink',
  'HTMLBlock',
  'HTMLTag',
  'TableDelimiter'
]);

const latexSelectionBlockCache = new WeakMap();

function hasBlockedInlineAncestor(state, position) {
  let node = syntaxTree(state).resolveInner(position, 1);
  while (node) {
    if (blockedInlineSelectionAncestors.has(node.name)) {
      return true;
    }
    node = node.parent;
  }
  return false;
}

function getLatexSelectionBlockRanges(state) {
  const docKey = state.doc;
  const cached = latexSelectionBlockCache.get(docKey);
  if (cached) {
    return cached;
  }

  const text = state.doc.toString();
  if (text.indexOf('$') === -1) {
    latexSelectionBlockCache.set(docKey, []);
    return [];
  }

  const ranges = collectLatexMathRanges(text).map((range) => ({ from: range.from, to: range.to }));
  latexSelectionBlockCache.set(docKey, ranges);
  return ranges;
}

function overlapsLatexMathSelection(state, from, to) {
  if (to <= from) {
    return false;
  }
  const ranges = getLatexSelectionBlockRanges(state);
  for (const range of ranges) {
    if (range.from < to && range.to > from) {
      return true;
    }
  }
  return false;
}

export function isRegularInlineSelection(state, from, to) {
  if (to <= from) {
    return false;
  }
  const text = state.doc.sliceString(from, to);
  const trimmedText = text.trim();
  if (!trimmedText) {
    return false;
  }
  if (trimmedText.includes('\n')) {
    return false;
  }
  if (hasBlockedInlineAncestor(state, from) || hasBlockedInlineAncestor(state, to - 1)) {
    return false;
  }
  if (overlapsLatexMathSelection(state, from, to)) {
    return false;
  }
  return true;
}


