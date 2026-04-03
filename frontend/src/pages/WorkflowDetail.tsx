import { useEffect, useState, useCallback, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Play, RefreshCw, CheckCircle2, Clock,
  AlertTriangle, XCircle, ChevronRight, Loader2,
  Trash2, RotateCcw, AlertCircle, FileDown, Pencil, Sparkles,
} from 'lucide-react'
import { workflowApi, outreachApi, candidateApi } from '@/api'
import type { Workflow, WorkflowRun } from '@/types'
import { exportCandidateProfiles } from '@/utils/exportCandidatePDF'
import Button from '@/components/ui/Button'
import Card, { CardBody, CardHeader } from '@/components/ui/Card'
import Badge, { statusBadge } from '@/components/ui/Badge'
import { formatDistanceToNow, format } from 'date-fns'
import toast from 'react-hot-toast'
import { clsx } from 'clsx'

const STEP_LABELS: Record<string, string> = {
  sourcing: 'Sourcing',
  filtering: 'Filtering',
  checkpoint_1: 'Shortlist Review',
  outreach: 'Email Outreach',
  checkpoint_2: 'Email Review',
  scheduling: 'Scheduling',
  completed: 'Complete',
}

const STEP_CONFIG_LABELS: Record<string, string> = {
  sourcing: 'Sourcing',
  filtering: 'Filtering & Scoring',
  outreach: 'Email Outreach',
  scheduling: 'Scheduling',
}

function StepIcon({ status }: { status: 'done' | 'active' | 'pending' | 'waiting' | 'failed' }) {
  if (status === 'done') {
    return (
      <div className="h-10 w-10 rounded-2xl border border-emerald-500/40 bg-emerald-900/25 flex items-center justify-center shadow-sm">
        <CheckCircle2 className="h-5 w-5 text-emerald-400" />
      </div>
    )
  }
  if (status === 'active') {
    return (
      <div className="h-10 w-10 rounded-2xl border border-blue-500/50 bg-blue-900/25 flex items-center justify-center shadow-sm apptware-glow">
        <Loader2 className="h-5 w-5 text-blue-300 animate-spin" />
      </div>
    )
  }
  if (status === 'waiting') {
    return (
      <div className="h-10 w-10 rounded-2xl border border-amber-500/45 bg-amber-900/20 flex items-center justify-center shadow-sm">
        <AlertTriangle className="h-5 w-5 text-amber-300" />
      </div>
    )
  }
  if (status === 'failed') {
    return (
      <div className="h-10 w-10 rounded-2xl border border-red-500/45 bg-red-900/25 flex items-center justify-center shadow-sm">
        <XCircle className="h-5 w-5 text-red-300" />
      </div>
    )
  }
  return (
    <div className="h-10 w-10 rounded-2xl border border-slate-700 bg-slate-900/60 flex items-center justify-center">
      <div className="h-2.5 w-2.5 rounded-full bg-slate-500" />
    </div>
  )
}

function getStepStatus(
  step: { key: string },
  timeline: { key: string; label: string }[],
  currentStep: string | null,
  runStatus: string,
): 'done' | 'active' | 'pending' | 'waiting' | 'failed' {
  if (runStatus === 'failed') return step.key === currentStep ? 'failed' : 'pending'
  if (!currentStep) return 'pending'
  const steps = timeline.map((s) => s.key)
  const currentIdx = steps.indexOf(currentStep)
  const stepIdx = steps.indexOf(step.key)

  if (stepIdx < currentIdx) return 'done'
  if (stepIdx === currentIdx) {
    if (runStatus === 'waiting_review') return 'waiting'
    if (runStatus === 'running') return 'active'
    if (runStatus === 'completed') return 'done'
  }
  return 'pending'
}

// ── Confirm dialog ────────────────────────────────────────────────────────────
function ConfirmDialog({
  message,
  onConfirm,
  onCancel,
}: {
  message: string
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full mx-4">
        <div className="flex items-start gap-3 mb-5">
          <div className="h-10 w-10 rounded-xl bg-red-100 flex items-center justify-center shrink-0">
            <AlertCircle className="h-5 w-5 text-red-600" />
          </div>
          <div>
            <p className="font-semibold text-slate-900 mb-1">Are you sure?</p>
            <p className="text-sm text-slate-500">{message}</p>
          </div>
        </div>
        <div className="flex gap-3 justify-end">
          <Button variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
          <Button variant="danger" size="sm" onClick={onConfirm}>Delete</Button>
        </div>
      </div>
    </div>
  )
}

// ── Run row in history list ───────────────────────────────────────────────────
function RunRow({
  run,
  onNavigate,
  onDelete,
  onRerun,
  onRegenerate,
  onExport,
  isExporting,
}: {
  run: WorkflowRun
  onNavigate: (run: WorkflowRun) => void
  onDelete: (run: WorkflowRun) => void
  onRerun: (run: WorkflowRun) => void
  onRegenerate: (run: WorkflowRun) => void
  onExport: (run: WorkflowRun) => void
  isExporting: boolean
}) {
  const [rerunning, setRerunning] = useState(false)

  const handleRerun = async (e: React.MouseEvent) => {
    e.stopPropagation()
    setRerunning(true)
    await onRerun(run)
    setRerunning(false)
  }

  return (
    <div
      className="flex flex-wrap items-center gap-3 px-4 py-4 sm:px-6 hover:bg-slate-50 transition-colors group"
    >
      <Badge variant={statusBadge(run.status)}>{run.status.replace('_', ' ')}</Badge>
      <div
        className="flex-1 min-w-0 cursor-pointer"
        onClick={() => onNavigate(run)}
      >
        <p className="text-sm font-medium text-slate-800">Run #{run.id}</p>
        <p className="text-xs text-slate-500">
          {run.current_step
            ? run.current_step.replace('_', ' ')
            : 'pending'}
          {' · '}
          {formatDistanceToNow(new Date(run.created_at), { addSuffix: true })}
        </p>
      </div>

      {/* Action buttons — visible on hover */}
      <div className="flex flex-wrap items-center gap-2 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
        <button
          title="Export candidate profiles to PDF"
          disabled={isExporting || run.status === 'pending'}
          onClick={(e) => { e.stopPropagation(); onExport(run) }}
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 hover:bg-blue-100 hover:text-blue-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
        >
          {isExporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />}
          Export
        </button>
        <button
          title="Regenerate this same run with current workflow settings"
          disabled={rerunning || run.status === 'running' || run.status === 'pending'}
          onClick={(e) => { e.stopPropagation(); onRegenerate(run) }}
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 hover:bg-violet-100 hover:text-violet-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
        >
          <Sparkles className="h-3.5 w-3.5" />
          Regenerate
        </button>
        <button
          title="Re-run with same settings"
          disabled={rerunning || run.status === 'running' || run.status === 'pending'}
          onClick={handleRerun}
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 hover:bg-blue-100 hover:text-blue-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
        >
          {rerunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
          Re-run
        </button>
        <button
          title="Delete this run"
          disabled={run.status === 'running' || run.status === 'pending'}
          onClick={(e) => { e.stopPropagation(); onDelete(run) }}
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 hover:bg-red-100 hover:text-red-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete
        </button>
      </div>

      <ChevronRight
        className="h-4 w-4 text-slate-400 cursor-pointer shrink-0"
        onClick={() => onNavigate(run)}
      />
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function WorkflowDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [workflow, setWorkflow] = useState<Workflow | null>(null)
  const [runs, setRuns] = useState<WorkflowRun[]>([])
  const [launching, setLaunching] = useState(false)
  const [deletingWorkflow, setDeletingWorkflow] = useState(false)
  const [confirmDeleteWorkflow, setConfirmDeleteWorkflow] = useState(false)
  const [confirmDeleteRun, setConfirmDeleteRun] = useState<WorkflowRun | null>(null)
  const [exportingRunId, setExportingRunId] = useState<number | null>(null)

  const load = useCallback(async () => {
    if (!id) return
    const [wfRes, runsRes] = await Promise.all([
      workflowApi.get(Number(id)),
      workflowApi.listRuns(Number(id)),
    ])
    setWorkflow(wfRes.data)
    setRuns(runsRes.data)
  }, [id])

  useEffect(() => {
    load()
    const interval = setInterval(load, 5000)
    return () => clearInterval(interval)
  }, [load])

  const launchRun = async () => {
    if (!id) return
    setLaunching(true)
    try {
      await workflowApi.launchRun(Number(id))
      toast.success('Pipeline launched!')
      await load()
    } catch {
      toast.error('Failed to launch pipeline')
    } finally {
      setLaunching(false)
    }
  }

  const handleDeleteWorkflow = async () => {
    if (!id) return
    setConfirmDeleteWorkflow(false)
    setDeletingWorkflow(true)
    try {
      await workflowApi.deleteWorkflow(Number(id))
      toast.success('Workflow deleted')
      navigate('/workflows')
    } catch {
      toast.error('Failed to delete workflow')
      setDeletingWorkflow(false)
    }
  }

  const handleDeleteRun = async (run: WorkflowRun) => {
    setConfirmDeleteRun(null)
    try {
      await workflowApi.deleteRun(run.id)
      setRuns((prev) => prev.filter((r) => r.id !== run.id))
      toast.success(`Run #${run.id} deleted`)
    } catch {
      toast.error('Failed to delete run')
    }
  }

  const handleExportRun = async (run: WorkflowRun) => {
    setExportingRunId(run.id)
    try {
      const res = await candidateApi.listForRun(run.id)
      if (!res.data.length) {
        toast.error('No candidates found for this run yet')
        return
      }
      const title = workflow ? `${workflow.name} — Candidates` : 'Candidate Profiles'
      const subtitle = workflow ? `${workflow.job_title}${workflow.location ? ', ' + workflow.location : ''}` : ''
      await exportCandidateProfiles(res.data, subtitle, title)
      toast.success(`Exported ${res.data.length} candidate profiles`)
    } catch {
      toast.error('Export failed')
    } finally {
      setExportingRunId(null)
    }
  }

  const handleRerun = async (run: WorkflowRun) => {
    try {
      const res = await workflowApi.rerun(run.id)
      toast.success(`New run #${res.data.id} launched with same settings`)
      await load()
    } catch {
      toast.error('Failed to start re-run')
    }
  }

  const handleRegenerate = async (run: WorkflowRun) => {
    try {
      await workflowApi.regenerateRun(run.id)
      toast.success(`Run #${run.id} regeneration started`)
      await load()
    } catch {
      toast.error('Failed to regenerate run')
    }
  }

  // Smart navigation: route to the correct review page based on current step
  const navigateToRun = (run: WorkflowRun) => {
    if (run.status === 'waiting_review') {
      if (run.current_step === 'checkpoint_1') {
        navigate(`/workflows/runs/${run.id}/review`)
      } else if (run.current_step === 'checkpoint_2') {
        navigate(`/workflows/runs/${run.id}/emails`)
      } else {
        navigate(`/workflows/runs/${run.id}/review`)
      }
    } else {
      navigate(`/workflows/runs/${run.id}/review`)
    }
  }

  const latestRun = runs[0]
  const timeline = useMemo(() => {
    const byName = new Map((workflow?.step_configs ?? []).map((s) => [s.step_name, s]))
    const filteringEnabled = byName.get('filtering')?.enabled ?? true
    const outreachEnabled = byName.get('outreach')?.enabled ?? true
    const schedulingEnabled = byName.get('scheduling')?.enabled ?? true

    const steps: { key: string; label: string }[] = [{ key: 'sourcing', label: STEP_LABELS.sourcing }]
    if (filteringEnabled) steps.push({ key: 'filtering', label: STEP_LABELS.filtering })
    steps.push({ key: 'checkpoint_1', label: STEP_LABELS.checkpoint_1 })
    if (outreachEnabled) {
      steps.push({ key: 'outreach', label: STEP_LABELS.outreach })
      steps.push({ key: 'checkpoint_2', label: STEP_LABELS.checkpoint_2 })
      if (schedulingEnabled) steps.push({ key: 'scheduling', label: STEP_LABELS.scheduling })
    }
    steps.push({ key: 'completed', label: STEP_LABELS.completed })
    return steps
  }, [workflow?.step_configs])

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6 apptware-fade-up">
      {/* Confirm dialogs */}
      {confirmDeleteWorkflow && (
        <ConfirmDialog
          message={`This will permanently delete the workflow "${workflow?.name}" and ALL its run history, candidates and emails. This cannot be undone.`}
          onConfirm={handleDeleteWorkflow}
          onCancel={() => setConfirmDeleteWorkflow(false)}
        />
      )}
      {confirmDeleteRun && (
        <ConfirmDialog
          message={`Delete Run #${confirmDeleteRun.id}? All candidates and emails for this run will be permanently removed.`}
          onConfirm={() => handleDeleteRun(confirmDeleteRun)}
          onCancel={() => setConfirmDeleteRun(null)}
        />
      )}

      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-3">
          <button onClick={() => navigate('/workflows')} className="text-slate-400 hover:text-slate-700 transition-colors cursor-pointer">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{workflow?.name ?? 'Loading...'}</h1>
            <p className="text-slate-500 text-sm">
              {workflow?.job_title} · {workflow?.location} · {workflow?.seniority}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!id}
            onClick={() => navigate(`/workflows/${id}/edit`)}
            title="Edit workflow criteria"
          >
            <Pencil className="h-4 w-4" />
            Edit
          </Button>
          <Button variant="outline" size="sm" onClick={load} title="Refresh">
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button
            variant="danger"
            size="sm"
            loading={deletingWorkflow}
            onClick={() => setConfirmDeleteWorkflow(true)}
            title="Delete this workflow"
          >
            <Trash2 className="h-4 w-4" />
            Delete Workflow
          </Button>
          <Button onClick={launchRun} loading={launching} className="gap-2">
            <Play className="h-4 w-4" />
            New Run
          </Button>
        </div>
      </div>

      {/* Step visibility */}
      {workflow && (
        <div className="rounded-2xl border border-slate-700/80 bg-slate-900/60 px-4 py-3 backdrop-blur-sm transition-all duration-300 hover:border-blue-700/60">
          <p className="text-xs uppercase tracking-wide text-slate-400">Workflow Steps Enabled</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {(workflow.step_configs ?? []).map((step) => (
              <span
                key={step.step_name}
                className={clsx(
                  'rounded-full border px-2.5 py-1 text-xs font-medium transition-all duration-200 hover:-translate-y-0.5',
                  step.enabled
                    ? 'border-emerald-700/70 bg-emerald-900/30 text-emerald-300'
                    : 'border-slate-700/80 bg-slate-800/70 text-slate-400 line-through',
                )}
              >
                {STEP_CONFIG_LABELS[step.step_name] ?? step.step_name}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Latest Run Live View */}
      {latestRun && (
        <Card>
          <CardHeader>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <h2 className="font-semibold text-slate-900">
                Latest Run
                <span className="ml-2 text-slate-400 text-sm font-normal">#{latestRun.id}</span>
              </h2>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={statusBadge(latestRun.status)}>
                  {latestRun.status.replace('_', ' ')}
                </Badge>

                {/* Action depends on where in the pipeline we are */}
                {latestRun.status === 'waiting_review' && latestRun.current_step === 'checkpoint_1' && (
                  <Button size="sm" variant="success" onClick={() => navigate(`/workflows/runs/${latestRun.id}/review`)}>
                    Review Shortlist <ChevronRight className="h-4 w-4" />
                  </Button>
                )}
                {latestRun.status === 'waiting_review' && latestRun.current_step === 'checkpoint_2' && (
                  <Button size="sm" variant="success" onClick={() => navigate(`/workflows/runs/${latestRun.id}/emails`)}>
                    Review Emails <ChevronRight className="h-4 w-4" />
                  </Button>
                )}
                {(latestRun.status === 'waiting_review' || latestRun.status === 'completed' || latestRun.status === 'failed') && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleRegenerate(latestRun)}
                  >
                    <Sparkles className="h-4 w-4" />
                    Regenerate
                  </Button>
                )}
                {(latestRun.status === 'completed' || latestRun.status === 'failed') && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleRerun(latestRun)}
                  >
                    <RotateCcw className="h-4 w-4" />
                    Re-run
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  loading={exportingRunId === latestRun.id}
                  disabled={latestRun.status === 'pending'}
                  onClick={() => handleExportRun(latestRun)}
                  title="Export candidate profiles to PDF"
                >
                  <FileDown className="h-4 w-4" />
                  Export PDF
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardBody>
            {/* Step timeline */}
            <div className="flex items-start gap-0 overflow-x-auto pb-2 apptware-hide-scrollbar">
              {timeline.map((step, idx) => {
                const stepStatus = getStepStatus(step, timeline, latestRun.current_step, latestRun.status)
                const isLast = idx === timeline.length - 1
                return (
                  <div key={step.key} className="flex items-center flex-shrink-0 apptware-fade-up">
                    <div
                      className={clsx(
                        'flex flex-col items-center gap-2 min-w-[110px] rounded-2xl px-2 py-2 transition-all duration-300',
                        stepStatus === 'active' && 'apptware-float bg-blue-950/30 border border-blue-700/40',
                        stepStatus === 'done' && 'bg-emerald-950/20 border border-emerald-700/30',
                        stepStatus === 'waiting' && 'bg-amber-950/20 border border-amber-700/30',
                      )}
                    >
                      <StepIcon status={stepStatus} />
                      <p className={clsx(
                        'text-xs text-center font-semibold tracking-wide',
                        stepStatus === 'done' ? 'text-emerald-600' :
                        stepStatus === 'active' ? 'text-blue-600' :
                        stepStatus === 'waiting' ? 'text-amber-600' :
                        stepStatus === 'failed' ? 'text-red-600' :
                        'text-slate-400',
                      )}>
                        {step.label}
                      </p>
                    </div>
                    {!isLast && (
                      <div
                        className={clsx(
                          'h-1 w-9 rounded-full mt-[-22px] transition-all duration-500',
                          stepStatus === 'done' ? 'bg-emerald-400' : 'bg-slate-700/70',
                          stepStatus === 'active' && 'apptware-shimmer',
                        )}
                      />
                    )}
                  </div>
                )
              })}
            </div>

            {latestRun.error_message && (
              <div className="mt-4 flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 p-3">
                <XCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-red-800">Run failed</p>
                  <p className="text-xs text-red-600 mt-0.5">{latestRun.error_message}</p>
                </div>
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-slate-500">
              <span className="flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" />
                Started {latestRun.started_at
                  ? formatDistanceToNow(new Date(latestRun.started_at), { addSuffix: true })
                  : 'not yet'}
              </span>
              {latestRun.completed_at && (
                <span>Completed {format(new Date(latestRun.completed_at), 'MMM d, h:mm a')}</span>
              )}
            </div>
          </CardBody>
        </Card>
      )}

      {/* Run History */}
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="font-semibold text-slate-900">
              Run History
              <span className="ml-2 text-xs text-slate-400 font-normal">{runs.length} run{runs.length !== 1 ? 's' : ''}</span>
            </h2>
            <p className="text-xs text-slate-400">Hover a row for delete / re-run options</p>
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {runs.length === 0 ? (
            <div className="py-12 text-center text-slate-400 text-sm">
              No runs yet. Click <strong>New Run</strong> to launch your first pipeline.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {runs.map((run) => (
                <RunRow
                  key={run.id}
                  run={run}
                  onNavigate={navigateToRun}
                  onDelete={(r) => setConfirmDeleteRun(r)}
                  onRerun={handleRerun}
                  onRegenerate={handleRegenerate}
                  onExport={handleExportRun}
                  isExporting={exportingRunId === run.id}
                />
              ))}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
