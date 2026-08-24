import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { parseWriteup } from '../lib/writeups.js'

const ROOT = ['content', 'writeups']

/**
 * Lists every write-up, generated from the files at build time.
 *
 * A typographic list, not a grid of cards: three items do not need cards, and
 * the thing a reader scans for is the title and what it teaches.
 */
export default async function WriteupIndex () {
  const dir = path.join(process.cwd(), ...ROOT)
  const entries = await readdir(dir, { withFileTypes: true })

  const items = []
  for (const e of entries) {
    if (!e.isDirectory()) continue
    const files = await readdir(path.join(dir, e.name))
    const doc = files.find((f) => /\.mdx?$/.test(f) && f !== '_meta.js')
    if (!doc) continue
    const md = await readFile(path.join(dir, e.name, doc), 'utf8')
    const { title, summary, phases } = parseWriteup(md)
    items.push({
      href: `/writeups/${e.name}/${doc.replace(/\.mdx?$/, '')}`,
      title,
      summary,
      phases,
      words: md.split(/\s+/).length
    })
  }

  items.sort((a, b) => a.title.localeCompare(b.title))

  if (items.length === 0) return null

  return (
    <ul className="sn-wlist">
      {items.map((w) => (
        <li key={w.href} className="sn-w">
          <a className="sn-w__link" href={w.href}>
            <h3 className="sn-w__title">{w.title}</h3>
          </a>
          <p className="sn-w__sum">{w.summary}</p>
          <p className="sn-w__meta">
            {w.phases.map((p) => (
              <span key={p} className="sn-w__phase">
                {p}
              </span>
            ))}
            <span className="sn-w__words">{Math.round(w.words / 100) / 10}k words</span>
          </p>
        </li>
      ))}
    </ul>
  )
}
