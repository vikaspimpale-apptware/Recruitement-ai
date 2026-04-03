import { useEffect, useMemo, useState } from 'react'
import { CalendarPlus, CheckCircle2, Copy, Mail, RefreshCw } from 'lucide-react'
import { outreachApi, schedulingApi } from '@/api'
import type { OutreachEmail, ScheduleRequest } from '@/types'
import Button from '@/components/ui/Button'
import Card, { CardBody, CardHeader } from '@/components/ui/Card'
import Badge, { statusBadge } from '@/components/ui/Badge'
import toast from 'react-hot-toast'

type SlotDraft = { start_at: string; end_at: string }

export default function SentMails() {
  const [emails, setEmails] = useState<OutreachEmail[]>([])
  const [requests, setRequests] = useState<ScheduleRequest[]>([])
  const [selectedEmailId, setSelectedEmailId] = useState<number | null>(null)
  const [slotDrafts, setSlotDrafts] = useState<SlotDraft[]>([{ start_at: '', end_at: '' }])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)

  const load = async (resetSelection = false) => {
    setLoading(true)
    try {
      const [sentRes, reqRes] = await Promise.all([
        outreachApi.listSent(),
        schedulingApi.listRequests(),
      ])
      setEmails(sentRes.data)
      setRequests(reqRes.data)
      if (resetSelection) {
        setSelectedEmailId(null)
        setSlotDrafts([{ start_at: '', end_at: '' }])
      } else if (selectedEmailId && !sentRes.data.some((e) => e.id === selectedEmailId)) {
        setSelectedEmailId(null)
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const requestMap = useMemo(() => {
    const map = new Map<number, ScheduleRequest>()
    for (const req of requests) map.set(req.outreach_email_id, req)
    return map
  }, [requests])
  const selectedEmail = emails.find((e) => e.id === selectedEmailId) ?? null
  const selectedRequest = selectedEmailId ? requestMap.get(selectedEmailId) ?? null : null
  const selectedBooking = selectedRequest?.bookings?.[0]
  const bookedSlot = selectedBooking
    ? selectedRequest?.slots.find((s) => s.id === selectedBooking.slot_id)
    : null

  const addSlotDraft = () => setSlotDrafts((prev) => [...prev, { start_at: '', end_at: '' }])

  const updateSlotDraft = (idx: number, key: keyof SlotDraft, value: string) => {
    setSlotDrafts((prev) => prev.map((s, i) => (i === idx ? { ...s, [key]: value } : s)))
  }

  const createSchedulingLink = async () => {
    if (!selectedEmailId) return
    const validSlots = slotDrafts.filter((s) => s.start_at && s.end_at)
    if (validSlots.length === 0) {
      toast.error('Add at least one valid slot')
      return
    }
    setCreating(true)
    try {
      await schedulingApi.createRequest({
        email_id: selectedEmailId,
        slots: validSlots.map((s) => ({
          start_at: new Date(s.start_at).toISOString(),
          end_at: new Date(s.end_at).toISOString(),
        })),
      })
      toast.success('Scheduling link created/updated')
      setSlotDrafts([{ start_at: '', end_at: '' }])
      await load()
    } catch {
      toast.error('Failed to create scheduling link')
    } finally {
      setCreating(false)
    }
  }

  const copyLink = async (token: string) => {
    const link = `${window.location.origin}/book/${token}`
    await navigator.clipboard.writeText(link)
    toast.success('Booking link copied')
  }

  if (loading) {
    return <div className="p-8 text-slate-500">Loading sent mails...</div>
  }

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Sent Mails & Scheduling</h1>
          <p className="text-slate-500 text-sm">Track sent outreach and create booking links with interview slots.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => load(true)} className="w-full sm:w-auto">
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <h2 className="font-semibold text-slate-900">Sent Emails</h2>
          </CardHeader>
          <CardBody className="p-0">
            {emails.length === 0 ? (
              <div className="px-6 py-8 text-slate-500 text-sm">No sent emails yet.</div>
            ) : (
              <div className="divide-y divide-slate-100">
                {emails.map((email) => (
                  <button
                    key={email.id}
                    onClick={() => setSelectedEmailId(email.id)}
                    className={`w-full text-left px-6 py-4 hover:bg-slate-50 ${
                      selectedEmailId === email.id ? 'bg-blue-50' : ''
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Mail className="h-4 w-4 text-slate-400" />
                      <p className="text-sm font-medium text-slate-900 truncate">{email.subject}</p>
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <Badge variant={statusBadge(email.status)}>{email.status}</Badge>
                      <span className="text-xs text-slate-500">Candidate #{email.candidate_id}</span>
                    </div>
                    {requestMap.get(email.id) && (
                      <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Booking link created
                      </p>
                    )}
                  </button>
                ))}
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="font-semibold text-slate-900">Create/Update Booking Link</h2>
          </CardHeader>
          <CardBody className="space-y-3">
            <p className="text-xs text-slate-500">
              Selected email: {selectedEmail ? `#${selectedEmail.id}` : 'None'}
            </p>
            {slotDrafts.map((slot, idx) => (
              <div key={idx} className="grid grid-cols-2 gap-2">
                <input
                  type="datetime-local"
                  value={slot.start_at}
                  onChange={(e) => updateSlotDraft(idx, 'start_at', e.target.value)}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
                <input
                  type="datetime-local"
                  value={slot.end_at}
                  onChange={(e) => updateSlotDraft(idx, 'end_at', e.target.value)}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={addSlotDraft}>
                <CalendarPlus className="h-4 w-4" />
                Add Slot
              </Button>
              <Button size="sm" loading={creating} onClick={createSchedulingLink} disabled={!selectedEmailId}>
                Generate Link
              </Button>
            </div>

            {selectedEmailId && requestMap.get(selectedEmailId) && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm">
                <p className="font-medium text-emerald-800">Booking link ready</p>
                <p className="text-emerald-700 text-xs break-all mt-1">
                  {window.location.origin}/book/{requestMap.get(selectedEmailId)?.token}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={() => copyLink(requestMap.get(selectedEmailId)!.token)}
                >
                  <Copy className="h-3.5 w-3.5" />
                  Copy Link
                </Button>
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <h2 className="font-semibold text-slate-900">Email & Candidate Tracking</h2>
        </CardHeader>
        <CardBody className="space-y-4">
          {!selectedEmail ? (
            <p className="text-sm text-slate-500">Select a sent email to view what was sent, to whom, and booking progress.</p>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-slate-500">To</p>
                  <p className="font-medium text-slate-900">
                    {selectedEmail.candidate_name || `Candidate #${selectedEmail.candidate_id}`}
                  </p>
                  <p className="text-slate-600 text-xs">{selectedEmail.candidate_email || 'Email not available'}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Status</p>
                  <div className="mt-1 flex items-center gap-2">
                    <Badge variant={statusBadge(selectedEmail.status)}>{selectedEmail.status}</Badge>
                    <span className="text-xs text-slate-500">
                      {selectedEmail.sent_at ? new Date(selectedEmail.sent_at).toLocaleString() : 'Sent time unavailable'}
                    </span>
                  </div>
                </div>
              </div>

              <div>
                <p className="text-xs text-slate-500">Subject</p>
                <p className="text-sm font-medium text-slate-900">{selectedEmail.subject}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Email body sent</p>
                <div className="mt-1 rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-700 whitespace-pre-wrap max-h-64 overflow-y-auto apptware-hide-scrollbar">
                  {selectedEmail.body}
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-sm font-semibold text-slate-800">Scheduling tracking</p>
                {!selectedRequest && (
                  <p className="text-xs text-slate-500 mt-1">No booking link created yet for this email.</p>
                )}
                {selectedRequest && selectedRequest.status === 'open' && (
                  <p className="text-xs text-amber-700 mt-1">Booking link created. Waiting for candidate to submit details and confirm a slot.</p>
                )}
                {selectedRequest && selectedBooking && (
                  <div className="mt-2 space-y-1 text-xs text-slate-700">
                    <p><strong>Name:</strong> {selectedBooking.candidate_name}</p>
                    <p><strong>Email:</strong> {selectedBooking.candidate_email}</p>
                    <p><strong>Phone:</strong> {selectedBooking.candidate_phone}</p>
                    {selectedBooking.resume_url && (
                      <p>
                        <strong>Resume:</strong>{' '}
                        <a className="text-blue-600 hover:underline break-all" href={selectedBooking.resume_url} target="_blank" rel="noreferrer">
                          Open uploaded resume
                        </a>
                      </p>
                    )}
                    {bookedSlot && (
                      <p>
                        <strong>Booked slot:</strong> {new Date(bookedSlot.start_at).toLocaleString()} - {new Date(bookedSlot.end_at).toLocaleString()}
                      </p>
                    )}
                    {selectedBooking.notes && <p><strong>Notes:</strong> {selectedBooking.notes}</p>}
                  </div>
                )}
              </div>
            </>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
