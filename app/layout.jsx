import { Footer, Layout, Navbar } from 'nextra-theme-docs'
import { Head } from 'nextra/components'
import { getPageMap } from 'nextra/page-map'
import 'nextra-theme-docs/style.css'

export const metadata = {
  title: {
    default: 'Security Notes',
    template: '%s — Security Notes'
  },
  description: 'Security learning notes and command reference — PT1 journey.'
}

const navbar = (
  <Navbar
    logo={<b>🛡️ Security Notes</b>}
    projectLink="https://github.com/bornbygoogle/security-notes"
  />
)

const footer = (
  <Footer>Security learning notes · built with Nextra · deployed on Vercel</Footer>
)

export default async function RootLayout({ children }) {
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <Head />
      <body>
        <Layout
          navbar={navbar}
          footer={footer}
          pageMap={await getPageMap()}
          docsRepositoryBase="https://github.com/bornbygoogle/security-notes/tree/main"
          sidebar={{ defaultMenuCollapseLevel: 1 }}
        >
          {children}
        </Layout>
      </body>
    </html>
  )
}
