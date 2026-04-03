import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { CalendarDays, FileUp, ShieldCheck, UserRound } from 'lucide-react'
import { schedulingApi } from '@/api'
import type { PublicSchedule } from '@/types'
import Button from '@/components/ui/Button'

export default function PublicBooking() {
  const { token } = useParams<{ token: string }>()
  const [schedule, setSchedule] = useState<PublicSchedule | null>(null)
  const [slotId, setSlotId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState<string | null>(null)
  const [resumeFile, setResumeFile] = useState<File | null>(null)
  const [form, setForm] = useState({
    candidate_name: '',
    candidate_email: '',
    candidate_phone: '',
    notes: '',
  })

  useEffect(() => {
    if (!token) return
    schedulingApi.getPublic(token)
      .then((res) => {
        setSchedule(res.data)
        if (res.data.slots.length > 0) setSlotId(res.data.slots[0].id)
      })
      .finally(() => setLoading(false))
  }, [token])

  const submitBooking = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!token || !slotId) return
    setSubmitting(true)
    try {
      const res = await schedulingApi.bookPublic(token, {
        slot_id: slotId,
        ...form,
        resume_file: resumeFile,
      })
      setSuccess(res.data.message || 'Booked successfully')
    } catch {
      setSuccess('Failed to book slot. It may already be booked.')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <div className="min-h-screen apptware-dark p-8 text-slate-300">Loading booking page...</div>
  if (!schedule) return <div className="min-h-screen apptware-dark p-8 text-red-300">Invalid scheduling link.</div>
  if (success) return <div className="min-h-screen apptware-dark p-8 max-w-xl mx-auto text-emerald-300 font-medium">Booking confirmed: {success}</div>

  return (
    <div className="min-h-screen apptware-dark px-4 py-6 sm:px-6">
      <div className="mx-auto grid max-w-5xl grid-cols-1 gap-6 lg:grid-cols-5">
        <div className="lg:col-span-2 rounded-2xl border border-slate-800/80 bg-slate-900/70 p-5">
          <h1 className="text-2xl font-bold text-white">Schedule Interview</h1>
          <p className="mt-2 text-sm text-slate-300">
            Candidate: <span className="font-semibold text-slate-100">{schedule.candidate_name}</span>
            {schedule.candidate_headline ? ` · ${schedule.candidate_headline}` : ''}
          </p>
          <div className="mt-5 space-y-3 text-sm text-slate-300">
            <div className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-blue-300" />
              Select one available slot
            </div>
            <div className="flex items-center gap-2">
              <FileUp className="h-4 w-4 text-blue-300" />
              Upload updated resume (optional)
            </div>
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-300" />
              Your details are shared only with recruiter
            </div>
          </div>
        </div>

        <div className="lg:col-span-3 rounded-2xl border border-slate-800/80 bg-slate-900/70 p-5 sm:p-6">
          <form className="space-y-4" onSubmit={submitBooking}>
          <input
            required
            placeholder="Your full name"
            value={form.candidate_name}
            onChange={(e) => setForm((p) => ({ ...p, candidate_name: e.target.value }))}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            required
            type="email"
            placeholder="Your email"
            value={form.candidate_email}
            onChange={(e) => setForm((p) => ({ ...p, candidate_email: e.target.value }))}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            required
            placeholder="Contact number"
            value={form.candidate_phone}
            onChange={(e) => setForm((p) => ({ ...p, candidate_phone: e.target.value }))}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <div className="rounded-xl border border-blue-900/70 bg-blue-950/30 p-4">
            <label className="flex items-center gap-2 text-sm font-medium text-slate-100">
              <FileUp className="h-4 w-4 text-blue-300" />
              Upload updated resume (optional)
            </label>
            <input
              type="file"
              accept=".pdf,.doc,.docx"
              onChange={(e) => setResumeFile(e.target.files?.[0] ?? null)}
              className="mt-3 block w-full rounded-lg border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-200 file:mr-3 file:rounded-md file:border-0 file:bg-blue-600 file:px-3 file:py-1.5 file:text-white hover:file:bg-blue-700"
            />
            <p className="mt-2 text-xs text-slate-400">Accepted: PDF, DOC, DOCX (max 10 MB)</p>
            {resumeFile && (
              <p className="mt-1 text-xs text-blue-300">Selected: {resumeFile.name}</p>
            )}
          </div>
          <textarea
            placeholder="Additional notes (optional)"
            value={form.notes}
            onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            rows={3}
          />

          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-200">Select a slot</label>
            <div className="space-y-2">
              {schedule.slots.map((slot) => (
                <label key={slot.id} className="flex items-start gap-2 text-sm text-slate-200 border border-slate-700 rounded-lg px-3 py-2 hover:border-blue-500">
                  <input
                    type="radio"
                    name="slot"
                    checked={slotId === slot.id}
                    onChange={() => setSlotId(slot.id)}
                    className="mt-0.5"
                  />
                  <span className="leading-relaxed">
                    {new Date(slot.start_at).toLocaleString()} - {new Date(slot.end_at).toLocaleString()}
                  </span>
                </label>
              ))}
            </div>
          </div>

          <Button type="submit" loading={submitting} disabled={!slotId} className="w-full sm:w-auto">
            <UserRound className="h-4 w-4" />
            Confirm Slot
          </Button>
        </form>
        </div>
      </div>
    </div>
  )
}
