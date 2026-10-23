import type { StoredMessage, Turn } from '@/types/chat'

// Stored user/assistant messages → question/answer turns for display.
export function toTurns(messages: StoredMessage[]): Turn[] {
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
