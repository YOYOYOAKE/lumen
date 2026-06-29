import { defineCollection } from 'astro:content'
import { glob } from 'astro/loaders'
import { z } from 'astro/zod'

const tagsSchema = z.preprocess(
  (value) => (value == null ? [] : value),
  z.array(z.string()).default([]),
)

// 将 'YYYY-MM-DD hh:mm:ss' 格式标准化为 UTC ISO 8601
function normalizeDateInput(value: unknown): unknown {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) {
    return value.replace(' ', 'T') + 'Z'
  }
  return value
}

const posts = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/posts' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    createdAt: z.preprocess(normalizeDateInput, z.coerce.date()),
    updatedAt: z.preprocess(normalizeDateInput, z.coerce.date().optional()),
    completed: z.boolean().default(true),
    top: z.boolean().default(false),
    tags: tagsSchema,
  }),
})

export const collections = { posts }
