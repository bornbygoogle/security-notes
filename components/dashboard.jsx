'use client'

import { useMemo } from 'react'
import { Cards, Target, ArrowRight } from '@phosphor-icons/react/ssr'
import {
  LESSONS, WEEKS, PASS_MARK, TOTAL_POINTS,
  rollup, phaseCoverage, projectedScore, weekForDate, daysRemaining
} from '../lib/curriculum.js'
import { PhaseIcon } from './phase-icon.jsx'
import { useProgress, today } from './use-progress.js'

/* -------------------------------------------------------------------------
   Attack chain. Recon -> Enumeration -> Exploitation -> Post-exploitation is
   the core mental model of the discipline. Showing your real coverage on it,
   on the homepage and in every lesson header, means you see your own position
   on that chain a few hundred times over the course.
   ------------------------------------------------------------------------- */
export function AttackChain ({ coverage, compact = false, activePhase = null }) {
  return (
    <ol className={`sn-chain${compact ? ' is-compact' : ''}`} aria-label="Attack chain coverage">
      {coverage.map((p, i) => {
        const complete = p.of > 0 && p.done === p.of
        const active = activePhase === p.id
        return (
          <li
            key={p.id}
            className={`sn-chain__step${complete ? ' is-complete' : ''}${active ? ' is-active' : ''}`}
            style={{ '--i': i }}
          >
            <div className="sn-chain__rail" aria-hidden="true">
              <span className="sn-chain__node" />
              <span className="sn-chain__track">
                <span className="sn-chain__fill" style={{ '--pct': `${p.pct}%` }} />
              </span>
            </div>
            <div className="sn-chain__body">
              <span className="sn-chain__label">
                <PhaseIcon icon={p.icon} size={14} />
                {p.label}
              </span>
              {!compact && <span className="sn-chain__count mono">{p.done}/{p.of}</span>}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

/* -------------------------------------------------------------------------
   Score bar. The real exam weights: 1000 points, 750 to pass. This is the
   single most strategically useful graphic on the site, because it shows at a
   glance that Network plus AD is 600 of the 750 you need.
   ------------------------------------------------------------------------- */
function ScoreBar ({ projection, ready }) {
  const markerPct = (PASS_MARK / TOTAL_POINTS) * 100
  const gap = Math.max(0, PASS_MARK - (ready ? projection.points : 0))
  return (
    <section className="sn-score" aria-labelledby="sn-score-h">
      <div className="sn-score__head">
        <h2 id="sn-score-h" className="sn-h">Exam weight</h2>
        <p className="sn-score__proj mono">
          <strong className={projection.passing ? 'is-passing' : undefined}>
            {ready ? projection.points : 0}
          </strong>
          <span> / {TOTAL_POINTS} projected</span>
        </p>
      </div>

      <div className="sn-score__bar" role="img"
        aria-label={`Projected ${ready ? projection.points : 0} of ${TOTAL_POINTS} points. Pass mark ${PASS_MARK}.`}>
        {projection.byDomain.map(d => (
          <div key={d.id} className={`sn-score__seg sn-score__seg--${d.id}`}
            data-label={`${d.short} ${d.points}`}
            style={{
              '--w': `${(d.points / TOTAL_POINTS) * 100}%`,
              // Same string as data-label, quoted so CSS `content` can take it.
              // The fill re-renders the label clipped to its own width, in an
              // on-fill colour — grey-on-cyan was unreadable once a segment
              // started filling.
              '--label': `"${d.short} ${d.points}"`
            }}>
            <span className="sn-score__earned" style={{ '--pct': ready ? `${(d.earned / d.points) * 100}%` : '0%' }} />
          </div>
        ))}
        <span className={`sn-score__mark${projection.passing && ready ? ' is-cleared' : ''}`}
          style={{ '--at': `${markerPct}%` }}>
          <span className="sn-score__mark-label mono">{PASS_MARK} to pass</span>
        </span>
      </div>

      {/* The bar shows proportion; these show the actual numbers, which is what
          you plan against. Both earn the panel's height. */}
      <ul className="sn-score__rows">
        {projection.byDomain.map(d => (
          <li key={d.id}>
            <span className="sn-score__dom">{d.label}</span>
            <span className="sn-score__lessons mono">
              {ready ? d.done : 0}/{d.of} lessons
            </span>
            <span className="sn-score__pts mono">
              {ready ? d.earned : 0}
              <em> / {d.points}</em>
            </span>
          </li>
        ))}
      </ul>

      <p className="sn-score__gap mono">
        {gap > 0
          ? `${gap} more points needed to reach the pass mark`
          : `Clear of the ${PASS_MARK}-point pass mark`}
      </p>

      <p className="sn-score__strategy">
        Network and AD together are 600 points. Bank those two completely and
        Web only has to carry the last 150.
      </p>

    </section>
  )
}

/* ------------------------------------------------------------------------- */
function ModuleList ({ roll, nextUp, ready }) {
  return (
    <section className="sn-modules" aria-labelledby="sn-mod-h">
      <h2 id="sn-mod-h" className="sn-h">Modules</h2>
      <ol className="sn-modules__list">
        {roll.modules.map((m, i) => {
          const current = ready && nextUp?.module === m.id
          return (
            <li key={m.id} className={`sn-mod${current ? ' is-current' : ''}`} style={{ '--i': i }}>
              <a className="sn-mod__link" href={`/pt1-course/${m.dir}`}>
                <span className="sn-mod__name">{m.short}</span>
                <span className="sn-mod__meter" aria-hidden="true">
                  <span className="sn-mod__fill" style={{ '--pct': ready ? `${m.pct}%` : '0%' }} />
                </span>
                <span className="sn-mod__count mono">{ready ? m.done : 0}/{m.of}</span>
              </a>
              {current && nextUp && (
                <a className="sn-mod__resume" href={`/${nextUp.path}`}>
                  Resume: {nextUp.title}
                  <ArrowRight size={14} weight="bold" aria-hidden="true" />
                </a>
              )}
            </li>
          )
        })}
      </ol>
    </section>
  )
}

/* -------------------------------------------------------------------------
   Study heatmap. 18 weeks of the plan. Its real job is making gaps visible:
   three blank weeks in October is data you need.
   ------------------------------------------------------------------------- */
function StudyHeatmap ({ days, ready }) {
  const cells = useMemo(() => {
    const out = []
    for (const w of WEEKS) {
      for (let d = 0; d < 7; d++) {
        const date = new Date(`${w.start}T00:00:00Z`)
        date.setUTCDate(date.getUTCDate() + d)
        const iso = date.toISOString().slice(0, 10)
        out.push({ iso, week: w.n, count: ready ? (days[iso] ?? 0) : 0 })
      }
    }
    return out
  }, [days, ready])

  const active = cells.filter(c => c.count > 0).length

  return (
    <section className="sn-heat" aria-labelledby="sn-heat-h">
      <div className="sn-heat__head">
        <h2 id="sn-heat-h" className="sn-h">Study days</h2>
        <span className="sn-heat__stat mono">{active} of 126</span>
      </div>
      <div className="sn-heat__grid" role="img"
        aria-label={`${active} study days recorded across the 18 week plan`}>
        {cells.map(c => (
          <span key={c.iso}
            className="sn-heat__cell"
            data-level={Math.min(c.count, 4)}
            title={c.count ? `${c.iso}: ${c.count} lesson${c.count > 1 ? 's' : ''}` : c.iso} />
        ))}
      </div>
      <p className="sn-heat__legend mono">
        <span>Aug 24</span><span>Dec 27</span>
      </p>
    </section>
  )
}

/* ------------------------------------------------------------------------- */
function DrillStrip ({ ready }) {
  return (
    <section className="sn-drill">
      <div className="sn-drill__text">
        <Cards size={20} weight="duotone" aria-hidden="true" />
        <div>
          <p className="sn-drill__lead">Recall practice</p>
          <p className="sn-drill__sub">
            {ready
              ? 'Glossary and command decks. Nothing scheduled yet, so start anywhere.'
              : 'Glossary and command decks.'}
          </p>
        </div>
      </div>
      <a className="sn-btn sn-btn--primary" href="/drill">
        Open drill
        <ArrowRight size={15} weight="bold" aria-hidden="true" />
      </a>
    </section>
  )
}

/* ------------------------------------------------------------------------- */
export default function Dashboard () {
  const { lessons, days, ready } = useProgress()

  const roll = useMemo(() => rollup(lessons), [lessons])
  const coverage = useMemo(() => phaseCoverage(lessons), [lessons])
  const projection = useMemo(() => projectedScore(lessons), [lessons])

  // Same rule as every other stat here: nothing date-derived until the client
  // says so. Read on the server it bakes the build date into the static HTML —
  // "Days left 125" shipped and stayed 125 until React hit a text mismatch and
  // re-rendered. useProgress flips `ready` in an effect, so this only runs
  // client-side, and the first paint matches what the server sent.
  const now = ready ? new Date() : null
  const week = now ? weekForDate(now) : null
  const left = now ? daysRemaining(now) : null

  return (
    <div className="sn-dash">
      <header className="sn-dash__head sn-rise" style={{ '--i': 0 }}>
        <p className="sn-eyebrow mono">
          <Target size={13} weight="bold" aria-hidden="true" />
          PT1 · Junior Penetration Tester
        </p>
        <h1 className="sn-dash__title">Security Notes</h1>
        <p className="sn-dash__lede">
          Working notes and a self-paced course for TryHackMe&rsquo;s PT1 exam.
          Everything here is written to be re-read the week before the exam.
        </p>
        <dl className="sn-stats">
          <div>
            <dt>Plan week</dt>
            <dd className="mono">{ready ? (week ? `${week.n} of ${WEEKS.length}` : 'Starts 24 Aug') : '—'}</dd>
          </div>
          <div>
            <dt>Days left</dt>
            <dd className="mono">{ready ? Math.max(0, left) : '—'}</dd>
          </div>
          <div>
            <dt>Lessons done</dt>
            <dd className="mono">{ready ? roll.total.done : 0} of {LESSONS.length}</dd>
          </div>
          <div>
            <dt>This week</dt>
            <dd>{ready ? (week ? week.focus : 'Module 0, setup and basics') : '—'}</dd>
          </div>
        </dl>
      </header>

      <section className="sn-panel sn-rise" style={{ '--i': 1 }} aria-labelledby="sn-chain-h">
        <div className="sn-panel__head">
          <h2 id="sn-chain-h" className="sn-h">Attack chain</h2>
          <p className="sn-panel__note">Where each lesson sits in the methodology.</p>
        </div>
        <AttackChain coverage={ready ? coverage : coverage.map(c => ({ ...c, done: 0, pct: 0 }))} />
      </section>

      {/* Panels stretch to fill their row and distribute their own content.
          With align-items:start the short panel left a hole beside the tall
          one; with independent columns the hole just moved to the bottom of
          the shorter column. Stretching removes it instead of relocating it. */}
      <div className="sn-split">
        <div className="sn-panel sn-rise" style={{ '--i': 2 }}>
          <ScoreBar projection={ready ? projection : { ...projection, points: 0, passing: false }} ready={ready} />
        </div>
        <div className="sn-panel sn-rise" style={{ '--i': 3 }}>
          <ModuleList roll={roll} nextUp={roll.nextUp} ready={ready} />
        </div>
      </div>

      <div className="sn-split sn-split--heat">
        <div className="sn-panel sn-rise" style={{ '--i': 4 }}>
          <StudyHeatmap days={days} ready={ready} />
        </div>
        <div className="sn-rise" style={{ '--i': 5 }}>
          <DrillStrip ready={ready} />
        </div>
      </div>
    </div>
  )
}
