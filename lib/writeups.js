/**
 * Pulls a card's worth of metadata out of a write-up's markdown.
 *
 * The write-ups index used to be hand-maintained, and it drifted: it still
 * said "No write-ups published yet" with three published, and pointed at a
 * pages/ directory that stopped existing at the Nextra 4 migration. Deriving
 * the index from the files is the fix — there is nothing left to forget.
 *
 * Pure. The caller does the file reading.
 */

/** Canonical methodology order. Post-exploitation is matched before
 *  Exploitation so the "post-" prefix wins. */
export const PHASE_WORDS = [
  { label: 'Recon', re: /\brecon(?:naissance)?\b/i },
  { label: 'Enumeration', re: /\benumerat(?:ion|e|ing)\b/i },
  { label: 'Exploitation', re: /(?<!post[\s-])\bexploitation\b/i },
  { label: 'Post-exploitation', re: /\bpost[\s-]?exploitation\b/i }
]

const ORDER = ['Recon', 'Enumeration', 'Exploitation', 'Post-exploitation']

/** Drop markdown decoration so a summary reads as plain prose. */
function plain (s) {
  return s
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/\*([^*]*)\*/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

function clamp (s, max = 240) {
  if (s.length <= max) return s
  const cut = s.slice(0, max)
  const at = cut.lastIndexOf(' ')
  return `${cut.slice(0, at > 80 ? at : max).trimEnd()}…`
}

export function parseWriteup (markdown) {
  const empty = { title: '', summary: '', phases: [] }
  if (typeof markdown !== 'string' || !markdown.trim()) return empty

  const lines = markdown.split('\n')

  const h1 = lines.find((l) => /^#\s+/.test(l.trim()))
  const title = h1 ? plain(h1.trim().replace(/^#\s+/, '')) : ''

  // Preferred: the "What you'll learn" blockquote the write-ups open with.
  let summary = ''
  const startedAt = lines.findIndex((l) => /^>\s*\*\*What you['’]ll learn/i.test(l.trim()))
  if (startedAt !== -1) {
    const buf = []
    for (let i = startedAt; i < lines.length; i++) {
      const t = lines[i].trim()
      if (!t.startsWith('>')) break
      const body = t.replace(/^>\s?/, '')
      if (!body.trim()) break // blank quote line ends the paragraph
      buf.push(body)
    }
    summary = plain(buf.join(' ')).replace(/^What you['’]ll learn:\s*/i, '')
  }

  // Fallback: the first real paragraph. This works on blank-line-separated
  // blocks, not single lines — a wrapped "**Goal:** …" label spills onto a
  // second line that looks like ordinary prose on its own and would otherwise
  // be picked as the summary mid-sentence.
  if (!summary) {
    const blocks = markdown
      .split(/\n\s*\n/)
      .map((b) => b.trim())
      .filter(Boolean)
    for (const block of blocks) {
      const first = block.split('\n')[0].trim()
      if (/^[#>\-*|]/.test(first)) continue
      if (/^\*\*[^*]+[:—-]\*\*/.test(first)) continue
      if (/^\*\*/.test(first)) continue
      if (/^\w[\w ]*:\s/.test(first) && first.length < 60) continue
      summary = plain(block)
      break
    }
  }

  const found = new Set()
  for (const { label, re } of PHASE_WORDS) {
    if (re.test(markdown)) found.add(label)
  }
  // "post-exploitation" also satisfies a loose exploitation read; the lookbehind
  // above stops that, so a doc mentioning only post- keeps only post-.
  const phases = ORDER.filter((p) => found.has(p))

  // Stripping the "What you'll learn:" lead-in leaves the sentence starting
  // mid-flow and lowercase.
  const s = clamp(summary)
  return { title, summary: s ? s[0].toUpperCase() + s.slice(1) : '', phases }
}
