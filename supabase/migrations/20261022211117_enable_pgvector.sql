-- pgvector: the vector column type, distance operators and vector indexes.
-- Supabase keeps extensions in the `extensions` schema rather than `public`.
create extension if not exists vector with schema extensions;
