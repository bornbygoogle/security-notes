import { readFile } from 'node:fs/promises'
import path from 'node:path'
import Drill from './drill.jsx'
import { parseGlossary } from '../lib/glossary.js'

/**
 * Server component: reads the glossary at build time and hands the parsed deck
 * to the client. Nothing to keep in sync — add a term to
 * content/pt1-course/glossary.mdx and it becomes a card.
 */
export default async function DrillDeck () {
  const file = path.join(process.cwd(), 'content', 'pt1-course', 'glossary.mdx')
  const cards = parseGlossary(await readFile(file, 'utf8'))
  const sections = [...new Set(cards.map((c) => c.section))]
  return <Drill cards={cards} sections={sections} />
}
