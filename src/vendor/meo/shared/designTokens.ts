// @ts-nocheck
import { tags as t, type Tag } from '@lezer/highlight';

export type SyntaxTokenStyleSpec = {
  id: string;
  tags: Tag | readonly Tag[];
  fallbackColor: string;
  style: {
    fontWeight?: 'normal' | 'bold' | 'bolder' | 'lighter' | string;
    fontStyle?: 'normal' | 'italic' | 'oblique' | string;
    textDecoration?: string;
    borderBottom?: string;
  };
};

export const SYNTAX_TAG_SPECS: readonly SyntaxTokenStyleSpec[] = [
  {
    id: 'keyword',
    tags: [t.keyword, t.controlKeyword, t.moduleKeyword],
    fallbackColor: 'var(--meo-color-base04)',
    style: { fontWeight: 'bold' }
  },
  {
    id: 'identifier',
    tags: [t.name, t.deleted, t.character],
    fallbackColor: 'var(--meo-color-base05)',
    style: {}
  },
  {
    id: 'macroName',
    tags: t.macroName,
    fallbackColor: 'var(--meo-color-base06)',
    style: { fontStyle: 'italic' }
  },
  {
    id: 'variableName',
    tags: t.variableName,
    fallbackColor: 'var(--meo-color-base01)',
    style: {}
  },
  {
    id: 'propertyName',
    tags: t.propertyName,
    fallbackColor: 'var(--meo-color-base09)',
    style: { fontStyle: 'normal' }
  },
  {
    id: 'typeName',
    tags: t.typeName,
    fallbackColor: 'var(--meo-color-base06)',
    style: {}
  },
  {
    id: 'className',
    tags: t.className,
    fallbackColor: 'var(--meo-color-base09)',
    style: {}
  },
  {
    id: 'namespace',
    tags: t.namespace,
    fallbackColor: 'var(--meo-color-base05)',
    style: {}
  },
  {
    id: 'operator',
    tags: t.operator,
    fallbackColor: 'var(--meo-color-base01)',
    style: {}
  },
  {
    id: 'operatorKeyword',
    tags: t.operatorKeyword,
    fallbackColor: 'var(--meo-color-base04)',
    style: {}
  },
  {
    id: 'punctuation',
    tags: [t.bracket, t.brace, t.punctuation, t.squareBracket, t.angleBracket],
    fallbackColor: 'var(--meo-color-base01)',
    style: {}
  },
  {
    id: 'functionName',
    tags: t.function(t.variableName),
    fallbackColor: 'var(--meo-color-base06)',
    style: {}
  },
  {
    id: 'labelName',
    tags: t.labelName,
    fallbackColor: 'var(--meo-color-base02)',
    style: {}
  },
  {
    id: 'definitionFunction',
    tags: t.definition(t.function(t.variableName)),
    fallbackColor: 'var(--meo-color-base06)',
    style: {}
  },
  {
    id: 'definedVariable',
    tags: t.definition(t.variableName),
    fallbackColor: 'var(--meo-color-base05)',
    style: {}
  },
  {
    id: 'number',
    tags: t.number,
    fallbackColor: 'var(--meo-color-base08)',
    style: {}
  },
  {
    id: 'changed',
    tags: t.changed,
    fallbackColor: 'var(--meo-color-base08)',
    style: {}
  },
  {
    id: 'annotation',
    tags: t.annotation,
    fallbackColor: 'var(--meo-color-base04)',
    style: { fontStyle: 'italic' }
  },
  {
    id: 'modifier',
    tags: t.modifier,
    fallbackColor: 'var(--meo-color-base04)',
    style: { fontStyle: 'italic' }
  },
  {
    id: 'self',
    tags: t.self,
    fallbackColor: 'var(--meo-color-base04)',
    style: { fontStyle: 'italic' }
  },
  {
    id: 'color',
    tags: t.color,
    fallbackColor: 'var(--meo-color-base08)',
    style: {}
  },
  {
    id: 'constant',
    tags: [t.constant(t.name), t.standard(t.name)],
    fallbackColor: 'var(--meo-color-base08)',
    style: {}
  },
  {
    id: 'atom',
    tags: t.atom,
    fallbackColor: 'var(--meo-color-base05)',
    style: {}
  },
  {
    id: 'bool',
    tags: t.bool,
    fallbackColor: 'var(--meo-color-base08)',
    style: {}
  },
  {
    id: 'specialVariable',
    tags: t.special(t.variableName),
    fallbackColor: 'var(--meo-color-base08)',
    style: {}
  },
  {
    id: 'specialString',
    tags: t.special(t.string),
    fallbackColor: 'var(--meo-color-base07)',
    style: {}
  },
  {
    id: 'regexp',
    tags: t.regexp,
    fallbackColor: 'var(--meo-color-base07)',
    style: {}
  },
  {
    id: 'string',
    tags: t.string,
    fallbackColor: 'var(--meo-color-base07)',
    style: {}
  },
  {
    id: 'typeDefinition',
    tags: t.definition(t.typeName),
    fallbackColor: 'var(--meo-color-base06)',
    style: { fontWeight: 'bold' }
  },
  {
    id: 'meta',
    tags: t.meta,
    fallbackColor: 'var(--meo-color-base02)',
    style: {}
  },
  {
    id: 'comment',
    tags: [t.comment, t.docComment],
    fallbackColor: 'var(--meo-color-base02)',
    style: { fontStyle: 'italic' }
  },
  {
    id: 'tagName',
    tags: t.tagName,
    fallbackColor: 'var(--meo-color-base04)',
    style: {}
  },
  {
    id: 'attributeName',
    tags: t.attributeName,
    fallbackColor: 'var(--meo-color-base09)',
    style: {}
  },
  {
    id: 'invalid',
    tags: t.invalid,
    fallbackColor: 'var(--meo-color-base01)',
    style: { textDecoration: 'underline wavy', borderBottom: '1px wavy #e06c75' }
  },
  {
    id: 'deleted',
    tags: t.deleted,
    fallbackColor: 'var(--meo-color-base04)',
    style: {}
  },
  {
    id: 'monospace',
    tags: t.monospace,
    fallbackColor: 'var(--meo-color-base07)',
    style: {}
  },
  {
    id: 'heading',
    tags: t.heading,
    fallbackColor: 'var(--meo-color-base04)',
    style: { fontWeight: '600' }
  },
  {
    id: 'emphasis',
    tags: t.emphasis,
    fallbackColor: 'var(--meo-color-base01)',
    style: { fontStyle: 'italic' }
  },
  {
    id: 'strong',
    tags: t.strong,
    fallbackColor: 'var(--meo-color-base07)',
    style: { fontWeight: '600' }
  },
  {
    id: 'strikethrough',
    tags: t.strikethrough,
    fallbackColor: 'var(--meo-color-base01)',
    style: { textDecoration: 'line-through' }
  },
  {
    id: 'quote',
    tags: t.quote,
    fallbackColor: 'var(--foreground)',
    style: {}
  },
  {
    id: 'contentSeparator',
    tags: t.contentSeparator,
    fallbackColor: 'var(--meo-color-base02)',
    style: {}
  },
  {
    id: 'link',
    tags: t.link,
    fallbackColor: 'var(--meo-color-base05)',
    style: {}
  },
  {
    id: 'url',
    tags: t.url,
    fallbackColor: 'var(--meo-color-base05)',
    style: {}
  },
  {
    id: 'processingInstruction',
    tags: t.processingInstruction,
    fallbackColor: 'var(--meo-color-base02)',
    style: {}
  }
] as const;
