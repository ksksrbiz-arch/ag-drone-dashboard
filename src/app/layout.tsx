import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import Link from 'next/link'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: '1COMMERCE Drone Ops',
  description: 'Ag drone operations & precision intelligence dashboard',
}

const navItems = [
  { href: '/',          label: 'Overview',   icon: '📊' },
  { href: '/leads',     label: 'Leads',      icon: '🌾' },
  { href: '/pipeline',  label: 'Pipeline',   icon: '🔄' },
  { href: '/jobs',      label: 'Jobs',       icon: '✈️'  },
  { href: '/intel',     label: 'EFB Intel',  icon: '🧠' },
]

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <div className="flex h-screen bg-slate-50">
          {/* Sidebar */}
          <aside className="w-56 bg-slate-900 flex flex-col shrink-0">
            <div className="px-5 py-5 border-b border-slate-700">
              <div className="text-white font-bold text-sm leading-tight">
                1COMMERCE
              </div>
              <div className="text-slate-400 text-xs mt-0.5">Drone Ops Dashboard</div>
            </div>

            <nav className="flex-1 px-3 py-4 space-y-1">
              {navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-slate-300
                             hover:bg-slate-700 hover:text-white transition-colors text-sm"
                >
                  <span>{item.icon}</span>
                  <span>{item.label}</span>
                </Link>
              ))}
            </nav>

            <div className="px-5 py-4 border-t border-slate-700">
              <div className="text-slate-500 text-xs">Canby, OR · DJI Agras T50</div>
              <div className="text-slate-600 text-xs mt-0.5">Bo Seiders — Field Ops</div>
            </div>
          </aside>

          {/* Main content */}
          <main className="flex-1 overflow-y-auto">
            {children}
          </main>
        </div>
      </body>
    </html>
  )
}
