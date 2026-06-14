import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import Sidebar from '@/components/Sidebar'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: '1COMMERCE Drone Ops',
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
      </body>
    </html>
  )
}
