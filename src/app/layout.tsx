import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import Sidebar from '@/components/Sidebar'
import Sidekick from '@/components/Sidekick'
import { BRAND_NAME } from '@/lib/business'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: BRAND_NAME,
  description: 'Ag drone operations & precision intelligence dashboard',
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
