import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { useAuthStore } from '@/store/auth'
import Layout from '@/components/Layout'
import Login from '@/pages/Login'
import Register from '@/pages/Register'
import Dashboard from '@/pages/Dashboard'
import Workflows from '@/pages/Workflows'
import WorkflowDetail from '@/pages/WorkflowDetail'
import NewWorkflow from '@/pages/NewWorkflow'
import ShortlistReview from '@/pages/ShortlistReview'
import EmailReview from '@/pages/EmailReview'
import SentMails from '@/pages/SentMails'
import PublicBooking from '@/pages/PublicBooking'
import Candidates from '@/pages/Candidates'
import Chat from '@/pages/Chat'
import Analytics from '@/pages/Analytics'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { token } = useAuthStore()
  if (!token) return <Navigate to="/login" replace />
  return <>{children}</>
}

export default function App() {
  return (
    <BrowserRouter>
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 4000,
          style: {
            borderRadius: '14px',
            background: '#0f172a',
            color: '#f8fafc',
            fontSize: '14px',
            border: '1px solid rgba(148, 163, 184, 0.25)',
            boxShadow: '0 10px 30px rgba(2, 6, 23, 0.28)',
          },
        }}
      />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/book/:token" element={<PublicBooking />} />

        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="workflows" element={<Workflows />} />
          <Route path="workflows/new" element={<NewWorkflow />} />
          <Route path="workflows/:id/edit" element={<NewWorkflow />} />
          <Route path="workflows/:id" element={<WorkflowDetail />} />
          <Route path="workflows/runs/:runId/review" element={<ShortlistReview />} />
          <Route path="workflows/runs/:runId/emails" element={<EmailReview />} />
          <Route path="candidates" element={<Candidates />} />
          <Route path="chat" element={<Chat />} />
          <Route path="sent-mails" element={<SentMails />} />
          <Route path="analytics" element={<Analytics />} />
        </Route>

        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
