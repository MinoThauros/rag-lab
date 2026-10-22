-- One row per source document; one row per chunk of it.
-- Re-indexing a document = delete it (its chunks cascade) and insert again.

create table public.documents (
  id          text primary key,                    -- e.g. 'maths-for-ml'
  title       text not null,
  source_path text not null,                       -- e.g. 'data/maths_for_ML.pdf'
  created_at  timestamptz not null default now()
);

create table public.chunks (
  id               text primary key,               -- '<document id>:chunk-<n>'
  document_id      text not null references public.documents (id) on delete cascade,
  kind             text not null check (kind in ('text', 'figure')),
  heading_path     text[] not null,
  text             text not null,                  -- what is embedded and shown to the LLM
  tokens           int not null,                   -- cl100k_base count, as chunked
  pages            int[] not null,
  keywords         text[] not null default '{}',
  equation_numbers text[] not null default '{}',
  figure_number    text,
  source_ids       text[] not null,
  -- Filled by the embedding step, separately from chunking, so a document can be
  -- re-embedded with another model without re-chunking.
  embedding        extensions.vector(1536),
  embedding_model  text,                           -- e.g. 'text-embedding-3-large@1536'
  -- Keyword half of hybrid search: heading path and keywords weighted above body text.
  -- Filled at insert time.
  fts              tsvector,
  created_at       timestamptz not null default now()
);
