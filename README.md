# Security Notes

My living security knowledge base (command reference + write-ups), built with
[Nextra 4](https://nextra.site) (App Router) and deployed on [Vercel](https://vercel.com).

## Local development

```bash
npm install        # first time only
npm run dev        # http://localhost:3000  (live reload while editing)
npm run build      # production build + Pagefind search index (what Vercel runs)
npm start          # serve the production build locally
```

## Structure (Nextra 4 / App Router)

```
app/
  layout.jsx                 # site chrome: Navbar, Footer, theme, sidebar (via <Layout>)
  [[...mdxPath]]/page.jsx     # renders MDX from content/ for every route
mdx-components.jsx            # merges the theme's MDX components (required by Nextra 4)
content/
  index.mdx                  # home
  commands.mdx               # the command reference (edit this as you learn)
  _meta.js                   # top-level sidebar order/labels
  writeups/
    index.mdx
    _meta.js                 # write-ups sidebar order
next.config.mjs              # Nextra wiring
```

## Add content (the "edit as I go" loop)

1. **A new command** -> edit `content/commands.mdx`.
2. **A new write-up** -> create `content/writeups/<name>.mdx`, then add it to
   `content/writeups/_meta.js` for the sidebar.
3. Commit & push:
   ```bash
   git add -A && git commit -m "notes: <what you added>" && git push
   ```
4. Vercel rebuilds (incl. the Pagefind search index) and publishes automatically.

## Pinned versions & why (do not bump blindly)

- **nextra / nextra-theme-docs pinned to `4.2.17`** — the last 4.x on **zod 3**. Versions 4.3.0+
  migrated to zod 4, which currently crashes the theme's `<Layout>` at build with
  `expected nonoptional, received undefined -> at children`. Revisit only when a newer Nextra fixes it.
- **next pinned to `^15.5`** — Nextra 4.2.17 targets Next 15. **Next 16 breaks it** (RSC changes -> the
  same `children` error). Staying on 15 also clears the Next 14 security advisories.
- **typescript `^5.9`** (devDependency) — Nextra's code highlighter (`twoslash`) needs the classic
  TypeScript **5.x** API at build time. Do **not** let it move to TypeScript 7 (the Go rewrite) — it
  breaks the build with `Cannot read properties of undefined (reading 'readFile')`.
- **pagefind** (devDependency) — powers site search. The `postbuild` script runs it over the built
  HTML and writes `public/_pagefind/` (git-ignored; regenerated on every build).

## Notes

- Keep secrets (flags, passwords, target IPs) out of anything under `content/` — this site is public.
