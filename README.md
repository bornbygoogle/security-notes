# Security Notes

My living security knowledge base (command reference + write-ups), built with
[Nextra](https://nextra.site) and deployed on [Vercel](https://vercel.com).

## Local development

```bash
npm install        # first time only
npm run dev        # http://localhost:3000  (live reload while editing)
npm run build      # production build (what Vercel runs)
```

## Structure

```
pages/
  index.mdx            # home
  commands.mdx         # the command reference (edit this as you learn)
  _meta.js             # top-level sidebar order/labels
  writeups/
    index.mdx          # write-ups overview
    _meta.js           # write-ups sidebar order
theme.config.jsx       # site title, GitHub link, footer, search text
next.config.mjs        # Nextra wiring (don't usually touch)
```

## Add content (the "edit as I go" loop)

1. **A new command** → edit `pages/commands.mdx`.
2. **A new write-up** → create `pages/writeups/<name>.mdx`, then add it to
   `pages/writeups/_meta.js` for the sidebar.
3. Commit & push:
   ```bash
   git add -A && git commit -m "notes: <what you added>" && git push
   ```
4. Vercel rebuilds and publishes automatically within ~1 minute.

## Notes

- `typescript` is a devDependency only because Nextra's code-highlighter needs the
  TypeScript **5.x** API present at build time (do not upgrade it to 7.x).
- Keep secrets (flags, passwords, target IPs) out of anything under `pages/` — this site is public.
