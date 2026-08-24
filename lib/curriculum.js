/**
 * Single source of truth for the PT1 course.
 *
 * Every lesson is listed once. The dashboard, lesson chrome, prev/next links,
 * study tracker and drill scoping all derive from this file, so adding a lesson
 * is a one-place edit.
 *
 * Pure data and pure functions only. No React, no browser APIs, no I/O, which
 * is what makes it testable and safe to import from a Server Component.
 */

/** Methodology phases. `chain` marks the four that form the attack chain. */
export const PHASES = [
  { id: 'foundation', label: 'Foundation', icon: 'GraduationCap', chain: false },
  { id: 'recon', label: 'Recon', icon: 'MagnifyingGlass', chain: true },
  { id: 'enumeration', label: 'Enumeration', icon: 'ListMagnifyingGlass', chain: true },
  { id: 'exploitation', label: 'Exploitation', icon: 'Lightning', chain: true },
  { id: 'post-exploitation', label: 'Post-exploitation', icon: 'TreeStructure', chain: true },
  { id: 'reporting', label: 'Reporting', icon: 'FileText', chain: false }
]

/** Exam domains. Points are the real PT1 weights: 1000 total, 750 to pass. */
export const DOMAINS = [
  { id: 'foundation', label: 'Foundation', short: 'Base', points: 0 },
  { id: 'web', label: 'Web Application', short: 'Web', points: 400 },
  { id: 'network', label: 'Network', short: 'Network', points: 360 },
  { id: 'active-directory', label: 'Active Directory', short: 'AD', points: 240 },
  { id: 'reporting', label: 'Reporting', short: 'Report', points: 0 }
]

export const PASS_MARK = 750
export const TOTAL_POINTS = 1000

/** Content folders, in sidebar order. */
export const MODULES = [
  { id: 'labs', label: 'Module 0 — Setup & Basics', short: 'Setup & Basics', dir: 'labs' },
  { id: 'web', label: 'Web Application', short: 'Web', dir: 'web' },
  { id: 'network', label: 'Network', short: 'Network', dir: 'network' },
  { id: 'active-directory', label: 'Active Directory', short: 'Active Directory', dir: 'active-directory' },
  { id: 'reporting', label: 'Reporting', short: 'Reporting', dir: 'reporting' }
]

const L = (id, module, slug, title, phase, domain, minutes) => ({
  id,
  module,
  slug,
  title,
  phase,
  domain,
  minutes,
  path: `pt1-course/${module}/${slug}`
})

/** Trackable lessons, in the order you work them. Overview/glossary/study-plan
 *  are reference pages, not lessons, so they are deliberately absent. */
export const LESSONS = [
  L('labs-01', 'labs', '01-lab-setup', 'Lab Setup & THM Connection', 'foundation', 'foundation', 45),
  L('labs-02', 'labs', '02-linux-primer', 'Linux Primer', 'foundation', 'foundation', 40),
  L('labs-03', 'labs', '03-networking-and-shells-primer', 'Networking & Shells', 'foundation', 'foundation', 45),
  L('labs-04', 'labs', '04-methodology-and-notes', 'Methodology & Notes', 'foundation', 'foundation', 30),

  L('web-00', 'web', '00-how-the-web-works', 'How the Web Works', 'foundation', 'foundation', 35),
  L('web-01', 'web', '01-sql-injection', 'SQL Injection', 'exploitation', 'web', 70),
  L('web-02', 'web', '02-idor-and-access-control', 'IDOR & Access Control', 'exploitation', 'web', 45),
  L('web-03', 'web', '03-xss', 'Cross-Site Scripting (XSS)', 'exploitation', 'web', 50),
  L('web-04', 'web', '04-file-upload-lfi-command-injection', 'Upload, LFI & Command Injection', 'exploitation', 'web', 55),
  L('web-05', 'web', '05-ssti', 'SSTI', 'exploitation', 'web', 45),
  L('web-06', 'web', '06-burp-suite-workflow', 'Burp Suite Workflow', 'enumeration', 'web', 55),

  L('network-01', 'network', '01-recon-and-enumeration', 'Recon & Enumeration', 'recon', 'network', 60),
  L('network-02', 'network', '02-service-exploitation', 'Service Exploitation & Shells', 'exploitation', 'network', 55),
  L('network-03', 'network', '03-linux-privilege-escalation', 'Linux Privilege Escalation', 'post-exploitation', 'network', 50),
  L('network-04', 'network', '04-windows-privilege-escalation', 'Windows Privilege Escalation', 'post-exploitation', 'network', 50),
  L('network-05', 'network', '05-pivoting', 'Pivoting', 'post-exploitation', 'network', 55),

  L('ad-01', 'active-directory', '01-ad-fundamentals-and-enumeration', 'AD Fundamentals & Enumeration', 'enumeration', 'active-directory', 65),
  L('ad-02', 'active-directory', '02-kerberos-attacks', 'Kerberoasting & AS-REP', 'exploitation', 'active-directory', 50),
  L('ad-03', 'active-directory', '03-bloodhound', 'BloodHound & Attack Paths', 'enumeration', 'active-directory', 60),
  L('ad-04', 'active-directory', '04-lateral-movement-and-credential-access', 'Lateral Movement & Credentials', 'post-exploitation', 'active-directory', 55),
  L('ad-05', 'active-directory', '05-domain-domination', 'Domain Domination', 'post-exploitation', 'active-directory', 55),

  L('reporting-01', 'reporting', '01-report-writing-for-pt1', 'Writing the PT1 Report', 'reporting', 'reporting', 60),
  L('reporting-02', 'reporting', 'report-template', 'Report Template', 'reporting', 'reporting', 30),
  L('reporting-03', 'reporting', 'cvss-quick-reference', 'CVSS Quick Reference', 'reporting', 'reporting', 30)
]

const BY_ID = new Map(LESSONS.map(l => [l.id, l]))
const BY_PATH = new Map(LESSONS.map(l => [l.path, l]))

/** Normalise anything Nextra hands us (`filePath`, a route, a slug array) to a
 *  bare content path: leading slash, `content/` prefix and extension removed. */
function normalise (input) {
  if (!input) return ''
  const raw = Array.isArray(input) ? input.join('/') : String(input)
  return raw
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/^content\//, '')
    .replace(/\.mdx?$/, '')
    .replace(/\/index$/, '')
}

/** The lesson at a content path, or null if the page is not a lesson. */
export function lessonByPath (input) {
  return BY_PATH.get(normalise(input)) ?? null
}

export function lessonById (id) {
  return BY_ID.get(id) ?? null
}

/** Previous and next lesson in curriculum order, crossing module boundaries. */
export function neighbours (id) {
  const i = LESSONS.findIndex(l => l.id === id)
  if (i === -1) return { prev: null, next: null }
  return {
    prev: i > 0 ? LESSONS[i - 1] : null,
    next: i < LESSONS.length - 1 ? LESSONS[i + 1] : null
  }
}

const isDone = (progress, id) => Boolean(progress?.[id]?.done)

/**
 * Completion counts overall and per module, plus the next unfinished lesson.
 * Unknown ids in `progress` are ignored so stale localStorage cannot inflate
 * the numbers after a lesson is renamed.
 */
export function rollup (progress = {}) {
  const byModule = {}
  for (const m of MODULES) {
    const lessons = LESSONS.filter(l => l.module === m.id)
    const done = lessons.filter(l => isDone(progress, l.id)).length
    byModule[m.id] = {
      ...m,
      done,
      of: lessons.length,
      pct: lessons.length ? Math.round((done / lessons.length) * 100) : 0
    }
  }
  const done = LESSONS.filter(l => isDone(progress, l.id)).length
  return {
    byModule,
    modules: MODULES.map(m => byModule[m.id]),
    total: { done, of: LESSONS.length, pct: Math.round((done / LESSONS.length) * 100) },
    nextUp: LESSONS.find(l => !isDone(progress, l.id)) ?? null
  }
}

/** Coverage of the four attack-chain phases, in chain order. */
export function phaseCoverage (progress = {}) {
  return PHASES.filter(p => p.chain).map(p => {
    const lessons = LESSONS.filter(l => l.phase === p.id)
    const done = lessons.filter(l => isDone(progress, l.id)).length
    return {
      ...p,
      done,
      of: lessons.length,
      pct: lessons.length ? Math.round((done / lessons.length) * 100) : 0
    }
  })
}

/**
 * Points you would be on track for if the exam scored lesson coverage.
 * A study projection, not a prediction: each scored domain contributes its
 * weight in proportion to the lessons finished in it.
 */
export function projectedScore (progress = {}) {
  const byDomain = DOMAINS.filter(d => d.points > 0).map(d => {
    const lessons = LESSONS.filter(l => l.domain === d.id)
    const done = lessons.filter(l => isDone(progress, l.id)).length
    const points = lessons.length ? Math.round((done / lessons.length) * d.points) : 0
    return { ...d, done, of: lessons.length, earned: points }
  })
  const points = byDomain.reduce((s, d) => s + d.earned, 0)
  return { byDomain, points, of: TOTAL_POINTS, passMark: PASS_MARK, passing: points >= PASS_MARK }
}

/* ------------------------------------------------------------------ *
 * Study plan: 18 weeks, Monday 2026-08-24 to Sunday 2026-12-27.
 * ------------------------------------------------------------------ */

const PLAN_START = '2026-08-24'

const WEEK_TOPICS = [
  ['Foundations', 'Module 0 + how the web works', ['labs-01', 'labs-02', 'labs-03', 'labs-04', 'web-00']],
  ['Foundations', 'Recon & enumeration', ['network-01']],
  ['Web', 'Burp Suite workflow', ['web-06']],
  ['Web', 'SQL injection', ['web-01']],
  ['Web', 'IDOR & broken access control', ['web-02']],
  ['Web', 'XSS', ['web-03']],
  ['Web', 'Upload, LFI & command injection', ['web-04']],
  ['Web', 'SSTI + web catch-up', ['web-05']],
  ['Network', 'Service exploitation', ['network-02']],
  ['Network', 'Linux privilege escalation', ['network-03']],
  ['Network', 'Windows privilege escalation', ['network-04']],
  ['Network', 'Pivoting', ['network-05']],
  ['Active Directory', 'AD fundamentals & enumeration', ['ad-01']],
  ['Active Directory', 'Kerberoasting, AS-REP, BloodHound', ['ad-02', 'ad-03']],
  ['Active Directory', 'Full chain to Domain Admin', ['ad-04', 'ad-05']],
  ['Report', 'Reporting module, full report for one room', ['reporting-01', 'reporting-02', 'reporting-03']],
  ['Report', 'Timed 48-hour mock on a fresh room', []],
  ['Report', 'Review gaps, drill weak spots, sit the exam', []]
]

function addDays (iso, days) {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export const WEEKS = WEEK_TOPICS.map(([phase, focus, lessons], i) => ({
  n: i + 1,
  phase,
  focus,
  lessons,
  start: addDays(PLAN_START, i * 7),
  end: addDays(PLAN_START, i * 7 + 6)
}))

export const PLAN_END = WEEKS[WEEKS.length - 1].end

/** The study week a date falls in, or null outside the plan window. */
export function weekForDate (date = new Date()) {
  const day = (date instanceof Date ? date : new Date(date)).toISOString().slice(0, 10)
  return WEEKS.find(w => day >= w.start && day <= w.end) ?? null
}

/** Whole days from `date` to the exam deadline. Negative once it has passed. */
export function daysRemaining (date = new Date()) {
  const from = new Date(`${(date instanceof Date ? date : new Date(date)).toISOString().slice(0, 10)}T00:00:00Z`)
  return Math.round((new Date(`${PLAN_END}T00:00:00Z`) - from) / 86400000)
}
