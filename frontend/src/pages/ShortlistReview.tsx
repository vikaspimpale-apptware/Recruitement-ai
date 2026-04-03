import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  CheckCircle2, XCircle, Flag, ArrowLeft, Users,
  ChevronDown, ChevronUp, ExternalLink, Star,
  RefreshCw, FileDown, Search, AlertTriangle,
  ThumbsDown, CheckCheck, RotateCcw, Loader2, Pencil, Sparkles, SlidersHorizontal, Info,
} from 'lucide-react'
import { candidateApi, workflowApi } from '@/api'
import type { Candidate, StepConfig } from '@/types'
import Button from '@/components/ui/Button'
import Card, { CardBody } from '@/components/ui/Card'
import Badge, { statusBadge } from '@/components/ui/Badge'
import ScoreRing from '@/components/ui/ScoreRing'
import toast from 'react-hot-toast'
import { clsx } from 'clsx'
import { exportCandidateProfiles } from '@/utils/exportCandidatePDF'

const DEFAULT_FILTERING_CONFIG = {
  min_score_threshold: 5.0,
  required_skills: [] as string[],
  preferred_skills: [] as string[],
  min_experience_years: 0,
  max_experience_years: null as number | null,
  strict_skill_match: false,
}

// ---------- Skill chip ----------
function SkillChip({ skill, highlight }: { skill: string; highlight?: boolean }) {
  return (
    <span className={clsx(
      'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
      highlight ? 'bg-blue-100 text-blue-700 ring-1 ring-blue-300' : 'bg-slate-100 text-slate-600',
    )}>
      {skill}
    </span>
  )
}

// ---------- Candidate card ----------
function CandidateCard({
  candidate,
  onDecision,
  onScoreOverride,
  onRescore,
  onSaveNotes,
}: {
  candidate: Candidate
  onDecision: (id: number, decision: string) => void
  onScoreOverride: (id: number, score: number) => void
  onRescore: (id: number) => Promise<void>
  onSaveNotes: (id: number, notes: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [notes, setNotes] = useState(candidate.recruiter_notes ?? '')
  const [scoreInput, setScoreInput] = useState('')
  const [rescoring, setRescoring] = useState(false)

  const effectiveScore = candidate.recruiter_score_override ?? candidate.ai_score
  const decision = candidate.recruiter_decision
  const reviewState = decision ?? 'pending'

  const handleRescore = async () => {
    setRescoring(true)
    await onRescore(candidate.id)
    setRescoring(false)
  }

  const cardBorder = decision === 'approved'
    ? 'border-emerald-300 bg-emerald-50/40'
    : decision === 'rejected'
    ? 'border-red-200 bg-red-50/20 opacity-70'
    : decision === 'flagged'
    ? 'border-amber-300 bg-amber-50/30'
    : ''

  return (
    <Card className={`transition-all duration-200 hover:-translate-y-0.5 apptware-fade-up ${cardBorder}`}>
      <CardBody>
        <div className="flex flex-col items-start gap-4 sm:flex-row">
          <ScoreRing score={candidate.ai_score} override={candidate.recruiter_score_override} size="md" />

          <div className="flex-1 min-w-0">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-slate-900">{candidate.full_name}</p>
                  {candidate.recruiter_score_override != null && (
                    <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                      Score overridden
                    </span>
                  )}
                </div>
                <p className="text-sm text-slate-500 mt-0.5 line-clamp-1">{candidate.headline}</p>
                <p className="text-xs text-slate-400 mt-0.5">
                  {candidate.location}
                  {candidate.experience_years != null && ` · ${candidate.experience_years.toFixed(1)} yrs exp`}
                </p>
                <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">
                  {candidate.current_company ? `Company: ${candidate.current_company}` : 'Company: Unknown'}
                  {candidate.email ? ` · ${candidate.email}` : ''}
                  {candidate.phone ? ` · ${candidate.phone}` : ''}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                <Badge className="whitespace-nowrap" variant={decision ? statusBadge(decision) : 'warning'}>
                  {reviewState}
                </Badge>
                {candidate.status === 'rejected' && (
                  <Badge className="whitespace-nowrap" variant="danger">AI rejected</Badge>
                )}
                {candidate.linkedin_url && (
                  <a href={candidate.linkedin_url} target="_blank" rel="noopener noreferrer"
                    className="text-slate-400 hover:text-blue-600 transition-colors" title="View LinkedIn profile">
                    <ExternalLink className="h-4 w-4" />
                  </a>
                )}
              </div>
            </div>

            {/* Skills */}
            <div className="flex flex-wrap gap-1.5 mt-2">
              {candidate.skills.slice(0, 7).map((s) => <SkillChip key={s} skill={s} />)}
              {candidate.skills.length > 7 && (
                <span className="text-xs text-slate-400 self-center">+{candidate.skills.length - 7} more</span>
              )}
            </div>

            {/* AI Reason */}
            {candidate.ai_score_reason && (
              <p className="text-xs text-slate-500 mt-2 italic leading-relaxed line-clamp-2">
                "{candidate.ai_score_reason}"
              </p>
            )}
          </div>
        </div>

        {/* Expand toggle */}
        <button
          onClick={() => setExpanded((p) => !p)}
          className="mt-3 flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-700 transition-colors cursor-pointer"
        >
          {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          {expanded ? 'Hide details' : 'Show full profile'}
        </button>

        {/* Expanded section */}
        {expanded && (
          <div className="mt-3 border-t border-slate-100 pt-4 space-y-4">
            {candidate.profile_summary && (
              <p className="text-sm text-slate-600 leading-relaxed">{candidate.profile_summary}</p>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs text-slate-600">
              {candidate.current_company && (
                <div><span className="font-semibold text-slate-700">Current company:</span> {candidate.current_company}</div>
              )}
              {candidate.email && (
                <div><span className="font-semibold text-slate-700">Email:</span> {candidate.email}</div>
              )}
              {candidate.phone && (
                <div><span className="font-semibold text-slate-700">Contact:</span> {candidate.phone}</div>
              )}
              {candidate.resume_url && (
                <div>
                  <span className="font-semibold text-slate-700">Resume:</span>{' '}
                  <a
                    href={candidate.resume_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline"
                  >
                    Open Resume Link
                  </a>
                </div>
              )}
            </div>

            {candidate.profile_description && (
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Profile Description</p>
                <p className="text-sm text-slate-600 leading-relaxed">{candidate.profile_description}</p>
              </div>
            )}

            {/* Experience */}
            {candidate.experience.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Experience</p>
                <div className="space-y-2">
                  {candidate.experience.map((exp, i) => (
                    <div key={i} className="flex gap-3">
                      <div className="h-2 w-2 rounded-full bg-blue-400 mt-1.5 shrink-0" />
                      <div>
                        <p className="text-sm font-medium text-slate-800">{exp.title} · {exp.company}</p>
                        <p className="text-xs text-slate-500">{exp.duration}</p>
                        {exp.description && <p className="text-xs text-slate-400 mt-0.5">{exp.description}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Education */}
            {candidate.education.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Education</p>
                {candidate.education.map((edu, i) => (
                  <p key={i} className="text-sm text-slate-700">
                    {edu.degree} · {edu.institution}
                    {edu.year && ` · ${edu.year}`}
                  </p>
                ))}
              </div>
            )}

            {/* Score override */}
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Score Override</p>
              <div className="flex gap-2 items-center">
                <input
                  type="number" min="0" max="10" step="0.5"
                  value={scoreInput}
                  onChange={(e) => setScoreInput(e.target.value)}
                  placeholder={`Current: ${effectiveScore?.toFixed(1) ?? '—'}`}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm w-36 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {scoreInput && (
                  <Button size="sm" variant="outline" onClick={() => {
                    onScoreOverride(candidate.id, parseFloat(scoreInput))
                    setScoreInput('')
                  }}>
                    <Star className="h-3.5 w-3.5" /> Apply
                  </Button>
                )}
                <Button size="sm" variant="ghost" loading={rescoring} onClick={handleRescore} title="Re-run AI scoring">
                  <RotateCcw className="h-3.5 w-3.5" />
                  {rescoring ? 'Rescoring...' : 'AI Rescore'}
                </Button>
              </div>
            </div>

            {/* Notes */}
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Recruiter Notes</p>
              <div className="flex gap-2">
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Add notes about this candidate..."
                  rows={2}
                  className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <Button size="sm" variant="outline" onClick={() => onSaveNotes(candidate.id, notes)}>
                  Save
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-2 mt-4 flex-wrap">
          <Button
            size="sm"
            variant={decision === 'approved' ? 'success' : 'outline'}
            onClick={() => onDecision(candidate.id, 'approved')}
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            {decision === 'approved' ? 'Approved ✓' : 'Approve'}
          </Button>
          <Button
            size="sm"
            variant={decision === 'rejected' ? 'danger' : 'outline'}
            onClick={() => onDecision(candidate.id, 'rejected')}
          >
            <XCircle className="h-3.5 w-3.5" />
            {decision === 'rejected' ? 'Rejected ✗' : 'Reject'}
          </Button>
          <Button
            size="sm"
            variant={decision === 'flagged' ? 'warning' : 'ghost'}
            className={decision === 'flagged' ? 'bg-amber-100 text-amber-800 border-amber-300' : ''}
            onClick={() => onDecision(candidate.id, 'flagged')}
          >
            <Flag className="h-3.5 w-3.5" />
            {decision === 'flagged' ? 'Flagged' : 'Flag for later'}
          </Button>
        </div>
      </CardBody>
    </Card>
  )
}

// ---------- Main page ----------
type FilterTab = 'all' | 'pending' | 'approved' | 'rejected' | 'flagged'
type SortMode = 'score_desc' | 'score_asc' | 'name_asc'

function dedupeCandidates(rows: Candidate[]): Candidate[] {
  const best = new Map<string, Candidate>()
  const score = (c: Candidate) =>
    (c.ai_score ?? 0) +
    (c.skills?.length ?? 0) * 0.1 +
    (c.experience?.length ?? 0) * 0.05 +
    (c.email ? 0.5 : 0)

  for (const c of rows) {
    const email = (c.email ?? '').trim().toLowerCase()
    const phone = (c.phone ?? '').replace(/\D/g, '')
    const url = (c.linkedin_url ?? '').trim().toLowerCase().replace(/\/$/, '')
    const fallback = `${(c.full_name ?? '').trim().toLowerCase()}|${(c.current_company ?? '').trim().toLowerCase()}`
    const key = email ? `email:${email}` : phone.length >= 8 ? `phone:${phone}` : url ? `url:${url}` : `name_company:${fallback}`
    const prev = best.get(key)
    if (!prev || score(c) > score(prev)) best.set(key, c)
  }
  return [...best.values()]
}

export default function ShortlistReview() {
  const { runId } = useParams<{ runId: string }>()
  const navigate = useNavigate()
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [runStatus, setRunStatus] = useState<string | null>(null)
  const [currentStep, setCurrentStep] = useState<string | null>(null)
  const [showingSourcedPreview, setShowingSourcedPreview] = useState(false)
  const [loading, setLoading] = useState(true)
  const [resuming, setResuming] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<FilterTab>('all')
  const [bulkRejectingAll, setBulkRejectingAll] = useState(false)
  const [workflowId, setWorkflowId] = useState<number | null>(null)
  const [regeneratingRun, setRegeneratingRun] = useState(false)
  const [refiltering, setRefiltering] = useState(false)
  const [skipFiltering, setSkipFiltering] = useState(false)
  const [requiredSkillInput, setRequiredSkillInput] = useState('')
  const [requiredSkills, setRequiredSkills] = useState<string[]>([])
  const [minScore, setMinScore] = useState('5')
  const [minExperience, setMinExperience] = useState('0')
  const [maxExperience, setMaxExperience] = useState('')
  const [strictSkillMatch, setStrictSkillMatch] = useState(false)
  const [sortMode, setSortMode] = useState<SortMode>('score_desc')

  const loadCandidates = useCallback(async () => {
    if (!runId) return
    const runRes = await workflowApi.getRun(Number(runId))
    setWorkflowId(runRes.data.workflow_id)
    setRunStatus(runRes.data.status)
    setCurrentStep(runRes.data.current_step)

    const postFilteredRes = await candidateApi.listForRun(Number(runId), undefined, true)
    if (postFilteredRes.data.length > 0) {
      setCandidates(dedupeCandidates(postFilteredRes.data))
      setShowingSourcedPreview(false)
    } else {
      const allRes = await candidateApi.listForRun(Number(runId))
      const sourcedOnly = allRes.data.filter((c) => c.status === 'sourced')
      if (sourcedOnly.length > 0) {
        setCandidates(dedupeCandidates(sourcedOnly))
        setShowingSourcedPreview(true)
      } else {
        setCandidates([])
        setShowingSourcedPreview(false)
      }
    }

    const workflowRes = await workflowApi.get(runRes.data.workflow_id)
    const steps = workflowRes.data.step_configs ?? []
    const filtering = steps.find((s) => s.step_name === 'filtering')
    const cfg = { ...DEFAULT_FILTERING_CONFIG, ...(filtering?.config ?? {}) } as Record<string, unknown>
    const parsedRequired = Array.isArray(cfg.required_skills) ? (cfg.required_skills as string[]) : []
    setRequiredSkills(parsedRequired)
    setMinScore(String(cfg.min_score_threshold ?? 5))
    setMinExperience(String(cfg.min_experience_years ?? 0))
    setMaxExperience(cfg.max_experience_years == null ? '' : String(cfg.max_experience_years))
    setStrictSkillMatch(Boolean(cfg.strict_skill_match))
  }, [runId])

  useEffect(() => {
    if (!runId) return
    loadCandidates()
      .catch(() => toast.error('Failed to load candidates'))
      .finally(() => setLoading(false))
  }, [runId, loadCandidates])

  useEffect(() => {
    if (!runId) return
    if (!(runStatus === 'running' || runStatus === 'pending')) return
    const timer = setInterval(() => {
      loadCandidates().catch(() => {})
    }, 5000)
    return () => clearInterval(timer)
  }, [runId, runStatus, loadCandidates])

  const addRequiredSkill = () => {
    const value = requiredSkillInput.trim()
    if (!value) return
    if (requiredSkills.some((s) => s.toLowerCase() === value.toLowerCase())) return
    setRequiredSkills((prev) => [...prev, value])
    setRequiredSkillInput('')
  }

  const removeRequiredSkill = (skill: string) => {
    setRequiredSkills((prev) => prev.filter((s) => s !== skill))
  }

  const upsertFilteringStep = (steps: StepConfig[]) => {
    const idx = steps.findIndex((s) => s.step_name === 'filtering')
    const parsedMinScore = Number.parseFloat(minScore)
    const parsedMinExp = Number.parseFloat(minExperience)
    const parsedMaxExp = maxExperience.trim() ? Number.parseFloat(maxExperience) : null
    const nextConfig = {
      ...DEFAULT_FILTERING_CONFIG,
      ...(idx >= 0 ? steps[idx].config : {}),
      min_score_threshold: Number.isFinite(parsedMinScore) ? parsedMinScore : 5,
      min_experience_years: Number.isFinite(parsedMinExp) ? parsedMinExp : 0,
      max_experience_years: Number.isFinite(parsedMaxExp as number) ? parsedMaxExp : null,
      required_skills: requiredSkills,
      strict_skill_match: strictSkillMatch,
    }
    if (idx >= 0) {
      const updated = [...steps]
      updated[idx] = {
        ...updated[idx],
        enabled: !skipFiltering,
        config: nextConfig,
      }
      return updated
    }
    return [
      ...steps,
      {
        step_name: 'filtering',
        enabled: !skipFiltering,
        order_index: 1,
        config: nextConfig,
      },
    ]
  }

  const handleRefilter = async () => {
    if (!runId || !workflowId) return
    setRefiltering(true)
    try {
      const wfRes = await workflowApi.get(workflowId)
      const nextSteps = upsertFilteringStep(wfRes.data.step_configs ?? [])
      await workflowApi.update(workflowId, { step_configs: nextSteps })
      await workflowApi.regenerateStep(Number(runId), 'filtering', skipFiltering)
      const candRes = await candidateApi.listForRun(Number(runId), undefined, true)
      setCandidates(dedupeCandidates(candRes.data))
      toast.success(skipFiltering ? 'Filtering skipped. All sourced candidates are now visible.' : 'Filtering regenerated with updated criteria.')
    } catch {
      toast.error('Failed to regenerate filtering step')
    } finally {
      setRefiltering(false)
    }
  }

  const applyPreset = (preset: 'top_talent' | 'balanced' | 'broad') => {
    if (preset === 'top_talent') {
      setMinScore('7')
      setMinExperience('3')
      setStrictSkillMatch(true)
      return
    }
    if (preset === 'balanced') {
      setMinScore('5.5')
      setMinExperience('1')
      setStrictSkillMatch(false)
      return
    }
    setMinScore('0')
    setMinExperience('0')
    setMaxExperience('')
    setStrictSkillMatch(false)
    setRequiredSkills([])
  }

  const handleDecision = useCallback(async (candidateId: number, decision: string) => {
    try {
      await candidateApi.setDecision(candidateId, decision)
      setCandidates((prev) =>
        prev.map((c) => c.id === candidateId
          ? { ...c, recruiter_decision: decision, status: decision as Candidate['status'] }
          : c
        )
      )
    } catch {
      toast.error('Failed to save decision')
    }
  }, [])

  const handleScoreOverride = useCallback(async (candidateId: number, score: number) => {
    try {
      const existing = candidates.find((c) => c.id === candidateId)
      await candidateApi.setDecision(candidateId, existing?.recruiter_decision ?? 'filtered', score)
      setCandidates((prev) =>
        prev.map((c) => c.id === candidateId ? { ...c, recruiter_score_override: score } : c)
      )
      toast.success(`Score overridden to ${score}`)
    } catch {
      toast.error('Failed to update score')
    }
  }, [candidates])

  const handleRescore = useCallback(async (candidateId: number) => {
    try {
      const updated = await candidateApi.rescore(candidateId)
      setCandidates((prev) =>
        prev.map((c) => c.id === candidateId ? updated.data : c)
      )
      toast.success('AI score refreshed')
    } catch {
      toast.error('Rescore failed — check backend logs')
    }
  }, [])

  const handleSaveNotes = useCallback(async (candidateId: number, notes: string) => {
    try {
      const existing = candidates.find((c) => c.id === candidateId)
      await candidateApi.setDecision(candidateId, existing?.recruiter_decision ?? 'filtered', undefined, notes)
      setCandidates((prev) =>
        prev.map((c) => c.id === candidateId ? { ...c, recruiter_notes: notes } : c)
      )
      toast.success('Notes saved')
    } catch {
      toast.error('Failed to save notes')
    }
  }, [candidates])

  const bulkApprove = async () => {
    const ids = candidates
      .filter((c) => c.status !== 'rejected' && c.recruiter_decision !== 'rejected' && c.recruiter_decision !== 'approved')
      .map((c) => c.id)
    if (!ids.length) { toast('All candidates already decided'); return }
    await candidateApi.bulkDecision(ids, 'approved')
    setCandidates((prev) =>
      prev.map((c) => ids.includes(c.id) ? { ...c, recruiter_decision: 'approved', status: 'approved' } : c)
    )
    toast.success(`${ids.length} candidates approved`)
  }

  const bulkRejectAll = async () => {
    setBulkRejectingAll(true)
    const ids = candidates.map((c) => c.id)
    try {
      await candidateApi.bulkDecision(ids, 'rejected')
      setCandidates((prev) =>
        prev.map((c) => ({ ...c, recruiter_decision: 'rejected', status: 'rejected' as Candidate['status'] }))
      )
      toast.success('All candidates rejected')
    } catch {
      toast.error('Failed to reject all')
    } finally {
      setBulkRejectingAll(false)
    }
  }

  const handleExportPDF = async () => {
    setExporting(true)
    try {
      await exportCandidateProfiles(filtered, '', 'Candidate Shortlist')
      toast.success('PDF exported successfully')
    } finally {
      setExporting(false)
    }
  }

  const handleResume = async () => {
    if (!runId) return
    const approvedCount = candidates.filter((c) => c.recruiter_decision === 'approved').length
    if (approvedCount === 0) {
      toast.error('Approve at least one candidate before continuing')
      return
    }
    setResuming(true)
    try {
      // Check if emails already exist — if so, skip straight to the email review page
      // (the backend resume() is also idempotent, but this saves a round-trip)
      const { outreachApi } = await import('@/api')
      const emailsRes = await outreachApi.listForRun(Number(runId))
      if (emailsRes.data.length > 0) {
        toast.success('Emails already generated — navigating to email review')
        navigate(`/workflows/runs/${runId}/emails`)
        return
      }

      await workflowApi.resumeRun(Number(runId), 'shortlist_review', 'approve')
      toast.success(`Pipeline resumed — generating emails for ${approvedCount} candidates...`)
      navigate(`/workflows/runs/${runId}/emails`)
    } catch {
      toast.error('Failed to resume pipeline')
    } finally {
      setResuming(false)
    }
  }

  const handleRegenerateRun = async () => {
    if (!runId) return
    setRegeneratingRun(true)
    try {
      await workflowApi.regenerateRun(Number(runId))
      toast.success('Run regeneration started with updated criteria')
      setTimeout(() => window.location.reload(), 1200)
    } catch {
      toast.error('Failed to regenerate this run')
    } finally {
      setRegeneratingRun(false)
    }
  }

  // Filtering
  const filtered = candidates.filter((c) => {
    const matchTab =
      tab === 'all' ||
      (tab === 'pending' && !c.recruiter_decision) ||
      (tab === 'approved' && c.recruiter_decision === 'approved') ||
      (tab === 'rejected' && c.recruiter_decision === 'rejected') ||
      (tab === 'flagged' && c.recruiter_decision === 'flagged')

    const matchSearch = !search ||
      c.full_name.toLowerCase().includes(search.toLowerCase()) ||
      c.headline?.toLowerCase().includes(search.toLowerCase()) ||
      c.skills.some((s) => s.toLowerCase().includes(search.toLowerCase()))

    return matchTab && matchSearch
  })
  const visibleCandidates = [...filtered].sort((a, b) => {
    if (sortMode === 'name_asc') return a.full_name.localeCompare(b.full_name)
    const scoreA = a.recruiter_score_override ?? a.ai_score ?? -1
    const scoreB = b.recruiter_score_override ?? b.ai_score ?? -1
    if (sortMode === 'score_asc') return scoreA - scoreB
    return scoreB - scoreA
  })

  const approvedCount = candidates.filter((c) => c.recruiter_decision === 'approved').length
  const rejectedCount = candidates.filter((c) => c.recruiter_decision === 'rejected').length
  const flaggedCount = candidates.filter((c) => c.recruiter_decision === 'flagged').length
  const pendingCount = candidates.filter((c) => !c.recruiter_decision).length

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 gap-3 text-slate-500">
        <Loader2 className="h-5 w-5 animate-spin" />
        Loading candidates...
      </div>
    )
  }

  const TABS: { key: FilterTab; label: string; count: number; color: string }[] = [
    { key: 'all', label: 'All', count: candidates.length, color: 'text-slate-700' },
    { key: 'pending', label: 'Pending', count: pendingCount, color: 'text-amber-600' },
    { key: 'approved', label: 'Approved', count: approvedCount, color: 'text-emerald-600' },
    { key: 'rejected', label: 'Rejected', count: rejectedCount, color: 'text-red-600' },
    { key: 'flagged', label: 'Flagged', count: flaggedCount, color: 'text-amber-700' },
  ]

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-6 apptware-fade-up">
      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-3">
          <button onClick={() => navigate(-1)} className="text-slate-400 hover:text-slate-700 cursor-pointer">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Shortlist Review</h1>
            <p className="text-slate-500 text-sm">
              Run #{runId} · Checkpoint 1 of 2 · {candidates.length} candidates after filtering
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap lg:justify-end">
          {workflowId && (
            <Button variant="outline" size="sm" onClick={() => navigate(`/workflows/${workflowId}/edit`)}>
              <Pencil className="h-4 w-4" />
              Edit Workflow
            </Button>
          )}
          <Button variant="outline" size="sm" loading={regeneratingRun} onClick={handleRegenerateRun}>
            <Sparkles className="h-4 w-4" />
            Regenerate This Run
          </Button>
          <Button variant="outline" size="sm" loading={exporting} onClick={handleExportPDF}>
            <FileDown className="h-4 w-4" />
            Export PDF
          </Button>
          <Button variant="outline" size="sm" onClick={bulkApprove}>
            <CheckCheck className="h-4 w-4" />
            Approve All
          </Button>
          <Button variant="danger" size="sm" loading={bulkRejectingAll} onClick={bulkRejectAll}>
            <ThumbsDown className="h-4 w-4" />
            Reject All
          </Button>
          <Button onClick={handleResume} loading={resuming} variant="success" className="gap-2">
            <CheckCircle2 className="h-4 w-4" />
            Continue Pipeline ({approvedCount})
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Total', value: candidates.length, color: 'text-slate-700', bg: 'bg-slate-50' },
          { label: 'Approved', value: approvedCount, color: 'text-emerald-600', bg: 'bg-emerald-50' },
          { label: 'Rejected', value: rejectedCount, color: 'text-red-600', bg: 'bg-red-50' },
          { label: 'Pending', value: pendingCount, color: 'text-amber-600', bg: 'bg-amber-50' },
        ].map(({ label, value, color, bg }) => (
          <div key={label} className={`rounded-xl border border-slate-700/80 p-4 text-center ${bg} backdrop-blur-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md`}>
            <p className={`text-2xl font-bold ${color}`}>{value}</p>
            <p className="text-xs text-slate-500 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* Warning if no approved and pending is 0 */}
      {pendingCount === 0 && approvedCount === 0 && candidates.length > 0 && (
        <div className="flex items-center gap-3 rounded-xl bg-amber-50 border border-amber-200 px-5 py-4">
          <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0" />
          <p className="text-sm text-amber-800">All candidates are rejected. Approve at least one to continue the pipeline.</p>
        </div>
      )}

      {showingSourcedPreview && (
        <div className="flex items-center gap-3 rounded-xl border border-blue-700/60 bg-blue-950/35 px-5 py-4">
          {(runStatus === 'running' || runStatus === 'pending') ? (
            <Loader2 className="h-4 w-4 animate-spin text-blue-300 shrink-0" />
          ) : (
            <Info className="h-4 w-4 text-blue-300 shrink-0" />
          )}
          <p className="text-sm text-blue-200">
            {(runStatus === 'running' || runStatus === 'pending')
              ? 'Showing sourced candidates temporarily while filtering completes.'
              : 'Showing sourced candidates because filtering scores are not available for this run yet.'}
            {runStatus ? ` Current run status: ${runStatus}` : ''}
            {currentStep ? ` (${currentStep})` : ''}
          </p>
        </div>
      )}

      {/* Search + Tab filters */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="relative w-full md:flex-1 md:max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, skill..."
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="flex rounded-lg border border-slate-200 overflow-x-auto bg-white apptware-hide-scrollbar">
          {TABS.map(({ key, label, count }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={clsx(
                'px-3 py-2 text-xs font-medium transition-colors cursor-pointer',
                tab === key
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-600 hover:bg-slate-50',
              )}
            >
              {label}
              <span className={clsx('ml-1 rounded-full px-1.5 py-0.5 text-xs', tab === key ? 'bg-blue-500 text-white' : 'bg-slate-100 text-slate-600')}>
                {count}
              </span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center gap-2 rounded-lg border border-slate-700/70 bg-slate-900/60 px-2.5 py-2 transition-colors hover:border-blue-600/60">
            <SlidersHorizontal className="h-4 w-4 text-slate-400" />
            <select
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value as SortMode)}
              className="border-none bg-transparent text-xs text-slate-200 focus:outline-none"
            >
              <option value="score_desc">Score: high to low</option>
              <option value="score_asc">Score: low to high</option>
              <option value="name_asc">Name: A to Z</option>
            </select>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearch('')
              setTab('all')
              setSortMode('score_desc')
            }}
          >
            Reset View
          </Button>
        </div>
      </div>

      {/* Refilter controls */}
      <div className="rounded-2xl border border-slate-700/80 bg-slate-900/70 p-4 space-y-3 backdrop-blur-sm transition-all duration-300 hover:border-blue-700/70">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-semibold text-slate-100">Refilter This Run</p>
          <p className="text-xs text-slate-400">Update filtering criteria and regenerate only the filtering step for this run.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => applyPreset('top_talent')}>
            Top Talent
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => applyPreset('balanced')}>
            Balanced
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => applyPreset('broad')}>
            Broad Search
          </Button>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-300">Min AI score</label>
            <input
              type="number"
              min="0"
              max="10"
              step="0.5"
              value={minScore}
              onChange={(e) => setMinScore(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-300">Min experience</label>
            <input
              type="number"
              min="0"
              step="0.5"
              value={minExperience}
              onChange={(e) => setMinExperience(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-300">Max experience</label>
            <input
              type="number"
              min="0"
              step="0.5"
              value={maxExperience}
              onChange={(e) => setMaxExperience(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="optional"
            />
          </div>
          <label className="inline-flex items-center gap-2 self-end text-sm text-slate-300">
            <input
              type="checkbox"
              checked={strictSkillMatch}
              onChange={(e) => setStrictSkillMatch(e.target.checked)}
              className="rounded border-slate-300"
            />
            Strict skill match
          </label>
        </div>
        <div className="flex flex-col gap-2">
          <label className="text-xs font-medium text-slate-300">Must-have skills</label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={requiredSkillInput}
              onChange={(e) => setRequiredSkillInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addRequiredSkill())}
              placeholder="e.g. FastAPI"
              className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
            <Button type="button" variant="outline" size="sm" onClick={addRequiredSkill}>Add skill</Button>
          </div>
          {requiredSkills.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {requiredSkills.map((skill) => (
                <span key={skill} className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs text-blue-700">
                  {skill}
                  <button type="button" onClick={() => removeRequiredSkill(skill)} className="text-blue-600 hover:text-blue-800 cursor-pointer">
                    <XCircle className="h-3.5 w-3.5" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <label className="inline-flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={skipFiltering}
              onChange={(e) => setSkipFiltering(e.target.checked)}
              className="rounded border-slate-300"
            />
            Skip filtering and show all sourced candidates
          </label>
          <Button variant="outline" size="sm" loading={refiltering} onClick={handleRefilter}>
            <RefreshCw className="h-4 w-4" />
            Apply & Refilter
          </Button>
        </div>
      </div>

      {/* Candidate list */}
      {filtered.length === 0 ? (
        <div className="py-16 text-center text-slate-400">
          <Users className="h-10 w-10 mx-auto mb-3 text-slate-300" />
          <p className="text-sm">
            {candidates.length === 0
              ? 'No filtered candidates found yet. Run or regenerate filtering to populate shortlist.'
              : 'No candidates match the current filter.'}
          </p>
          {candidates.length === 0 && (
            <Button variant="outline" size="sm" className="mt-3" onClick={() => navigate(-1)}>
              Back to workflow
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {visibleCandidates.map((c) => (
            <CandidateCard
              key={c.id}
              candidate={c}
              onDecision={handleDecision}
              onScoreOverride={handleScoreOverride}
              onRescore={handleRescore}
              onSaveNotes={handleSaveNotes}
            />
          ))}
        </div>
      )}

      {/* Bottom CTA */}
      {filtered.length > 0 && (
        <div className="sticky bottom-4 flex justify-center">
          <div className="bg-slate-900/85 border border-slate-700/80 shadow-lg rounded-2xl px-4 py-3 flex flex-col items-start gap-3 sm:flex-row sm:items-center backdrop-blur-sm">
            <span className="text-sm text-slate-600">
              <strong>{approvedCount}</strong> approved · <strong>{pendingCount}</strong> still pending
            </span>
            <Button onClick={handleResume} loading={resuming} variant="success" disabled={approvedCount === 0} className="w-full sm:w-auto">
              <CheckCircle2 className="h-4 w-4" />
              Continue to Email Outreach
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
