import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Users, Mail, Calendar, TrendingUp, Play, Plus,
  AlertCircle, CheckCircle2, Clock, Zap,
} from 'lucide-react'
import { analyticsApi, workflowApi } from '@/api'
import type { DashboardAnalytics, WorkflowRun, Workflow } from '@/types'
import Button from '@/components/ui/Button'
import Card, { CardBody, CardHeader } from '@/components/ui/Card'
import Badge, { statusBadge } from '@/components/ui/Badge'
import { formatDistanceToNow } from 'date-fns'

function StatCard({ icon: Icon, label, value, sub, color }: {
  icon: React.ElementType; label: string; value: string | number; sub?: string; color: string
}) {
  return (
    <Card>
      <CardBody className="flex items-center gap-4">
        <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${color}`}>
          <Icon className="h-6 w-6 text-white" />
        </div>
        <div>
          <p className="text-2xl font-bold text-slate-900">{value}</p>
          <p className="text-sm text-slate-500">{label}</p>
          {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
        </div>
      </CardBody>
    </Card>
  )
}

function RunStatusIcon({ status }: { status: string }) {
  if (status === 'running') return <div className="h-2.5 w-2.5 rounded-full bg-blue-500 animate-pulse" />
  if (status === 'waiting_review') return <AlertCircle className="h-4 w-4 text-amber-500" />
  if (status === 'completed') return <CheckCircle2 className="h-4 w-4 text-emerald-500" />
  if (status === 'failed') return <AlertCircle className="h-4 w-4 text-red-500" />
  return <Clock className="h-4 w-4 text-slate-400" />
}

const STEP_LABELS: Record<string, string> = {
  sourcing: 'Sourcing candidates',
  filtering: 'Filtering & scoring',
  checkpoint_1: 'Awaiting shortlist review',
  outreach: 'Generating emails',
  checkpoint_2: 'Awaiting email review',
  scheduling: 'Scheduling interviews',
  completed: 'Pipeline complete',
}

export default function Dashboard() {
  const [analytics, setAnalytics] = useState<DashboardAnalytics | null>(null)
  const [workflows, setWorkflows] = useState<Workflow[]>([])
  const [allRuns, setAllRuns] = useState<WorkflowRun[]>([])
  const navigate = useNavigate()

  useEffect(() => {
    analyticsApi.dashboard().then((r) => setAnalytics(r.data))
    workflowApi.list().then(async (r) => {
      setWorkflows(r.data)
      const runs: WorkflowRun[] = []
      for (const wf of r.data.slice(0, 5)) {
        const runRes = await workflowApi.listRuns(wf.id)
        runs.push(...runRes.data.slice(0, 3))
      }
      setAllRuns(runs.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()))
    })
  }, [])

  const pendingReviews = allRuns.filter((r) => r.status === 'waiting_review')

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Recruitment Dashboard</h1>
          <p className="text-slate-500 mt-0.5">AI-powered pipeline overview</p>
        </div>
        <Button onClick={() => navigate('/workflows/new')} className="gap-2 w-full sm:w-auto">
          <Plus className="h-4 w-4" />
          New Workflow
        </Button>
      </div>

      {/* Pending reviews banner */}
      {pendingReviews.length > 0 && (
        <div className="flex flex-col items-start gap-3 rounded-xl bg-amber-50 border border-amber-200 px-5 py-4 sm:flex-row sm:items-center">
          <AlertCircle className="h-5 w-5 text-amber-600 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-amber-900">
              {pendingReviews.length} workflow run{pendingReviews.length > 1 ? 's' : ''} waiting for your review
            </p>
            <p className="text-xs text-amber-700 mt-0.5">Approve or reject candidates to continue the pipeline</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => navigate('/workflows')}>
            Review now
          </Button>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Users} label="Candidates Sourced" value={analytics?.total_sourced ?? '—'} color="bg-blue-500" />
        <StatCard icon={Mail} label="Emails Sent" value={analytics?.emails_sent ?? '—'} sub={`${analytics?.reply_rate ?? 0}% reply rate`} color="bg-purple-500" />
        <StatCard icon={Calendar} label="Interviews Scheduled" value={analytics?.total_scheduled ?? '—'} color="bg-emerald-500" />
        <StatCard icon={TrendingUp} label="Conversion Rate" value={`${analytics?.conversion_to_interview ?? 0}%`} sub="sourced → interview" color="bg-orange-500" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Active Workflows */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-slate-900 flex items-center gap-2">
                <Zap className="h-4 w-4 text-blue-500" />
                Workflows
              </h2>
              <Button variant="ghost" size="sm" onClick={() => navigate('/workflows')}>View all</Button>
            </div>
          </CardHeader>
          <CardBody className="p-0">
            {workflows.length === 0 ? (
              <div className="py-12 text-center text-slate-400">
                <p className="text-sm">No workflows yet.</p>
                <Button variant="ghost" size="sm" className="mt-2" onClick={() => navigate('/workflows/new')}>
                  Create your first workflow
                </Button>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {workflows.slice(0, 5).map((wf) => (
                  <div
                    key={wf.id}
                    className="flex items-center gap-4 px-6 py-4 hover:bg-slate-50 cursor-pointer transition-colors"
                    onClick={() => navigate(`/workflows/${wf.id}`)}
                  >
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-100">
                      <Zap className="h-4 w-4 text-blue-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-900 truncate">{wf.name}</p>
                      <p className="text-xs text-slate-500 truncate">
                        {wf.job_title} · {wf.location}
                      </p>
                    </div>
                    <p className="text-xs text-slate-400">
                      {formatDistanceToNow(new Date(wf.created_at), { addSuffix: true })}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>

        {/* Recent Runs */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-slate-900 flex items-center gap-2">
                <Play className="h-4 w-4 text-emerald-500" />
                Recent Pipeline Runs
              </h2>
            </div>
          </CardHeader>
          <CardBody className="p-0">
            {allRuns.length === 0 ? (
              <div className="py-12 text-center text-slate-400 text-sm">No runs yet</div>
            ) : (
              <div className="divide-y divide-slate-100">
                {allRuns.slice(0, 6).map((run) => (
                  <div
                    key={run.id}
                    className="flex items-center gap-3 px-6 py-3.5 hover:bg-slate-50 cursor-pointer transition-colors"
                    onClick={() => navigate(`/workflows/${run.workflow_id}`)}
                  >
                    <RunStatusIcon status={run.status} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-slate-700 truncate">
                        Run #{run.id} · {STEP_LABELS[run.current_step ?? ''] ?? run.current_step ?? 'Pending'}
                      </p>
                      <p className="text-xs text-slate-400">
                        {formatDistanceToNow(new Date(run.created_at), { addSuffix: true })}
                      </p>
                    </div>
                    <Badge variant={statusBadge(run.status)}>{run.status.replace('_', ' ')}</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  )
}
