// The open conversation's turns: loaded from the API when a conversation is
// opened, extended live as answers stream in over Server-Sent Events.
import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Source, Turn } from '@/types/chat'
import { toTurns } from '@/utils/turns'
import { conversationsQueryKey, useConversationMessages } from './use-conversations'

export function useChat(conversationId: string, setConversationId: (id: string) => void) {
  const queryClient = useQueryClient()
  const [turns, setTurns] = useState<Turn[]>([])
  const loadedFor = useRef('') // conversation whose turns are on screen
  const stored = useConversationMessages(conversationId)
  const busy = turns.at(-1)?.status === 'streaming'

  // Show a conversation's stored messages when it's opened (not while streaming into it).
  useEffect(() => {
    if (!conversationId) {
      loadedFor.current = ''
      setTurns([])
    } else if (stored.data && loadedFor.current !== conversationId) {
      loadedFor.current = conversationId
      setTurns(toTurns(stored.data))
    } else if (stored.isError) {
      setConversationId('') // not found, or someone else's
    }
  }, [conversationId, stored.data, stored.isError, setConversationId])

  const updateLast = (patch: Partial<Turn> | ((t: Turn) => Partial<Turn>)) =>
    setTurns((all) => {
      const last = all[all.length - 1]
      return [...all.slice(0, -1), { ...last, ...(typeof patch === 'function' ? patch(last) : patch) }]
    })

  const ask = (question: string) => {
    if (busy) return
    setTurns((all) => [...all, { question, answer: '', status: 'streaming' }])

    const params = new URLSearchParams({ q: question })
    if (conversationId) params.set('conversation', conversationId)
    const stream = new EventSource(`/api/ask?${params}`)

    stream.addEventListener('conversation', (e) => {
      const id = JSON.parse((e as MessageEvent).data) as string
      loadedFor.current = id // the turns on screen already belong to it
      setConversationId(id)
    })
    stream.addEventListener('token', (e) => {
      const token = JSON.parse((e as MessageEvent).data) as string
      updateLast((t) => ({ answer: t.answer + token }))
    })
    stream.addEventListener('done', (e) => {
      const data = JSON.parse((e as MessageEvent).data) as {
        standalone: string
        cited: number[]
        sources: Source[]
        promptTokens?: number
        answerTokens?: number
      }
      updateLast({
        status: 'done',
        standalone: data.standalone,
        retrieved: data.sources,
        cited: data.cited.map((n) => ({ n, source: data.sources[n - 1] })),
        promptTokens: data.promptTokens,
        answerTokens: data.answerTokens,
      })
      stream.close()
      queryClient.invalidateQueries({ queryKey: conversationsQueryKey })
    })
    stream.addEventListener('failure', (e) => {
      updateLast({ status: 'failed', error: JSON.parse((e as MessageEvent).data).message })
      stream.close()
    })
    stream.onerror = () => {
      updateLast((t) =>
        t.status === 'streaming'
          ? { status: 'failed', error: 'Lost the connection to the API. Is it running (npm run web)?' }
          : {}
      )
      stream.close()
    }
  }

  return { turns, busy, ask }
}
