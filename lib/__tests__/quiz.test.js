import { describe, expect, it } from 'vitest'
import { LESSONS } from '../curriculum.js'
import { PASS_PCT, QUIZZES, grade, quizFor } from '../quiz.js'

describe('quizFor', () => {
  it('returns the questions for a lesson that has a quiz', () => {
    const q = quizFor('web-01')
    expect(Array.isArray(q)).toBe(true)
    expect(q.length).toBeGreaterThanOrEqual(4)
  })

  it('returns null for a lesson deliberately left without a quiz', () => {
    // report-template is a fill-in skeleton, not a lesson — there is nothing
    // to test you on. It is the only lesson without a quiz.
    expect(quizFor('reporting-02')).toBeNull()
  })

  it('returns null for an unknown id rather than throwing', () => {
    expect(quizFor('nope')).toBeNull()
    expect(quizFor(undefined)).toBeNull()
  })
})

describe('grade', () => {
  const qs = [
    { q: 'a', options: ['x', 'y'], answer: 0, why: 'because' },
    { q: 'b', options: ['x', 'y'], answer: 1, why: 'because' },
    { q: 'c', options: ['x', 'y'], answer: 1, why: 'because' },
    { q: 'd', options: ['x', 'y'], answer: 0, why: 'because' }
  ]

  it('counts a clean sweep', () => {
    expect(grade(qs, [0, 1, 1, 0])).toMatchObject({ right: 4, total: 4, pct: 100, passed: true })
  })

  it('counts a total miss', () => {
    expect(grade(qs, [1, 0, 0, 1])).toMatchObject({ right: 0, pct: 0, passed: false })
  })

  it('reports which questions were wrong, by index', () => {
    expect(grade(qs, [0, 0, 1, 1]).wrong).toEqual([1, 3])
  })

  it('treats an unanswered question as wrong rather than crashing', () => {
    expect(grade(qs, [0, undefined, 1, null])).toMatchObject({ right: 2, pct: 50 })
  })

  it('handles a short answer array', () => {
    expect(grade(qs, [0]).right).toBe(1)
  })

  it(`passes at ${PASS_PCT}% and fails just below`, () => {
    expect(grade(qs, [0, 1, 1, 1]).pct).toBe(75)
    expect(grade(qs, [0, 1, 1, 1]).passed).toBe(false)
    expect(grade(qs, [0, 1, 1, 0]).passed).toBe(true)
  })

  it('never divides by zero', () => {
    expect(grade([], [])).toMatchObject({ right: 0, total: 0, pct: 0 })
  })
})

describe('the question bank', () => {
  const all = Object.entries(QUIZZES)

  it('only keys off real lesson ids', () => {
    const ids = new Set(LESSONS.map((l) => l.id))
    expect(all.map(([k]) => k).filter((k) => !ids.has(k))).toEqual([])
  })

  // The template page is a skeleton to fill in, not material to be tested on.
  const NO_QUIZ = ['reporting-02']

  it('covers every lesson except the ones deliberately exempt', () => {
    const missing = LESSONS.map((l) => l.id)
      .filter((id) => !NO_QUIZ.includes(id))
      .filter((id) => !QUIZZES[id])
    expect(missing).toEqual([])
  })

  it('keeps the exempt list honest — an exempt lesson must not have a quiz', () => {
    expect(NO_QUIZ.filter((id) => QUIZZES[id])).toEqual([])
  })

  it.each(all)('%s is well formed', (id, questions) => {
    expect(questions.length).toBeGreaterThanOrEqual(4)
    questions.forEach((q, i) => {
      const at = `${id}[${i}]`
      expect(typeof q.q, at).toBe('string')
      expect(q.q.length, at).toBeGreaterThan(15)
      expect(q.options.length, at).toBeGreaterThanOrEqual(3)
      expect(Number.isInteger(q.answer), at).toBe(true)
      expect(q.answer, at).toBeGreaterThanOrEqual(0)
      expect(q.answer, at).toBeLessThan(q.options.length)
      // Every question explains itself — a quiz that only scores you
      // teaches nothing, and this deck exists to teach.
      expect(q.why.length, at).toBeGreaterThan(30)
      expect(new Set(q.options).size, at).toBe(q.options.length)
      q.options.forEach((o) => expect(o.length, at).toBeGreaterThan(0))
    })
  })

  it('spreads the correct answer across positions as served', () => {
    // Authored in source, the right answer clusters at whichever index the
    // writer happened to put it. Served, it must not: "always pick the second
    // one" has to be a losing strategy or the quiz measures nothing.
    const served = all.flatMap(([id]) => quizFor(id).map((q) => q.answer))
    const counts = [0, 0, 0, 0]
    served.forEach((a) => counts[a]++)
    counts.forEach((n) => expect(n / served.length).toBeLessThan(0.45))
  })

  it('serves the same option set, with answer still pointing at the right text', () => {
    for (const [id, raw] of all) {
      const served = quizFor(id)
      served.forEach((q, i) => {
        expect(new Set(q.options), `${id}[${i}]`).toEqual(new Set(raw[i].options))
        expect(q.options[q.answer], `${id}[${i}]`).toBe(raw[i].options[raw[i].answer])
        expect(q.q, `${id}[${i}]`).toBe(raw[i].q)
      })
    }
  })

  it('serves a stable order — a re-render must not move the options', () => {
    const a = quizFor('web-01')
    const b = quizFor('web-01')
    expect(a.map((q) => q.options)).toEqual(b.map((q) => q.options))
    expect(a.map((q) => q.answer)).toEqual(b.map((q) => q.answer))
  })

  it('has no duplicate question text inside a lesson', () => {
    for (const [id, qs] of all) {
      const texts = qs.map((q) => q.q)
      expect(new Set(texts).size, id).toBe(texts.length)
    }
  })
})
