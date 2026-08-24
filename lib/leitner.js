/**
 * Leitner spaced repetition.
 *
 * Five boxes. Get a card right and it moves up a box and you will not see it
 * again for longer; get it wrong and it falls straight back to box 1. The
 * spacing is the classic 1/2/4/8/16 days — long enough to force real recall,
 * short enough that a whole deck cycles inside an 18-week study plan.
 *
 * Dates are plain ISO `YYYY-MM-DD` strings in the learner's local timezone.
 * Never Date objects across the boundary: a card finished at 23:30 must not be
 * scheduled from tomorrow.
 *
 * Pure. No React, no DOM, no storage.
 */

export const BOXES = 5
export const INTERVALS = [1, 2, 4, 8, 16]

/** `YYYY-MM-DD` for a Date, read in local time. */
export function toISODate (date) {
  const d = date instanceof Date ? date : new Date(date)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function addDays (iso, days) {
  const [y, m, d] = iso.split('-').map(Number)
  // Noon avoids any DST edge shunting the date a day either way.
  const dt = new Date(y, m - 1, d, 12, 0, 0)
  dt.setDate(dt.getDate() + days)
  return toISODate(dt)
}

/** When a card in `box` reviewed on `iso` should next come round. */
export function dueDate (box, iso) {
  const b = Math.min(Math.max(Number(box) || 1, 1), BOXES)
  return addDays(iso, INTERVALS[b - 1])
}

/** Apply one answer to a card's state and return the new state. */
export function reviewCard (state, correct, iso) {
  const prev = state ?? { box: 1, right: 0, wrong: 0 }
  const box = correct ? Math.min((prev.box ?? 1) + 1, BOXES) : 1
  return {
    box,
    due: dueDate(box, iso),
    seen: iso,
    right: (prev.right ?? 0) + (correct ? 1 : 0),
    wrong: (prev.wrong ?? 0) + (correct ? 0 : 1)
  }
}

/** A card with no state, or one whose due date has arrived, is due. */
export function isDue (state, iso) {
  if (!state || !state.due) return true
  return state.due <= iso
}

/**
 * The cards to sit this session: everything overdue, oldest first, then new
 * cards in glossary order so a first pass reads like the glossary itself.
 */
export function buildQueue (cards, state = {}, iso, limit = 20) {
  const review = []
  const fresh = []

  for (const card of cards) {
    const s = state[card.id]
    if (!s) fresh.push(card)
    else if (isDue(s, iso)) review.push(card)
  }

  review.sort((a, b) => {
    const da = state[a.id].due ?? ''
    const db = state[b.id].due ?? ''
    return da < db ? -1 : da > db ? 1 : 0
  })

  return [...review, ...fresh].slice(0, Math.max(0, limit))
}

/** Deck-level counts for the header strip. */
export function summarise (cards, state = {}, iso) {
  let seen = 0
  let due = 0
  let learned = 0
  const boxes = new Array(BOXES).fill(0)

  for (const card of cards) {
    const s = state[card.id]
    if (s) {
      seen++
      const b = Math.min(Math.max(s.box ?? 1, 1), BOXES)
      boxes[b - 1]++
      if (b === BOXES) learned++
      if (isDue(s, iso)) due++
    } else {
      due++
    }
  }

  return { total: cards.length, seen, due, learned, boxes, new: cards.length - seen }
}
