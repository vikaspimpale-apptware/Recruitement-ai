export interface User {
  id: number
  email: string
  full_name: string
  is_active: boolean
}

export interface Workflow {
  id: number
  name: string
  job_title: string
  job_description: string | null
  location: string
  seniority: string
  keywords: string[]
  step_configs: StepConfig[]
  is_active: boolean
  created_at: string
}

export interface WorkflowRun {
  id: number
  workflow_id: number
  status: 'pending' | 'running' | 'waiting_review' | 'completed' | 'failed'
  current_step: string | null
  state_data: Record<string, unknown>
  error_message: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
}

export interface Candidate {
  id: number
  workflow_run_id: number
  full_name: string
  headline: string | null
  linkedin_url: string | null
  location: string | null
  skills: string[]
  experience_years: number | null
  experience: ExperienceItem[]
  education: EducationItem[]
  email: string | null
  phone: string | null
  current_company: string | null
  profile_description: string | null
  profile_summary: string | null
  resume_url: string | null
  ai_score: number | null
  ai_score_reason: string | null
  recruiter_score_override: number | null
  recruiter_notes: string | null
  status: CandidateStatus
  recruiter_decision: string | null
  sourced_at: string | null
  filtered_at: string | null
  contacted_at: string | null
  scheduled_at: string | null
  created_at: string
}

export type CandidateStatus =
  | 'sourced'
  | 'filtered'
  | 'approved'
  | 'rejected'
  | 'flagged'
  | 'contacted'
  | 'replied'
  | 'scheduled'

export interface ExperienceItem {
  title: string
  company: string
  duration: string
  description?: string
}

export interface EducationItem {
  degree: string
  institution: string
  year: number
}

export interface OutreachEmail {
  id: number
  candidate_id: number
  candidate_name?: string | null
  candidate_email?: string | null
  subject: string
  body: string
  tone: string
  status: 'draft' | 'approved' | 'sent' | 'replied' | 'bounced'
  opened: boolean
  replied: boolean
  reply_body: string | null
  reply_sentiment: string | null
  sent_at: string | null
  created_at: string
}

export interface InterviewSlot {
  id: number
  start_at: string
  end_at: string
  is_booked: boolean
}

export interface InterviewBooking {
  id: number
  slot_id: number
  candidate_name: string
  candidate_email: string
  candidate_phone: string
  resume_url: string | null
  notes: string | null
  calendar_status: 'pending' | 'synced' | 'failed'
  created_at: string
}

export interface ScheduleRequest {
  id: number
  outreach_email_id: number
  token: string
  status: 'open' | 'booked' | 'closed'
  created_at: string
  slots: InterviewSlot[]
  bookings: InterviewBooking[]
}

export interface PublicSchedule {
  token: string
  status: 'open' | 'booked' | 'closed'
  candidate_name: string
  candidate_headline: string | null
  slots: InterviewSlot[]
}

export interface CandidateEvent {
  id: number
  event_type: string
  agent: string | null
  description: string
  metadata: Record<string, unknown>
  created_at: string
}

export interface DashboardAnalytics {
  total_sourced: number
  total_contacted: number
  total_scheduled: number
  emails_sent: number
  emails_replied: number
  reply_rate: number
  conversion_to_interview: number
  active_workflow_runs: number
}

export interface PipelineFunnelItem {
  stage: string
  count: number
}

export interface StepConfig {
  step_name: string
  enabled: boolean
  order_index: number
  config: Record<string, unknown>
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}
