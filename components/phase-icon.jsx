import {
  GraduationCap, MagnifyingGlass, ListMagnifyingGlass,
  Lightning, TreeStructure, FileText
} from '@phosphor-icons/react/ssr'

const ICONS = {
  GraduationCap,
  MagnifyingGlass,
  ListMagnifyingGlass,
  Lightning,
  TreeStructure,
  FileText
}

/**
 * Phase is deliberately NOT colour-coded. Four muted hues are hard to tell
 * apart and would compete with the severity ramp, so phase identity is carried
 * by a distinct glyph plus a label instead.
 */
export function PhaseIcon ({ icon, size = 16, weight = 'bold', ...rest }) {
  const Icon = ICONS[icon] ?? ListMagnifyingGlass
  return <Icon size={size} weight={weight} aria-hidden="true" {...rest} />
}
