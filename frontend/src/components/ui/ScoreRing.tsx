import { clsx } from 'clsx'

interface ScoreRingProps {
  score: number | null
  size?: 'sm' | 'md' | 'lg'
  override?: number | null
}

function scoreColor(score: number): string {
  if (score >= 8) return 'text-emerald-600'
  if (score >= 6) return 'text-blue-600'
  if (score >= 4) return 'text-amber-600'
  return 'text-red-500'
}

function scoreBg(score: number): string {
  if (score >= 8) return 'ring-emerald-500'
  if (score >= 6) return 'ring-blue-500'
  if (score >= 4) return 'ring-amber-400'
  return 'ring-red-400'
}

const sizes = { sm: 'h-10 w-10 text-sm', md: 'h-14 w-14 text-base', lg: 'h-16 w-16 text-lg' }

export default function ScoreRing({ score, size = 'md', override }: ScoreRingProps) {
  const display = override ?? score
  if (display === null) {
    return (
      <div
        className={clsx(
          'rounded-full ring-2 ring-slate-700/70 flex items-center justify-center bg-slate-900/60 font-bold text-slate-400 apptware-glow',
          sizes[size],
        )}
        title="AI score not available yet"
      >
        —
      </div>
    )
  }
  return (
    <div
      className={clsx(
        'rounded-full ring-2 flex items-center justify-center font-bold bg-white apptware-fade-up',
        scoreBg(display),
        scoreColor(display),
        sizes[size],
        override !== null && override !== undefined && 'ring-offset-2',
      )}
      title={override !== null && override !== undefined ? `AI: ${score} | Override: ${override}` : `AI Score: ${display}`}
    >
      {display.toFixed(1)}
    </div>
  )
}
