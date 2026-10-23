import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

type User = { id: string; email?: string }

type Source = {
  section: string
  pages: number[]
  kind?: 'text' | 'figure'
  semantic_rank?: number | null
  keyword_rank?: number | null
}

type Turn = {
  question: string
  standalone?: string
  answer: string
  status: 'streaming' | 'done' | 'failed'
  cited?: { n: number; source: Source }[]
  retrieved?: Source[]
  promptTokens?: number
  answerTokens?: number
  error?: string
}

type ConversationSummary = { id: string; summary: string; updated_at: string }

type StoredMessage = {
  seq: number
  role: 'user' | 'assistant'
  content: string
  standalone_question: string | null
  sources: { n: number; section: string; pages: number[] }[] | null
}

// Qwen writes inline math as "$ x $"; Markdown math needs "$x$".
const normalizeMath = (text: string) =>
  text.replace(/(?<!\$)\$ +([^$\n]+?) +\$(?!\$)/g, (_, inner: string) => `$${inner}$`)

const pagesLabel = (pages: number[]) =>
  pages.length > 1 ? `pp. ${pages[0]}–${pages[pages.length - 1]}` : `p. ${pages[0]}`

const conversationFromUrl = () => new URLSearchParams(location.search).get('c') ?? ''

function setConversationInUrl(id: string) {
  const url = new URL(location.href)
  if (id) url.searchParams.set('c', id)
  else url.searchParams.delete('c')
  history.replaceState(null, '', url)
}

function toTurns(messages: StoredMessage[]): Turn[] {
  const turns: Turn[] = []
  for (const m of messages) {
    if (m.role === 'user') {
      turns.push({ question: m.content, standalone: m.standalone_question ?? undefined, answer: '', status: 'done' })
    } else if (turns.length) {
      const last = turns[turns.length - 1]
      last.answer = m.content
      last.cited = (m.sources ?? []).map(({ n, section, pages }) => ({ n, source: { section, pages } }))
    }
  }
  return turns
}

function Login({ onLogin }: { onLogin: (user: User) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    if (response.ok) onLogin(await response.json())
    else setError((await response.json().catch(() => ({}))).error ?? 'Login failed')
  }

  return (
    <div className="flex h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full">
              Sign in
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

export default function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined) // undefined = checking
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [conversationId, setConversationId] = useState(conversationFromUrl)
  const [turns, setTurns] = useState<Turn[]>([])
  const [draft, setDraft] = useState('')
  const bottom = useRef<HTMLDivElement>(null)
  const busy = turns.at(-1)?.status === 'streaming'

  useEffect(() => {
    fetch('/api/auth/me').then(async (r) => setUser(r.ok ? await r.json() : null))
  }, [])

  const refreshConversations = useCallback(async () => {
    const r = await fetch('/api/conversations')
    if (r.ok) setConversations(await r.json())
  }, [])

  useEffect(() => {
    if (user) refreshConversations()
  }, [user, refreshConversations])

  // Load a conversation's messages when it's opened (or on page load from the URL).
  useEffect(() => {
    setConversationInUrl(conversationId)
    if (!user || !conversationId || busy) return
    fetch(`/api/conversations/${conversationId}`).then(async (r) => {
      if (r.ok) setTurns(toTurns(await r.json()))
      else setConversationId('')
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, conversationId])

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' })
  }, [turns])

  const update = (patch: Partial<Turn> | ((t: Turn) => Partial<Turn>)) =>
    setTurns((all) => {
      const last = all[all.length - 1]
      const next = typeof patch === 'function' ? patch(last) : patch
      return [...all.slice(0, -1), { ...last, ...next }]
    })

  const ask = (event?: FormEvent) => {
    event?.preventDefault()
    const question = draft.trim()
    if (!question || busy) return
    setDraft('')
    setTurns((all) => [...all, { question, answer: '', status: 'streaming' }])

    const params = new URLSearchParams({ q: question })
    if (conversationId) params.set('conversation', conversationId)
    const stream = new EventSource(`/api/ask?${params}`)

    stream.addEventListener('conversation', (e) => {
      const id = JSON.parse((e as MessageEvent).data) as string
      setConversationId(id)
    })
    stream.addEventListener('token', (e) => {
      const token = JSON.parse((e as MessageEvent).data) as string
      update((t) => ({ answer: t.answer + token }))
    })
    stream.addEventListener('done', (e) => {
      const data = JSON.parse((e as MessageEvent).data)
      update({
        status: 'done',
        standalone: data.standalone,
        retrieved: data.sources,
        cited: (data.cited as number[]).map((n) => ({ n, source: data.sources[n - 1] })),
        promptTokens: data.promptTokens,
        answerTokens: data.answerTokens,
      })
      stream.close()
      refreshConversations()
    })
    stream.addEventListener('failure', (e) => {
      update({ status: 'failed', error: JSON.parse((e as MessageEvent).data).message })
      stream.close()
    })
    stream.onerror = () => {
      update((t) =>
        t.status === 'streaming'
          ? { status: 'failed', error: 'Lost the connection to the API. Is it running (npm run web)?' }
          : {}
      )
      stream.close()
    }
  }

  const newConversation = () => {
    setConversationId('')
    setTurns([])
  }

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    setUser(null)
    newConversation()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) ask(event)
  }

  if (user === undefined) return null
  if (user === null) return <Login onLogin={setUser} />

  return (
    <div className="flex h-screen">
      <aside className="hidden w-64 shrink-0 flex-col gap-2 border-r p-3 md:flex">
        <Button variant="outline" onClick={newConversation} disabled={busy}>
          New conversation
        </Button>
        <div className="flex-1 space-y-1 overflow-y-auto">
          {conversations.map((c) => (
            <button
              key={c.id}
              onClick={() => !busy && setConversationId(c.id)}
              className={`w-full truncate rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted ${
                c.id === conversationId ? 'bg-muted font-medium' : ''
              }`}
              title={c.summary || undefined}
            >
              {c.summary || new Date(c.updated_at).toLocaleString()}
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between gap-2 border-t pt-2 text-xs text-muted-foreground">
          <span className="truncate">{user.email}</span>
          <Button variant="ghost" size="sm" onClick={logout}>
            Sign out
          </Button>
        </div>
      </aside>

      <div className="mx-auto flex h-screen w-full max-w-3xl flex-col px-4">
        <header className="py-5">
          <h1 className="text-lg font-semibold">Ask your documents</h1>
          <p className="text-sm text-muted-foreground">Answers from your documents only, with citations.</p>
        </header>

        <main className="flex-1 space-y-6 overflow-y-auto pb-6">
          {turns.map((turn, i) => (
            <Card key={i}>
              <CardHeader>
                <CardTitle className="text-base">{turn.question}</CardTitle>
                {turn.standalone && turn.standalone !== turn.question && (
                  <p className="text-xs text-muted-foreground">Searched for: {turn.standalone}</p>
                )}
              </CardHeader>
              <CardContent className="prose-answer space-y-3 text-sm leading-relaxed">
                <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                  {normalizeMath(turn.answer)}
                </ReactMarkdown>
                {turn.status === 'streaming' && <span className="text-muted-foreground">▍</span>}
                {turn.status === 'failed' && <p className="text-destructive">{turn.error}</p>}
              </CardContent>

              {turn.status === 'done' && (turn.cited?.length || turn.retrieved) && (
                <CardFooter className="flex-col items-start gap-3 text-sm">
                  <div className="flex flex-col gap-1">
                    {turn.cited?.map(({ n, source }) => (
                      <div key={n} className="flex items-center gap-2">
                        <Badge variant="secondary">[{n}]</Badge>
                        <span>{source.section}</span>
                        <span className="text-muted-foreground">{pagesLabel(source.pages)}</span>
                      </div>
                    ))}
                  </div>
                  {turn.retrieved && (
                    <Collapsible>
                      <CollapsibleTrigger render={<Button variant="ghost" size="sm" />}>
                        All retrieved sources ({turn.retrieved.length})
                      </CollapsibleTrigger>
                      <CollapsibleContent className="mt-2 space-y-1 text-muted-foreground">
                        {turn.retrieved.map((s, n) => (
                          <div key={n}>
                            [{n + 1}] {s.section} · {pagesLabel(s.pages)} · semantic {s.semantic_rank ?? '–'} ·
                            keyword {s.keyword_rank ?? '–'}
                          </div>
                        ))}
                      </CollapsibleContent>
                    </Collapsible>
                  )}
                  {turn.promptTokens !== undefined && (
                    <span className="text-xs text-muted-foreground">
                      {turn.promptTokens} prompt tokens · {turn.answerTokens} answer tokens
                    </span>
                  )}
                </CardFooter>
              )}
            </Card>
          ))}
          <div ref={bottom} />
        </main>

        <form onSubmit={ask} className="flex gap-2 border-t py-4">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Ask a question… (Enter to send, Shift+Enter for a new line)"
            className="min-h-12 resize-none"
            disabled={busy}
          />
          <Button type="submit" disabled={busy || !draft.trim()}>
            Ask
          </Button>
        </form>
      </div>
    </div>
  )
}
