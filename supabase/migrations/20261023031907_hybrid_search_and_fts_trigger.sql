-- Database-side pieces so the app can use supabase-js (like PostgresBackend):
--   1. a trigger that keeps chunks.fts in sync with the chunk's text
--   2. hybrid_search(), called with supabase.rpc("hybrid_search", ...)

-- 1. Keyword index: heading path and margin keywords (weight A) rank above body text (B).
create function public.chunks_set_fts()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.fts :=
       setweight(to_tsvector('english', array_to_string(new.heading_path, ' ') || ' ' || array_to_string(new.keywords, ' ')), 'A')
    || setweight(to_tsvector('english', new.text), 'B');
  return new;
end;
$$;

create trigger chunks_set_fts
  before insert or update of text, heading_path, keywords on public.chunks
  for each row execute function public.chunks_set_fts();

-- 2. Hybrid search: top candidates by vector similarity and by keyword match,
-- merged with reciprocal rank fusion (score = sum of 1 / (rrf_k + rank)).
create function public.hybrid_search(
  query_embedding extensions.vector(1536),
  query_text text,
  filter_document_id text,
  match_count int,
  candidate_count int default 20,
  rrf_k int default 60
)
returns table (
  id text,
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
  with semantic as (
    select c.id, row_number() over (order by c.embedding <=> query_embedding) as rank
      from chunks c
     where c.document_id = filter_document_id
     order by c.embedding <=> query_embedding
     limit candidate_count
  ),
  keyword as (
    select c.id, row_number() over (order by ts_rank_cd(c.fts, q) desc) as rank
      from chunks c, websearch_to_tsquery('english', query_text) as q
     where c.document_id = filter_document_id and c.fts @@ q
     order by ts_rank_cd(c.fts, q) desc
     limit candidate_count
  )
  select c.id,
         array_to_string(c.heading_path, ' › '),
         c.pages, c.kind, c.text, c.tokens,
         s.rank, k.rank,
         round((coalesce(1.0 / (rrf_k + s.rank), 0) + coalesce(1.0 / (rrf_k + k.rank), 0))::numeric, 4)
    from semantic s
    full outer join keyword k on k.id = s.id
    join chunks c on c.id = coalesce(s.id, k.id)
   order by 9 desc
   limit match_count;
$$;

-- Server-side only: the public API roles can't call it; the secret key can.
revoke execute on function public.hybrid_search(extensions.vector, text, text, int, int, int)
  from public, anon, authenticated;
