import { defineConfig } from 'astro/config'
import tailwindcss from '@tailwindcss/vite'
import rehypeCallouts from 'rehype-callouts'
import rehypeExternalLinks from 'rehype-external-links'
import rehypeKatex from 'rehype-katex'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize from 'rehype-sanitize'
import rehypeSlug from 'rehype-slug'
import rehypeUnwrapImages from 'rehype-unwrap-images'
import remarkDirective from 'remark-directive'
import remarkDirectiveSugar from 'remark-directive-sugar'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkSmartypants from 'remark-smartypants'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { DANGER_CALLOUT_ICON, sanitizeSchema } from './src/lib/markdown-constants.mjs'
import {
  rehypeRepairSanitizedHashLinks,
  remarkAssertSupportedCallouts,
} from './src/lib/markdown-plugins.mjs'

const rootDir = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  site: 'https://www.yoake.cc/',
  output: 'static',
  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        '~': resolve(rootDir, 'src'),
      },
    },
  },
  markdown: {
    remarkPlugins: [
      remarkGfm,
      remarkSmartypants,
      remarkAssertSupportedCallouts,
      remarkDirective,
      [
        remarkDirectiveSugar,
        {
          badge: { presets: { n: { text: 'NEW' } } },
          link: {
            faviconSourceUrl: 'https://www.google.com/s2/favicons?domain={domain}&sz=128',
            imgProps: () => ({ 'aria-hidden': 'true' }),
          },
          image: { stripParagraph: false },
          video: {
            platforms: {
              bilibili: 'https://player.bilibili.com/player.html?bvid={id}&autoplay=0',
            },
          },
        },
      ],
      remarkMath,
    ],
    rehypePlugins: [
      rehypeRaw,
      [rehypeSanitize, sanitizeSchema],
      rehypeRepairSanitizedHashLinks,
      rehypeSlug,
      rehypeUnwrapImages,
      [
        rehypeCallouts,
        {
          theme: 'vitepress',
          callouts: {
            danger: {
              title: 'DANGER',
              indicator: DANGER_CALLOUT_ICON,
            },
          },
        },
      ],
      [
        rehypeExternalLinks,
        {
          target: '_blank',
          rel: ['noopener', 'noreferrer'],
        },
      ],
      rehypeKatex,
    ],
    shikiConfig: {
      themes: {
        light: 'catppuccin-latte',
        dark: 'catppuccin-macchiato',
      },
      langs: [
        'javascript',
        'typescript',
        'vue',
        'html',
        'css',
        'json',
        'yaml',
        'markdown',
        'bash',
        'shell',
        'powershell',
        'python',
        'go',
        'sql',
        'dockerfile',
        'toml',
        'ini',
        'diff',
        'plaintext',
        'tsx',
        'jsx',
        'rust',
        'java',
        'c',
        'cpp',
      ],
    },
  },
})
