import { describe, it, expect } from 'vitest'
import {
  LESSONS, MODULES, PHASES, DOMAINS, WEEKS,
  lessonByPath, neighbours, rollup, phaseCoverage, projectedScore, weekForDate
} from '../curriculum.js'

describe('curriculum data', () => {
  it('has 24 trackable lessons', () => {
    expect(LESSONS).toHaveLength(24)
  })

  it('gives every lesson a unique path', () => {
    const paths = LESSONS.map(l => l.path)
    expect(new Set(paths).size).toBe(paths.length)
  })

  it('assigns every lesson a known module, phase and domain', () => {
    for (const l of LESSONS) {
      expect(MODULES.map(m => m.id)).toContain(l.module)
      expect(PHASES.map(p => p.id)).toContain(l.phase)
      expect(DOMAINS.map(d => d.id)).toContain(l.domain)
    }
  })

  it('module lesson counts match the content tree', () => {
    const count = id => LESSONS.filter(l => l.module === id).length
    expect(count('labs')).toBe(4)
    expect(count('web')).toBe(7)
    expect(count('network')).toBe(5)
    expect(count('active-directory')).toBe(5)
    expect(count('reporting')).toBe(3)
  })

  it('exam domain weights sum to 1000 with a 750 pass mark', () => {
    const scored = DOMAINS.filter(d => d.points > 0)
    expect(scored.reduce((s, d) => s + d.points, 0)).toBe(1000)
    expect(scored.map(d => d.points).sort((a, b) => b - a)).toEqual([400, 360, 240])
  })
})

describe('lessonByPath', () => {
  it('finds a lesson by its content path', () => {
    expect(lessonByPath('pt1-course/web/01-sql-injection').title).toBe('SQL Injection')
  })
  it('tolerates a leading slash and an .mdx suffix', () => {
    expect(lessonByPath('/pt1-course/web/01-sql-injection.mdx').id).toBe('web-01')
  })
  it('returns null for a page that is not a lesson', () => {
    expect(lessonByPath('pt1-course/glossary')).toBeNull()
  })
})

describe('neighbours', () => {
  it('links lessons in curriculum order across module boundaries', () => {
    const { prev, next } = neighbours('web-06')
    expect(prev.id).toBe('web-05')
    expect(next.id).toBe('network-01')
  })
  it('has no prev on the first lesson and no next on the last', () => {
    expect(neighbours(LESSONS[0].id).prev).toBeNull()
    expect(neighbours(LESSONS[LESSONS.length - 1].id).next).toBeNull()
  })
})

describe('rollup', () => {
  it('reports zero for empty progress', () => {
    const r = rollup({})
    expect(r.total.done).toBe(0)
    expect(r.total.pct).toBe(0)
  })
  it('counts completed lessons per module', () => {
    const r = rollup({ 'web-01': { done: true }, 'web-02': { done: true }, 'labs-01': { done: true } })
    expect(r.byModule.web.done).toBe(2)
    expect(r.byModule.web.of).toBe(7)
    expect(r.byModule.labs.done).toBe(1)
    expect(r.total.done).toBe(3)
  })
  it('ignores unknown ids and entries not marked done', () => {
    const r = rollup({ 'not-a-lesson': { done: true }, 'web-01': { done: false } })
    expect(r.total.done).toBe(0)
  })
  it('names the next unfinished lesson in curriculum order', () => {
    const r = rollup({ 'labs-01': { done: true }, 'labs-02': { done: true } })
    expect(r.nextUp.id).toBe('labs-03')
  })
  it('has no nextUp once everything is done', () => {
    const all = Object.fromEntries(LESSONS.map(l => [l.id, { done: true }]))
    expect(rollup(all).nextUp).toBeNull()
    expect(rollup(all).total.pct).toBe(100)
  })
})

describe('phaseCoverage', () => {
  it('returns the four operational phases in attack-chain order', () => {
    expect(phaseCoverage({}).map(p => p.id))
      .toEqual(['recon', 'enumeration', 'exploitation', 'post-exploitation'])
  })
  it('counts done lessons within each phase', () => {
    const cov = phaseCoverage({ 'network-01': { done: true } })
    expect(cov.find(p => p.id === 'recon')).toMatchObject({ done: 1, of: 1 })
    expect(cov.find(p => p.id === 'exploitation').done).toBe(0)
  })
})

describe('projectedScore', () => {
  it('is zero with no progress', () => {
    expect(projectedScore({}).points).toBe(0)
  })
  it('awards a domain its full points when all its lessons are done', () => {
    const webDone = Object.fromEntries(
      LESSONS.filter(l => l.domain === 'web').map(l => [l.id, { done: true }])
    )
    expect(projectedScore(webDone).points).toBe(400)
  })
  it('flags whether the projection clears the 750 pass mark', () => {
    const all = Object.fromEntries(LESSONS.map(l => [l.id, { done: true }]))
    expect(projectedScore(all).points).toBe(1000)
    expect(projectedScore(all).passing).toBe(true)
    expect(projectedScore({}).passing).toBe(false)
  })
})

describe('weekForDate', () => {
  it('has 18 weeks starting Monday 2026-08-24', () => {
    expect(WEEKS).toHaveLength(18)
    expect(WEEKS[0].start).toBe('2026-08-24')
    expect(WEEKS[17].end).toBe('2026-12-27')
  })
  it('returns week 1 on the first day', () => {
    expect(weekForDate(new Date('2026-08-24T09:00:00Z')).n).toBe(1)
  })
  it('returns week 1 on the last day of week 1', () => {
    expect(weekForDate(new Date('2026-08-30T23:00:00Z')).n).toBe(1)
  })
  it('rolls to week 2 the next Monday', () => {
    expect(weekForDate(new Date('2026-08-31T00:00:00Z')).n).toBe(2)
  })
  it('returns null before the plan starts and after it ends', () => {
    expect(weekForDate(new Date('2026-08-23T12:00:00Z'))).toBeNull()
    expect(weekForDate(new Date('2026-12-28T00:00:00Z'))).toBeNull()
  })
})
