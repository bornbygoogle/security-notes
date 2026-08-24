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

  it('falls back to the first real paragraph when there is no such blockquote', () => {
    const s = parseWriteup(NMAP).summary
    expect(s).toMatch(/running notes/)
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
