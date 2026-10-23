export type Source = {
  section: string
  pages: number[]
  kind?: 'text' | 'figure'
  semantic_rank?: number | null
  keyword_rank?: number | null
}

// One question and its answer, as shown on the page.
export type Turn = {
  question: string
  standalone?: string // what retrieval searched for, when the rewrite changed the question
  answer: string
  status: 'streaming' | 'done' | 'failed'
  cited?: { n: number; source: Source }[]
  retrieved?: Source[] // everything retrieved (only for answers given in this session)
  promptTokens?: number
  answerTokens?: number
  error?: string
}

export type ConversationSummary = { id: string; summary: string; updated_at: string }

// A row from GET /api/conversations/:id
export type StoredMessage = {
  seq: number
  role: 'user' | 'assistant'
  content: string
  standalone_question: string | null
  sources: { n: number; section: string; pages: number[] }[] | null
}
