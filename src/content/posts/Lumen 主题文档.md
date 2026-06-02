---
title: Lumen 主题文档
description: Lumen 的内容规范与写作语法。
createdAt: 2026-05-31
updatedAt: 2026-06-01
completed: true
top: true
tags: 
  - Lumen
---


## 配置

主题配置集中在 `src/site.config.ts`。

### 站点基础信息

`siteConfig` 用于配置站点基础信息：

| 字段 | 说明 |
| --- | --- |
| `title` | 站点标题|
| `slogan` | 站点描述 |
| `author` | 作者 |
| `url` | 站点 URL |
| `lang` | 站点语言 |
| `base` | 站点基础路径 |
| `avatar` | 头像与 favicon |
| `footer` | 页脚文本 |

### 导航

`navigationConfig` 用于配置头部和底部导航：

```ts
export const navigationConfig = {
  header: [
    { label: 'Home', href: '/' },
    { label: 'Posts', href: '/posts' },
  ],
  footer: [
    { label: 'Home', href: '/' },
    { label: 'Posts', href: '/posts' },
  ],
}
```

### 功能页面

`pagesConfig` 用于配置首页、友链页、标签页：

| 字段 | 说明 |
| --- | --- |
| `home` | 首页 |
| `friends` | 友链页 |
| `tags` | 标签页 |

## 内容组织

请将文章 Markdown 放在 `src/content/posts/` 目录下，支持中文文件名。

所有 Markdown 的开头必须有 Frontmatter：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `title` | 是 | 文章标题 |
| `description` | 是 | 文章描述 |
| `createdAt` | 是 | 文章创建时间 |
| `updatedAt` | 否 | 文章更新时间 |
| `completed` | 否，默认为 `true` | 文章是否完成，未完成的文章将被标记为 `Draft` |
| `top` | 否，默认为 `false` | 是否将文章置顶 |
| `tags` | 否，默认为空数组 | 文章标签 |

例如：

```yaml
---
title: Lumen 主题文档
description: 基于当前仓库实现的内容规范与写作语法说明。
createdAt: 2026-05-31
updatedAt: 2026-06-01
completed: true
top: true
tags:
  - Lumen
---
```


## 写作语法

### 基本 Markdown 语法

主题支持基本 Markdown 语法。


```md
注意，您的正文应从二级标题开始。二级到四级标题会参与右侧文章目录，高于四级的标题仍会渲染，但不会进入目录。

此外，支持 **加粗**、*斜体*、`行内代码` 和 [链接](https://astro.build/)。

- 无序列表
- 第二项

分割线：

---

1. 有序列表
2. 第二项

> 引用。

```

注意，您的正文应从二级标题开始。二级到四级标题会参与右侧文章目录，高于四级的标题仍会渲染，但不会进入目录。

此外，支持 **加粗**、*斜体*、`行内代码` 和 [链接](https://astro.build/)。

- 无序列表
- 第二项


分割线：

---

1. 有序列表
2. 第二项

> 引用。


### 扩展 Markdown 语法

主题支持表格、任务列表、删除线、脚注和自动链接等扩展 Markdown 语法。

```md
| 语法 | 用途 |
| --- | --- |
| 表格 | 展示结构化数据 |
| 任务列表 | 展示待办状态 |

- [x] 已完成
- [ ] 未完成

~~这段内容会被删除线标记。~~

这里有一个脚注引用[^demo]。

https://astro.build/

[^demo]: 这里是脚注内容。
```

| 语法 | 用途 |
| --- | --- |
| 表格 | 展示结构化数据 |
| 任务列表 | 展示待办状态 |

- [x] 已完成
- [ ] 未完成

~~这段内容会被删除线标记。~~

这里有一个脚注引用[^demo]。

https://astro.build/

[^demo]: 这里是脚注内容。

### 数学公式

主题支持行内公式和块级公式。

```md
行内公式：$E = mc^2$

块级公式：

$$
\int_0^1 x^2 \, dx = \frac{1}{3}
$$
```

行内公式：$E = mc^2$

块级公式：

$$
\int_0^1 x^2 \, dx = \frac{1}{3}
$$

### 标注

支持 4 类标注：`note`、`tip`、`warning`、`danger`。

示例：

```md
> [!note] 这里是一条笔记
> 经砖家研究，21 世纪出生的儿童无一活过三十岁。
```

> [!note] 这里是一条笔记
> 经砖家研究，21 世纪出生的儿童无一活过三十岁。

```md
> [!tip] 温馨提示
> 砖家建议不要在空腹的状态下进食。
```

> [!tip] 温馨提示
> 砖家建议不要在空腹的状态下进食。

```md
> [!warning] 重要说明
> 口渴的时候一定要喝水。
```

> [!warning] 重要说明
> 口渴的时候一定要喝水。

```md
> [!danger] 当心
> 水是剧毒的。
```

> [!danger] 当心
> 水是剧毒的。

### 代码块

主题支持基本的代码块语法，会自动显示语言标签，并提供复制按钮。

````md
```typescript
function render(state: 'loading' | 'success' | 'error') {
  switch (state) {
    case 'loading':
      return '加载中...'
    case 'success':
      return '成功'
    case 'error':
      return '失败'
  }
}
```
````

```typescript
function render(state: 'loading' | 'success' | 'error') {
  switch (state) {
    case 'loading':
      return '加载中...'
    case 'success':
      return '成功'
    case 'error':
      return '失败'
  }
}
```

也可以使用 `diff` 语言展示变更：

````md
```diff
- const enabled = false
+ const enabled = true
```
````

```diff
- const enabled = false
+ const enabled = true
```

### 徽章

主题支持自定义文本徽章。

```md
:badge[Beta]
:badge[New]
```

:badge[Beta]
:badge[New]

### 增强链接

主题支持带头像或 favicon 的链接。GitHub 用户、GitHub 仓库、和普通 URL 都可以使用。

```md
:link{#@withastro}
:link[Astro]{id=withastro/astro}
:link[Astro Docs]{id=https://docs.astro.build/}
```

:link{#@withastro}
:link[Astro]{id=withastro/astro}
:link[Astro Docs]{id=https://docs.astro.build/}

普通 Markdown 外部链接会自动添加新标签页打开所需的安全属性。

### 图片

普通 Markdown 图片可以直接使用。文章内图片默认支持点击放大。

```md
![图片说明](./demo.png)
```

需要使用标题说明、链接包裹或特殊容器时，可以使用 `:::image-*` 指令。

```md
:::image-figure[图片标题]
![图片替代文本](./demo.png)
:::

:::image-a{href="https://astro.build/"}
![Astro](./astro.png)
:::

:::image-div{class="gallery-item"}
![图片替代文本](./demo.png)
:::
```

如果需要控制图片缩放或暗色模式滤镜，可以使用受清洗规则允许的 HTML 属性。

```html
<img src="./demo.png" alt="图片说明" class="no-zoom noDarken" />
```

### 视频

视频使用 `::video` 指令生成响应式 iframe。默认支持 YouTube、Bilibili 和 Vimeo；也可以传入自定义 iframe URL。

```md
::video-youtube{#gxBkghlglTg}

::video-bilibili{id=BV1MC4y1c7Kv}

::video-vimeo[自定义标题]{id=912831806}

::video{id=https://www.youtube-nocookie.com/embed/gxBkghlglTg}
```

### 折叠内容与 HTML

主题允许经过清洗的 Raw HTML，因此可以使用 `details` / `summary` 这类安全标签。危险标签、事件属性和脚本不会作为写作能力依赖。

```html
<details>
  <summary>展开查看</summary>
  <p>这里是折叠内容。</p>
</details>
```

<details>
  <summary>展开查看</summary>
  <p>这里是折叠内容。</p>
</details>
