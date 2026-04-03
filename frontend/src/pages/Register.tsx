import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { BrainCircuit } from 'lucide-react'
import { authApi } from '@/api'
import { useAuthStore } from '@/store/auth'
import Button from '@/components/ui/Button'
import toast from 'react-hot-toast'

export default function Register() {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const { setAuth } = useAuthStore()
  const navigate = useNavigate()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      await authApi.register(email, fullName, password)
      const res = await authApi.login(email, password)
      setAuth(
        { id: res.data.user_id, email: res.data.email, full_name: res.data.full_name, is_active: true },
        res.data.access_token,
      )
      toast.success('Welcome to RecruitAI!')
      navigate('/dashboard')
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Registration failed'
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-600 shadow-xl shadow-blue-900/40 mb-4">
            <BrainCircuit className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white">RecruitAI</h1>
          <p className="text-slate-400 mt-1 text-sm">AI-powered recruitment automation</p>
        </div>

        <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-8 shadow-2xl">
          <h2 className="text-xl font-semibold text-white mb-6">Create your account</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            {[
              { label: 'Full name', value: fullName, onChange: setFullName, type: 'text', placeholder: 'Jane Smith' },
              { label: 'Email address', value: email, onChange: setEmail, type: 'email', placeholder: 'jane@company.com' },
              { label: 'Password', value: password, onChange: setPassword, type: 'password', placeholder: '••••••••' },
            ].map(({ label, value, onChange, type, placeholder }) => (
              <div key={label} className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-slate-300">{label}</label>
                <input
                  type={type}
                  value={value}
                  onChange={(e) => onChange(e.target.value)}
                  placeholder={placeholder}
                  required
                  className="w-full px-4 py-2.5 rounded-lg bg-white/10 border border-white/20 text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            ))}
            <Button type="submit" loading={loading} className="w-full justify-center py-3 text-base mt-2">
              Create account
            </Button>
          </form>
          <p className="mt-6 text-center text-sm text-slate-400">
            Already have an account?{' '}
            <Link to="/login" className="text-blue-400 hover:text-blue-300 font-medium">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
