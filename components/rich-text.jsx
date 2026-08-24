/**
 * Renders a plain string, turning `backticked` runs into <code>.
 *
 * Quiz questions and glossary definitions are plain strings, not MDX, so
 * markdown's inline code never gets processed for them. This is the smallest
 * thing that keeps `-sV` and `WHERE id = $id` looking like code where they
 * belong, without pulling a markdown renderer into the client bundle.
 */
export default function Rich ({ text }) {
  const parts = String(text ?? '').split('`')
  return parts.map((p, i) => (i % 2 ? <code key={i}>{p}</code> : <span key={i}>{p}</span>))
}
