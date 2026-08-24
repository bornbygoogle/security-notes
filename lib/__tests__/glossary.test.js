import { describe, expect, it } from 'vitest'
import { parseGlossary, slugifyTerm } from '../glossary.js'

const SAMPLE = `# PT1 Course Glossary

Plain-language definitions for every term the course uses.

## Setup & general

- **Kali Linux** — the standard Linux distribution for penetration testing; comes with the tools pre-loaded. Your "attack box."
- **VM (Virtual Machine)** — a full computer running inside your real one, isolated so you can break things safely.
- **\`tun0\`** — the network interface the VPN creates. Your attacker IP lives here (\`ip addr show tun0\`).

## Networking

- **Port** — a numbered door on a host, 1-65535.
- **CIDR** (e.g. \`/24\`) — notation for a subnet's size.

## Common tools (quick "what is it")

- **nmap** — port/service scanner. **ffuf / gobuster** — web content brute-forcers. **Burp Suite** — intercepting web proxy.

---

*Missing a term? It's worth adding.*
`

describe('slugifyTerm', () => {
  it('kebab-cases a plain term', () => {
    expect(slugifyTerm('Kali Linux')).toBe('kali-linux')
  })

  it('drops parentheses and punctuation', () => {
    expect(slugifyTerm('VM (Virtual Machine)')).toBe('vm-virtual-machine')
  })

  it('strips backticks', () => {
    expect(slugifyTerm('`tun0`')).toBe('tun0')
  })

  it('collapses slashes and spaces', () => {
    expect(slugifyTerm('ffuf / gobuster')).toBe('ffuf-gobuster')
  })
})

describe('parseGlossary', () => {
  const cards = parseGlossary(SAMPLE)

  it('finds every term, including the three packed on one line', () => {
    // 3 setup + 2 networking + 3 packed into the tools line
    expect(cards).toHaveLength(8)
  })

  // Two real glossary entries qualify the term before the dash:
  //   **CIDR** (e.g. `/24`) — …      **SYSTEM** (`NT AUTHORITY\\SYSTEM`) — …
  // An earlier regex demanded the dash straight after the bold and silently
  // dropped both, so the deck was two cards short with no error anywhere.
  it('accepts a parenthetical qualifier between the term and the dash', () => {
    const cidr = cards.find((c) => c.id === 'cidr')
    expect(cidr).toBeDefined()
    expect(cidr.definition).toBe("notation for a subnet's size.")
  })

  it('keeps the qualifier on the prompt but out of the id', () => {
    const cidr = cards.find((c) => c.id === 'cidr')
    expect(cidr.term).toBe('CIDR (e.g. `/24`)')
  })

  it('keeps the term and definition apart', () => {
    const kali = cards.find((c) => c.id === 'kali-linux')
    expect(kali.term).toBe('Kali Linux')
    expect(kali.definition).toBe(
      'the standard Linux distribution for penetration testing; comes with the tools pre-loaded. Your "attack box."'
    )
  })

  it('tags each card with the section it came from', () => {
    expect(cards.find((c) => c.id === 'kali-linux').section).toBe('Setup & general')
    expect(cards.find((c) => c.id === 'port').section).toBe('Networking')
    expect(cards.find((c) => c.id === 'nmap').section).toBe('Common tools')
  })

  it('splits a line that packs several term/definition pairs', () => {
    const nmap = cards.find((c) => c.id === 'nmap')
    expect(nmap.definition).toBe('port/service scanner.')
    const ffuf = cards.find((c) => c.id === 'ffuf-gobuster')
    expect(ffuf.term).toBe('ffuf / gobuster')
    expect(ffuf.definition).toBe('web content brute-forcers.')
    expect(cards.find((c) => c.id === 'burp-suite').definition).toBe(
      'intercepting web proxy.'
    )
  })

  it('marks a term that was written as code', () => {
    const tun = cards.find((c) => c.id === 'tun0')
    expect(tun.term).toBe('tun0')
    expect(tun.code).toBe(true)
    expect(cards.find((c) => c.id === 'kali-linux').code).toBe(false)
  })

  it('keeps inline code inside the definition intact', () => {
    expect(cards.find((c) => c.id === 'tun0').definition).toContain('`ip addr show tun0`')
  })

  it('ignores the heading, the intro, the rule and the closing italic note', () => {
    expect(cards.some((c) => /Missing a term/.test(c.definition))).toBe(false)
    expect(cards.some((c) => c.term.startsWith('#'))).toBe(false)
  })

  it('gives every card a unique id', () => {
    const ids = cards.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('never emits an empty term or definition', () => {
    for (const c of cards) {
      expect(c.term.length).toBeGreaterThan(0)
      expect(c.definition.length).toBeGreaterThan(0)
    }
  })

  it('returns an empty list for empty input rather than throwing', () => {
    expect(parseGlossary('')).toEqual([])
    expect(parseGlossary(null)).toEqual([])
  })
})

// ── Guard against silent drops in the real deck ─────────────────────────
// The qualifier bug above lost two cards with no error anywhere. This reads
// the actual glossary and insists every bullet produces at least one card.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const GLOSSARY = readFileSync(
  fileURLToPath(new URL('../../content/pt1-course/glossary.mdx', import.meta.url)),
  'utf8'
)

describe('the real glossary', () => {
  const cards = parseGlossary(GLOSSARY)

  it('parses every bullet — no line is silently skipped', () => {
    const bullets = GLOSSARY.split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('- **'))
    const unparsed = bullets.filter((l) => {
      const got = parseGlossary(`## x\n${l}`)
      return got.length === 0
    })
    expect(unparsed).toEqual([])
  })

  it('yields a deck big enough to be worth drilling', () => {
    expect(cards.length).toBeGreaterThanOrEqual(100)
  })

  it('files every card under a section', () => {
    expect(cards.filter((c) => !c.section)).toEqual([])
  })

  it('never truncates a definition mid-sentence', () => {
    const truncated = cards.filter((c) => !/[.!?)\]"”`]$/.test(c.definition))
    expect(truncated.map((c) => `${c.term}: …${c.definition.slice(-30)}`)).toEqual([])
  })
})
