import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fg from 'fast-glob'

const FONT_PACKAGE_VERSION = '1.7.0'
const FONT_PACKAGE_BASE_URL = `https://fastly.jsdelivr.net/npm/lxgw-wenkai-webfont@${FONT_PACKAGE_VERSION}`
const OUTPUT_DIR = ['public', 'fonts', 'lxgw-wenkai']
const OUTPUT_FILES_DIR = [...OUTPUT_DIR, 'files']
const FETCH_TIMEOUT_MS = 120_000
const FETCH_RETRY_COUNT = 3

const FONT_SOURCES = [
  {
    cssFile: 'lxgwwenkai-regular.css',
    displayName: 'LXGW WenKai regular',
  },
  {
    cssFile: 'lxgwwenkai-bold.css',
    displayName: 'LXGW WenKai bold',
  },
  {
    cssFile: 'lxgwwenkaimono-regular.css',
    displayName: 'LXGW WenKai Mono regular',
  },
]

const TEXT_SOURCE_PATTERNS = [
  'src/content/**/*.md',
  'src/**/*.{astro,ts,css,mjs}',
  'src/config/**/*',
  'index.html',
]

const REQUIRED_CHARACTERS = [
  String.fromCodePoint(...Array.from({ length: 95 }, (_, index) => index + 0x20)),
  '，。；：？！、“”‘’（）《》【】—…·￥「」『』〈〉〔〕［］｛｝～、',
].join('')

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outputDir = path.join(repoRoot, ...OUTPUT_DIR)
const outputFilesDir = path.join(repoRoot, ...OUTPUT_FILES_DIR)

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizeCssUrl(url) {
  return url.replace(/^\.\/+/, '')
}

function parseUnicodeRange(value) {
  return value
    .split(',')
    .map((range) => range.trim())
    .filter(Boolean)
    .map((range) => {
      const match = /^U\+([0-9A-F?]+)(?:-([0-9A-F]+))?$/i.exec(range)
      if (!match) return null

      const startRaw = match[1].toUpperCase()
      const endRaw = match[2]?.toUpperCase()

      if (startRaw.includes('?')) {
        const start = Number.parseInt(startRaw.replaceAll('?', '0'), 16)
        const end = Number.parseInt(startRaw.replaceAll('?', 'F'), 16)
        return [start, end]
      }

      const start = Number.parseInt(startRaw, 16)
      const end = endRaw ? Number.parseInt(endRaw, 16) : start
      return [start, end]
    })
    .filter(Boolean)
}

function hasMatchingCodepoint(sortedCodepoints, ranges) {
  if (ranges.length === 0) return true

  return ranges.some(([start, end]) => {
    let low = 0
    let high = sortedCodepoints.length - 1

    while (low <= high) {
      const middle = Math.floor((low + high) / 2)
      const codepoint = sortedCodepoints[middle]

      if (codepoint < start) {
        low = middle + 1
      } else {
        high = middle - 1
      }
    }

    return low < sortedCodepoints.length && sortedCodepoints[low] <= end
  })
}

function parseFontFaceBlocks(cssText) {
  const blocks = []
  const fontFaceRegex = /@font-face\s*{[\s\S]*?}/g

  for (const match of cssText.matchAll(fontFaceRegex)) {
    const block = match[0]
    const srcMatch = /src:\s*url\((['"]?)([^)'"]+)\1\)\s+format\((['"]?)woff2\3\)/i.exec(block)
    if (!srcMatch) continue

    // Upstream subset CSS omits the trailing semicolon on unicode-range.
    const unicodeMatch = /unicode-range:\s*([^}]+?)\s*(?:;|})/i.exec(block)
    const ranges = unicodeMatch ? parseUnicodeRange(unicodeMatch[1]) : []
    if (!unicodeMatch) {
      throw new Error(`Missing unicode-range in font-face block for ${srcMatch[2]}`)
    }
    if (ranges.length === 0) {
      throw new Error(`Failed to parse unicode-range for ${srcMatch[2]}`)
    }

    blocks.push({
      css: block,
      cssUrl: normalizeCssUrl(srcMatch[2]),
      ranges,
    })
  }

  return blocks
}

async function collectCharacterSet() {
  const textFilePaths = await fg(TEXT_SOURCE_PATTERNS, {
    cwd: repoRoot,
    onlyFiles: true,
    dot: false,
  })

  const contents = await Promise.all(
    textFilePaths.map((filePath) => readFile(path.join(repoRoot, filePath), 'utf8')),
  )

  const characters = new Set()
  const combinedText = `${contents.join('\n')}\n${REQUIRED_CHARACTERS}`

  for (const char of Array.from(combinedText)) {
    characters.add(char.codePointAt(0))
  }

  return Array.from(characters).sort((left, right) => left - right)
}

async function fetchText(url) {
  const response = await fetchWithRetry(url)
  return response.text()
}

async function fetchBinary(url) {
  const response = await fetchWithRetry(url)
  return Buffer.from(await response.arrayBuffer())
}

async function fetchWithRetry(url) {
  let lastError = null

  for (let attempt = 1; attempt <= FETCH_RETRY_COUNT; attempt += 1) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
      if (!response.ok) {
        throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`)
      }

      return response
    } catch (error) {
      lastError = error
      if (attempt === FETCH_RETRY_COUNT) break
      await new Promise((resolve) => setTimeout(resolve, attempt * 1_000))
    }
  }

  throw lastError
}

async function ensureCleanOutputDir() {
  await rm(outputDir, { recursive: true, force: true })
  await mkdir(outputFilesDir, { recursive: true })
}

async function buildFonts() {
  const sortedCodepoints = await collectCharacterSet()
  await ensureCleanOutputDir()

  const selectedCssBlocks = []
  const downloadedFiles = new Set()
  let totalBytes = 0

  for (const source of FONT_SOURCES) {
    const cssUrl = `${FONT_PACKAGE_BASE_URL}/${source.cssFile}`
    const cssText = await fetchText(cssUrl)
    const blocks = parseFontFaceBlocks(cssText)
    const matchedBlocks = blocks.filter((block) =>
      hasMatchingCodepoint(sortedCodepoints, block.ranges),
    )

    if (matchedBlocks.length === 0) {
      throw new Error(`No matching subset blocks found for ${source.displayName}`)
    }

    selectedCssBlocks.push(`/* ${source.displayName} */`)
    selectedCssBlocks.push(...matchedBlocks.map((block) => block.css))

    for (const block of matchedBlocks) {
      if (downloadedFiles.has(block.cssUrl)) continue

      const fileUrl = `${FONT_PACKAGE_BASE_URL}/${block.cssUrl}`
      const data = await fetchBinary(fileUrl)
      const targetPath = path.join(outputDir, block.cssUrl)
      await mkdir(path.dirname(targetPath), { recursive: true })
      await writeFile(targetPath, data)
      downloadedFiles.add(block.cssUrl)
      totalBytes += data.byteLength
    }
  }

  const header = [
    '/* Generated by scripts/build-fonts.mjs */',
    `/* Source: lxgw-wenkai-webfont@${FONT_PACKAGE_VERSION} */`,
    `/* Selected files: ${downloadedFiles.size} */`,
    '',
  ].join('\n')

  await writeFile(
    path.join(outputDir, 'fonts.css'),
    `${header}${selectedCssBlocks.join('\n\n')}\n`,
    'utf8',
  )

  const totalSizeInKiB = (totalBytes / 1024).toFixed(2)
  console.log(
    `[fonts] Generated ${downloadedFiles.size} subset files (${totalSizeInKiB} KiB) into ${path.relative(repoRoot, outputDir)}`,
  )
}

buildFonts().catch((error) => {
  console.error('[fonts] Failed to build local fonts')
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
