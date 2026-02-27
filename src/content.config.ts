import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const posts = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string().min(5),
    description: z.string().min(20),
    slug: z.string().min(3).optional(),
    publishedAt: z.coerce.date(),
    updatedAt: z.coerce.date(),
    tags: z.array(z.string()).min(1),
    category: z.string().min(2),
    readingTimeMinutes: z.number().int().positive()
  })
});

const keywords = defineCollection({
  loader: glob({ pattern: '**/*.json', base: './src/content/keywords' }),
  schema: z
    .object({
      generatedAt: z.string().optional(),
      count: z.number().optional(),
      keywords: z.array(z.string()).optional()
    })
    .passthrough()
});

export const collections = { posts, keywords };
