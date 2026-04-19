// @ts-nocheck
import { HighlightStyle } from '@codemirror/language';
import { SYNTAX_TAG_SPECS, type SyntaxTokenStyleSpec } from '../shared/designTokens';

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


