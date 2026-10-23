import { useEffect, useState } from 'react'

// The open conversation's id, kept in the URL (?c=…) so a refresh resumes it.
export function useConversationId() {
  const [conversationId, setConversationId] = useState(
    () => new URLSearchParams(location.search).get('c') ?? ''
  )

  useEffect(() => {
    const url = new URL(location.href)
    if (conversationId) url.searchParams.set('c', conversationId)
    else url.searchParams.delete('c')
    history.replaceState(null, '', url)
  }, [conversationId])

  return [conversationId, setConversationId] as const
}
