create extension if not exists vector;

create table if not exists public.brain_chunks (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  source_type text not null check (source_type in ('user_profile', 'dsp_record', 'tag_record', 'brain_card', 'fleet_log', 'saved_chat')),
  source_id text not null,
  chunk_index integer not null,
  title text not null,
  heading text,
  content text not null,
  content_hash text not null,
  metadata jsonb not null default '{}'::jsonb,
  embedding vector(768) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, source_type, source_id, chunk_index)
);

create index if not exists brain_chunks_user_source_idx
  on public.brain_chunks (user_id, source_type, source_id);

create index if not exists brain_chunks_embedding_hnsw_idx
  on public.brain_chunks
  using hnsw (embedding vector_cosine_ops);

create index if not exists brain_chunks_fts_idx
  on public.brain_chunks
  using gin (to_tsvector('english', title || ' ' || coalesce(heading, '') || ' ' || content));

alter table public.brain_chunks enable row level security;

create or replace function public.match_brain_chunks(
  match_user_id text,
  query_embedding vector(768),
  match_count integer default 10,
  min_similarity double precision default 0.35,
  source_types text[] default null
)
returns table (
  id uuid,
  source_type text,
  source_id text,
  title text,
  heading text,
  content text,
  metadata jsonb,
  similarity double precision
)
language sql
stable
as $$
  select
    brain_chunks.id,
    brain_chunks.source_type,
    brain_chunks.source_id,
    brain_chunks.title,
    brain_chunks.heading,
    brain_chunks.content,
    brain_chunks.metadata,
    1 - (brain_chunks.embedding <=> query_embedding) as similarity
  from public.brain_chunks
  where brain_chunks.user_id = match_user_id
    and (source_types is null or brain_chunks.source_type = any(source_types))
    and 1 - (brain_chunks.embedding <=> query_embedding) >= min_similarity
  order by brain_chunks.embedding <=> query_embedding
  limit match_count;
$$;
