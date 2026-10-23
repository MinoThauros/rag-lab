import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { ConversationSummary, StoredMessage } from '@/types/chat'

export const conversationsQueryKey = ['conversations'] as const

export function useConversations() {
  return useQuery({
    queryKey: conversationsQueryKey,
    queryFn: () => api<ConversationSummary[]>('/api/conversations'),
  })
}

export function useConversationMessages(conversationId: string) {
  return useQuery({
    queryKey: ['conversations', conversationId, 'messages'],
    queryFn: () => api<StoredMessage[]>(`/api/conversations/${conversationId}`),
    enabled: Boolean(conversationId),
    retry: false,
  })
}
