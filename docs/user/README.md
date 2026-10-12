# Studio user guide

These pages are the Studio user guide published at
[docs.spec0.io/docs/studio](https://docs.spec0.io/docs/studio). This folder is
where they're written, so a fix or a new page starts here, as a pull request
like any other.

The site is updated from this folder when a maintainer syncs it, normally with
each Studio release. A merged change shows up on the site then, not straight
away.

## How the folder maps to the site

Each `.mdx` file is a page, at the same path under `/docs/studio`:

| File | Page |
|---|---|
| `index.mdx` | `/docs/studio` |
| `local-mocks.mdx` | `/docs/studio/local-mocks` |
| `collections/chaining.mdx` | `/docs/studio/collections/chaining` |

`meta.json` in each folder sets the order of pages in the sidebar. Entries such
as `"---Mock servers---"` are section headings. A new page has to be added to
the `pages` list, or it won't appear in the navigation.

Images and clips live in `assets/`, laid out the way the site serves them:
`assets/images/product/studio-console.webp` is published as
`/images/product/studio-console.webp`, and that's the path a page uses.

## Writing a page

Pages are Markdown with a few components (MDX). Start with frontmatter:

```yaml
---
title: Local mock servers
description: Run a mock of any API in your library on this computer, with no account.
docType: how-to
---
```

`docType` says what kind of page it is, which the site's search and Spec0's docs
tools use to split the page into sections. Use `how-to` for steps towards a
goal, `concept` for explaining one idea, `reference` for tables and lists of
links, and `recipe` for one small, complete task.

Link to other Studio pages by their site path, such as
`[local mocks](/docs/studio/local-mocks)` or
`[the key](/docs/studio/hosted-mocks#regenerate-the-key)`, not by file name.
Links to other parts of the site (`/docs/cli`, for example) are fine too.

These components are available. Anything else, and `import` or `export`
statements, won't work on the site.

- `<Callout>` for a note set apart from the text. It takes an optional `title`
  and `type` (`info`, `warn`, `error`, `success`). A `> [!NOTE]` or
  `> [!WARNING]` block quote becomes one as well.
- `<Steps>` with a `<Step>` for each numbered step.
- `<Tabs items={[...]}>` with a `<Tab value="...">` for each tab, for example
  setup for different clients.
- `<Accordions>` with `<Accordion title="...">` for detail most readers can skip.
- `<Mermaid chart="...">` for a diagram.
- `<Screenshot>` for an image. It needs `src`, `alt`, `caption`, `width` and
  `height` (the image's size in pixels). `maxWidth` keeps a small capture from
  being stretched, and `minWidth` keeps a wide one readable on a phone.
- `<Clip>` for a short screen recording. It needs `src` (an `.mp4`), `poster`
  (a still shown before it plays), `label`, `caption`, `width` and `height`.

A caption says what the reader should notice, not what the heading above it
already said. Screenshots are WebP at twice the size they're shown; clips are
silent MP4s with a WebP poster next to them.

## Checking your change

The full site isn't in this repository, so you can't preview a page exactly as
it will look. GitHub's preview of an `.mdx` file shows the text and most of the
Markdown, which is usually enough.

Before you open a pull request, run:

```bash
node scripts/check-user-docs.mjs
```

It runs in CI on every pull request that changes this folder, and checks that:

- every page has a `title`, a `description` and a known `docType`
- only the components above are used, with the props they need
- links between Studio pages, and their `#anchors`, lead somewhere
- every image or clip a page uses is in `assets/`, and every file in `assets/`
  is used
- every page is listed in a `meta.json`, and everything listed exists

## Style

Write the way the rest of the guide is written: plainly, in the second person,
with the names of buttons and settings in **bold** as they appear in Studio.
Say what something does before how it works, keep claims to what Studio does
today, and mention limits where they matter rather than in a list at the end.
