import { describe, expect, it } from 'vitest'
import {
  BOXES,
  INTERVALS,
  buildQueue,
  dueDate,
  isDue,
  reviewCard,
  summarise
} from '../leitner.js'

describe('the box ladder', () => {
  it('has five boxes on the classic 1/2/4/8/16-day spacing', () => {
    expect(BOXES).toBe(5)
    expect(INTERVALS).toEqual([1, 2, 4, 8, 16])
  })
})

describe('reviewCard', () => {
  it('promotes a correct answer one box and schedules the next sitting', () => {
    const next = reviewCard({ box: 1 }, true, '2026-08-24')
    expect(next.box).toBe(2)
    expect(next.due).toBe('2026-08-26') // box 2 → 2 days
  })

  it('starts an unseen card in box 1', () => {
    const next = reviewCard(undefined, true, '2026-08-24')
    expect(next.box).toBe(2)
  })

  it('stops promoting at the top box but still reschedules', () => {
    const next = reviewCard({ box: 5 }, true, '2026-08-24')
    expect(next.box).toBe(5)
    expect(next.due).toBe('2026-09-09') // +16 days
  })

  it('sends a wrong answer all the way back to box 1', () => {
    const next = reviewCard({ box: 4 }, false, '2026-08-24')
    expect(next.box).toBe(1)
    expect(next.due).toBe('2026-08-25')
  })

  it('records when it was last seen', () => {
    expect(reviewCard({ box: 1 }, true, '2026-08-24').seen).toBe('2026-08-24')
  })

  it('counts lifetime right and wrong answers', () => {
    let c = reviewCard(undefined, true, '2026-08-24')
    expect(c).toMatchObject({ right: 1, wrong: 0 })
    c = reviewCard(c, false, '2026-08-25')
    expect(c).toMatchObject({ right: 1, wrong: 1 })
  })

  it('crosses a month boundary correctly', () => {
    expect(reviewCard({ box: 3 }, true, '2026-08-30').due).toBe('2026-09-07')
  })
})

describe('dueDate', () => {
  it('adds the box interval to the date', () => {
    expect(dueDate(1, '2026-08-24')).toBe('2026-08-25')
    expect(dueDate(5, '2026-08-24')).toBe('2026-09-09')
  })

  it('crosses a year boundary', () => {
    expect(dueDate(5, '2026-12-27')).toBe('2027-01-12')
  })
})

describe('isDue', () => {
  it('treats a card that has never been seen as due', () => {
    expect(isDue(undefined, '2026-08-24')).toBe(true)
  })

  it('is due on the due date itself, not only after it', () => {
    expect(isDue({ box: 1, due: '2026-08-24' }, '2026-08-24')).toBe(true)
  })

  it('is due when overdue', () => {
    expect(isDue({ box: 1, due: '2026-08-20' }, '2026-08-24')).toBe(true)
  })

  it('is not due before the due date', () => {
    expect(isDue({ box: 1, due: '2026-08-25' }, '2026-08-24')).toBe(false)
  })
})

describe('buildQueue', () => {
  const cards = [
    { id: 'a' },
    { id: 'b' },
    { id: 'c' },
    { id: 'd' },
    { id: 'e' }
  ]

  it('puts overdue cards before brand-new ones', () => {
    const state = {
      c: { box: 1, due: '2026-08-20' },
      e: { box: 2, due: '2026-08-22' }
    }
    const q = buildQueue(cards, state, '2026-08-24', 10)
    expect(q.slice(0, 2).map((c) => c.id)).toEqual(['c', 'e'])
  })

  it('orders the overdue cards oldest-first', () => {
    const state = {
      a: { box: 1, due: '2026-08-23' },
      b: { box: 1, due: '2026-08-01' }
    }
    const q = buildQueue(cards, state, '2026-08-24', 10)
    expect(q[0].id).toBe('b')
  })

  it('leaves out cards that are not due yet', () => {
    const state = Object.fromEntries(
      cards.map((c) => [c.id, { box: 3, due: '2026-09-30' }])
    )
    expect(buildQueue(cards, state, '2026-08-24', 10)).toEqual([])
  })

  it('respects the session limit', () => {
    expect(buildQueue(cards, {}, '2026-08-24', 3)).toHaveLength(3)
  })

  it('keeps new cards in their source order so a session follows the glossary', () => {
    expect(buildQueue(cards, {}, '2026-08-24', 5).map((c) => c.id)).toEqual([
      'a',
      'b',
      'c',
      'd',
      'e'
    ])
  })

  it('ignores state entries for cards that no longer exist', () => {
    const state = { gone: { box: 1, due: '2026-01-01' } }
    const q = buildQueue(cards, state, '2026-08-24', 10)
    expect(q.every((c) => cards.some((x) => x.id === c.id))).toBe(true)
  })
})

describe('summarise', () => {
  const cards = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]

  it('reports an untouched deck as all new', () => {
    expect(summarise(cards, {}, '2026-08-24')).toMatchObject({
      total: 4,
      seen: 0,
      due: 4,
      learned: 0
    })
  })

  it('counts a card in the top box as learned', () => {
    const state = { a: { box: 5, due: '2026-09-09' }, b: { box: 2, due: '2026-08-26' } }
    expect(summarise(cards, state, '2026-08-24')).toMatchObject({
      total: 4,
      seen: 2,
      learned: 1,
      due: 2 // c and d are new
    })
  })

  it('reports how many sit in each box', () => {
    const state = { a: { box: 5 }, b: { box: 5 }, c: { box: 2 } }
    expect(summarise(cards, state, '2026-08-24').boxes).toEqual([0, 1, 0, 0, 2])
  })
})
