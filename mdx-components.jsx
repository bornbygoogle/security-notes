import { useMDXComponents as getThemeComponents } from 'nextra-theme-docs'
import { lessonByPath } from './lib/curriculum.js'
import { LessonHeader, LessonFooter } from './components/lesson-chrome.jsx'
import Dashboard, { AttackChain } from './components/dashboard.jsx'
import FlagTips from './components/flag-tips.jsx'
import DrillDeck from './components/drill-deck.jsx'
import LessonQuiz from './components/lesson-quiz.jsx'
import WriteupIndex from './components/writeup-index.jsx'

const themeComponents = getThemeComponents()
const ThemeWrapper = themeComponents.wrapper

/**
 * Wraps Nextra's own wrapper so every lesson gets chrome without a content
 * edit. The lesson is resolved from metadata.filePath against
 * lib/curriculum.js; pages that are not lessons fall through untouched.
 */
function Wrapper ({ children, toc, metadata, ...rest }) {
  const lesson = lessonByPath(metadata?.filePath)
  return (
    <ThemeWrapper toc={toc} metadata={metadata} {...rest}>
      {lesson && <LessonHeader lesson={lesson} />}
      {children}
      <FlagTips />
      {lesson && <LessonQuiz lesson={lesson} />}
      {lesson && <LessonFooter lesson={lesson} />}
    </ThemeWrapper>
  )
}

export function useMDXComponents (components) {
  return {
    ...themeComponents,
    wrapper: Wrapper,
    Dashboard,
    AttackChain,
    DrillDeck,
    WriteupIndex,
    ...components
  }
}
