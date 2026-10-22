import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Textarea } from '@/components/ui/textarea'

type Source = {
  section: string
  pages: number[]
  kind: 'text' | 'figure'
  semantic_rank: string | null
  keyword_rank: string | null
}

type Turn = {
  question: string
  answer: string
  status: 'streaming' | 'done' | 'failed'
  cited?: number[]
  sources?: Source[]
  promptTokens?: number
  answerTokens?: number
  error?: string
}

// Qwen writes inline math as "$ x $"; Markdown math needs "$x$".
const normalizeMath = (text: string) =>
  text.replace(/(?<!\$)\$ +([^$\n]+?) +\$(?!\$)/g, (_, inner: string) => `$${inner}$`)

const pagesLabel = (pages: number[]) =>
  pages.length > 1 ? `pp. ${pages[0]}–${pages[pages.length - 1]}` : `p. ${pages[0]}`

export default function App() {
  const [turns, setTurns] = useState<Turn[]>([])
  const [draft, setDraft] = useState('')
  const bottom = useRef<HTMLDivElement>(null)
  const busy = turns.at(-1)?.status === 'streaming'

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

    const stream = new EventSource(`/api/ask?q=${encodeURIComponent(question)}`)
    stream.addEventListener('token', (e) => {
      const token = JSON.parse((e as MessageEvent).data) as string
      update((t) => ({ answer: t.answer + token }))
    })
    stream.addEventListener('done', (e) => {
      update({ ...JSON.parse((e as MessageEvent).data), status: 'done' })
      stream.close()
    })
    stream.addEventListener('failure', (e) => {
      update({ status: 'failed', error: JSON.parse((e as MessageEvent).data).message })
      stream.close()
    })
    stream.onerror = () => {
      update((t) => (t.status === 'streaming' ? { status: 'failed', error: 'Connection to the API lost.' } : {}))
      stream.close()
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) ask(event)
  }

  return (
    <div className="mx-auto flex h-screen max-w-3xl flex-col px-4">
      <header className="py-5">
        <h1 className="text-lg font-semibold">Mathematics for Machine Learning</h1>
        <p className="text-sm text-muted-foreground">Answers from the book only, with citations.</p>
      </header>

      <main className="flex-1 space-y-6 overflow-y-auto pb-6">
        {turns.map((turn, i) => (
          <Card key={i}>
            <CardHeader>
              <CardTitle className="text-base">{turn.question}</CardTitle>
            </CardHeader>
            <CardContent className="prose-answer space-y-3 text-sm leading-relaxed">
              <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                {normalizeMath(turn.answer)}
              </ReactMarkdown>
              {turn.status === 'streaming' && <span className="text-muted-foreground">▍</span>}
              {turn.status === 'failed' && <p className="text-destructive">{turn.error}</p>}
            </CardContent>

            {turn.status === 'done' && turn.sources && (
              <CardFooter className="flex-col items-start gap-3 text-sm">
                <div className="flex flex-col gap-1">
                  {turn.cited?.map((n) => {
                    const s = turn.sources![n - 1]
                    return (
                      <div key={n} className="flex items-center gap-2">
                        <Badge variant="secondary">[{n}]</Badge>
                        <span>{s.section}</span>
                        <span className="text-muted-foreground">{pagesLabel(s.pages)}</span>
                      </div>
                    )
                  })}
                </div>
                <Collapsible>
                  <CollapsibleTrigger render={<Button variant="ghost" size="sm" />}>
                    All retrieved sources ({turn.sources.length})
                  </CollapsibleTrigger>
                  <CollapsibleContent className="mt-2 space-y-1 text-muted-foreground">
                    {turn.sources.map((s, n) => (
                      <div key={n}>
                        [{n + 1}] {s.section} · {pagesLabel(s.pages)} · semantic {s.semantic_rank ?? '–'} ·
                        keyword {s.keyword_rank ?? '–'}
                      </div>
                    ))}
                  </CollapsibleContent>
                </Collapsible>
                <span className="text-xs text-muted-foreground">
                  {turn.promptTokens} prompt tokens · {turn.answerTokens} answer tokens
                </span>
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
          placeholder="Ask a question about the book… (Enter to send, Shift+Enter for a new line)"
          className="min-h-12 resize-none"
          disabled={busy}
        />
        <Button type="submit" disabled={busy || !draft.trim()}>
          Ask
        </Button>
      </form>
    </div>
  )
}
