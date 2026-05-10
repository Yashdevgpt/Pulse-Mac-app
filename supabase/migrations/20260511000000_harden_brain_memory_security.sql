-- Hardens Pulse Brain memory against Supabase Security Advisor warnings.
--
-- Pulse architecture decisions:
-- 1. brain_chunks is only vector memory. Firebase remains the app database.
-- 2. Keep RLS enabled with no client policies as intentional default-deny.
--    An anon keep-alive request may get HTTP 200 with an empty result, but it
--    cannot read rows. The local Pulse server uses service_role for real work.
-- 3. Lock match_brain_chunks search_path so caller-controlled search paths
--    cannot affect object resolution.
-- 4. Try to move pgvector from public to extensions. If Supabase refuses because
--    the active table depends on it, leave it in place and keep the app online.

alter table public.brain_chunks enable row level security;

create schema if not exists extensions;

do $$
begin
  if exists (
    select 1
    from pg_extension e
    join pg_namespace n on n.oid = e.extnamespace
    where e.extname = 'vector'
      and n.nspname <> 'extensions'
  ) then
    begin
      alter extension vector set schema extensions;
    exception
      when others then
        raise notice 'Pulse: leaving vector extension in its current schema because ALTER EXTENSION failed: %', sqlerrm;
    end;
  end if;
end $$;

do $$
declare
  vector_schema text;
begin
  select n.nspname
    into vector_schema
  from pg_extension e
  join pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'vector';

  if vector_schema is null then
    raise exception 'Pulse Brain memory requires the vector extension.';
  end if;

  execute format($function$
    create or replace function public.match_brain_chunks(
      match_user_id text,
      query_embedding %1$I.vector(768),
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
    set search_path = public, extensions
    as $body$
      select
        public.brain_chunks.id,
        public.brain_chunks.source_type,
        public.brain_chunks.source_id,
        public.brain_chunks.title,
        public.brain_chunks.heading,
        public.brain_chunks.content,
        public.brain_chunks.metadata,
        1 - (public.brain_chunks.embedding <=> query_embedding) as similarity
      from public.brain_chunks
      where public.brain_chunks.user_id = match_user_id
        and (source_types is null or public.brain_chunks.source_type = any(source_types))
        and 1 - (public.brain_chunks.embedding <=> query_embedding) >= min_similarity
      order by public.brain_chunks.embedding <=> query_embedding
      limit match_count;
    $body$;
  $function$, vector_schema);

  execute format(
    'revoke execute on function public.match_brain_chunks(text, %I.vector(768), integer, double precision, text[]) from public, anon, authenticated',
    vector_schema
  );

  execute format(
    'grant execute on function public.match_brain_chunks(text, %I.vector(768), integer, double precision, text[]) to service_role',
    vector_schema
  );
end $$;
