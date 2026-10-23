import { Button } from '@/components/ui/button'
import { useAuth } from '@/hooks/useAuth'
import { useConversations } from '@/hooks/use-conversations'

type Props = {
  activeId: string
  disabled: boolean
  onSelect: (id: string) => void
  onNew: () => void
}

export function ConversationSidebar({ activeId, disabled, onSelect, onNew }: Props) {
  const { user, logout } = useAuth()
  const { data: conversations = [] } = useConversations()

  return (
    <aside className="hidden w-64 shrink-0 flex-col gap-2 border-r p-3 md:flex">
      <Button variant="outline" onClick={onNew} disabled={disabled}>
        New conversation
      </Button>
      <div className="flex-1 space-y-1 overflow-y-auto">
        {conversations.map((c) => (
          <button
            key={c.id}
            onClick={() => !disabled && onSelect(c.id)}
            className={`w-full truncate rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted ${
              c.id === activeId ? 'bg-muted font-medium' : ''
            }`}
            title={c.summary || undefined}
          >
            {c.summary || new Date(c.updated_at).toLocaleString()}
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between gap-2 border-t pt-2 text-xs text-muted-foreground">
        <span className="truncate">{user?.email}</span>
        <Button variant="ghost" size="sm" onClick={logout}>
          Sign out
        </Button>
      </div>
    </aside>
  )
}
