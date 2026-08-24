'use client'

import { usePathname } from 'next/navigation'
import { useEffect } from 'react'
import { attributeCommands, isFlagToken, lookupFlag } from '../lib/flags.js'

/**
 * Turns every explained flag inside a fenced code block into a hoverable,
 * focusable button that says what the flag does.
 *
 * Why a DOM pass instead of an MDX component: the lessons are plain markdown
 * fences and stay that way — no content edits, and a new lesson gets tooltips
 * for free. A corpus scan of the built pages (157 blocks / 366 lines) confirmed
 * Shiki emits each flag as its own atomic <span>, e.g. `<span style=…> -sV</span>`,
 * so there is a real node to decorate. Text-language blocks put the whole line
 * in one span; those never match isFlagToken, so they are skipped for free.
 *
 * The tooltip is a single fixed-position element on <body> rather than a CSS
 * ::after, because <pre> scrolls horizontally and would clip it.
 */
export default function FlagTips () {
  const pathname = usePathname()

  useEffect(() => {
    const main = document.querySelector('main')
    if (!main) return

    const tip = document.createElement('div')
    tip.className = 'sn-tip'
    tip.id = 'sn-tip'
    tip.setAttribute('role', 'tooltip')
    tip.hidden = true
    document.body.appendChild(tip)

    let active = null

    const place = () => {
      if (!active) return
      const r = active.getBoundingClientRect()
      tip.style.visibility = 'hidden'
      tip.hidden = false
      const t = tip.getBoundingClientRect()
      const pad = 10
      let left = r.left + r.width / 2 - t.width / 2
      left = Math.max(pad, Math.min(left, window.innerWidth - t.width - pad))
      // Prefer above; flip below when there is no room.
      const above = r.top - t.height - 8
      const below = r.bottom + 8
      const top = above > pad ? above : below
      tip.dataset.side = above > pad ? 'top' : 'bottom'
      tip.style.setProperty('--arrow-x', `${r.left + r.width / 2 - left}px`)
      tip.style.left = `${left}px`
      tip.style.top = `${top}px`
      tip.style.visibility = ''
    }

    const show = (el) => {
      active = el
      tip.textContent = ''
      const head = document.createElement('span')
      head.className = 'sn-tip__flag'
      head.textContent = el.dataset.cmd ? `${el.dataset.cmd} ${el.dataset.flag}` : el.dataset.flag
      const body = document.createElement('span')
      body.className = 'sn-tip__text'
      body.textContent = el.dataset.tip
      tip.append(head, body)
      tip.hidden = false
      el.setAttribute('aria-describedby', 'sn-tip')
      place()
      requestAnimationFrame(() => tip.classList.add('is-open'))
    }

    const hide = () => {
      if (active) active.removeAttribute('aria-describedby')
      active = null
      tip.classList.remove('is-open')
      tip.hidden = true
    }

    const onOver = (e) => {
      const el = e.target.closest?.('.sn-flag')
      if (el && el !== active) show(el)
    }
    const onOut = (e) => {
      if (active && !e.relatedTarget?.closest?.('.sn-flag')) hide()
    }
    const onFocus = (e) => {
      const el = e.target.closest?.('.sn-flag')
      if (el) show(el)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') hide()
    }
    const onClick = (e) => {
      const el = e.target.closest?.('.sn-flag')
      if (!el) return
      e.preventDefault()
      // Touch has no hover: tapping toggles.
      if (el === active) hide()
      else show(el)
    }

    // ── decorate ────────────────────────────────────────────────────────
    for (const code of main.querySelectorAll('code.nextra-code')) {
      if (code.dataset.snFlags) continue
      const lineEls = Array.from(code.children).filter((n) => n.tagName === 'SPAN')
      if (lineEls.length === 0) continue // inline code: no line wrappers
      code.dataset.snFlags = '1'

      const commands = attributeCommands(lineEls.map((l) => l.textContent))

      lineEls.forEach((lineEl, i) => {
        const command = commands[i]
        if (!command) return
        for (const token of Array.from(lineEl.children)) {
          if (token.tagName !== 'SPAN') continue
          const text = token.textContent
          if (!isFlagToken(text)) continue
          const hit = lookupFlag(command, text)
          if (!hit) continue

          const m = /^(\s*)(\S+)(\s*)$/.exec(text)
          if (!m) continue
          const btn = document.createElement('button')
          btn.type = 'button'
          btn.className = 'sn-flag'
          btn.textContent = m[2]
          btn.dataset.flag = hit.flag
          btn.dataset.cmd = hit.command ?? ''
          btn.dataset.tip = hit.text
          btn.setAttribute('aria-label', `${hit.flag} — what this flag does`)

          token.textContent = ''
          if (m[1]) token.appendChild(document.createTextNode(m[1]))
          token.appendChild(btn)
          if (m[3]) token.appendChild(document.createTextNode(m[3]))
        }
      })
    }

    // Do NOT bail when `decorated === 0`. Under reactStrictMode React runs
    // this effect twice: the first pass decorates and marks each block with
    // data-sn-flags, the second finds everything already marked and counts
    // zero — so an early return here left dev with no listeners at all and no
    // tooltip ever responded. "Already decorated" and "nothing to decorate"
    // are different states; only the latter is a reason to skip, and the
    // cheap way to tell is to look for a button rather than count this pass.
    if (main.querySelector('button.sn-flag') === null) {
      tip.remove()
      return
    }

    main.addEventListener('mouseover', onOver)
    main.addEventListener('mouseout', onOut)
    main.addEventListener('focusin', onFocus)
    main.addEventListener('focusout', hide)
    main.addEventListener('click', onClick)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)

    return () => {
      main.removeEventListener('mouseover', onOver)
      main.removeEventListener('mouseout', onOut)
      main.removeEventListener('focusin', onFocus)
      main.removeEventListener('focusout', hide)
      main.removeEventListener('click', onClick)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('resize', hide)
      tip.remove()
      // Clear the marker so a later pass can decorate again if the DOM was
      // swapped underneath us. The buttons themselves are left in place —
      // they carry the original textContent, so copy still works.
      for (const code of main.querySelectorAll('code[data-sn-flags]')) {
        delete code.dataset.snFlags
      }
    }
  }, [pathname])

  return null
}
