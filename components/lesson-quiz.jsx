'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { PASS_PCT, grade, quizFor } from '../lib/quiz.js'
import Rich from './rich-text.jsx'

const KEY = 'security-notes:quiz:v1'

function read () {
  try {
    const raw = window.localStorage.getItem(KEY)
    const parsed = raw ? JSON.parse(raw) : null
    return parsed && typeof parsed === 'object' ? parsed : { v: 1, best: {} }
  } catch {
    return { v: 1, best: {} }
  }
}

function write (state) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    /* storage blocked — the quiz still works, it just forgets the score */
  }
}

/**
 * Self-check for one lesson. Feedback lands the moment you answer, right or
 * wrong, because the explanation is the teaching — waiting until the end to
 * reveal it wastes the moment where you actually care about the answer.
 *
 * Rendered from the MDX wrapper, so no lesson file needed editing.
 */
export default function LessonQuiz ({ lesson }) {
  const questions = useMemo(() => quizFor(lesson?.id), [lesson?.id])
  const [answers, setAnswers] = useState({})
  const [best, setBest] = useState(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    setBest(read().best?.[lesson.id] ?? null)
    setReady(true)
    setAnswers({})
  }, [lesson.id])

  const answered = Object.keys(answers).length
  const complete = questions ? answered === questions.length : false

  const result = useMemo(
    () =>
      questions && complete
        ? grade(questions, questions.map((_, i) => answers[i]))
        : null,
    [questions, complete, answers]
  )

  useEffect(() => {
    if (!result) return
    const state = read()
    const prev = state.best?.[lesson.id]?.pct ?? -1
    if (result.pct > prev) {
      const next = {
        ...state,
        best: { ...state.best, [lesson.id]: { pct: result.pct, right: result.right, of: result.total } }
      }
      write(next)
      setBest(next.best[lesson.id])
    }
  }, [result, lesson.id])

  const choose = useCallback((qi, oi) => {
    setAnswers((prev) => (qi in prev ? prev : { ...prev, [qi]: oi }))
  }, [])

  const reset = useCallback(() => setAnswers({}), [])

  if (!questions) return null

  const rightSoFar = questions.reduce(
    (n, q, i) => n + (answers[i] === q.answer ? 1 : 0),
    0
  )

  return (
    <section className="sn-quiz" aria-labelledby="sn-quiz-h" data-pagefind-ignore>
      <header className="sn-quiz__head">
        <div>
          <p className="sn-eyebrow mono">Self-check</p>
          <h2 className="sn-h" id="sn-quiz-h">
            {questions.length} questions on this lesson
          </h2>
        </div>
        <p className="sn-quiz__score" aria-live="polite">
          <span className="sn-quiz__now">
            {rightSoFar}
            <span> / {questions.length}</span>
          </span>
          {ready && best && (
            <span className="sn-quiz__best">best {best.pct}%</span>
          )}
        </p>
      </header>

      <ol className="sn-quiz__list">
        {questions.map((q, qi) => {
          const picked = answers[qi]
          const done = picked !== undefined
          const correct = done && picked === q.answer
          return (
            <li key={qi} className="sn-q" data-state={done ? (correct ? 'right' : 'wrong') : 'open'}>
              <fieldset className="sn-q__set" disabled={done}>
                <legend className="sn-q__text">
                  <Rich text={q.q} />
                </legend>
                <div className="sn-q__options">
                  {q.options.map((opt, oi) => {
                    const isAnswer = oi === q.answer
                    const state = !done
                      ? 'open'
                      : isAnswer
                        ? 'answer'
                        : oi === picked
                          ? 'picked-wrong'
                          : 'muted'
                    return (
                      <label key={oi} className="sn-opt" data-state={state}>
                        <input
                          type="radio"
                          name={`q-${lesson.id}-${qi}`}
                          checked={picked === oi}
                          onChange={() => choose(qi, oi)}
                        />
                        <span className="sn-opt__mark" aria-hidden="true" />
                        <span className="sn-opt__text">
                          <Rich text={opt} />
                        </span>
                      </label>
                    )
                  })}
                </div>
              </fieldset>
              {done && (
                <p className="sn-q__why">
                  <strong>{correct ? 'Right.' : 'Not quite.'}</strong>{' '}
                  <Rich text={q.why} />
                </p>
              )}
            </li>
          )
        })}
      </ol>

      {result && (
        <footer className="sn-quiz__foot" data-passed={result.passed}>
          <p className="sn-quiz__verdict">
            <strong>
              {result.right} / {result.total} — {result.pct}%
            </strong>{' '}
            {result.passed
              ? `Above the ${PASS_PCT}% bar. Move on.`
              : `Below the ${PASS_PCT}% bar. Re-read the sections behind the ones you missed, then take it again — a miss you looked up sticks better than one you guessed right.`}
          </p>
          <button type="button" className="sn-btn" onClick={reset}>
            Take it again
          </button>
        </footer>
      )}
    </section>
  )
}
