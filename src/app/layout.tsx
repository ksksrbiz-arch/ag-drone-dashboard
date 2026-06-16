import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import Sidebar from '@/components/Sidebar'
import Sidekick from '@/components/Sidekick'
import { PRODUCT_NAME, PRODUCT_TAGLINE } from '@/lib/business'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: `${PRODUCT_NAME} — ${PRODUCT_TAGLINE}`,
  description: 'Drone operations CRM & precision-intelligence platform.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <div className="md:flex md:h-screen">
          <Sidebar />
          <main className="flex-1 md:overflow-y-auto">
            {children}
          </main>
        </div>
        <Sidekick />
      </body>
    </html>
  )
}
