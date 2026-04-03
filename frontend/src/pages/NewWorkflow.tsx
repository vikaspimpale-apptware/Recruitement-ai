import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Plus, X, ToggleLeft, ToggleRight, Sparkles } from 'lucide-react'
import { workflowApi } from '@/api'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Card, { CardBody, CardHeader } from '@/components/ui/Card'
import toast from 'react-hot-toast'
import type { StepConfig } from '@/types'

const DEFAULT_STEPS: StepConfig[] = [
  {
    step_name: 'sourcing',
    enabled: true,
    order_index: 0,
    config: { max_candidates: 30, min_candidates: 25, include_test_profile: true },
  },
  {
    step_name: 'filtering',
    enabled: true,
    order_index: 1,
    config: {
      min_score_threshold: 5.0,
      required_skills: [],
      preferred_skills: [],
      min_experience_years: 0,
      max_experience_years: null,
      strict_skill_match: false,
    },
  },
  {
    step_name: 'outreach',
    enabled: true,
    order_index: 2,
    config: { tone: 'friendly', review_before_send: true },
  },
  {
    step_name: 'scheduling',
    enabled: true,
    order_index: 3,
    config: { interviewer_emails: [], slot_duration_minutes: 45 },
  },
]

const STEP_LABELS: Record<string, string> = {
  sourcing: 'Sourcing',
  filtering: 'Filtering & Scoring',
  outreach: 'Email Outreach',
  scheduling: 'Interview Scheduling',
}

const STEP_DESCRIPTIONS: Record<string, string> = {
  sourcing: 'Search LinkedIn for open-to-work candidates matching your criteria',
  filtering: 'AI scores and ranks candidates with explainable reasoning',
  outreach: 'Generate personalised outreach emails for approved candidates',
  scheduling: 'Monitor replies and auto-schedule interviews via calendar',
}

export default function NewWorkflow() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const workflowId = id ? Number(id) : null
  const isEditMode = Boolean(workflowId)
  const [loading, setLoading] = useState(false)
  const [initializing, setInitializing] = useState(false)

  // Basic config
  const [name, setName] = useState('')
  const [jobTitle, setJobTitle] = useState('')
  const [jobDescription, setJobDescription] = useState('')
  const [location, setLocation] = useState('')
  const [seniority, setSeniority] = useState('mid')
  const [keywordInput, setKeywordInput] = useState('')
  const [keywords, setKeywords] = useState<string[]>([])
  const [requiredSkillInput, setRequiredSkillInput] = useState('')
  const [preferredSkillInput, setPreferredSkillInput] = useState('')

  // Step configs
  const [steps, setSteps] = useState<StepConfig[]>(DEFAULT_STEPS)

  const availableStepNames = useMemo(
    () => new Set(DEFAULT_STEPS.map((s) => s.step_name)),
    [],
  )

  useEffect(() => {
    if (!workflowId) return
    setInitializing(true)
    workflowApi.get(workflowId)
      .then((res) => {
        const wf = res.data
        setName(wf.name)
        setJobTitle(wf.job_title)
        setJobDescription(wf.job_description ?? '')
        setLocation(wf.location)
        setSeniority(wf.seniority)
        setKeywords(wf.keywords ?? [])

        const existing = wf.step_configs?.filter((s) => availableStepNames.has(s.step_name)) ?? []
        const existingMap = new Map(existing.map((s) => [s.step_name, s]))
        setSteps(
          DEFAULT_STEPS.map((base) => {
            const matched = existingMap.get(base.step_name)
            if (!matched) return base
            return {
              ...base,
              enabled: matched.enabled,
              order_index: matched.order_index,
              config: { ...base.config, ...matched.config },
            }
          }),
        )
      })
      .catch(() => toast.error('Failed to load workflow for editing'))
      .finally(() => setInitializing(false))
  }, [availableStepNames, workflowId])

  const updateStep = (stepName: string, updates: Partial<StepConfig>) => {
    setSteps((prev) => prev.map((s) => (s.step_name === stepName ? { ...s, ...updates } : s)))
  }

  const updateStepConfig = (stepName: string, key: string, value: unknown) => {
    setSteps((prev) =>
      prev.map((s) =>
        s.step_name === stepName ? { ...s, config: { ...s.config, [key]: value } } : s,
      ),
    )
  }

  const addKeyword = () => {
    const kw = keywordInput.trim()
    if (kw && !keywords.includes(kw)) {
      setKeywords((prev) => [...prev, kw])
      setKeywordInput('')
    }
  }

  const addFilteringSkill = (kind: 'required_skills' | 'preferred_skills') => {
    const input = kind === 'required_skills' ? requiredSkillInput : preferredSkillInput
    const value = input.trim()
    if (!value) return
    const filtering = steps.find((s) => s.step_name === 'filtering')
    const existing = Array.isArray(filtering?.config?.[kind]) ? filtering?.config?.[kind] as string[] : []
    if (existing.some((s) => s.toLowerCase() === value.toLowerCase())) return
    updateStepConfig('filtering', kind, [...existing, value])
    if (kind === 'required_skills') setRequiredSkillInput('')
    else setPreferredSkillInput('')
  }

  const removeFilteringSkill = (kind: 'required_skills' | 'preferred_skills', skill: string) => {
    const filtering = steps.find((s) => s.step_name === 'filtering')
    const existing = Array.isArray(filtering?.config?.[kind]) ? filtering?.config?.[kind] as string[] : []
    updateStepConfig('filtering', kind, existing.filter((s) => s !== skill))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name || !jobTitle || !location) {
      toast.error('Please fill in all required fields')
      return
    }
    setLoading(true)
    try {
      const payload = {
        name,
        job_title: jobTitle,
        job_description: jobDescription || undefined,
        location,
        seniority,
        keywords,
        step_configs: steps,
      }
      const wf = isEditMode && workflowId
        ? await workflowApi.update(workflowId, payload)
        : await workflowApi.create(payload)
      toast.success(isEditMode ? 'Workflow updated!' : 'Workflow created!')
      navigate(`/workflows/${wf.data.id}`)
    } catch {
      toast.error(isEditMode ? 'Failed to update workflow' : 'Failed to create workflow')
    } finally {
      setLoading(false)
    }
  }

  if (initializing) {
    return (
      <div className="p-8 max-w-3xl mx-auto text-slate-500">
        Loading workflow details...
      </div>
    )
  }

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-6 apptware-fade-up">
      <div className="flex items-start gap-3">
        <button onClick={() => navigate(-1)} className="text-slate-400 hover:text-slate-700 transition-colors cursor-pointer">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{isEditMode ? 'Edit Workflow' : 'New Workflow'}</h1>
          <p className="text-slate-500 text-sm">
            {isEditMode ? 'Update criteria and regenerate runs from shortlist' : 'Configure your recruitment pipeline'}
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Job Details */}
        <Card>
          <CardHeader>
            <h2 className="font-semibold text-slate-900">Job Details</h2>
            <p className="text-sm text-slate-500 mt-0.5">Define the role you're hiring for</p>
          </CardHeader>
          <CardBody className="space-y-4">
            <Input label="Workflow name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Senior Python Engineers — Q2 2026" required />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input label="Job title" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} placeholder="e.g. Senior Python Engineer" required />
              <Input label="Location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Bangalore, India" required />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-slate-700">Job Description (JD)</label>
              <textarea
                value={jobDescription}
                onChange={(e) => setJobDescription(e.target.value)}
                rows={6}
                placeholder="Paste complete JD here. This improves candidate scoring and matching quality."
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-slate-700">Seniority level</label>
              <select
                value={seniority}
                onChange={(e) => setSeniority(e.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {['junior', 'mid', 'senior', 'lead', 'principal', 'director'].map((s) => (
                  <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                ))}
              </select>
            </div>

            {/* Keywords */}
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-slate-700">Keywords / skills to search</label>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  value={keywordInput}
                  onChange={(e) => setKeywordInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addKeyword())}
                  placeholder="e.g. LangChain, FastAPI..."
                  className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <Button type="button" variant="outline" size="sm" onClick={addKeyword}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              {keywords.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-1">
                  {keywords.map((kw) => (
                    <span key={kw} className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-3 py-1 text-xs font-medium text-blue-700">
                      {kw}
                      <button type="button" onClick={() => setKeywords((p) => p.filter((k) => k !== kw))} className="text-blue-500 hover:text-blue-900 cursor-pointer">
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </CardBody>
        </Card>

        {/* Pipeline Steps */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold text-slate-900">Pipeline Configuration</h2>
                <p className="text-sm text-slate-500 mt-0.5">Enable or disable each step and configure its settings</p>
              </div>
              <div className="inline-flex items-center gap-2 rounded-xl border border-blue-700/50 bg-blue-950/30 px-3 py-1.5 text-xs text-blue-300">
                <Sparkles className="h-3.5 w-3.5" />
                {steps.filter((s) => s.enabled).length}/{steps.length} steps enabled
              </div>
            </div>
          </CardHeader>
          <CardBody className="divide-y divide-slate-100 p-0">
            {steps.map((step, idx) => (
              <div
                key={step.step_name}
                className={`
                  px-6 py-5 transition-all duration-300 apptware-fade-up
                  ${step.enabled ? 'bg-slate-900/35 hover:bg-slate-900/55' : 'bg-slate-950/20 hover:bg-slate-900/35'}
                `}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className={`
                        inline-flex h-6 min-w-6 items-center justify-center rounded-full border px-1.5 text-[11px] font-semibold
                        ${step.enabled ? 'border-blue-500/50 bg-blue-950/45 text-blue-300' : 'border-slate-600 bg-slate-900/60 text-slate-400'}
                      `}>
                        {idx + 1}
                      </span>
                      <p className="font-medium text-slate-900 text-sm">{STEP_LABELS[step.step_name]}</p>
                      {!step.enabled && <span className="text-xs text-slate-400">(skipped)</span>}
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">{STEP_DESCRIPTIONS[step.step_name]}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => updateStep(step.step_name, { enabled: !step.enabled })}
                    className={`transition-all duration-200 cursor-pointer ${step.enabled ? 'text-blue-600 hover:scale-105' : 'text-slate-300 hover:text-slate-100 hover:scale-105'}`}
                  >
                    {step.enabled ? <ToggleRight className="h-7 w-7" /> : <ToggleLeft className="h-7 w-7" />}
                  </button>
                </div>

                {step.enabled && (
                  <div className="mt-4 space-y-3">
                    {step.step_name === 'sourcing' && (
                      <div className="space-y-3">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <Input
                            label="Target candidates per run"
                            type="number"
                            min="25"
                            value={String(step.config.max_candidates ?? 30)}
                            onChange={(e) => updateStepConfig('sourcing', 'max_candidates', parseInt(e.target.value))}
                          />
                          <Input
                            label="Minimum candidates guaranteed"
                            type="number"
                            min="25"
                            value={String(step.config.min_candidates ?? 25)}
                            onChange={(e) => updateStepConfig('sourcing', 'min_candidates', parseInt(e.target.value))}
                          />
                        </div>
                        <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                          <input
                            type="checkbox"
                            checked={Boolean(step.config.include_test_profile)}
                            onChange={(e) => updateStepConfig('sourcing', 'include_test_profile', e.target.checked)}
                            className="rounded border-slate-300"
                          />
                          Always add default test profile (Vikas Pimpale) for outreach testing
                        </label>
                      </div>
                    )}
                    {step.step_name === 'filtering' && (
                      <div className="space-y-3">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                          <Input
                            label="Min AI score (0–10)"
                            type="number"
                            step="0.5"
                            min="0"
                            max="10"
                            value={String(step.config.min_score_threshold ?? 5)}
                            onChange={(e) => updateStepConfig('filtering', 'min_score_threshold', parseFloat(e.target.value))}
                          />
                          <Input
                            label="Min experience (years)"
                            type="number"
                            min="0"
                            value={String(step.config.min_experience_years ?? 0)}
                            onChange={(e) => updateStepConfig('filtering', 'min_experience_years', parseFloat(e.target.value))}
                          />
                          <Input
                            label="Max experience (years)"
                            type="number"
                            min="0"
                            value={String(step.config.max_experience_years ?? '')}
                            onChange={(e) => updateStepConfig('filtering', 'max_experience_years', e.target.value ? parseFloat(e.target.value) : null)}
                          />
                        </div>

                        <div className="flex flex-col gap-1.5">
                          <label className="text-sm font-medium text-slate-700">Must-have tech stack (hard filter)</label>
                          <div className="flex flex-col sm:flex-row gap-2">
                            <input
                              value={requiredSkillInput}
                              onChange={(e) => setRequiredSkillInput(e.target.value)}
                              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addFilteringSkill('required_skills'))}
                              placeholder="e.g. React, Node.js, PostgreSQL"
                              className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                            <Button type="button" variant="outline" size="sm" onClick={() => addFilteringSkill('required_skills')}>
                              <Plus className="h-4 w-4" />
                            </Button>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {((step.config.required_skills as string[]) ?? []).map((skill) => (
                              <span key={skill} className="inline-flex items-center gap-1 rounded-full bg-red-100 px-3 py-1 text-xs font-medium text-red-700">
                                {skill}
                                <button type="button" onClick={() => removeFilteringSkill('required_skills', skill)} className="text-red-500 hover:text-red-900 cursor-pointer">
                                  <X className="h-3 w-3" />
                                </button>
                              </span>
                            ))}
                          </div>
                        </div>

                        <div className="flex flex-col gap-1.5">
                          <label className="text-sm font-medium text-slate-700">Preferred tech stack (boost score)</label>
                          <div className="flex flex-col sm:flex-row gap-2">
                            <input
                              value={preferredSkillInput}
                              onChange={(e) => setPreferredSkillInput(e.target.value)}
                              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addFilteringSkill('preferred_skills'))}
                              placeholder="e.g. Docker, AWS, GraphQL"
                              className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                            <Button type="button" variant="outline" size="sm" onClick={() => addFilteringSkill('preferred_skills')}>
                              <Plus className="h-4 w-4" />
                            </Button>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {((step.config.preferred_skills as string[]) ?? []).map((skill) => (
                              <span key={skill} className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-3 py-1 text-xs font-medium text-blue-700">
                                {skill}
                                <button type="button" onClick={() => removeFilteringSkill('preferred_skills', skill)} className="text-blue-500 hover:text-blue-900 cursor-pointer">
                                  <X className="h-3 w-3" />
                                </button>
                              </span>
                            ))}
                          </div>
                        </div>

                        <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                          <input
                            type="checkbox"
                            checked={Boolean(step.config.strict_skill_match)}
                            onChange={(e) => updateStepConfig('filtering', 'strict_skill_match', e.target.checked)}
                            className="rounded border-slate-300"
                          />
                          Enforce strict must-have matching (all required skills must match)
                        </label>
                      </div>
                    )}
                    {step.step_name === 'outreach' && (
                      <div className="flex flex-col gap-1.5">
                        <label className="text-sm font-medium text-slate-700">Email tone</label>
                        <select
                          value={String(step.config.tone ?? 'friendly')}
                          onChange={(e) => updateStepConfig('outreach', 'tone', e.target.value)}
                          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="friendly">Friendly & conversational</option>
                          <option value="formal">Formal & professional</option>
                          <option value="custom">Custom template seed</option>
                        </select>
                      </div>
                    )}
                    {step.step_name === 'scheduling' && (
                      <Input
                        label="Default interview duration (minutes)"
                        type="number"
                        value={String(step.config.slot_duration_minutes ?? 45)}
                        onChange={(e) => updateStepConfig('scheduling', 'slot_duration_minutes', parseInt(e.target.value))}
                      />
                    )}
                  </div>
                )}
              </div>
            ))}
          </CardBody>
        </Card>

        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={() => navigate(-1)}>Cancel</Button>
          <Button type="submit" loading={loading}>{isEditMode ? 'Save Changes' : 'Create Workflow'}</Button>
        </div>
      </form>
    </div>
  )
}
