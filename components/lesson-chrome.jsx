import { Clock } from '@phosphor-icons/react/ssr'
import { PHASES, DOMAINS } from '../lib/curriculum.js'
import { PhaseIcon } from './phase-icon.jsx'
import LessonFooter from './lesson-footer.jsx'

const CHAIN = PHASES.filter(p => p.chain)

/**
 * Header strip on every lesson. Rendered from lib/curriculum.js keyed on the
 * page's filePath, so all 24 lessons get it without a single content edit.
 */
export function LessonHeader ({ lesson }) {
  const phase = PHASES.find(p => p.id === lesson.phase)
  const domain = DOMAINS.find(d => d.id === lesson.domain)
  const inChain = CHAIN.some(p => p.id === lesson.phase)

  return (
    <header className="sn-lessonhead">
      <p className="sn-lessonhead__meta mono">
        <span className="sn-lessonhead__phase">
          <PhaseIcon icon={phase?.icon} size={14} />
          {phase?.label}
        </span>
        <span className="sn-dot" aria-hidden="true" />
        <span>{domain?.label}</span>
        {domain?.points > 0 && (
          <>
            <span className="sn-dot" aria-hidden="true" />
            <span>{domain.points} pts</span>
          </>
        )}
        <span className="sn-dot" aria-hidden="true" />
        <span className="sn-lessonhead__time">
          <Clock size={13} weight="bold" aria-hidden="true" />
          {lesson.minutes} min
        </span>
      </p>

      {inChain && (
        <ol className="sn-chain is-compact is-static" aria-label={`Methodology phase: ${phase?.label}`}>
          {CHAIN.map(p => (
            <li key={p.id} className={`sn-chain__step${p.id === lesson.phase ? ' is-active' : ''}`}>
              <div className="sn-chain__rail" aria-hidden="true">
                <span className="sn-chain__node" />
                <span className="sn-chain__track" />
              </div>
              <span className="sn-chain__label">{p.label}</span>
            </li>
          ))}
        </ol>
      )}
    </header>
  )
}

export { LessonFooter }
