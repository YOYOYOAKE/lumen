import {
  CALLOUT_MARKER_REGEX,
  LEGACY_CALLOUT_REPLACEMENTS,
  SUPPORTED_CALLOUT_TYPES,
} from './markdown-constants.mjs'

const SANITIZE_CLOBBER_PREFIX = 'user-content-'
const DEFAULT_FAVICON_SOURCE_URL = 'https://www.google.com/s2/favicons?domain={domain}&sz=128'

function visitMarkdownNodes(node, visitor) {
  if (!node || typeof node !== 'object') return

  visitor(node)

  if (Array.isArray(node.children)) {
    for (const child of node.children) visitMarkdownNodes(child, visitor)
  }
}

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

function addClassName(properties, className) {
  const existingClassName = properties.className

  if (Array.isArray(existingClassName)) {
    return { ...properties, className: [...new Set([...existingClassName, className])] }
  }

  if (typeof existingClassName === 'string') {
    const classNames = existingClassName.split(/\s+/).filter(Boolean)
    return { ...properties, className: [...new Set([...classNames, className])] }
  }

  return { ...properties, className: [className] }
}

function isHttpUrl(href) {
  try {
    const url = new URL(href)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function getSourcePath(file) {
  return file?.path || file?.history?.[0] || 'markdown'
}

function hasImageDescendant(node) {
  if (!node || typeof node !== 'object') return false
  if (node.type === 'element' && node.tagName === 'img') return true
  if (!Array.isArray(node.children)) return false

  return node.children.some((child) => hasImageDescendant(child))
}

function createFaviconUrl(href, faviconSourceUrl) {
  const url = new URL(href)
  return faviconSourceUrl.replace('{domain}', url.hostname)
}

function addFaviconToExternalLink(node, faviconSourceUrl) {
  if (!node || typeof node !== 'object') return false
  if (node.type !== 'element' || node.tagName !== 'a') return false

  const properties = node.properties ?? {}
  const href = properties.href
  if (typeof href !== 'string' || !isHttpUrl(href)) return false
  if (properties['data-link'] || properties.dataLink || hasImageDescendant(node)) return false

  const favicon = {
    type: 'element',
    tagName: 'img',
    properties: {
      src: createFaviconUrl(href, faviconSourceUrl),
      alt: '',
      'aria-hidden': 'true',
      loading: 'lazy',
      decoding: 'async',
    },
    children: [],
  }

  node.properties = addClassName({ ...properties, 'data-link': 'external-url' }, 'rds-link')
  node.children = [favicon, ...(node.children ?? [])]
  return true
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

export function rehypeAddExternalLinkFavicons(options = {}) {
  const faviconSourceUrl = options.faviconSourceUrl ?? DEFAULT_FAVICON_SOURCE_URL

  if (!faviconSourceUrl.includes('{domain}')) {
    throw new Error(
      'Invalid favicon source URL. The template must include the `{domain}` placeholder.',
    )
  }

  return (tree, file) => {
    let updatedLinkCount = 0

    visitMarkdownNodes(tree, (node) => {
      if (addFaviconToExternalLink(node, faviconSourceUrl)) updatedLinkCount += 1
    })

    if (updatedLinkCount > 0) {
      console.debug(
        `[markdown] Added favicons to ${updatedLinkCount} external link(s) in ${getSourcePath(file)}.`,
      )
    }
  }
}
