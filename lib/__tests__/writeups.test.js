import { describe, expect, it } from 'vitest'
import { PHASE_WORDS, parseWriteup } from '../writeups.js'

const NMAP = `# TryHackMe — Nmap Challenge: from a high port to a shell

**Target:** \`10.129.152.110\`
**Date:** 2026-08-23
**Goal (as given by the room):** the box listens on a *high* port. Connect to it, read whatever it
tells you, and use that information to log in on a *low* port "commonly used for remote access".

These are running notes. Every command is written down as it was run.

**Methodology phase mapping**

- Recon — port scan
- Enumeration — banner grab
- Exploitation — ssh in
`

const GREP = `# Grep / SuperSecure Corp (SearchME) — OSINT + Web Walkthrough (PT1 study edition)

> **What you'll learn:** a complete, methodical web pentest — recon → enumeration → OSINT →
> authenticated access → insecure file upload → RCE → database access → credential recovery.
> Every command is broken down **flag by flag**.
>
> **Target used in this run:** \`10.129.164.123\`.
`

describe('parseWriteup', () => {
  it('takes the title from the first h1, without the hashes', () => {
    expect(parseWriteup(NMAP).title).toBe(
      'TryHackMe — Nmap Challenge: from a high port to a shell'
    )
  })

  it('prefers the "What you\'ll learn" blockquote as the summary', () => {
    const s = parseWriteup(GREP).summary
    expect(s).toMatch(/^A complete, methodical web pentest/)
    expect(s).not.toContain('>')
    expect(s).not.toContain('**')
  })

  it('prefers the Goal line over the running-notes boilerplate', () => {
    // This used to assert the summary WAS "These are running notes…", which
    // is the shared opening of several write-ups and made the index show the
    // same subtitle twice. The Goal line is what actually describes this box.
    const s = parseWriteup(NMAP).summary
    expect(s).toMatch(/high.*port/i)
    expect(s).not.toMatch(/running notes/i)
  })

  it('still falls back to the first real paragraph when there is no blockquote and no Goal', () => {
    const bare = '# T\n\nSome specific prose about this particular box and its odd service.\n'
    const s = parseWriteup(bare).summary
    expect(s).toMatch(/odd service/)
    expect(s).not.toMatch(/^#/)
  })

  it('strips markdown emphasis and inline code from the summary', () => {
    const s = parseWriteup(GREP).summary
    expect(s).not.toMatch(/[*`]/)
  })

  it('detects the methodology phases the write-up covers, in canonical order', () => {
    expect(parseWriteup(NMAP).phases).toEqual(['Recon', 'Enumeration', 'Exploitation'])
  })

  it('does not repeat a phase mentioned many times', () => {
    const doc = '# T\n\nrecon recon Recon and enumeration and ENUMERATION'
    expect(parseWriteup(doc).phases).toEqual(['Recon', 'Enumeration'])
  })

  it('knows all four phases', () => {
    expect(PHASE_WORDS.map((p) => p.label)).toEqual([
      'Recon',
      'Enumeration',
      'Exploitation',
      'Post-exploitation'
    ])
  })

  it('matches post-exploitation without also counting it as exploitation twice', () => {
    const doc = '# T\n\nWe moved into post-exploitation only.'
    expect(parseWriteup(doc).phases).toEqual(['Post-exploitation'])
  })

  it('survives empty or junk input', () => {
    expect(parseWriteup('')).toMatchObject({ title: '', summary: '', phases: [] })
    expect(parseWriteup(null)).toMatchObject({ title: '', summary: '', phases: [] })
  })

  it('capitalises the summary — stripping the "What you\'ll learn:" prefix leaves it lowercase', () => {
    expect(parseWriteup(GREP).summary[0]).toBe('A')
  })

  it('keeps the summary to a readable length', () => {
    expect(parseWriteup(GREP).summary.length).toBeLessThanOrEqual(240)
  })
})

describe('the fallback summary earns its place', () => {
  // Two write-ups open with the same "These are running notes…" paragraph, so
  // the index rendered near-identical subtitles for both. Boilerplate that
  // every write-up shares tells a reader nothing about which one to open.
  const NOTES_THEN_GOAL = `# A box

**Target:** \`10.10.10.10\`
**Goal (as given by the room):** the box listens on a high port. Connect to it and
use what it tells you to log in on a low port.

These are running notes. Every command is written down as it was run.

Then the real prose starts here and says something specific about this box.
`

  const NOTES_FIRST = `# Another box

These are running notes. Every step was written down before it was run.

The instance for this session was \`10.128.135.177\`, and the app is a Node/Express
thing behind a socket.
`

  it('prefers a Goal line over the shared running-notes boilerplate', () => {
    const s = parseWriteup(NOTES_THEN_GOAL).summary
    expect(s).toMatch(/high port/i)
    expect(s).not.toMatch(/running notes/i)
  })

  it('skips the boilerplate and takes the next real paragraph', () => {
    const s = parseWriteup(NOTES_FIRST).summary
    expect(s).not.toMatch(/^These are running notes/i)
    expect(s).toMatch(/Node\/Express/)
  })

  it('gives two write-ups that share an opening different summaries', () => {
    const a = parseWriteup(NOTES_THEN_GOAL).summary
    const b = parseWriteup(NOTES_FIRST).summary
    expect(a).not.toBe(b)
  })
})

describe('an authored summary wins', () => {
  // A derived summary is a guess. "The challenge says:" is what the heuristic
  // picked for one write-up — grammatical, useless. Frontmatter lets the
  // write-up say what it is, and the heuristic stays for anything without it.
  const WITH_FM = `---
description: Static analysis of a Windows game binary — strings, offsets, no execution.
---

# Unpacking Tetrix

The challenge says:

> Cipher has gone dark.
`

  it('prefers the frontmatter description', () => {
    expect(parseWriteup(WITH_FM).summary).toBe(
      'Static analysis of a Windows game binary — strings, offsets, no execution.'
    )
  })

  it('still finds the title below the frontmatter', () => {
    expect(parseWriteup(WITH_FM).title).toBe('Unpacking Tetrix')
  })

  it('does not treat a frontmatter key as prose when there is no description', () => {
    const doc = '---\ntitle: A box\n---\n\n# A box\n\nReal prose about the box.\n'
    expect(parseWriteup(doc).summary).toBe('Real prose about the box.')
  })
})
