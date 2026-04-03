import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Workflow as WorkflowIcon, ChevronRight } from 'lucide-react'
import { workflowApi } from '@/api'
import type { Workflow } from '@/types'
import Button from '@/components/ui/Button'
import Card, { CardBody } from '@/components/ui/Card'
import { formatDistanceToNow } from 'date-fns'

export default function Workflows() {
  const [workflows, setWorkflows] = useState<Workflow[]>([])
  const navigate = useNavigate()

  useEffect(() => {
    workflowApi.list().then((r) => setWorkflows(r.data))
  }, [])

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Workflows</h1>
          <p className="text-slate-500 text-sm mt-0.5">Manage your recruitment pipelines</p>
        </div>
        <Button onClick={() => navigate('/workflows/new')} className="w-full sm:w-auto">
          <Plus className="h-4 w-4" /> New Workflow
        </Button>
      </div>

      {workflows.length === 0 ? (
        <div className="text-center py-20">
          <WorkflowIcon className="h-12 w-12 text-slate-300 mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-slate-600 mb-2">No workflows yet</h2>
          <p className="text-slate-400 text-sm mb-6">Create your first AI-powered recruitment pipeline</p>
          <Button onClick={() => navigate('/workflows/new')}>Create Workflow</Button>
        </div>
      ) : (
        <div className="space-y-3">
          {workflows.map((wf) => (
            <Card key={wf.id} hover onClick={() => navigate(`/workflows/${wf.id}`)}>
              <CardBody className="flex items-center gap-4">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-100">
                  <WorkflowIcon className="h-5 w-5 text-blue-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-slate-900">{wf.name}</p>
                  <p className="text-sm text-slate-500 mt-0.5">
                    {wf.job_title} · {wf.location} · {wf.seniority}
                  </p>
                  {wf.keywords.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {wf.keywords.slice(0, 4).map((k) => (
                        <span key={k} className="text-xs bg-slate-100 text-slate-600 rounded-full px-2 py-0.5">{k}</span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs text-slate-400">
                    {formatDistanceToNow(new Date(wf.created_at), { addSuffix: true })}
                  </p>
                  <ChevronRight className="h-4 w-4 text-slate-400 mt-1 ml-auto" />
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
