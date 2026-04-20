// @ts-nocheck
import { HighlightStyle } from '@codemirror/language';
import { tags as t, type Tag } from '@lezer/highlight';

type SyntaxTokenStyleSpec = {
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

const SYNTAX_TAG_SPECS: readonly SyntaxTokenStyleSpec[] = [
  {
    id: 'keyword',
    tags: [t.keyword, t.controlKeyword, t.moduleKeyword],
    fallbackColor: 'var(--color-rose-600)',
    style: { fontWeight: 'bold' }
  },
  {
    id: 'identifier',
    tags: [t.name, t.deleted, t.character],
    fallbackColor: 'var(--color-sky-600)',
    style: {}
  },
  {
    id: 'macroName',
    tags: t.macroName,
    fallbackColor: 'var(--color-cyan-600)',
    style: { fontStyle: 'italic' }
  },
  {
    id: 'variableName',
    tags: t.variableName,
    fallbackColor: 'var(--foreground)',
    style: {}
  },
  {
    id: 'propertyName',
    tags: t.propertyName,
    fallbackColor: 'var(--color-green-600)',
    style: { fontStyle: 'normal' }
  },
  {
    id: 'typeName',
    tags: t.typeName,
    fallbackColor: 'var(--color-cyan-600)',
    style: {}
  },
  {
    id: 'className',
    tags: t.className,
    fallbackColor: 'var(--color-green-600)',
    style: {}
  },
  {
    id: 'namespace',
    tags: t.namespace,
    fallbackColor: 'var(--color-sky-600)',
    style: {}
  },
  {
    id: 'operator',
    tags: t.operator,
    fallbackColor: 'var(--foreground)',
    style: {}
  },
  {
    id: 'operatorKeyword',
    tags: t.operatorKeyword,
    fallbackColor: 'var(--color-rose-600)',
    style: {}
  },
  {
    id: 'punctuation',
    tags: [t.bracket, t.brace, t.punctuation, t.squareBracket, t.angleBracket],
    fallbackColor: 'var(--foreground)',
    style: {}
  },
  {
    id: 'functionName',
    tags: t.function(t.variableName),
    fallbackColor: 'var(--color-cyan-600)',
    style: {}
  },
  {
    id: 'labelName',
    tags: t.labelName,
    fallbackColor: 'var(--muted)',
    style: {}
  },
  {
    id: 'definitionFunction',
    tags: t.definition(t.function(t.variableName)),
    fallbackColor: 'var(--color-cyan-600)',
    style: {}
  },
  {
    id: 'definedVariable',
    tags: t.definition(t.variableName),
    fallbackColor: 'var(--color-sky-600)',
    style: {}
  },
  {
    id: 'number',
    tags: t.number,
    fallbackColor: 'var(--color-purple-600)',
    style: {}
  },
  {
    id: 'changed',
    tags: t.changed,
    fallbackColor: 'var(--color-purple-600)',
    style: {}
  },
  {
    id: 'annotation',
    tags: t.annotation,
    fallbackColor: 'var(--color-rose-600)',
    style: { fontStyle: 'italic' }
  },
  {
    id: 'modifier',
    tags: t.modifier,
    fallbackColor: 'var(--color-rose-600)',
    style: { fontStyle: 'italic' }
  },
  {
    id: 'self',
    tags: t.self,
    fallbackColor: 'var(--color-rose-600)',
    style: { fontStyle: 'italic' }
  },
  {
    id: 'color',
    tags: t.color,
    fallbackColor: 'var(--color-purple-600)',
    style: {}
  },
  {
    id: 'constant',
    tags: [t.constant(t.name), t.standard(t.name)],
    fallbackColor: 'var(--color-purple-600)',
    style: {}
  },
  {
    id: 'atom',
    tags: t.atom,
    fallbackColor: 'var(--color-sky-600)',
    style: {}
  },
  {
    id: 'bool',
    tags: t.bool,
    fallbackColor: 'var(--color-purple-600)',
    style: {}
  },
  {
    id: 'specialVariable',
    tags: t.special(t.variableName),
    fallbackColor: 'var(--color-purple-600)',
    style: {}
  },
  {
    id: 'specialString',
    tags: t.special(t.string),
    fallbackColor: 'var(--color-amber-600)',
    style: {}
  },
  {
    id: 'regexp',
    tags: t.regexp,
    fallbackColor: 'var(--color-amber-600)',
    style: {}
  },
  {
    id: 'string',
    tags: t.string,
    fallbackColor: 'var(--color-amber-600)',
    style: {}
  },
  {
    id: 'typeDefinition',
    tags: t.definition(t.typeName),
    fallbackColor: 'var(--color-cyan-600)',
    style: { fontWeight: 'bold' }
  },
  {
    id: 'meta',
    tags: t.meta,
    fallbackColor: 'var(--muted)',
    style: {}
  },
  {
    id: 'comment',
    tags: [t.comment, t.docComment],
    fallbackColor: 'var(--muted)',
    style: { fontStyle: 'italic' }
  },
  {
    id: 'tagName',
    tags: t.tagName,
    fallbackColor: 'var(--color-rose-600)',
    style: {}
  },
  {
    id: 'attributeName',
    tags: t.attributeName,
    fallbackColor: 'var(--color-green-600)',
    style: {}
  },
  {
    id: 'invalid',
    tags: t.invalid,
    fallbackColor: 'var(--foreground)',
    style: { textDecoration: 'underline wavy', borderBottom: '1px wavy #e06c75' }
  },
  {
    id: 'deleted',
    tags: t.deleted,
    fallbackColor: 'var(--color-rose-600)',
    style: {}
  },
  {
    id: 'monospace',
    tags: t.monospace,
    fallbackColor: 'var(--muted)',
    style: {}
  },
  {
    id: 'heading',
    tags: t.heading,
    fallbackColor: 'var(--foreground)',
    style: { fontWeight: '600' }
  },
  {
    id: 'emphasis',
    tags: t.emphasis,
    fallbackColor: 'var(--foreground)',
    style: { fontStyle: 'italic' }
  },
  {
    id: 'strong',
    tags: t.strong,
    fallbackColor: 'var(--foreground)',
    style: { fontWeight: '600' }
  },
  {
    id: 'strikethrough',
    tags: t.strikethrough,
    fallbackColor: 'var(--foreground)',
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
    fallbackColor: 'var(--muted)',
    style: {}
  },
  {
    id: 'link',
    tags: t.link,
    fallbackColor: 'var(--color-sky-600)',
    style: {}
  },
  {
    id: 'url',
    tags: t.url,
    fallbackColor: 'var(--color-sky-600)',
    style: {}
  },
  {
    id: 'processingInstruction',
    tags: t.processingInstruction,
    fallbackColor: 'var(--muted)',
    style: {}
  }
] as const;

const buildSpec = (spec: SyntaxTokenStyleSpec) => {
  const color = `var(--token-${spec.id}-color, ${spec.fallbackColor})`;
  const fontWeight = spec.id === 'heading'
    ? `var(--heading-token-weight, ${spec.style.fontWeight ?? '600'})`
    : spec.style.fontWeight;

  return {
    tag: spec.tags,
    color,
    fontStyle: spec.style.fontStyle,
    fontWeight,
    textDecoration: spec.style.textDecoration,
    borderBottom: spec.style.borderBottom
  };
};

export const highlightStyle = HighlightStyle.define(SYNTAX_TAG_SPECS.map(buildSpec));


