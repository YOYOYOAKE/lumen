import { defineCollection } from 'astro:content'
import { glob } from 'astro/loaders'
import { z } from 'astro/zod'

const tagsSchema = z.preprocess(
  (value) => (value == null ? [] : value),
  z.array(z.string()).default([]),
)

const posts = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/posts' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    createdAt: z.coerce.date(),
    updatedAt: z.coerce.date().optional(),
    completed: z.boolean().default(true),
    top: z.boolean().default(false),
    tags: tagsSchema,
  }),
})

export const collections = { posts }
