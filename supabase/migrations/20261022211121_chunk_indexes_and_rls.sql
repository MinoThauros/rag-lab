-- Approximate nearest-neighbour search on embeddings, by cosine distance (<=>).
create index chunks_embedding_hnsw on public.chunks
  using hnsw (embedding extensions.vector_cosine_ops);

-- Full-text (keyword) search.
create index chunks_fts_gin on public.chunks using gin (fts);

create index chunks_document_id on public.chunks (document_id);

-- Supabase exposes `public` tables through its REST API. RLS with no policies
-- denies that API everything; the direct connection (table owner) is unaffected.
alter table public.documents enable row level security;
alter table public.chunks enable row level security;
