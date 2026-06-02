import {
  CALLOUT_MARKER_REGEX,
  LEGACY_CALLOUT_REPLACEMENTS,
  SUPPORTED_CALLOUT_TYPES,
} from './markdown-constants.mjs'

const SANITIZE_CLOBBER_PREFIX = 'user-content-'

function collectElementIds(node, ids = new Set()) {
  if (!node || typeof node !== 'object') return ids

  if (node.type === 'element') {
    const id = node.properties?.id
    if (typeof id === 'string' && id) ids.add(id)
  }

  if (Array.isArray(node.children)) {
    for (const child of node.children) collectElementIds(child, ids)
  }

  return ids
}

function repairHashLinks(node, ids) {
  if (!node || typeof node !== 'object') return

  if (node.type === 'element') {
    const href = node.properties?.href
    if (typeof href === 'string' && href.startsWith('#')) {
      const targetId = href.slice(1)
      const sanitizedTargetId = `${SANITIZE_CLOBBER_PREFIX}${targetId}`

      if (targetId && !ids.has(targetId) && ids.has(sanitizedTargetId)) {
        node.properties.href = `#${sanitizedTargetId}`
      }
    }
  }

  if (Array.isArray(node.children)) {
    for (const child of node.children) repairHashLinks(child, ids)
  }
}

export function remarkAssertSupportedCallouts() {
  return (_tree, file) => {
    const content = String(file.value ?? '')
    const source = file.path || file.history?.[0] || 'markdown'

    for (const [index, line] of content.split(/\r?\n/).entries()) {
      const match = line.match(CALLOUT_MARKER_REGEX)
      if (!match?.groups?.type) continue

      const calloutType = match.groups.type.toLowerCase()
      if (SUPPORTED_CALLOUT_TYPES.has(calloutType)) continue

      const replacement = LEGACY_CALLOUT_REPLACEMENTS[calloutType]
      const hint = replacement ? ` Use "[!${replacement}]" instead.` : ''
      throw new Error(
        `Unsupported callout type "[!${calloutType}]" in ${source}:${index + 1}. Supported types: note, tip, warning, danger.${hint}`,
      )
    }
  }
}

export function rehypeRepairSanitizedHashLinks() {
  return (tree) => {
    const ids = collectElementIds(tree)
    repairHashLinks(tree, ids)
  }
}
