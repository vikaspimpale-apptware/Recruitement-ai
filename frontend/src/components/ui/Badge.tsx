import { clsx } from 'clsx'

type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'purple' | 'slate'

interface BadgeProps {
  variant?: BadgeVariant
  className?: string
  children: React.ReactNode
}

const variants: Record<BadgeVariant, string> = {
  default: 'bg-slate-100 text-slate-700 border border-slate-200',
  success: 'bg-emerald-100 text-emerald-700 border border-emerald-200',
  warning: 'bg-amber-100 text-amber-700 border border-amber-200',
  danger: 'bg-red-100 text-red-700 border border-red-200',
  info: 'bg-blue-100 text-blue-700 border border-blue-200',
  purple: 'bg-purple-100 text-purple-700 border border-purple-200',
  slate: 'bg-slate-200 text-slate-600 border border-slate-300',
}

export default function Badge({ variant = 'default', className, children }: BadgeProps) {
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold',
        variants[variant],
        className,
      )}
    >
      {children}
    </span>
  )
}

export function statusBadge(status: string) {
  const map: Record<string, BadgeVariant> = {
    sourced: 'slate',
    filtered: 'info',
    approved: 'success',
    rejected: 'danger',
    flagged: 'warning',
    contacted: 'purple',
    replied: 'info',
    scheduled: 'success',
    pending: 'warning',
    running: 'info',
    waiting_review: 'warning',
    completed: 'success',
    failed: 'danger',
    draft: 'slate',
    sent: 'info',
    bounced: 'danger',
  }
  return map[status] ?? 'default'
}
