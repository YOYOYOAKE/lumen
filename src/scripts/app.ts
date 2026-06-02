import mediumZoom from 'medium-zoom/dist/pure'

const STORAGE_KEY = 'theme'
const THEME_SWITCHING_CLASS = 'theme-switching'
const THEME_SWITCH_DURATION = 560
const DEFAULT_DESKTOP_CONTROLS_BOTTOM = 96
const DIVIDER_CONTROLS_GAP = 16
const DESKTOP_CONTROLS_TOC_GAP = 16
const ARTICLE_ANCHOR_OFFSET_REM = 6
const ARTICLE_TOC_DEFAULT_HEIGHT_OFFSET_REM = 24
const ARTICLE_TOC_OVERFLOW_EPSILON = 1
const ARTICLE_TOC_SCROLL_SELECTOR = '[data-article-toc-scroll]'
const ARTICLE_TOC_MASK_TOP_SELECTOR = '[data-article-toc-mask="top"]'
const ARTICLE_TOC_MASK_BOTTOM_SELECTOR = '[data-article-toc-mask="bottom"]'
const ARTICLE_LEFT_PANE_SELECTOR = '[data-article-left-pane]'

let zoom: ReturnType<typeof mediumZoom> | null = null
let listenersBound = false
let scrollSpyObserver: IntersectionObserver | null = null
let controlsAnimationFrame = 0
let tocHeightAnimationFrame = 0

type AstroTransitionEvent = Event & {
  from: URL
  to: URL
  newDocument?: Document
  signal?: AbortSignal
}

const LANG_DISPLAY: Record<string, string> = {
  js: 'JavaScript',
  javascript: 'JavaScript',
  ts: 'TypeScript',
  typescript: 'TypeScript',
  tsx: 'TSX',
  jsx: 'JSX',
  vue: 'Vue',
  html: 'HTML',
  css: 'CSS',
  json: 'JSON',
  yaml: 'YAML',
  toml: 'TOML',
  ini: 'INI',
  md: 'Markdown',
  markdown: 'Markdown',
  bash: 'Bash',
  shell: 'Shell',
  sh: 'Shell',
  powershell: 'PowerShell',
  ps1: 'PowerShell',
  python: 'Python',
  py: 'Python',
  go: 'Go',
  rust: 'Rust',
  java: 'Java',
  c: 'C',
  cpp: 'C++',
  sql: 'SQL',
  dockerfile: 'Dockerfile',
  diff: 'Diff',
  plaintext: 'Text',
  text: 'Text',
}

function getStoredDarkMode(): boolean {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored !== null) return stored === 'dark'
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

function applyTheme(dark: boolean, doc: Document = document) {
  doc.documentElement.classList.toggle('dark', dark)
}

function toggleTheme(origin?: { x: number; y: number }) {
  const next = !document.documentElement.classList.contains('dark')
  localStorage.setItem(STORAGE_KEY, next ? 'dark' : 'light')

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (prefersReducedMotion) {
    applyTheme(next)
    return
  }

  const root = document.documentElement
  const startViewTransition = document.startViewTransition

  if (!startViewTransition || !origin) {
    root.classList.add(THEME_SWITCHING_CLASS)
    applyTheme(next)
    window.setTimeout(() => {
      root.classList.remove(THEME_SWITCHING_CLASS)
    }, THEME_SWITCH_DURATION)
    return
  }

  const transition = startViewTransition.call(document, () => {
    applyTheme(next)
  })

  transition.ready
    .then(() => {
      const maxX = Math.max(origin.x, window.innerWidth - origin.x)
      const maxY = Math.max(origin.y, window.innerHeight - origin.y)
      const endRadius = Math.hypot(maxX, maxY)

      document.documentElement.animate(
        {
          clipPath: [
            `circle(0px at ${origin.x}px ${origin.y}px)`,
            `circle(${endRadius}px at ${origin.x}px ${origin.y}px)`,
          ],
        },
        {
          duration: THEME_SWITCH_DURATION,
          easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)',
          pseudoElement: '::view-transition-new(root)',
        },
      )
    })
    .catch(() => {})
    .finally(() => {
      void transition.finished.catch(() => {})
    })
}

function getCodeLanguage(pre: HTMLPreElement): string {
  const code = pre.querySelector('code')
  const className = Array.from(code?.classList ?? []).find((item) => item.startsWith('language-'))
  const lang = className?.replace(/^language-/, '') || pre.dataset.language || 'plaintext'
  return LANG_DISPLAY[lang] ?? lang
}

function buildCodeHeader(label: string): HTMLDivElement {
  const header = document.createElement('div')
  header.className = 'code-block-header'
  header.innerHTML = [
    `<span class="code-block-lang">${label}</span>`,
    '<button class="code-block-copy" type="button" aria-label="Copy code" title="Copy code">',
    '<span class="code-block-copy-icon code-block-copy-icon-clipboard" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M184,32H72A16,16,0,0,0,56,48V64H48A16,16,0,0,0,32,80V200a16,16,0,0,0,16,16H160a16,16,0,0,0,16-16v-16h8a16,16,0,0,0,16-16V48A16,16,0,0,0,184,32ZM160,200H48V80H160V200Zm24-32H176V80a16,16,0,0,0-16-16H72V48H184V168Z"/></svg></span>',
    '<span class="code-block-copy-icon code-block-copy-icon-check" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M229.66,90.34a8,8,0,0,1,0,11.32l-96,96a8,8,0,0,1-11.32,0l-48-48a8,8,0,0,1,11.32-11.32L128,180.69l90.34-90.35A8,8,0,0,1,229.66,90.34Z"/></svg></span>',
    '</button>',
  ].join('')
  return header
}

function enhanceCodeBlocks() {
  document.querySelectorAll<HTMLPreElement>('.markdown pre').forEach((pre) => {
    if (pre.closest('figure.code-block')) return
    const figure = document.createElement('figure')
    figure.className = 'code-block'
    pre.parentNode?.insertBefore(figure, pre)
    figure.append(buildCodeHeader(getCodeLanguage(pre)), pre)
  })
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof navigator.clipboard?.writeText !== 'function') return false

  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

function setCopyButtonState(button: HTMLButtonElement, title: string, state: 'copied' | null) {
  button.title = title
  button.setAttribute('aria-label', title)

  if (!state) {
    delete button.dataset.state
    return
  }

  button.dataset.state = state
  window.setTimeout(() => {
    if (!button.isConnected) return
    delete button.dataset.state
    button.title = 'Copy code'
    button.setAttribute('aria-label', 'Copy code')
  }, 800)
}

function getRootFontSize(): number {
  const rootFontSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize)
  return Number.isFinite(rootFontSize) ? rootFontSize : 16
}

function getArticleAnchorOffset(): number {
  return getRootFontSize() * ARTICLE_ANCHOR_OFFSET_REM
}

function scrollToArticleAnchor(target: HTMLElement) {
  const top = target.getBoundingClientRect().top + window.scrollY - getArticleAnchorOffset()
  window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
}

async function handleDocumentClick(event: MouseEvent) {
  const target = event.target
  if (!(target instanceof Element)) return

  const footnoteLink = target.closest<HTMLAnchorElement>(
    'a[data-footnote-ref], a[data-footnote-backref]',
  )
  if (footnoteLink) {
    const targetId = footnoteLink.hash.slice(1)
    const targetElement = targetId ? document.getElementById(targetId) : null
    if (!targetElement) return

    event.preventDefault()
    history.pushState(null, '', footnoteLink.hash)
    scrollToArticleAnchor(targetElement)
    return
  }

  const themeButton = target.closest<HTMLButtonElement>('[data-theme-toggle]')
  if (themeButton) {
    const rect = themeButton.getBoundingClientRect()
    toggleTheme({
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    })
    return
  }

  const backToTop = target.closest<HTMLButtonElement>('[data-back-to-top]')
  if (backToTop) {
    window.scrollTo({ top: 0, behavior: 'smooth' })
    return
  }

  const copyButton = target.closest<HTMLButtonElement>('.code-block-copy')
  if (!copyButton) return

  const figure = copyButton.closest('figure.code-block')
  const code = figure?.querySelector('pre code')
  const text = code?.textContent?.replace(/\n$/, '') ?? ''
  if (!text) return

  const copied = await copyTextToClipboard(text)
  if (copied) setCopyButtonState(copyButton, 'Copied', 'copied')
}

function initZoom() {
  zoom?.detach()
  zoom = mediumZoom({ background: 'rgb(0 0 0 / 0.8)' })
  zoom.attach('.markdown img:not(.no-zoom):not(a img)')
}

function setActiveTocLink(id: string | null) {
  document.querySelectorAll<HTMLElement>('[data-heading-id]').forEach((item) => {
    const active = Boolean(id && item.dataset.headingId === id)
    item.dataset.active = String(active)
  })
}

function initScrollSpy() {
  scrollSpyObserver?.disconnect()
  scrollSpyObserver = null

  const headings = document.querySelectorAll<HTMLElement>('h1[id], h2[id], h3[id], h4[id]')
  if (!headings.length) return

  scrollSpyObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.intersectionRatio > 0) {
          setActiveTocLink((entry.target as HTMLElement).id)
        }
      }
    },
    { rootMargin: '-96px 0px -85% 0px', threshold: [0, 1] },
  )

  headings.forEach((heading) => scrollSpyObserver?.observe(heading))

  requestAnimationFrame(() => {
    const visible = Array.from(headings).find((heading) => {
      const rect = heading.getBoundingClientRect()
      return rect.top > 10 && rect.top < window.innerHeight * 0.33
    })
    setActiveTocLink(visible?.id ?? headings[0]?.id ?? null)
  })
}

function updateBackToTop() {
  const visible = window.scrollY > 300
  document.querySelectorAll<HTMLElement>('[data-back-to-top]').forEach((button) => {
    button.classList.toggle('opacity-100', visible)
    button.classList.toggle('translate-y-0', visible)
    button.classList.toggle('opacity-0', !visible)
    button.classList.toggle('invisible', !visible)
    button.classList.toggle('translate-y-4', !visible)
  })
}

function setArticleTocMaskVisible(mask: HTMLElement | null | undefined, visible: boolean) {
  if (!mask) return

  mask.classList.toggle('opacity-100', visible)
  mask.classList.toggle('opacity-0', !visible)
}

function updateArticleTocMasks(toc: HTMLElement | null = document.querySelector(ARTICLE_TOC_SCROLL_SELECTOR)) {
  if (!toc) return

  const topMask = toc.parentElement?.querySelector<HTMLElement>(ARTICLE_TOC_MASK_TOP_SELECTOR)
  const bottomMask = toc.parentElement?.querySelector<HTMLElement>(ARTICLE_TOC_MASK_BOTTOM_SELECTOR)
  const isCollapsed = toc.dataset.collapsed === 'true'
  const hiddenScrollHeight = toc.scrollHeight - toc.clientHeight
  const hasHiddenContent = hiddenScrollHeight > ARTICLE_TOC_OVERFLOW_EPSILON

  setArticleTocMaskVisible(
    topMask,
    isCollapsed && hasHiddenContent && toc.scrollTop > ARTICLE_TOC_OVERFLOW_EPSILON,
  )
  setArticleTocMaskVisible(
    bottomMask,
    isCollapsed &&
      hasHiddenContent &&
      hiddenScrollHeight - toc.scrollTop > ARTICLE_TOC_OVERFLOW_EPSILON,
  )
}

function initArticleTocMasks() {
  document.querySelectorAll<HTMLElement>(ARTICLE_TOC_SCROLL_SELECTOR).forEach((toc) => {
    if (toc.dataset.maskListenerBound !== 'true') {
      toc.dataset.maskListenerBound = 'true'
      toc.addEventListener('scroll', () => updateArticleTocMasks(toc), { passive: true })
    }

    updateArticleTocMasks(toc)
  })
}

function updateArticleTocHeight(controls: HTMLElement | null) {
  const toc = document.querySelector<HTMLElement>(ARTICLE_TOC_SCROLL_SELECTOR)
  if (!toc) return

  if (!controls || !controls.isConnected || getComputedStyle(controls).display === 'none') {
    toc.style.removeProperty('height')
    delete toc.dataset.collapsed
    updateArticleTocMasks(toc)
    return
  }

  const defaultHeight = Math.max(
    0,
    window.innerHeight - getRootFontSize() * ARTICLE_TOC_DEFAULT_HEIGHT_OFFSET_REM,
  )
  const availableHeight =
    controls.getBoundingClientRect().top - toc.getBoundingClientRect().top - DESKTOP_CONTROLS_TOC_GAP

  if (availableHeight < defaultHeight) {
    toc.style.height = `${Math.max(0, availableHeight)}px`
    toc.dataset.collapsed = 'true'
    updateArticleTocMasks(toc)
    return
  }

  toc.style.removeProperty('height')
  delete toc.dataset.collapsed
  updateArticleTocMasks(toc)
}

function scheduleArticleTocHeightUpdate(controls: HTMLElement | null) {
  cancelAnimationFrame(tocHeightAnimationFrame)
  tocHeightAnimationFrame = window.requestAnimationFrame(() => {
    updateArticleTocHeight(controls)
  })
}

function updateDesktopControlsPosition() {
  const controls = document.querySelector<HTMLElement>('[data-desktop-controls]')
  if (!controls) {
    scheduleArticleTocHeightUpdate(null)
    return
  }

  const divider = document.querySelector<HTMLElement>('.app-bottom-divider')
  if (!divider) {
    controls.style.bottom = `${DEFAULT_DESKTOP_CONTROLS_BOTTOM}px`
    scheduleArticleTocHeightUpdate(controls)
    return
  }

  const dividerRect = divider.getBoundingClientRect()
  const viewportHeight = window.innerHeight
  const controlsBottomY = viewportHeight - DEFAULT_DESKTOP_CONTROLS_BOTTOM
  const maxControlsBottomY = dividerRect.top - DIVIDER_CONTROLS_GAP
  const lift = Math.max(0, controlsBottomY - maxControlsBottomY)

  controls.style.bottom = `${DEFAULT_DESKTOP_CONTROLS_BOTTOM + lift}px`
  scheduleArticleTocHeightUpdate(controls)
}

function scheduleDesktopControlsPositionUpdate() {
  cancelAnimationFrame(controlsAnimationFrame)
  controlsAnimationFrame = window.requestAnimationFrame(updateDesktopControlsPosition)
}

function handleScrollOrResize() {
  updateBackToTop()
  scheduleDesktopControlsPositionUpdate()
}

function isArticlePath(pathname: string): boolean {
  return pathname.startsWith('/posts/')
}

function isArticleToArticleTransition(event: AstroTransitionEvent): boolean {
  return isArticlePath(event.from.pathname) && isArticlePath(event.to.pathname)
}

function restoreArticleLeftTransitionName() {
  document
    .querySelector<HTMLElement>(ARTICLE_LEFT_PANE_SELECTOR)
    ?.style.removeProperty('view-transition-name')
}

function suppressArticleLeftTransitionName() {
  document
    .querySelector<HTMLElement>(ARTICLE_LEFT_PANE_SELECTOR)
    ?.style.setProperty('view-transition-name', 'none')
}

function syncPersistedArticleLeftPane(newDocument: Document) {
  const currentPane = document.querySelector<HTMLElement>(ARTICLE_LEFT_PANE_SELECTOR)
  const nextPane = newDocument.querySelector<HTMLElement>(ARTICLE_LEFT_PANE_SELECTOR)
  if (!currentPane || !nextPane) return

  currentPane.replaceChildren(
    ...Array.from(nextPane.childNodes).map((node) => document.importNode(node, true)),
  )
}

function bindGlobalListeners() {
  if (listenersBound) return
  listenersBound = true
  document.addEventListener('click', (event) => void handleDocumentClick(event))
  window.addEventListener('scroll', handleScrollOrResize, { passive: true })
  window.addEventListener('resize', handleScrollOrResize)
  document.addEventListener('astro:before-swap', ((event: Event) => {
    const transitionEvent = event as Event & { newDocument?: Document }
    const newDocument = transitionEvent.newDocument
    if (newDocument) applyTheme(getStoredDarkMode(), newDocument)
  }) as EventListener)
  document.addEventListener('astro:before-preparation', ((event: Event) => {
    const transitionEvent = event as AstroTransitionEvent
    if (!isArticleToArticleTransition(transitionEvent)) return

    suppressArticleLeftTransitionName()
    transitionEvent.signal?.addEventListener('abort', restoreArticleLeftTransitionName, {
      once: true,
    })
  }) as EventListener)
  document.addEventListener('astro:before-swap', ((event: Event) => {
    const transitionEvent = event as AstroTransitionEvent
    if (!isArticleToArticleTransition(transitionEvent) || !transitionEvent.newDocument) return

    syncPersistedArticleLeftPane(transitionEvent.newDocument)
  }) as EventListener)
  document.addEventListener('astro:page-load', restoreArticleLeftTransitionName)
}

function initPage() {
  bindGlobalListeners()
  applyTheme(getStoredDarkMode())
  enhanceCodeBlocks()
  initZoom()
  initScrollSpy()
  initArticleTocMasks()
  updateBackToTop()
  scheduleDesktopControlsPositionUpdate()
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPage, { once: true })
} else {
  initPage()
}

document.addEventListener('astro:page-load', initPage)
