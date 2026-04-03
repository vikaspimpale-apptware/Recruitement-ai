import { useEffect, useState } from 'react'
import { analyticsApi } from '@/api'
import type { DashboardAnalytics, PipelineFunnelItem } from '@/types'
import Card, { CardBody, CardHeader } from '@/components/ui/Card'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, FunnelChart, Funnel, Cell } from 'recharts'

const FUNNEL_COLORS = ['#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899']

export default function Analytics() {
  const [analytics, setAnalytics] = useState<DashboardAnalytics | null>(null)
  const [funnel, setFunnel] = useState<PipelineFunnelItem[]>([])

  useEffect(() => {
    analyticsApi.dashboard().then((r) => setAnalytics(r.data))
    analyticsApi.funnel().then((r) => setFunnel(r.data))
  }, [])

  const kpis = analytics
    ? [
        { label: 'Total Sourced', value: analytics.total_sourced, suffix: '' },
        { label: 'Emails Sent', value: analytics.emails_sent, suffix: '' },
        { label: 'Reply Rate', value: analytics.reply_rate, suffix: '%' },
        { label: 'Interview Conversion', value: analytics.conversion_to_interview, suffix: '%' },
        { label: 'Scheduled', value: analytics.total_scheduled, suffix: '' },
        { label: 'Active Runs', value: analytics.active_workflow_runs, suffix: '' },
      ]
    : []

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Analytics</h1>
        <p className="text-slate-500 mt-0.5">Pipeline performance metrics</p>
      </div>

      {/* KPI grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {kpis.map(({ label, value, suffix }) => (
          <Card key={label}>
            <CardBody className="text-center py-5">
              <p className="text-3xl font-bold text-slate-900">
                {value}{suffix}
              </p>
              <p className="text-xs text-slate-500 mt-1">{label}</p>
            </CardBody>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pipeline Funnel */}
        <Card>
          <CardHeader>
            <h2 className="font-semibold text-slate-900">Pipeline Funnel</h2>
            <p className="text-xs text-slate-500 mt-0.5">Candidates at each stage</p>
          </CardHeader>
          <CardBody>
            {funnel.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={funnel} layout="vertical">
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="stage" tick={{ fontSize: 11 }} width={80} />
                  <Tooltip
                    contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
                  />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                    {funnel.map((_, i) => (
                      <Cell key={i} fill={FUNNEL_COLORS[i % FUNNEL_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-48 flex items-center justify-center text-slate-400 text-sm">
                No pipeline data yet. Launch a workflow to see metrics.
              </div>
            )}
          </CardBody>
        </Card>

        {/* Conversion Rates */}
        <Card>
          <CardHeader>
            <h2 className="font-semibold text-slate-900">Conversion Rates</h2>
          </CardHeader>
          <CardBody className="space-y-5">
            {analytics && [
              { label: 'Sourced → Contacted', from: analytics.total_sourced, to: analytics.total_contacted },
              { label: 'Contacted → Replied', from: analytics.emails_sent, to: analytics.emails_replied },
              { label: 'Replied → Scheduled', from: analytics.emails_replied, to: analytics.total_scheduled },
            ].map(({ label, from, to }) => {
              const pct = from > 0 ? Math.round((to / from) * 100) : 0
              return (
                <div key={label}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm text-slate-600">{label}</span>
                    <span className="text-sm font-semibold text-slate-900">{pct}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-blue-500 transition-all duration-700"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <p className="text-xs text-slate-400 mt-1">{to} / {from}</p>
                </div>
              )
            })}
            {!analytics && (
              <div className="text-sm text-slate-400 text-center py-8">Loading...</div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  )
}
