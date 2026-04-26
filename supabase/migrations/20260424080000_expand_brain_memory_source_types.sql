alter table public.brain_chunks
  drop constraint if exists brain_chunks_source_type_check;

alter table public.brain_chunks
  add constraint brain_chunks_source_type_check
  check (source_type in ('user_profile', 'dsp_record', 'tag_record', 'brain_card', 'fleet_log', 'saved_chat'));
