import { getCollection, getEntry, type CollectionEntry } from 'astro:content'
import readingTime from 'reading-time'
import { compareLocalizedText, encodeRoutePath, parseDateInput } from './utils'

export type PostEntry = CollectionEntry<'posts'>

export interface ResolvedPost extends PostEntry {
  href: string
  words: number
  readingTime: number
}

export interface TagItem {
  name: string
  slug: string
  count: number
}

function hashText(text: string): string {
  let hash = 0x811c9dc5
  for (const char of text) {
    hash ^= char.codePointAt(0) ?? 0
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

function normalizeTagName(tag: string): string {
  return tag.trim()
}

function createTagSlug(tag: string): string {
  const base = normalizeTagName(tag)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  if (base) return base
  return `tag-${hashText(tag)}`
}

function comparePostByDateDesc(a: ResolvedPost, b: ResolvedPost): number {
  const timeDiff =
    parseDateInput(b.data.createdAt).getTime() - parseDateInput(a.data.createdAt).getTime()
  if (timeDiff !== 0) return timeDiff

  const titleDiff = compareLocalizedText(a.data.title, b.data.title)
  if (titleDiff !== 0) return titleDiff

  return compareLocalizedText(a.id, b.id)
}

function comparePostByPinnedDateDesc(a: ResolvedPost, b: ResolvedPost): number {
  const pinnedDiff = Number(Boolean(b.data.top)) - Number(Boolean(a.data.top))
  if (pinnedDiff !== 0) return pinnedDiff
  return comparePostByDateDesc(a, b)
}

function enrichPost(post: PostEntry): ResolvedPost {
  const stats = readingTime(post.body ?? '')
  return {
    ...post,
    href: `/posts/${encodeRoutePath(post.id)}`,
    words: stats.words,
    readingTime: Math.ceil(stats.minutes),
  }
}

export async function getAllPosts(): Promise<ResolvedPost[]> {
  const posts = await getCollection('posts')
  return posts.map(enrichPost).sort(comparePostByPinnedDateDesc)
}

export async function getRecentPosts(count: number): Promise<ResolvedPost[]> {
  const posts = await getCollection('posts')
  return posts.map(enrichPost).sort(comparePostByDateDesc).slice(0, count)
}

export async function getPostById(id: string): Promise<ResolvedPost | null> {
  const post = await getEntry('posts', id)
  return post ? enrichPost(post) : null
}

export async function getTags(): Promise<TagItem[]> {
  const posts = await getAllPosts()
  const counts = new Map<string, number>()

  for (const post of posts) {
    for (const rawTag of post.data.tags ?? []) {
      const tag = normalizeTagName(rawTag)
      if (!tag) continue
      counts.set(tag, (counts.get(tag) ?? 0) + 1)
    }
  }

  const items: TagItem[] = []
  const seenSlugs = new Set<string>()

  for (const [name, count] of counts.entries()) {
    const baseSlug = createTagSlug(name)
    let slug = baseSlug

    if (seenSlugs.has(slug)) {
      const suffix = hashText(name).slice(0, 6)
      slug = `${baseSlug}-${suffix}`
      let serial = 2
      while (seenSlugs.has(slug)) {
        slug = `${baseSlug}-${suffix}-${serial}`
        serial += 1
      }
    }

    seenSlugs.add(slug)
    items.push({ name, slug, count })
  }

  return items.sort((a, b) => {
    const nameDiff = compareLocalizedText(a.name, b.name)
    if (nameDiff !== 0) return nameDiff
    return compareLocalizedText(a.slug, b.slug)
  })
}

export async function getTagNameBySlug(slug: string): Promise<string | null> {
  const tag = (await getTags()).find((item) => item.slug === slug)
  return tag?.name ?? null
}

export async function getTagSlug(tag: string): Promise<string> {
  const normalized = normalizeTagName(tag)
  const item = (await getTags()).find((candidate) => candidate.name === normalized)
  return item?.slug ?? createTagSlug(normalized)
}

export async function getPostsByTagSlug(slug: string): Promise<ResolvedPost[]> {
  const tagName = await getTagNameBySlug(slug)
  if (!tagName) return []

  return (await getAllPosts())
    .filter((post) => post.data.tags.some((tag) => normalizeTagName(tag) === tagName))
    .sort(comparePostByDateDesc)
}

export function getAdjacentPosts<T extends { id: string }>(
  list: T[],
  currentId: string,
): { prev: T | null; next: T | null; index: number } {
  const index = list.findIndex((post) => post.id === currentId)
  return {
    prev: index > 0 ? (list[index - 1] ?? null) : null,
    next: index >= 0 && index < list.length - 1 ? (list[index + 1] ?? null) : null,
    index,
  }
}
