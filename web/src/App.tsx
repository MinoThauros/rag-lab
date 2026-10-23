import { useEffect, useRef } from 'react'
import { AskForm } from '@/components/ask-form'
import { ConversationSidebar } from '@/components/conversation-sidebar'
import { LoginForm } from '@/components/login-form'
import { TurnCard } from '@/components/turn-card'
import { useAuth } from '@/hooks/useAuth'
import { useChat } from '@/hooks/use-chat'
import { useConversationId } from '@/hooks/use-conversation-id'

export default function App() {
  const { user, isLoading } = useAuth()
  if (isLoading) return null
  if (!user) return <LoginForm />
  return <ChatPage />
}

function ChatPage() {
  const [conversationId, setConversationId] = useConversationId()
  const { turns, busy, ask } = useChat(conversationId, setConversationId)
  const bottom = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' })
  }, [turns])

  return (
    <div className="flex h-screen">
      <ConversationSidebar
        activeId={conversationId}
        disabled={busy}
        onSelect={setConversationId}
        onNew={() => setConversationId('')}
      />

      <div className="mx-auto flex h-screen w-full max-w-3xl flex-col px-4">
        <header className="py-5">
          <h1 className="text-lg font-semibold">Ask your documents</h1>
          <p className="text-sm text-muted-foreground">Answers from your documents only, with citations.</p>
        </header>

        <main className="flex-1 space-y-6 overflow-y-auto pb-6">
          {turns.map((turn, i) => (
            <TurnCard key={i} turn={turn} />
          ))}
          <div ref={bottom} />
        </main>

        <AskForm disabled={busy} onAsk={ask} />
      </div>
    </div>
  )
}
