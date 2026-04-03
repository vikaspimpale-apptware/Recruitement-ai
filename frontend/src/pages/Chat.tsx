import { useState, useRef, useEffect, useCallback } from 'react'
import { Send, BrainCircuit, User, Loader2, Zap, AlertCircle } from 'lucide-react'
import type { ChatMessage } from '@/types'
import Button from '@/components/ui/Button'
import { clsx } from 'clsx'
import { API_BASE_URL, API_ORIGIN } from '@/api/client'

const SUGGESTIONS = [
  'Find me 10 senior Python engineers in Bangalore open to work',
  'What candidates are currently in my pipeline?',
  'What is the reply rate on my last outreach campaign?',
  'How do I configure the filtering step for my workflow?',
]

/** Render **bold** and `code` markers in assistant messages */
function renderContent(text: string) {
  // Split on **bold** and `code` tokens
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={i} className="bg-slate-100 text-blue-700 rounded px-1 text-xs font-mono">{part.slice(1, -1)}</code>
    }
    return <span key={i}>{part}</span>
  })
}

function MessageBubble({ msg }: { msg: ChatMessage & { error?: boolean } }) {
  const isUser = msg.role === 'user'
  const isWarning = !isUser && msg.content.startsWith('⚠️')
  return (
    <div className={clsx('flex gap-3 items-start', isUser ? 'justify-end' : 'justify-start')}>
      {!isUser && (
        <div className={clsx(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-xl',
          msg.error ? 'bg-red-500' : isWarning ? 'bg-amber-500' : 'bg-blue-600',
        )}>
          {msg.error ? <AlertCircle className="h-4 w-4 text-white" /> : <BrainCircuit className="h-4 w-4 text-white" />}
        </div>
      )}
      <div
        className={clsx(
          'max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed',
          isUser
            ? 'bg-blue-600 text-white rounded-br-sm whitespace-pre-wrap'
            : msg.error
            ? 'bg-red-50 border border-red-200 text-red-700 rounded-bl-sm shadow-sm'
            : isWarning
            ? 'bg-amber-50 border border-amber-200 text-amber-900 rounded-bl-sm shadow-sm'
            : 'bg-white border border-slate-200 text-slate-700 rounded-bl-sm shadow-sm',
        )}
      >
        {isUser
          ? msg.content
          : <div className="space-y-1">
              {msg.content.split('\n').map((line, i) => (
                <div key={i}>{renderContent(line)}</div>
              ))}
            </div>
        }
      </div>
      {isUser && (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-slate-200">
          <User className="h-4 w-4 text-slate-600" />
        </div>
      )}
    </div>
  )
}

function TypingDots() {
  return (
    <div className="flex gap-3 items-start">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-blue-600">
        <BrainCircuit className="h-4 w-4 text-white" />
      </div>
      <div className="max-w-[75%] rounded-2xl rounded-bl-sm px-4 py-3 bg-white border border-slate-200 shadow-sm flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: '0ms' }} />
        <span className="h-2 w-2 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: '150ms' }} />
        <span className="h-2 w-2 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: '300ms' }} />
      </div>
    </div>
  )
}

type ExtMessage = ChatMessage & { error?: boolean }

export default function Chat() {
  const [messages, setMessages] = useState<ExtMessage[]>([
    {
      role: 'assistant',
      content: "Hi! I'm your AI recruitment assistant powered by GPT-4o.\n\nI can help you:\n• Find candidates for a role\n• Check your pipeline status\n• Explain how to configure workflows\n• Answer questions about your recruitment data\n\nWhat would you like to do?",
    },
  ])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const [wsStatus, setWsStatus] = useState<'connecting' | 'connected' | 'error'>('connecting')
  const wsRef = useRef<WebSocket | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const pendingResolveRef = useRef<((content: string) => void) | null>(null)
  const accumulatedRef = useRef('')

  const connectWs = useCallback(() => {
    const token = localStorage.getItem('access_token')
    if (!token) return

    const wsProtocol = API_ORIGIN.startsWith('https://') ? 'wss://' : 'ws://'
    const wsHost = API_ORIGIN.replace(/^https?:\/\//, '')
    const wsUrl = `${wsProtocol}${wsHost}/api/chat/ws`
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      setWsStatus('connected')
      // Send auth token as first message
      ws.send(JSON.stringify({ type: 'auth', token }))
    }

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data.type === 'chunk') {
          accumulatedRef.current += data.data
          setStreamingContent(accumulatedRef.current)
        } else if (data.type === 'done') {
          const finalContent = accumulatedRef.current
          accumulatedRef.current = ''
          setStreamingContent('')
          setStreaming(false)
          if (pendingResolveRef.current) {
            pendingResolveRef.current(finalContent)
            pendingResolveRef.current = null
          }
        } else if (data.type === 'error') {
          accumulatedRef.current = ''
          setStreamingContent('')
          setStreaming(false)
          if (pendingResolveRef.current) {
            pendingResolveRef.current(`Error: ${data.data}`)
            pendingResolveRef.current = null
          }
        }
      } catch {
        // ignore malformed messages
      }
    }

    ws.onerror = () => setWsStatus('error')
    ws.onclose = () => {
      setWsStatus('error')
      // Reconnect after 3s
      setTimeout(connectWs, 3000)
    }
  }, [])

  useEffect(() => {
    connectWs()
    return () => {
      wsRef.current?.close()
    }
  }, [connectWs])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingContent])

  const sendMessage = async (text?: string) => {
    const msg = text ?? input.trim()
    if (!msg || streaming) return
    setInput('')

    const userMsg: ExtMessage = { role: 'user', content: msg }
    setMessages((prev) => [...prev, userMsg])
    setStreaming(true)
    accumulatedRef.current = ''

    // Try WebSocket first
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      const historyForWs = messages.map((m) => ({ role: m.role, content: m.content }))
      wsRef.current.send(JSON.stringify({ type: 'chat', message: msg, history: historyForWs }))

      const content = await new Promise<string>((resolve) => {
        pendingResolveRef.current = resolve
        // Timeout fallback after 30s
        setTimeout(() => {
          if (pendingResolveRef.current) {
            pendingResolveRef.current('Request timed out. Please try again.')
            pendingResolveRef.current = null
          }
        }, 30000)
      })

      setMessages((prev) => [...prev, {
        role: 'assistant',
        content: content || "I processed your request.",
        error: content.startsWith('Error:'),
      }])
    } else {
      // HTTP fallback
      try {
        const token = localStorage.getItem('access_token')
        const response = await fetch(`${API_BASE_URL}/chat/message`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ message: msg, history: messages.map((m) => ({ role: m.role, content: m.content })) }),
        })

        if (!response.ok) throw new Error(`HTTP ${response.status}`)

        const reader = response.body?.getReader()
        const decoder = new TextDecoder()
        let fullContent = ''

        if (reader) {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            const chunk = decoder.decode(value, { stream: true })
            const lines = chunk.split('\n')
            for (const line of lines) {
              if (!line.startsWith('data: ')) continue
              try {
                const parsed = JSON.parse(line.slice(6))
                if (parsed.type === 'chunk') {
                  fullContent += parsed.data
                  setStreamingContent(fullContent)
                }
              } catch { /* skip */ }
            }
          }
        }

        setMessages((prev) => [...prev, { role: 'assistant', content: fullContent || 'I processed your request.' }])
        setStreamingContent('')
      } catch (err) {
        setMessages((prev) => [...prev, {
          role: 'assistant',
          content: `Connection issue. Backend not reachable at ${API_ORIGIN}.`,
          error: true,
        }])
      } finally {
        setStreaming(false)
      }
    }
  }

  return (
    <div className="flex flex-col min-h-[calc(100vh-3.5rem)] md:h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-4 py-4 sm:px-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600">
            <BrainCircuit className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="font-bold text-slate-900">AI Recruitment Assistant</h1>
            <p className="text-xs text-slate-500 flex items-center gap-1.5">
              <Zap className="h-3 w-3 text-emerald-500" />
              Powered by GPT-4o · Real-time streaming
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={clsx(
            'flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium',
            wsStatus === 'connected' ? 'bg-emerald-100 text-emerald-700' :
            wsStatus === 'connecting' ? 'bg-amber-100 text-amber-700' :
            'bg-red-100 text-red-700'
          )}>
            <span className={clsx('h-1.5 w-1.5 rounded-full', wsStatus === 'connected' ? 'bg-emerald-500 animate-pulse' : wsStatus === 'connecting' ? 'bg-amber-500' : 'bg-red-500')} />
            {wsStatus === 'connected' ? 'Connected' : wsStatus === 'connecting' ? 'Connecting...' : 'Reconnecting...'}
          </span>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5 apptware-hide-scrollbar">
        {messages.map((msg, i) => (
          <MessageBubble key={i} msg={msg} />
        ))}

        {/* Streaming */}
        {streaming && (
          streamingContent
            ? (
              <div className="flex gap-3 items-start">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-blue-600">
                  <BrainCircuit className="h-4 w-4 text-white" />
                </div>
                <div className="max-w-[75%] rounded-2xl rounded-bl-sm px-4 py-3 text-sm leading-relaxed bg-white border border-slate-200 shadow-sm text-slate-700 whitespace-pre-wrap">
                  {streamingContent}
                  <span className="inline-block h-4 w-0.5 bg-blue-500 ml-0.5 animate-pulse" />
                </div>
              </div>
            )
            : <TypingDots />
        )}
        <div ref={bottomRef} />
      </div>

      {/* Suggestions */}
      {messages.length === 1 && (
        <div className="px-4 sm:px-6 pb-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => sendMessage(s)}
              className="text-left rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-600 hover:border-blue-300 hover:bg-blue-50 transition-all cursor-pointer shadow-sm"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="border-t border-slate-200 bg-white px-6 py-4 shrink-0">
        <div className="flex items-end gap-3 max-w-4xl mx-auto">
          <div className="flex-1 relative">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  sendMessage()
                }
              }}
              placeholder={
                wsStatus === 'connected'
                  ? 'Ask anything about your recruitment pipeline...'
                  : wsStatus === 'error'
                  ? 'WebSocket unavailable, using HTTP fallback...'
                  : 'Connecting to AI assistant...'
              }
              disabled={false}
              rows={1}
              className="w-full resize-none rounded-xl border border-slate-300 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent max-h-40 overflow-y-auto apptware-hide-scrollbar disabled:bg-slate-50 disabled:text-slate-400"
              style={{ minHeight: '48px' }}
            />
          </div>
          <Button
            onClick={() => sendMessage()}
            disabled={!input.trim() || streaming}
            className="h-12 w-12 rounded-xl p-0 justify-center"
          >
            {streaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
        <p className="text-center text-xs text-slate-400 mt-2">Enter to send · Shift+Enter for new line</p>
      </div>
    </div>
  )
}
