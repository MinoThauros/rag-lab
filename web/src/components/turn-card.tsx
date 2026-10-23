import ReactMarkdown from 'react-markdown'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import type { Turn } from '@/types/chat'
import { normalizeMath, pagesLabel } from '@/utils/format'

// One question with its answer (math typeset with KaTeX), citations and sources.
export function TurnCard({ turn }: { turn: Turn }) {
  const showFooter = turn.status === 'done' && (turn.cited?.length || turn.retrieved)

  return (
    <Card>
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

      {showFooter && (
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
                    [{n + 1}] {s.section} · {pagesLabel(s.pages)} · semantic {s.semantic_rank ?? '–'} · keyword{' '}
                    {s.keyword_rank ?? '–'}
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
  )
}
