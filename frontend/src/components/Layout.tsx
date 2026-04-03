import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { clsx } from 'clsx'
import {
  LayoutDashboard,
  Workflow,
  Users,
  MessageSquare,
  BarChart3,
  MailCheck,
  LogOut,
  BrainCircuit,
  ChevronRight,
  Menu,
  X,
} from 'lucide-react'
import { useAuthStore } from '@/store/auth'

const navItems = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/workflows', icon: Workflow, label: 'Workflows' },
  { to: '/candidates', icon: Users, label: 'Candidates' },
  { to: '/chat', icon: MessageSquare, label: 'AI Chat' },
  { to: '/sent-mails', icon: MailCheck, label: 'Sent Mails' },
  { to: '/analytics', icon: BarChart3, label: 'Analytics' },
]

export default function Layout() {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      {/* Mobile top bar */}
      <div className="fixed inset-x-0 top-0 z-40 flex h-14 items-center justify-between border-b border-slate-800 bg-slate-950 px-4 md:hidden">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600">
            <BrainCircuit className="h-4 w-4 text-white" />
          </div>
          <p className="text-sm font-semibold text-white">RecruitAI</p>
        </div>
        <button
          onClick={() => setMobileNavOpen((v) => !v)}
          className="rounded-lg p-1.5 text-slate-300 hover:bg-slate-800 hover:text-white"
          aria-label="Toggle navigation"
        >
          {mobileNavOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {/* Mobile backdrop */}
      {mobileNavOpen && (
        <button
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={() => setMobileNavOpen(false)}
          aria-label="Close navigation overlay"
        />
      )}

      {/* Sidebar */}
      <aside
        className={clsx(
          'fixed inset-y-0 left-0 z-40 w-64 flex-col bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 border-r border-slate-800 shadow-xl shrink-0 transition-transform md:relative md:translate-x-0 md:flex',
          mobileNavOpen ? 'translate-x-0 flex' : '-translate-x-full hidden md:flex',
        )}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-6 py-5 border-b border-slate-800">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow">
            <BrainCircuit className="h-5 w-5 text-white" />
          </div>
          <div>
            <p className="text-sm font-bold text-white leading-tight">RecruitAI</p>
            <p className="text-xs text-slate-400">Powered by Apptware</p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              onClick={() => setMobileNavOpen(false)}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-100 group',
                  isActive
                    ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <Icon className={clsx('h-4 w-4', isActive ? 'text-white' : 'text-slate-400 group-hover:text-white')} />
                  {label}
                  {isActive && <ChevronRight className="ml-auto h-3.5 w-3.5 text-blue-100" />}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {/* User footer */}
        <div className="px-4 py-4 border-t border-slate-800">
          <div className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-slate-800 transition-colors">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-500/20 text-blue-300 font-semibold text-sm shrink-0">
              {user?.full_name?.[0]?.toUpperCase() ?? 'R'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-100 truncate">{user?.full_name}</p>
              <p className="text-xs text-slate-400 truncate">{user?.email}</p>
            </div>
            <button onClick={handleLogout} className="text-slate-500 hover:text-red-400 transition-colors cursor-pointer" title="Logout">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="apptware-dark flex-1 overflow-y-auto pt-14 md:pt-0">
        <Outlet />
      </main>
    </div>
  )
}
