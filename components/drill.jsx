'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BOXES,
  INTERVALS,
  buildQueue,
  reviewCard,
  summarise,
  toISODate
} from '../lib/leitner.js'
import Rich from './rich-text.jsx'

const KEY = 'security-notes:drill:v1'
const EMPTY = { v: 1, cards: {} }
const SESSION = 20

function read () {
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return EMPTY
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return EMPTY
    return { ...EMPTY, ...parsed, cards: parsed.cards ?? {} }
  } catch {
    return EMPTY
  }
}

function write (state) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    /* private mode or blocked storage — the drill still works, it just forgets */
  }
}

export default function Drill ({ cards, sections }) {
  const [state, setState] = useState(EMPTY)
  const [ready, setReady] = useState(false)
  const [section, setSection] = useState('all')
  const [queue, setQueue] = useState([])
  const [idx, setIdx] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [tally, setTally] = useState({ right: 0, wrong: 0 })
  const [started, setStarted] = useState(false)
  const liveRef = useRef(null)

  const iso = ready ? toISODate(new Date()) : '1970-01-01'

  useEffect(() => {
    setState(read())
    setReady(true)
  }, [])

  const pool = useMemo(
    () => (section === 'all' ? cards : cards.filter((c) => c.section === section)),
    [cards, section]
  )

  const stats = useMemo(
    () => summarise(pool, ready ? state.cards : {}, iso),
    [pool, state.cards, ready, iso]
  )

  const start = useCallback(() => {
    setQueue(buildQueue(pool, state.cards, toISODate(new Date()), SESSION))
    setIdx(0)
    setFlipped(false)
    setTally({ right: 0, wrong: 0 })
    setStarted(true)
  }, [pool, state.cards])

  const answer = useCallback(
    (correct) => {
      const card = queue[idx]
      if (!card) return
      const day = toISODate(new Date())
      setState((prev) => {
        const next = {
          ...prev,
          cards: { ...prev.cards, [card.id]: reviewCard(prev.cards[card.id], correct, day) }
        }
        write(next)
        return next
      })
      setTally((t) => ({
        right: t.right + (correct ? 1 : 0),
        wrong: t.wrong + (correct ? 0 : 1)
      }))
      setFlipped(false)
      setIdx((i) => i + 1)
    },
    [queue, idx]
  )

  // Keyboard: the whole point of a drill is that your hands stay still.
  useEffect(() => {
    if (!started) return
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const tag = document.activeElement?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        if (!flipped) setFlipped(true)
        else answer(true)
      } else if (flipped && (e.key === '1' || e.key === 'ArrowLeft')) {
        e.preventDefault()
        answer(false)
      } else if (flipped && (e.key === '2' || e.key === 'ArrowRight')) {
        e.preventDefault()
        answer(true)
      } else if (e.key === 'Escape') {
        setStarted(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [started, flipped, answer])

  // Scale the five boxes against the fullest box only. The unseen pile is not
  // a rung on the ladder — it starts at the whole deck and would flatten every
  // real bar to a hairline — so it is drawn full height and hatched instead.
  const tallest = Math.max(1, ...(ready ? stats.boxes : new Array(BOXES).fill(0)))
  const card = queue[idx]
  const finished = started && idx >= queue.length
  const pct = queue.length ? Math.round((idx / queue.length) * 100) : 0

  return (
    <div className="sn-drillpage" data-pagefind-ignore>
      <header className="sn-dash__head">
        <p className="sn-eyebrow mono">Spaced repetition</p>
        <h1 className="sn-dash__title">Drill</h1>
        <p className="sn-dash__lede">
          {cards.length} terms from the glossary, on five Leitner boxes. Get one right and
          it moves up a box — you next see it in {INTERVALS.join(', ')} days. Get it wrong
          and it drops to box 1. Short sittings, often, beat one long one.
        </p>
      </header>

      <dl className="sn-stats">
        <div>
          <dt>Due now</dt>
          <dd>{ready ? stats.due : 0}</dd>
        </div>
        <div>
          <dt>Learned</dt>
          <dd>
            {ready ? stats.learned : 0}
            <span className="sn-stats__of"> / {pool.length}</span>
          </dd>
        </div>
        <div>
          <dt>Seen</dt>
          <dd>
            {ready ? stats.seen : 0}
            <span className="sn-stats__of"> / {pool.length}</span>
          </dd>
        </div>
        <div>
          <dt>Session</dt>
          <dd>{started ? `${Math.min(idx + (finished ? 0 : 1), queue.length)} / ${queue.length}` : '—'}</dd>
        </div>
      </dl>

      {/* ── Box ladder ─────────────────────────────────────────────────── */}
      <section className="sn-panel">
        <h2 className="sn-h">Box ladder</h2>
        <ol className="sn-boxes">
          {Array.from({ length: BOXES }, (_, i) => {
            const n = ready ? stats.boxes[i] : 0
            // Scale against the tallest column, not the deck size. Against the
            // deck, an untouched 104-card deck renders every real box as a
            // hairline next to one huge Unseen block and shows you nothing.
            const share = (n / tallest) * 100
            return (
              <li key={i} className="sn-box" data-box={i + 1}>
                <span className="sn-box__bar" style={{ '--h': `${share}%` }} />
                <span className="sn-box__n">{n}</span>
                <span className="sn-box__label">
                  Box {i + 1}
                  <span className="sn-box__int">{INTERVALS[i]}d</span>
                </span>
              </li>
            )
          })}
          <li className="sn-box sn-box--new">
            <span className="sn-box__bar" style={{ '--h': '100%' }} />
            <span className="sn-box__n">{ready ? stats.new : pool.length}</span>
            <span className="sn-box__label">
              Unseen
              <span className="sn-box__int">new</span>
            </span>
          </li>
        </ol>
      </section>

      {/* ── Deck picker ────────────────────────────────────────────────── */}
      <section className="sn-panel">
        <h2 className="sn-h">Deck</h2>
        <div className="sn-chips" role="group" aria-label="Filter the deck by section">
          <button
            type="button"
            className="sn-chip"
            aria-pressed={section === 'all'}
            onClick={() => {
              setSection('all')
              setStarted(false)
            }}
          >
            All <span className="sn-chip__n">{cards.length}</span>
          </button>
          {sections.map((s) => (
            <button
              key={s}
              type="button"
              className="sn-chip"
              aria-pressed={section === s}
              onClick={() => {
                setSection(s)
                setStarted(false)
              }}
            >
              {s} <span className="sn-chip__n">{cards.filter((c) => c.section === s).length}</span>
            </button>
          ))}
        </div>
      </section>

      {/* ── The card ───────────────────────────────────────────────────── */}
      <section className="sn-panel sn-panel--card">
        {!started && (
          <div className="sn-drillstart">
            <p className="sn-drillstart__lede">
              {ready && stats.due === 0
                ? 'Nothing is due in this deck. Everything you have seen is resting in a higher box — come back when it comes round, or pick another section.'
                : `${ready ? stats.due : pool.length} card${(ready ? stats.due : pool.length) === 1 ? '' : 's'} ready. A sitting is at most ${SESSION}.`}
            </p>
            <button
              type="button"
              className="sn-btn sn-btn--primary"
              onClick={start}
              disabled={ready && stats.due === 0}
            >
              Start drilling
            </button>
            <p className="sn-keys">
              <kbd>Space</kbd> reveal · <kbd>1</kbd> again · <kbd>2</kbd> got it
            </p>
          </div>
        )}

        {started && !finished && card && (
          <>
            <div className="sn-drillbar" aria-hidden="true">
              <span style={{ '--pct': `${pct}%` }} />
            </div>
            <div
              className={`sn-card${flipped ? ' is-flipped' : ''}`}
              onClick={() => !flipped && setFlipped(true)}
            >
              <div className="sn-card__inner">
                <div className="sn-card__face sn-card__face--front">
                  <p className="sn-card__section">{card.section}</p>
                  <p className={`sn-card__term${card.code ? ' mono' : ''}`}>{card.term}</p>
                  {!flipped && (
                    <button
                      type="button"
                      className="sn-btn"
                      onClick={(e) => {
                        e.stopPropagation()
                        setFlipped(true)
                      }}
                    >
                      Reveal
                    </button>
                  )}
                </div>
                <div className="sn-card__face sn-card__face--back">
                  <p className="sn-card__section">{card.section}</p>
                  <p className={`sn-card__term${card.code ? ' mono' : ''}`}>{card.term}</p>
                  <p className="sn-card__def">
                    <Rich text={card.definition} />
                  </p>
                </div>
              </div>
            </div>

            <div className="sn-verdict" aria-live="polite" ref={liveRef}>
              {flipped ? (
                <>
                  <button type="button" className="sn-btn sn-btn--again" onClick={() => answer(false)}>
                    Again <kbd>1</kbd>
                  </button>
                  <button type="button" className="sn-btn sn-btn--got" onClick={() => answer(true)}>
                    Got it <kbd>2</kbd>
                  </button>
                </>
              ) : (
                <p className="sn-verdict__hint">
                  Say the answer out loud first — recall you had to work for is the recall
                  that sticks.
                </p>
              )}
            </div>
          </>
        )}

        {finished && (
          <div className="sn-drilldone">
            <p className="sn-drilldone__score">
              {tally.right} <span>/ {queue.length}</span>
            </p>
            <p className="sn-drilldone__text">
              {tally.wrong === 0
                ? 'Clean sweep. Every one of those moved up a box.'
                : `${tally.wrong} went back to box 1. Those are the ones worth a second sitting today.`}
            </p>
            <div className="sn-verdict">
              <button type="button" className="sn-btn sn-btn--primary" onClick={start}>
                Another {stats.due > 0 ? `(${stats.due} due)` : 'round'}
              </button>
              <button type="button" className="sn-btn" onClick={() => setStarted(false)}>
                Done for now
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
