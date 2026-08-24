# Security Notes redesign — design spec

Date: 2026-08-23
Status: approved, implementation started

## Goal

Turn a stock Nextra docs site into a study instrument for the TryHackMe PT1 exam
(target: pass by end of 2026). Existing lesson prose is preserved verbatim. What
changes is the visual system and the interaction layer on top of it.

Done means: the site reads well for long sessions, tracks where you are against
the 18-week plan, and gives you a daily recall loop (quizzes + flashcards) that
you actually open.

## Constraints established by inspection

Verified against `node_modules` and build output on 2026-08-23, not from memory.

| Fact | Consequence |
|---|---|
| Nextra theme CSS lives entirely in `@layer theme, base, components, utilities` | Unlayered CSS in `globals.css` overrides it with no `!important` |
| Theme utilities are prefixed `x:` | No class-name collisions with our own |
| `providerImportSource = "next-mdx-import-source-file"` | Components returned from `useMDXComponents()` are usable in any content file with no import |
| `MARKDOWN_EXTENSIONS = ["md", "mdx"]` | The three `.md` write-ups also get components |
| `<Head>` sets `--nextra-primary-*`, `--nextra-bg`, `--nextra-content-width` on `:root` and `.dark` | Sanctioned recolor hook |
| Dark mode is the `.dark` class via next-themes | Theme follows OS preference; toggle already works |
| No Tailwind installed | Author plain CSS |
| Baseline `npm run build` green: 33 pages, Pagefind OK | Regression bar |

## Two registers

The site has two surfaces with opposite needs. Same palette, same type, same
theme. Different energy.

| | Study surface (lessons, command ref) | Practice surface (home, drill, quiz) |
|---|---|---|
| DESIGN_VARIANCE | 4 | 7 |
| MOTION_INTENSITY | 2 | 7 |
| VISUAL_DENSITY | 5 | 4 |

Rationale: lessons are read for 90 minutes, so motion there is hostile. The
practice surface is where the reward loop lives; motion is feedback on recall,
which is the whole point of retrieval practice.

## Color

Hue is spent only where it carries meaning. Three things get hue.

### Accent (one, all interactive state)
- dark `hsl(187 58% 52%)`, light `hsl(189 68% 33%)`
- Chosen by elimination: must avoid green (collides with "correct") and
  red/amber (collides with severity).

### Severity (sequential ramp, not a categorical rainbow)
Severity is ordinal, so it gets an intensity ramp. This also removes green from
severity, freeing it for "correct".

| | Dark | Light |
|---|---|---|
| Critical | `#FF6369` | `#CE2C31` |
| High | `#FF8B3E` | `#D2530C` |
| Medium | `#F5B944` | `#9E6B00` |
| Low | `#C9A227` | `#7A6100` |
| Info | `#8A94A6` | `#5E6878` |

### Success (one green, one meaning)
`#3DA35D` dark / `#2A7F45` light. Means "done correctly": quiz-correct,
lesson-complete, progress-filled. Quiz-incorrect reuses severity-critical.

### Phase is NOT color-coded
Recon / Enumeration / Exploitation / Post-exploitation get an icon plus a label
on the neutral ramp. Four muted hues are hard to distinguish, worse for
colorblind readers, and would compete with severity on reporting lessons.

### Neutrals
Single cool-grey ramp. Dark `#0B0E14` → `#E3E8EF`. Light `#FBFCFD` → `#11151C`.
No pure black, no pure white.

## Typography

Geist + Geist Mono via `next/font` (self-hosted, no external request, no CLS).
Body 16.5px / 1.7. Headings weight 600, tight tracking; hierarchy carried by
weight and rule-above rather than raw scale.

**Prose reads narrow, evidence reads wide.** Text measure caps at 68ch; code
blocks, tables and terminal output break out to the full column width. Nextra's
90rem shell is retained; only prose is constrained.

## Token architecture

Three layers, plain CSS custom properties, unlayered.

    PRIMITIVE   --ink-950..--ink-50, --cyan-*, --sev-*, --green-*
        v
    SEMANTIC    --surface, --surface-raised, --text-primary, --text-muted,
                --accent, --border-hairline, --focus-ring
        v
    COMPONENT   --quiz-correct-bg, --card-face-bg, --progress-track,
                --phase-marker-fg, --cmd-flag-underline

Only the semantic layer is redefined under `.dark`. No component references a
primitive directly.

## Single source of truth

`lib/curriculum.js` lists every lesson once: path, title, phase, domain, exam
weight, estimated minutes; plus the 18 study weeks with absolute dates
(week 1 = 2026-08-24, week 18 ends 2026-12-27).

Dashboard, lesson chrome, prev/next, study tracker and drill scoping all derive
from it. Adding a lesson is a one-place edit.

## Components

Registered in `mdx-components.jsx`, so usable in any content file with no import.

| Component | Surface | Content edits |
|---|---|---|
| `wrapper` override: phase strip + complete + prev/next | Study | none, keyed on `metadata.filePath` |
| `details` override: reveal-solution card | Study | none, 16 files improve free |
| `<AttackChain>` | Both | homepage + lesson chrome |
| `<ScoreBar>` 1000 pts, 750 line | Practice | homepage |
| `<ModuleProgress>` | Practice | homepage |
| `<StudyHeatmap>` 18 weeks | Practice | homepage |
| `<Quiz>` / `<Q>` | Study | one block appended per lesson |
| `<Flashcards>` Leitner, 5 boxes, 1/2/4/8/16d | Practice | none, glossary parsed |
| flag-tooltip enhancer | Study | none, dictionary + DOM walk |
| `<Finding>` severity + CVSS | Write-ups | opt-in |

## Seven visual moves

1. **Attack chain spine.** Recon → Enum → Exploit → Post as a persistent visual.
   Full width on the homepage filling with real coverage; in every lesson header
   with the current phase lit. The core mental model of the discipline, made
   visible ~400 times over the course.
2. **Score bar animated to a threshold.** Web 400 / Network 360 / AD 240 with 750
   marked. Staggered fill on load; the line changes state when projection crosses.
3. **Study-day heatmap.** 18-week contribution grid. Makes gaps visible.
4. **Flashcards with physics.** 3D flip on `transform`; swipe-to-grade via
   `useMotionValue` (never `useState` for pointer position); grading animates the
   card into its Leitner box so the SRS is visible rather than hidden bookkeeping.
5. **Quiz feedback carries the pedagogy.** Incorrect: wrong choice recedes, right
   one rises, explanation unfolds. The motion shows the correction.
6. **Flag anatomy on hover.** Command decomposes in place, flag lifts, meaning
   appears aligned beneath, rest dims.
7. **Material and depth.** Real elevation on interactive surfaces, hairlines for
   grouping, fixed `pointer-events-none` grain layer. Blue-shifted near-black
   dark theme, not GitHub-dark.

No confetti or celebration effects.

## States

Specified up front, not discovered.

- **Quiz incorrect** gets the most design attention of any state: it must show
  *why* the answer fails, because that is where learning happens.
- **Drill empty** ("nothing due, next review Thursday") is the most-seen state;
  it names the next action.
- **Dashboard zero-progress** is the first impression; it says what to do first.

## Storage

One `localStorage` key behind `useProgress()`, SSR-guarded and try/catch-wrapped,
with JSON export/import so months of progress are not hostage to one browser
profile. Progress-dependent UI renders a neutral state server-side and fills in
after mount, or prerender breaks.

## Motion rules

- `transform` and `opacity` only.
- Everything collapses under `prefers-reduced-motion`.
- No `window.addEventListener('scroll')`.
- `motion@13` lazy-loaded, scoped to drill/quiz client components only, so lesson
  pages do not pay for it.

## Dependencies

Verified to exist on npm 2026-08-23.

| Package | Version | Why |
|---|---|---|
| `geist` | 1.7.2 | Type. Highest visual lift per unit of risk. |
| `@phosphor-icons/react` | 2.1.10 | Hand-rolled SVG icons are banned; icons are needed for verdicts, controls, phases. |
| `motion` | 13.1.1 | Card physics, spring grading. Lazy, practice surface only. |
| `vitest` | latest (dev) | Leitner scheduler, progress rollups, glossary parser. A silent bug there corrupts months of study data. |

## Scope decisions

- **Em-dash ban applies to UI chrome only**, not to lesson prose. The glossary's
  ` — ` is the delimiter the flashcard parser keys on; a site-wide ban would
  rewrite preserved content and break the deck.
- **Theme follows OS preference.** Both themes designed equally.
- **Quizzes: Web module first** (6 lessons, ~30 questions), then extend. A thin
  end-to-end pass beats a complete first stage.
- **IA is frozen.** No route slugs, nav labels or page paths change.

## Risks

1. **Flag-tooltip enhancer** is the one genuinely uncertain piece. Shiki may split
   `-sV` across `<span>` boundaries. Spiked first against a real built page,
   before anything is built on it. Fallback: explicit `<Cmd>` component plus a
   searchable flag reference page.
2. **Authoring load.** Quizzes and the command deck are new content, not derived.
3. **localStorage only.** Per-browser. Export/import mitigates; nothing else can
   without a server.
4. **Hydration.** Progress-dependent UI is the most likely source of build breaks.

## Verification

- `npm run build` green, page count >= 33, Pagefind still indexing.
- Visual check in both themes, desktop and mobile, via Chrome DevTools.
- Lighthouse accessibility pass; WCAG AA on all interactive text.
- Unit tests for `lib/` pure logic.

## Build order

Thin end-to-end first:

1. Deps + token system + `lib/curriculum.js` (+ tests)
2. Homepage + lesson wrapper
3. **Screenshot both themes, review before continuing**
4. Flag-tooltip spike
5. Flashcards + drill page
6. Quizzes, Web module first
7. Write-ups index + `<Finding>`

Nothing after step 2 is built until step 3 is looked at.

---

## Build status — 2026-08-23

Verified this session unless marked otherwise. 159 unit tests pass (`npx vitest run lib/__tests__/`);
`npm run build` succeeds, 37 static pages, Pagefind indexes 33.

### Done

| Step | What | Verified by |
|---|---|---|
| 1-3 | Tokens, homepage dashboard, lesson chrome | Browser, dark + light + 390px |
| 4 | Flag tooltips | 34 flags decorated on one lesson, in the production build |
| 5 | Drill — 104 flashcards, Leitner 5 boxes | Flip → answer → `{box:2,due:"2026-08-25"}` persisted |
| 6 | Quizzes — Web module, 31 questions | 5/6 → 83%, pass footer, best score stored |
| 7 | Write-ups index, generated from files | 3 items in DOM, phase tags, word counts |

### The flag-tooltip spike, resolved

The open risk was Shiki splitting `-sV` across `<span>` boundaries. It does not. A scan of every
built lesson page — 157 fenced blocks, 366 lines, 210 flag tokens, 123 distinct `(command, flag)`
pairs — found each flag emitted as its own atomic span, e.g. `<span style="…"> -sV</span>`.

Two rules the data forced, which the code follows:

1. **Only atomic spans decorate.** `text`-language blocks emit one span per line and quoted strings
   glue flags to surrounding text; neither matches the flag regex, so they are skipped by
   construction rather than by an allowlist. All 10 glued cases in the corpus are comments or
   strings — exactly where a tooltip must not fire.
2. **Command attribution walks backwards.** 19 lines start with a flag because `ffuf`/`sqlmap`
   invocations wrap with a trailing backslash. A continuation line inherits the command above it;
   a blank line or comment breaks the chain.

Nextra's copy button still copies the original text — the decoration preserves `textContent`,
checked against `nmap -p 22,80,445 -sC -sV -oN nmap/detail.txt 10.10.x.x`.

### Content bugs found and fixed along the way

- `content/pt1-course/{network/01,labs/02}`: `&#123;`/`&#125;` rendered literally inside ```bash
  fences, so the copy-pasteable line read `mkdir -p ~/thm/boxname/&#123;nmap,ffuf&#125;` and would
  have created a directory with that literal name. MDX does not interpret braces inside a code
  fence, so the entities were never needed.
- `content/writeups/index.mdx` said "No write-ups published yet" with three published, and
  documented a `pages/writeups/` directory that stopped existing at the Nextra 4 migration. The
  list is now generated from the files at build time.
- The glossary parser silently dropped two cards (`CIDR`, `SYSTEM`) whose terms carry a
  parenthetical before the em-dash. A test now reads the real glossary and fails if any bullet
  produces no card.

### Not built

- Quizzes for Network, AD, Labs and Reporting (18 lessons). The engine and the wiring are done —
  this is question authoring only: add a key to `QUIZZES` in `lib/quiz.js` and it appears.
  `lib/__tests__/quiz.test.js` currently asserts full Web coverage; widen that list as modules land.
- `<Finding>` component for write-ups.
- Favicon and OG image — `public/` still holds only the Pagefind output.
- `motion@13.1.1` is installed but unused; all motion so far is CSS.
