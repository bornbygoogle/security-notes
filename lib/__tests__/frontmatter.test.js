import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { parseWriteup } from '../writeups.js'

const CONTENT = path.join(process.cwd(), 'content')

function walk (dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (/\.mdx?$/.test(name)) out.push(full)
  }
  return out
}

const withFrontmatter = walk(CONTENT)
  .map((f) => [path.relative(CONTENT, f), readFileSync(f, 'utf8')])
  .filter(([, src]) => src.startsWith('---'))

describe('content frontmatter', () => {
  // A `description:` whose value contained ": " parsed as a nested mapping and
  // took the whole build down with a YAMLParseError. The build catches it in
  // ~90 seconds; this catches it in milliseconds.
  it('found some to check', () => {
    expect(withFrontmatter.length).toBeGreaterThan(0)
  })

  it.each(withFrontmatter)('%s is valid YAML', (rel, src) => {
    const block = src.match(/^---\r?\n([\s\S]*?)\r?\n---/)
    expect(block, rel).not.toBeNull()
    expect(() => parse(block[1]), rel).not.toThrow()
  })

  it.each(withFrontmatter)('%s has a usable description if it declares one', (rel, src) => {
    const fm = parse(src.match(/^---\r?\n([\s\S]*?)\r?\n---/)[1])
    if (fm?.description === undefined) return
    expect(typeof fm.description, rel).toBe('string')
    expect(fm.description.trim().length, rel).toBeGreaterThan(20)
  })
})

describe('the write-up index copy', () => {
  const writeups = withFrontmatter.filter(([rel]) => rel.startsWith('writeups' + path.sep))

  it('gives every write-up its own summary', () => {
    const summaries = writeups.map(([, src]) => parseWriteup(src).summary)
    expect(summaries.filter((s) => !s)).toEqual([])
    expect(new Set(summaries).size).toBe(summaries.length)
  })

  it('never falls back to a dangling lead-in or a bare lab IP', () => {
    for (const [rel, src] of writeups) {
      const s = parseWriteup(src).summary
      expect(s, rel).not.toMatch(/:$/)
      expect(s, rel).not.toMatch(/\b\d{1,3}(\.\d{1,3}){3}\b/)
      expect(s, rel).not.toMatch(/^These are running notes/i)
    }
  })
})
