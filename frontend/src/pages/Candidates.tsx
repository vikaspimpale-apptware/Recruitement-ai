import { useEffect, useState } from 'react'
import { Search, Users, ExternalLink } from 'lucide-react'
import { candidateApi, workflowApi } from '@/api'
import type { Candidate } from '@/types'
import Card, { CardBody } from '@/components/ui/Card'
import Badge, { statusBadge } from '@/components/ui/Badge'
import ScoreRing from '@/components/ui/ScoreRing'

export default function Candidates() {
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  useEffect(() => {
    workflowApi.list().then(async (wfRes) => {
      const allCands: Candidate[] = []
      for (const wf of wfRes.data.slice(0, 10)) {
        const runRes = await workflowApi.listRuns(wf.id)
        for (const run of runRes.data.slice(0, 3)) {
          const candRes = await candidateApi.listForRun(run.id)
          allCands.push(...candRes.data)
        }
      }
      setCandidates(allCands)
    })
  }, [])

  const filtered = candidates.filter((c) => {
    const matchSearch =
      !search ||
      c.full_name.toLowerCase().includes(search.toLowerCase()) ||
      c.headline?.toLowerCase().includes(search.toLowerCase()) ||
      c.skills.some((s) => s.toLowerCase().includes(search.toLowerCase()))
    const matchStatus = !statusFilter || c.status === statusFilter
    return matchSearch && matchStatus
  })

  const statuses = ['sourced', 'filtered', 'approved', 'rejected', 'contacted', 'scheduled']

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">All Candidates</h1>
        <p className="text-slate-500 text-sm mt-0.5">{candidates.length} total across all workflows</p>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative w-full sm:flex-1 sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, headline, or skill..."
            className="w-full pl-10 pr-4 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="w-full sm:w-auto rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All statuses</option>
          {statuses.map((s) => (
            <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="py-16 text-center">
          <Users className="h-10 w-10 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-400 text-sm">
            {candidates.length === 0 ? 'No candidates yet. Launch a workflow to source candidates.' : 'No candidates match your filters.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((c) => (
            <Card key={c.id} hover>
              <CardBody className="flex items-center gap-4">
                <ScoreRing score={c.ai_score} override={c.recruiter_score_override} size="sm" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-slate-900">{c.full_name}</p>
                    <Badge variant={statusBadge(c.status)}>{c.status}</Badge>
                  </div>
                  <p className="text-sm text-slate-500 truncate mt-0.5">{c.headline}</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-xs text-slate-500">
                    {c.current_company && <span>Company: {c.current_company}</span>}
                    {c.email && <span>Email: {c.email}</span>}
                    {c.phone && <span>Phone: {c.phone}</span>}
                  </div>
                  {c.profile_description && (
                    <p className="text-xs text-slate-500 mt-1 line-clamp-2">{c.profile_description}</p>
                  )}
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {c.skills.slice(0, 5).map((s) => (
                      <span key={s} className="text-xs bg-slate-100 text-slate-600 rounded-full px-2 py-0.5">{s}</span>
                    ))}
                  </div>
                </div>
                <div className="text-right shrink-0 space-y-1">
                  <p className="text-xs text-slate-500">{c.location}</p>
                  <p className="text-xs text-slate-400">{c.experience_years?.toFixed(1)} yrs</p>
                  {c.linkedin_url && (
                    <a href={c.linkedin_url} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline">
                      LinkedIn <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
