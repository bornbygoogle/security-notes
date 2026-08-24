import { Footer, Layout, Navbar } from 'nextra-theme-docs'
import { Head } from 'nextra/components'
import { getPageMap } from 'nextra/page-map'
import { GeistSans } from 'geist/font/sans'
import { GeistMono } from 'geist/font/mono'
import 'nextra-theme-docs/style.css'
import './globals.css'
import './components.css'

export const metadata = {
  title: {
    default: 'Security Notes',
    template: '%s — Security Notes'
  },
  description: 'Security learning notes and a self-paced PT1 course. Pentest methodology, command reference and TryHackMe write-ups.'
}

const navbar = (
  <Navbar
    logo={<span className="sn-logo"><span className="sn-logo__mark" aria-hidden="true" />Security Notes</span>}
    projectLink="https://github.com/bornbygoogle/security-notes"
  />
)

const footer = (
  <Footer>
    <span className="sn-foot mono">
      Authorised labs and CTFs only. Built with Nextra.
    </span>
  </Footer>
)

export default async function RootLayout ({ children }) {
  return (
    <html
      lang="en"
      dir="ltr"
      className={`${GeistSans.variable} ${GeistMono.variable}`}
      suppressHydrationWarning
    >
      <Head
        color={{
          hue: { dark: 187, light: 189 },
          saturation: { dark: 58, light: 68 },
          lightness: { dark: 52, light: 33 }
        }}
        backgroundColor={{ dark: '#0b0e14', light: '#fbfcfd' }}
      />
      <body>
        <Layout
          navbar={navbar}
          footer={footer}
          pageMap={await getPageMap()}
          docsRepositoryBase="https://github.com/bornbygoogle/security-notes/tree/main"
          sidebar={{ defaultMenuCollapseLevel: 1 }}
          navigation={false}
          editLink={null}
        >
          {children}
        </Layout>
      </body>
    </html>
  )
}
