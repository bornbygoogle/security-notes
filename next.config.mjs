import nextra from 'nextra'

const withNextra = nextra({
  defaultShowCopyCode: true
})

const config = withNextra({
  reactStrictMode: true
})

/**
 * Nextra 4.2.17 still writes its Turbopack loader rules and resolve aliases to
 * `experimental.turbo` (node_modules/nextra/dist/server/index.js), which Next
 * 15.5 deprecated in favour of a top-level `turbopack` key. The warning comes
 * from inside Nextra, not from this file, so `next-experimental-turbo-to-turbopack`
 * has nothing to rewrite — the block has to be relocated after Nextra has built
 * the config.
 *
 * Nextra configures webpack separately, so this only affects Turbopack runs.
 * Delete this once Nextra emits `turbopack` itself.
 */
const { turbo, ...experimental } = config.experimental ?? {}

export default turbo
  ? {
      ...config,
      experimental,
      turbopack: {
        ...turbo,
        ...config.turbopack,
        rules: { ...turbo.rules, ...config.turbopack?.rules },
        resolveAlias: { ...turbo.resolveAlias, ...config.turbopack?.resolveAlias }
      }
    }
  : config
