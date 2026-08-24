'use client'

import { CheckCircle, ArrowLeft, ArrowRight, Cards } from '@phosphor-icons/react/ssr'
import { neighbours } from '../lib/curriculum.js'
import { useProgress } from './use-progress.js'

export default function LessonFooter ({ lesson }) {
  const { lessons, ready, setDone } = useProgress()
  const done = Boolean(lessons[lesson.id]?.done)
  const { prev, next } = neighbours(lesson.id)

  return (
    <footer className="sn-lessonfoot">
      <button
        type="button"
        className={`sn-btn sn-btn--complete${done && ready ? ' is-done' : ''}`}
        aria-pressed={ready ? done : false}
        onClick={() => setDone(lesson.id, !done)}
      >
        <CheckCircle size={17} weight={done && ready ? 'fill' : 'bold'} aria-hidden="true" />
        {done && ready ? 'Completed' : 'Mark complete'}
      </button>

      <nav className="sn-lessonnav" aria-label="Lesson navigation">
        {prev
          ? <a className="sn-lessonnav__link" href={`/${prev.path}`}>
              <ArrowLeft size={14} weight="bold" aria-hidden="true" />
              <span>
                <span className="sn-lessonnav__dir mono">Previous</span>
                <span className="sn-lessonnav__title">{prev.title}</span>
              </span>
            </a>
          : <span />}
        {next
          ? <a className="sn-lessonnav__link is-next" href={`/${next.path}`}>
              <span>
                <span className="sn-lessonnav__dir mono">Next</span>
                <span className="sn-lessonnav__title">{next.title}</span>
              </span>
              <ArrowRight size={14} weight="bold" aria-hidden="true" />
            </a>
          : <a className="sn-lessonnav__link is-next" href="/drill">
              <span>
                <span className="sn-lessonnav__dir mono">Course complete</span>
                <span className="sn-lessonnav__title">Drill everything</span>
              </span>
              <Cards size={14} weight="bold" aria-hidden="true" />
            </a>}
      </nav>
    </footer>
  )
}
