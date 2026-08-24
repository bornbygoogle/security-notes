'use client'

import { useCallback, useEffect, useState } from 'react'

const KEY = 'security-notes:progress:v1'

const EMPTY = { v: 1, lessons: {}, days: {} }

/** Today as YYYY-MM-DD in the viewer's own timezone, not UTC. A study day is a
 *  local day: finishing a lesson at 23:30 should not land on tomorrow. */
export function today (d = new Date()) {
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function read () {
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return EMPTY
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return EMPTY
    return { ...EMPTY, ...parsed, lessons: parsed.lessons ?? {}, days: parsed.days ?? {} }
  } catch {
    // private mode, blocked site data, corrupt JSON. Not worth surfacing:
    // the site works, it just cannot remember.
    return EMPTY
  }
}

function write (state) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    /* nothing we can do, and nothing the reader needs to see */
  }
}

/**
 * Progress state, read from localStorage after mount.
 *
 * `ready` is false during SSR and on the first client render, so components
 * render a zero state on both sides and hydration cannot mismatch. It flips
 * true once real values are in, which is also what triggers the fill
 * animations: the load transition is the hydration.
 */
export function useProgress () {
  const [state, setState] = useState(EMPTY)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    setState(read())
    setReady(true)
  }, [])

  const update = useCallback(fn => {
    setState(prev => {
      const next = fn(prev)
      write(next)
      return next
    })
  }, [])

  const setDone = useCallback((id, done) => {
    update(prev => {
      const lessons = { ...prev.lessons }
      const days = { ...prev.days }
      const day = today()
      if (done) {
        lessons[id] = { done: true, at: day }
        days[day] = (days[day] ?? 0) + 1
      } else {
        delete lessons[id]
      }
      return { ...prev, lessons, days }
    })
  }, [update])

  const reset = useCallback(() => update(() => EMPTY), [update])

  return { state, lessons: state.lessons, days: state.days, ready, setDone, reset }
}
