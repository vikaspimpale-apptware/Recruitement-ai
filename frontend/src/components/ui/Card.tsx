import { clsx } from 'clsx'

interface CardProps {
  className?: string
  children: React.ReactNode
  onClick?: () => void
  hover?: boolean
}

export default function Card({ className, children, onClick, hover }: CardProps) {
  return (
    <div
      onClick={onClick}
      className={clsx(
        'bg-slate-900/75 backdrop-blur-sm rounded-2xl border border-slate-800 shadow-sm text-slate-100',
        hover && 'hover:shadow-lg hover:-translate-y-0.5 hover:border-blue-500/40 transition-all duration-150 cursor-pointer',
        className,
      )}
    >
      {children}
    </div>
  )
}

export function CardHeader({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={clsx('px-6 py-4 border-b border-slate-800/80', className)}>{children}</div>
}

export function CardBody({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={clsx('px-6 py-4', className)}>{children}</div>
}

export function CardFooter({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={clsx('px-6 py-4 border-t border-slate-800 bg-slate-900/80 rounded-b-2xl', className)}>{children}</div>
}
