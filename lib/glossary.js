/**
 * Turns content/pt1-course/glossary.mdx into flashcards.
 *
 * The glossary is the deck. That is deliberate: it already exists, it is
 * already the vocabulary the exam tests, and parsing it means a term added to
 * the glossary becomes a card with no second place to edit.
 *
 * Two shapes in the file, both handled:
 *   - **Term** — definition
 *   - **a** — def one. **b** — def two.      (the "Common tools" line)
 *
 * Pure. No React, no DOM, no IO — the caller reads the file.
 */

// A term may carry a parenthetical qualifier before the dash:
//   **CIDR** (e.g. `/24`) — …        **SYSTEM** (`NT AUTHORITY\SYSTEM`) — …
// The qualifier stays on the prompt but is left out of the id.
const PAIR = /\*\*(.+?)\*\*(\s*\([^)]*\))?\s*[—–]\s*/g

export function slugifyTerm (term) {
  return String(term ?? '')
    .replace(/`/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Parse the raw glossary markdown into `{id, term, definition, section, code}`. */
export function parseGlossary (markdown) {
  if (typeof markdown !== 'string' || !markdown.trim()) return []

  const cards = []
  const seen = new Set()
  let section = ''

  for (const raw of markdown.split('\n')) {
    const line = raw.trim()

    if (line.startsWith('## ')) {
      // "Common tools (quick "what is it")" → "Common tools"
      section = line.slice(3).replace(/\s*\(.*$/, '').trim()
      continue
    }
    if (!line.startsWith('- ')) continue

    const body = line.slice(2)
    // Find every **term** — … on the line, then take each definition as the
    // text running up to the start of the next pair.
    const hits = [...body.matchAll(PAIR)]
    if (hits.length === 0) continue

    hits.forEach((hit, i) => {
      const start = hit.index + hit[0].length
      const end = i + 1 < hits.length ? hits[i + 1].index : body.length
      const definition = body.slice(start, end).trim()
      if (!definition) return

      const rawTerm = hit[1].trim()
      const qualifier = (hit[2] ?? '').trim()
      const code = /^`.*`$/.test(rawTerm)
      const bare = code ? rawTerm.replace(/^`|`$/g, '') : rawTerm
      const term = qualifier ? `${bare} ${qualifier}` : bare
      const id = slugifyTerm(bare)
      if (!id || !bare || seen.has(id)) return

      seen.add(id)
      cards.push({ id, term, definition, section, code })
    })
  }

  return cards
}
