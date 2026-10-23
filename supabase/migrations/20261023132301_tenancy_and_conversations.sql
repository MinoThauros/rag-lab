-- Multi-tenancy (per user) and conversation memory.
-- The server uses the secret key and filters by owner in code; the RLS policies
-- below are a second line of defense for any access made with a user's token.

-- 1. Documents belong to a user. Nullable for now: existing documents get an
--    owner right after this migration, then a later migration makes it NOT NULL.
alter table public.documents
  add column owner_id uuid references auth.users (id) on delete cascade;

create index documents_owner_id on public.documents (owner_id);

create policy "own documents" on public.documents
  for all using (owner_id = (select auth.uid()));

-- 2. Conversations and their messages. A conversation belongs to a user, not to
--    a document; retrieval searches all of the user's documents.
create table public.conversations (
  id                  uuid primary key default gen_random_uuid(),
  owner_id            uuid not null references auth.users (id) on delete cascade,
  -- Rolling summary of every exchange older than the verbatim window.
  summary             text not null default '',
  -- Highest message seq covered by the summary; later messages are sent verbatim.
  summarized_through  int not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index conversations_owner_id on public.conversations (owner_id, updated_at desc);

create table public.messages (
  id                   bigint generated always as identity primary key,
  conversation_id      uuid not null references public.conversations (id) on delete cascade,
  seq                  int not null,
  role                 text not null check (role in ('user', 'assistant')),
  content              text not null,          -- exactly what was typed, or the answer text
  standalone_question  text,                   -- user turns: the rewritten question used for search
  sources              jsonb,                  -- assistant turns: cited sections and pages
  created_at           timestamptz not null default now(),
  unique (conversation_id, seq)
);

alter table public.conversations enable row level security;
alter table public.messages enable row level security;

create policy "own conversations" on public.conversations
  for all using (owner_id = (select auth.uid()));

create policy "own messages" on public.messages
  for all using (
    exists (
      select 1 from public.conversations c
       where c.id = conversation_id and c.owner_id = (select auth.uid())
    )
  );

-- 3. Search across all of the owner's documents, optionally narrowed to some.
drop function public.hybrid_search(extensions.vector, text, text, int, int, int);

create function public.hybrid_search(
  query_embedding extensions.vector(1536),
  query_text text,
  owner uuid,
  match_count int,
  document_ids text[] default null, -- null = all of the owner's documents
  candidate_count int default 20,
  rrf_k int default 60
)
returns table (
  id text,
  document_id text,
  section text,
  pages int[],
  kind text,
  text text,
  tokens int,
  semantic_rank bigint,
  keyword_rank bigint,
  score numeric
)
language sql
stable
set search_path = public, extensions
as $$
  with scope as (
    select d.id from documents d
     where d.owner_id = owner
       and (document_ids is null or d.id = any (document_ids))
  ),
  semantic as (
    select c.id, row_number() over (order by c.embedding <=> query_embedding) as rank
      from chunks c
     where c.document_id in (select id from scope)
     order by c.embedding <=> query_embedding
     limit candidate_count
  ),
  keyword as (
    select c.id, row_number() over (order by ts_rank_cd(c.fts, q) desc) as rank
      from chunks c, websearch_to_tsquery('english', query_text) as q
     where c.document_id in (select id from scope) and c.fts @@ q
     order by ts_rank_cd(c.fts, q) desc
     limit candidate_count
  )
  select c.id,
         c.document_id,
         array_to_string(c.heading_path, ' › '),
         c.pages, c.kind, c.text, c.tokens,
         s.rank, k.rank,
         round((coalesce(1.0 / (rrf_k + s.rank), 0) + coalesce(1.0 / (rrf_k + k.rank), 0))::numeric, 4)
    from semantic s
    full outer join keyword k on k.id = s.id
    join chunks c on c.id = coalesce(s.id, k.id)
   order by 10 desc
   limit match_count;
$$;

revoke execute on function public.hybrid_search(extensions.vector, text, uuid, int, text[], int, int)
  from public, anon, authenticated;
