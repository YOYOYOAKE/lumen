import { defaultSchema } from 'rehype-sanitize'

export const SUPPORTED_CALLOUT_TYPES = new Set(['note', 'tip', 'warning', 'danger'])
export const LEGACY_CALLOUT_REPLACEMENTS = {
  important: 'warning',
  caution: 'danger',
}
export const CALLOUT_MARKER_REGEX = /^\s*>\s*\[!(?<type>\w+)](?:[+-])?/i

export const DANGER_CALLOUT_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16h.01M12 8v4m3.312-10a2 2 0 0 1 1.414.586l4.688 4.688A2 2 0 0 1 22 8.688v6.624a2 2 0 0 1-.586 1.414l-4.688 4.688a2 2 0 0 1-1.414.586H8.688a2 2 0 0 1-1.414-.586l-4.688-4.688A2 2 0 0 1 2 15.312V8.688a2 2 0 0 1 .586-1.414l4.688-4.688A2 2 0 0 1 8.688 2z"/></svg>'

export const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    '*': [
      ...(defaultSchema.attributes?.['*'] ?? []),
      'className',
      'id',
      'ariaHidden',
      'data*',
      'style',
    ],
    a: [...(defaultSchema.attributes?.a ?? []), 'target', 'rel', 'dataLink', 'data-link'],
    code: [...(defaultSchema.attributes?.code ?? []), 'className', 'dataMeta', 'data-meta'],
    pre: [...(defaultSchema.attributes?.pre ?? []), 'className', 'style'],
    span: [...(defaultSchema.attributes?.span ?? []), 'className', 'style'],
    div: [...(defaultSchema.attributes?.div ?? []), 'className', 'dataCallout', 'data-callout'],
    img: [
      ...(defaultSchema.attributes?.img ?? []),
      'className',
      'loading',
      'decoding',
      'ariaHidden',
      'aria-hidden',
    ],
    iframe: ['src', 'title', 'allow', 'allowfullscreen', 'loading', 'referrerpolicy', 'className'],
  },
  tagNames: [
    ...(defaultSchema.tagNames ?? []),
    'iframe',
    'image-div-polaroid',
    'image-figure-polaroid',
  ],
}
