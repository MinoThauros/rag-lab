import { useState, type FormEvent, type KeyboardEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

// Question box: Enter sends, Shift+Enter adds a line.
export function AskForm({ disabled, onAsk }: { disabled: boolean; onAsk: (question: string) => void }) {
  const [draft, setDraft] = useState('')

  const submit = (event?: FormEvent) => {
    event?.preventDefault()
    const question = draft.trim()
    if (!question || disabled) return
    setDraft('')
    onAsk(question)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) submit(event)
  }

  return (
    <form onSubmit={submit} className="flex gap-2 border-t py-4">
      <Textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Ask a question… (Enter to send, Shift+Enter for a new line)"
        className="min-h-12 resize-none"
        disabled={disabled}
      />
      <Button type="submit" disabled={disabled || !draft.trim()}>
        Ask
      </Button>
    </form>
  )
}
