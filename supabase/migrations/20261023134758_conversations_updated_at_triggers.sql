-- updated_at is maintained by the database, not the app (same pattern as
-- PostgresBackend's set_updated_at / trg_<table>_updated_at).

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger trg_conversations_updated_at
  before update on public.conversations
  for each row execute function public.set_updated_at();

-- A new message is activity on its conversation.
create function public.touch_conversation_on_message()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.conversations set updated_at = now() where id = new.conversation_id;
  return new;
end;
$$;

create trigger trg_messages_touch_conversation
  after insert on public.messages
  for each row execute function public.touch_conversation_on_message();
