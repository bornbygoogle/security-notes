export default {
  logo: <span style={{ fontWeight: 700 }}>🛡️ Security Notes</span>,
  // TODO: after you create the GitHub repo, replace YOUR_USERNAME below.
  project: {
    link: 'https://github.com/YOUR_USERNAME/security-notes'
  },
  docsRepositoryBase:
    'https://github.com/YOUR_USERNAME/security-notes/tree/main',
  head: (
    <>
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <meta name="description" content="Security learning notes and command reference — PT1 journey." />
      <meta name="robots" content="index,follow" />
    </>
  ),
  sidebar: {
    defaultMenuCollapseLevel: 1
  },
  search: {
    placeholder: 'Search commands & notes…'
  },
  footer: {
    text: (
      <span>
        Security learning notes · built with Nextra · deployed on Vercel
      </span>
    )
  },
  darkMode: true
}
