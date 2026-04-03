import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, RefreshCw, Check, CheckCircle2, Send,
  ChevronLeft, ChevronRight, Edit2, Sparkles, Trash2,
  Square, CheckSquare, Loader2, AlertCircle, MinusSquare,
  FileDown,
} from 'lucide-react'
import { outreachApi, candidateApi, workflowApi } from '@/api'
import type { OutreachEmail, Candidate } from '@/types'
import Button from '@/components/ui/Button'
import Badge, { statusBadge } from '@/components/ui/Badge'
import toast from 'react-hot-toast'
import { clsx } from 'clsx'
import { exportCandidateProfiles } from '@/utils/exportCandidatePDF'

// ── Confirm dialog ────────────────────────────────────────────────────────────
function ConfirmDeleteDialog({
  count,
  onConfirm,
  onCancel,
}: {
  count: number
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
            <p className="font-semibold text-slate-900 mb-1">
              Discard {count} email{count !== 1 ? 's' : ''}?
            </p>
            <p className="text-sm text-slate-500">
              The selected email draft{count !== 1 ? 's' : ''} will be permanently deleted and
              {count !== 1 ? ' those candidates' : ' that candidate'} won't be contacted.
            </p>
          </div>
        </div>
        <div className="flex gap-3 justify-end">
          <Button variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
          <Button variant="danger" size="sm" onClick={onConfirm}>
            <Trash2 className="h-3.5 w-3.5" />
            Delete {count} Email{count !== 1 ? 's' : ''}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ── Email editor pane ─────────────────────────────────────────────────────────
function EmailPane({
  email,
  candidate,
  onUpdate,
  onApprove,
  onRegenerate,
}: {
  email: OutreachEmail
  candidate: Candidate | undefined
  onUpdate: (id: number, subject: string, body: string) => void
  onApprove: (id: number) => void
  onRegenerate: (id: number, instruction: string) => void
}) {
  const [editingSubject, setEditingSubject] = useState(email.subject)
  const [editingBody, setEditingBody] = useState(email.body)
  const [instruction, setInstruction] = useState('')
  const [showRegen, setShowRegen] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [regenLoading, setRegenLoading] = useState(false)

  // Sync when email prop changes (navigation)
  useEffect(() => {
    setEditingSubject(email.subject)
    setEditingBody(email.body)
    setDirty(false)
    setShowRegen(false)
  }, [email.id, email.subject, email.body])

  const handleSave = () => {
    onUpdate(email.id, editingSubject, editingBody)
    setDirty(false)
    toast.success('Draft saved')
  }

  const handleRegenerate = async () => {
    setRegenLoading(true)
    await onRegenerate(email.id, instruction)
    setInstruction('')
    setShowRegen(false)
    setRegenLoading(false)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Email toolbar */}
      <div className="border-b border-slate-200 px-4 py-4 sm:px-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between bg-white shrink-0">
        <div className="flex items-center gap-2">
          <Badge variant={statusBadge(email.status)}>{email.status}</Badge>
          <span className="text-xs text-slate-500">{email.tone} tone</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {dirty && (
            <Button size="sm" variant="outline" onClick={handleSave}>
              <Edit2 className="h-3.5 w-3.5" /> Save edits
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setShowRegen((p) => !p)}>
            <Sparkles className="h-3.5 w-3.5" /> Regenerate
          </Button>
          <Button
            size="sm"
            variant={email.status === 'approved' ? 'success' : 'primary'}
            onClick={() => onApprove(email.id)}
            disabled={email.status === 'approved'}
          >
            <Check className="h-3.5 w-3.5" />
            {email.status === 'approved' ? 'Approved ✓' : 'Approve'}
          </Button>
        </div>
      </div>

      {/* Regenerate bar */}
      {showRegen && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 sm:px-6 flex flex-col sm:flex-row sm:items-center gap-3 shrink-0">
          <input
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder="Optional: 'Make it shorter', 'Emphasise Python skills', 'More formal'"
            className="flex-1 rounded-lg border border-amber-300 px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-400"
            onKeyDown={(e) => e.key === 'Enter' && handleRegenerate()}
          />
          <Button size="sm" variant="outline" loading={regenLoading} onClick={handleRegenerate}>
            <RefreshCw className="h-3.5 w-3.5" /> Regenerate
          </Button>
        </div>
      )}

      {/* Email content */}
      <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5 space-y-4 apptware-hide-scrollbar">
        <div>
          <label className="text-xs font-medium text-slate-500 uppercase tracking-wide block mb-1">Subject</label>
          <input
            value={editingSubject}
            onChange={(e) => { setEditingSubject(e.target.value); setDirty(true) }}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-500 uppercase tracking-wide block mb-1">Body</label>
          <textarea
            value={editingBody}
            onChange={(e) => { setEditingBody(e.target.value); setDirty(true) }}
            rows={16}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 leading-relaxed resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>
    </div>
  )
}

// ── Checkbox component ────────────────────────────────────────────────────────
function Checkbox({
  checked,
  indeterminate,
  onChange,
  className,
}: {
  checked: boolean
  indeterminate?: boolean
  onChange: (v: boolean) => void
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onChange(!checked) }}
      className={clsx('flex-shrink-0 h-4 w-4 rounded text-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer', className)}
      aria-checked={indeterminate ? 'mixed' : checked}
    >
      {indeterminate
        ? <MinusSquare className="h-4 w-4 text-blue-600" />
        : checked
        ? <CheckSquare className="h-4 w-4 text-blue-600" />
        : <Square className="h-4 w-4 text-slate-400 hover:text-slate-600" />}
    </button>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function EmailReview() {
  const { runId } = useParams<{ runId: string }>()
  const navigate = useNavigate()
  const [emails, setEmails] = useState<OutreachEmail[]>([])
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [currentIdx, setCurrentIdx] = useState(0)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)

  // Selection state
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    if (!runId) return
    Promise.all([
      outreachApi.listForRun(Number(runId)),
      candidateApi.listForRun(Number(runId), 'approved'),
    ]).then(([emailRes, candRes]) => {
      setEmails(emailRes.data)
      setCandidates(candRes.data)
    }).finally(() => setLoading(false))
  }, [runId])

  const currentEmail = emails[currentIdx]
  const currentCandidate = candidates.find((c) => c.id === currentEmail?.candidate_id)

  // Selection helpers
  const allSelected = emails.length > 0 && selected.size === emails.length
  const someSelected = selected.size > 0 && selected.size < emails.length

  const toggleOne = useCallback((id: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }, [])

  const toggleAll = useCallback(() => {
    if (allSelected) {
      setSelected(new Set())
    } else {
      setSelected(new Set(emails.map((e) => e.id)))
    }
  }, [allSelected, emails])

  // Email actions
  const handleUpdate = async (id: number, subject: string, body: string) => {
    const updated = await outreachApi.update(id, { subject, body })
    setEmails((prev) => prev.map((e) => e.id === id ? updated.data : e))
  }

  const handleApprove = async (id: number) => {
    const updated = await outreachApi.approve(id)
    setEmails((prev) => prev.map((e) => e.id === id ? updated.data : e))
    toast.success('Email approved')
  }

  const handleRegenerate = async (id: number, instruction: string) => {
    const updated = await outreachApi.regenerate(id, instruction)
    setEmails((prev) => prev.map((e) => e.id === id ? updated.data : e))
    toast.success('Email regenerated')
  }

  // Delete selected
  const handleDeleteSelected = async () => {
    setConfirmDelete(false)
    setDeleting(true)
    const ids = Array.from(selected)
    try {
      await outreachApi.bulkDelete(ids)

      // Remove deleted from local state
      const remainingEmails = emails.filter((e) => !ids.includes(e.id))
      setEmails(remainingEmails)
      setSelected(new Set())

      // Adjust currentIdx so it stays valid
      setCurrentIdx((prev) => {
        if (remainingEmails.length === 0) return 0
        return Math.min(prev, remainingEmails.length - 1)
      })

      toast.success(`${ids.length} email${ids.length !== 1 ? 's' : ''} discarded`)
    } catch {
      toast.error('Failed to delete emails')
    } finally {
      setDeleting(false)
    }
  }

  const handleExportPDF = async () => {
    setExporting(true)
    try {
      await exportCandidateProfiles(candidates, '', 'Outreach Candidates')
      toast.success('Candidate profiles exported to PDF')
    } finally {
      setExporting(false)
    }
  }

  const handleBulkApproveAndSend = async () => {
    setSending(true)
    try {
      // Approve all remaining drafts
      const drafts = emails.filter((e) => e.status === 'draft')
      for (const e of drafts) await outreachApi.approve(e.id)

      // Send all remaining emails
      const allIds = emails.map((e) => e.id)
      const sendRes = await outreachApi.bulkSend(allIds)

      // Validate at least one email actually moved to sent/replied before moving workflow.
      const refreshedEmails = await outreachApi.listForRun(Number(runId))
      const sentCount = refreshedEmails.data.filter((e) => e.status === 'sent' || e.status === 'replied').length
      if (sentCount === 0) {
        const bounced = refreshedEmails.data.filter((e) => e.status === 'bounced')
        const firstReason = bounced.find((e) => e.reply_body)?.reply_body
        toast.error(firstReason || 'No emails were sent. Check candidate email addresses and SendGrid sender settings.')
        return
      }

      await workflowApi.resumeRun(Number(runId), 'email_review', 'approve')

      const bouncedCount = sendRes?.data?.bounced_count ?? 0
      if (bouncedCount > 0) {
        toast.success(`Sent ${sentCount} email${sentCount !== 1 ? 's' : ''}, ${bouncedCount} bounced.`)
      } else {
        toast.success(`Sent ${sentCount} email${sentCount !== 1 ? 's' : ''}.`)
      }
      const runRes = await workflowApi.getRun(Number(runId))
      navigate(`/workflows/${runRes.data.workflow_id}`)
    } catch {
      toast.error('Failed to send emails')
    } finally {
      setSending(false)
    }
  }

  const approvedCount = emails.filter((e) => e.status === 'approved').length

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 gap-3 text-slate-500">
        <Loader2 className="h-5 w-5 animate-spin" />
        Loading email drafts...
      </div>
    )
  }

  return (
    <div className="flex flex-col min-h-[calc(100vh-3.5rem)] md:h-screen bg-slate-50">
      {/* Confirm delete dialog */}
      {confirmDelete && (
        <ConfirmDeleteDialog
          count={selected.size}
          onConfirm={handleDeleteSelected}
          onCancel={() => setConfirmDelete(false)}
        />
      )}

      {/* Top bar */}
      <div className="flex flex-col gap-3 px-4 py-4 bg-white border-b border-slate-200 shrink-0 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="text-slate-400 hover:text-slate-700 cursor-pointer">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="font-bold text-slate-900">Email Review</h1>
            <p className="text-xs text-slate-500">
              Run #{runId} · Checkpoint 2 of 2 · {emails.length} draft{emails.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          {/* Selection action toolbar — appears when rows are selected */}
          {selected.size > 0 && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
              <span className="text-sm font-medium text-red-800">
                {selected.size} selected
              </span>
              <Button
                size="sm"
                variant="danger"
                loading={deleting}
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Discard
              </Button>
              <button
                onClick={() => setSelected(new Set())}
                className="text-xs text-red-600 hover:text-red-800 underline cursor-pointer"
              >
                Clear
              </button>
            </div>
          )}

          <span className="text-sm text-slate-500">{approvedCount}/{emails.length} approved</span>
          <Button
            variant="outline"
            size="sm"
            loading={exporting}
            disabled={emails.length === 0}
            onClick={handleExportPDF}
          >
            <FileDown className="h-4 w-4" />
            Export PDF
          </Button>
          <Button
            onClick={handleBulkApproveAndSend}
            loading={sending}
            variant="success"
            disabled={emails.length === 0}
            className="gap-2"
          >
            <Send className="h-4 w-4" />
            Send All ({emails.length})
          </Button>
        </div>
      </div>

      {emails.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-slate-400 gap-3">
          <CheckCircle2 className="h-12 w-12 text-emerald-300" />
          <p className="text-sm font-medium">All emails discarded or sent</p>
          <p className="text-xs text-slate-400">No remaining drafts for this run.</p>
          <Button variant="outline" size="sm" onClick={() => navigate(-1)}>Go back</Button>
        </div>
      ) : (
        <div className="flex flex-1 flex-col lg:flex-row lg:overflow-hidden">
          {/* ── Left sidebar: candidate list with checkboxes ── */}
          <div className="w-full lg:w-72 border-r border-slate-200 bg-white flex h-64 lg:h-auto flex-col shrink-0">
            {/* Sidebar header — select all */}
            <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-3">
              <Checkbox
                checked={allSelected}
                indeterminate={someSelected}
                onChange={toggleAll}
              />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  {someSelected || allSelected
                    ? `${selected.size} of ${emails.length} selected`
                    : `${emails.length} draft${emails.length !== 1 ? 's' : ''}`}
                </p>
              </div>
              {(someSelected || allSelected) && (
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="text-red-500 hover:text-red-700 cursor-pointer"
                  title="Discard selected"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>

            {/* Email rows */}
            <div className="flex-1 overflow-y-auto apptware-hide-scrollbar">
              {emails.map((email, idx) => {
                const cand = candidates.find((c) => c.id === email.candidate_id)
                const isActive = idx === currentIdx
                const isSelected = selected.has(email.id)

                return (
                  <div
                    key={email.id}
                    className={clsx(
                      'flex items-start gap-3 px-4 py-3 border-b border-slate-100 transition-colors cursor-pointer group',
                      isActive && !isSelected && 'bg-blue-50 border-l-2 border-l-blue-500',
                      isSelected && 'bg-red-50 border-l-2 border-l-red-400',
                      !isActive && !isSelected && 'hover:bg-slate-50',
                    )}
                    onClick={() => setCurrentIdx(idx)}
                  >
                    {/* Checkbox — always visible */}
                    <div className="pt-0.5" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={isSelected}
                        onChange={() => toggleOne(email.id)}
                      />
                    </div>

                    {/* Candidate info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1">
                        <p className={clsx(
                          'text-sm font-medium truncate',
                          isSelected ? 'text-red-700 line-through opacity-70' : 'text-slate-800',
                        )}>
                          {cand?.full_name ?? `Candidate ${email.candidate_id}`}
                        </p>
                        {email.status === 'approved' && !isSelected && (
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                        )}
                        {isSelected && (
                          <Trash2 className="h-3.5 w-3.5 text-red-400 shrink-0" />
                        )}
                      </div>
                      <p className="text-xs text-slate-500 truncate mt-0.5">
                        {cand?.headline ?? ''}
                      </p>
                      <Badge variant={statusBadge(email.status)} className="mt-1 text-xs">
                        {email.status}
                      </Badge>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* ── Right panel: email editor ── */}
          <div className="flex-1 flex flex-col overflow-hidden min-h-0">
            {currentEmail ? (
              <>
                {/* Candidate mini-profile strip */}
                {currentCandidate && (
                  <div className={clsx(
                    'border-b px-4 py-3 flex flex-col items-start gap-3 shrink-0 sm:px-6 sm:flex-row sm:items-center',
                    selected.has(currentEmail.id)
                      ? 'bg-red-50 border-red-200'
                      : 'bg-slate-50 border-slate-200',
                  )}>
                    <div className={clsx(
                      'flex h-8 w-8 items-center justify-center rounded-full font-semibold text-sm shrink-0',
                      selected.has(currentEmail.id)
                        ? 'bg-red-200 text-red-700'
                        : 'bg-blue-100 text-blue-700',
                    )}>
                      {currentCandidate.full_name[0]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={clsx(
                        'text-sm font-medium',
                        selected.has(currentEmail.id) && 'text-red-700 line-through',
                      )}>
                        {currentCandidate.full_name}
                      </p>
                      <p className="text-xs text-slate-500 truncate">{currentCandidate.headline}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                      {/* Per-email checkbox in header */}
                      <div
                        className="flex items-center gap-1.5 cursor-pointer"
                        onClick={() => toggleOne(currentEmail.id)}
                      >
                        <Checkbox
                          checked={selected.has(currentEmail.id)}
                          onChange={() => toggleOne(currentEmail.id)}
                        />
                        <span className="text-xs text-slate-500 select-none">
                          {selected.has(currentEmail.id) ? 'Marked for discard' : 'Mark for discard'}
                        </span>
                      </div>
                      <div className="w-px h-4 bg-slate-300 mx-1" />
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={currentIdx === 0}
                        onClick={() => setCurrentIdx((i) => i - 1)}
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <span className="text-xs text-slate-500">{currentIdx + 1} / {emails.length}</span>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={currentIdx === emails.length - 1}
                        onClick={() => setCurrentIdx((i) => i + 1)}
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )}

                {/* Discard notice overlay on selected emails */}
                {selected.has(currentEmail.id) ? (
                  <div className="flex-1 flex flex-col items-center justify-center gap-4 bg-red-50/60">
                    <div className="h-14 w-14 rounded-2xl bg-red-100 flex items-center justify-center">
                      <Trash2 className="h-7 w-7 text-red-500" />
                    </div>
                    <div className="text-center">
                      <p className="font-semibold text-red-800 text-base">Marked for discard</p>
                      <p className="text-sm text-red-500 mt-1">
                        This email will be deleted when you click <strong>Discard</strong>.
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => toggleOne(currentEmail.id)}
                    >
                      Keep this email
                    </Button>
                  </div>
                ) : (
                  <EmailPane
                    key={currentEmail.id}
                    email={currentEmail}
                    candidate={currentCandidate}
                    onUpdate={handleUpdate}
                    onApprove={handleApprove}
                    onRegenerate={handleRegenerate}
                  />
                )}
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-slate-400">
                Select a candidate to review their email
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
