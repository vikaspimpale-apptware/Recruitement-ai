import api from './client'
import type {
  Workflow,
  WorkflowRun,
  Candidate,
  OutreachEmail,
  ScheduleRequest,
  PublicSchedule,
  CandidateEvent,
  DashboardAnalytics,
  PipelineFunnelItem,
  StepConfig,
  ChatMessage,
} from '@/types'

// Auth
export const authApi = {
  login: (email: string, password: string) =>
    api.post('/auth/login', { email, password }),
  register: (email: string, full_name: string, password: string) =>
    api.post('/auth/register', { email, full_name, password }),
  me: () => api.get('/auth/me'),
}

// Workflows
export const workflowApi = {
  create: (data: {
    name: string
    job_title: string
    job_description?: string
    location: string
    seniority: string
    keywords: string[]
    step_configs: StepConfig[]
  }) => api.post<Workflow>('/workflows', data),

  list: () => api.get<Workflow[]>('/workflows'),
  get: (id: number) => api.get<Workflow>(`/workflows/${id}`),

  update: (id: number, data: {
    name?: string
    job_title?: string
    job_description?: string
    location?: string
    seniority?: string
    keywords?: string[]
    step_configs?: StepConfig[]
  }) => api.put<Workflow>(`/workflows/${id}`, data),

  launchRun: (workflowId: number) =>
    api.post<WorkflowRun>(`/workflows/${workflowId}/run`),

  listRuns: (workflowId: number) =>
    api.get<WorkflowRun[]>(`/workflows/${workflowId}/runs`),

  getRun: (runId: number) => api.get<WorkflowRun>(`/workflows/runs/${runId}`),

  resumeRun: (runId: number, checkpoint: string, action: string) =>
    api.post<WorkflowRun>(`/workflows/runs/${runId}/resume`, { checkpoint, action }),

  deleteRun: (runId: number) =>
    api.delete(`/workflows/runs/${runId}`),

  rerun: (runId: number) =>
    api.post<WorkflowRun>(`/workflows/runs/${runId}/rerun`),

  regenerateRun: (runId: number) =>
    api.post<WorkflowRun>(`/workflows/runs/${runId}/regenerate`),

  regenerateStep: (runId: number, stepName: string, skipFiltering = false) =>
    api.post<WorkflowRun>(`/workflows/runs/${runId}/regenerate-step`, {
      step_name: stepName,
      skip_filtering: skipFiltering,
    }),

  deleteWorkflow: (workflowId: number) =>
    api.delete(`/workflows/${workflowId}`),
}

// Candidates
export const candidateApi = {
  listForRun: (runId: number, status?: string, postFilterOnly?: boolean) =>
    api.get<Candidate[]>(`/candidates/run/${runId}`, {
      params: {
        ...(status ? { status } : {}),
        ...(postFilterOnly ? { post_filter_only: true } : {}),
      },
    }),

  get: (id: number) => api.get<Candidate>(`/candidates/${id}`),

  setDecision: (id: number, decision: string, score_override?: number, notes?: string) =>
    api.post<Candidate>(`/candidates/${id}/decision`, {
      decision,
      ...(score_override !== undefined && { score_override }),
      ...(notes !== undefined && { notes }),
    }),

  bulkDecision: (candidateIds: number[], decision: string) =>
    api.post('/candidates/bulk-decision', { candidate_ids: candidateIds, decision }),

  getEvents: (id: number) =>
    api.get<CandidateEvent[]>(`/candidates/${id}/events`),

  rescore: (id: number) =>
    api.post<Candidate>(`/candidates/${id}/rescore`),
}

// Outreach
export const outreachApi = {
  listForRun: (runId: number) =>
    api.get<OutreachEmail[]>(`/outreach/run/${runId}`),

  listSent: () =>
    api.get<OutreachEmail[]>('/outreach/sent'),

  update: (id: number, data: { subject?: string; body?: string; tone?: string }) =>
    api.put<OutreachEmail>(`/outreach/${id}`, data),

  approve: (id: number) =>
    api.post<OutreachEmail>(`/outreach/${id}/approve`),

  regenerate: (id: number, instruction?: string, tone?: string) =>
    api.post<OutreachEmail>(`/outreach/${id}/regenerate`, { instruction, tone }),

  bulkSend: (emailIds: number[]) =>
    api.post('/outreach/bulk-send', { email_ids: emailIds }),

  deleteEmail: (id: number) =>
    api.delete(`/outreach/${id}`),

  bulkDelete: (emailIds: number[]) =>
    api.post<{ deleted: number }>('/outreach/bulk-delete', { email_ids: emailIds }),
}

export const schedulingApi = {
  createRequest: (data: {
    email_id: number
    slots: { start_at: string; end_at: string }[]
  }) => api.post<ScheduleRequest>('/scheduling/requests', data),

  listRequests: () =>
    api.get<ScheduleRequest[]>('/scheduling/requests'),

  getPublic: (token: string) =>
    api.get<PublicSchedule>(`/scheduling/public/${token}`),

  bookPublic: (token: string, data: {
    slot_id: number
    candidate_name: string
    candidate_email: string
    candidate_phone: string
    resume_file?: File | null
    notes?: string
  }) => {
    const formData = new FormData()
    formData.append('slot_id', String(data.slot_id))
    formData.append('candidate_name', data.candidate_name)
    formData.append('candidate_email', data.candidate_email)
    formData.append('candidate_phone', data.candidate_phone)
    if (data.notes) formData.append('notes', data.notes)
    if (data.resume_file) formData.append('resume_file', data.resume_file)
    return api.post(`/scheduling/public/${token}/book`, formData)
  },
}

// Analytics
export const analyticsApi = {
  dashboard: () => api.get<DashboardAnalytics>('/analytics/dashboard'),
  funnel: () => api.get<PipelineFunnelItem[]>('/analytics/pipeline-funnel'),
}

// Chat
export const chatApi = {
  sendMessage: (message: string, history: ChatMessage[]) =>
    api.post('/chat/message', { message, history }, { responseType: 'stream' }),
}
