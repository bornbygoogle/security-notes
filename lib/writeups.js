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

/**
 * Openings shared across write-ups. They are good for the reader of one page
 * and useless in an index — two write-ups that both start "These are running
 * notes" got the same subtitle, which tells you nothing about which to open.
 */
const BOILERPLATE = /^(These are running notes|This guide assumes|These notes)/i

function clamp (s, max = 240) {
  if (s.length <= max) return s
  const cut = s.slice(0, max)
  const at = cut.lastIndexOf(' ')
  return `${cut.slice(0, at > 80 ? at : max).trimEnd()}…`
}

/** Which methodology phases a document covers, in canonical order.
 *  "post-exploitation" also satisfies a loose exploitation read; the lookbehind
 *  in PHASE_WORDS stops that, so a doc mentioning only post- keeps only post-. */
function phasesIn (markdown) {
  const found = new Set()
  for (const { label, re } of PHASE_WORDS) {
    if (re.test(markdown)) found.add(label)
  }
  return ORDER.filter((p) => found.has(p))
}

export function parseWriteup (markdown) {
  const empty = { title: '', summary: '', phases: [] }
  if (typeof markdown !== 'string' || !markdown.trim()) return empty

  // An authored summary beats any heuristic. content/drill.mdx already sets
  // `description:` this way, so it is the pattern the repo uses rather than a
  // new one invented here.
  const fm = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (fm) {
    const d = fm[1].match(/^description:\s*(.+)$/m)
    if (d) {
      const authored = plain(d[1].trim().replace(/^["']|["']$/g, ''))
      if (authored) {
        const body = markdown.slice(fm[0].length)
        const h = body.split('\n').find((l) => /^#\s+/.test(l.trim()))
        return {
          title: h ? plain(h.trim().replace(/^#\s+/, '')) : '',
          summary: clamp(authored),
          phases: phasesIn(markdown)
        }
      }
    }
  }

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

  // Second choice: an explicit Goal line. Several write-ups state the room's
  // brief there, and it is the most specific sentence on the page.
  if (!summary) {
    const goal = markdown.match(/^\*\*Goal[^*]*:\*\*\s*([\s\S]*?)(?:\n\s*\n|\n\*\*)/m)
    if (goal) summary = plain(goal[1])
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
      if (BOILERPLATE.test(first)) continue
      summary = plain(block)
      break
    }
  }

  const phases = phasesIn(markdown)

  // Stripping the "What you'll learn:" lead-in leaves the sentence starting
  // mid-flow and lowercase.
  const s = clamp(summary)
  return { title, summary: s ? s[0].toUpperCase() + s.slice(1) : '', phases }
}
