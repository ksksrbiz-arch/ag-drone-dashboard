-- Knowledge base: files / folders / notes the Sidekick assistant can use as
-- context. Staff add reference material (pricing sheets, SOPs, call scripts,
-- agronomy notes); the assistant searches it to answer company-specific
-- questions instead of guessing.

create table if not exists public.knowledge_documents (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  folder      text not null default 'General',
  content     text not null default '',
  source      text not null default 'note',   -- 'note' | 'file'
  mime        text,
  byte_size   integer,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- One logical document per (folder, title) so re-adding updates in place.
create unique index if not exists knowledge_documents_folder_title_key
  on public.knowledge_documents (folder, lower(title));

create index if not exists knowledge_documents_folder_idx
  on public.knowledge_documents (folder);

-- Full-text search over title + content.
alter table public.knowledge_documents
  add column if not exists fts tsvector
  generated always as (to_tsvector('english', coalesce(title,'') || ' ' || coalesce(content,''))) stored;

create index if not exists knowledge_documents_fts_idx
  on public.knowledge_documents using gin (fts);

alter table public.knowledge_documents enable row level security;

-- Hardened RLS: anon none, authenticated read, staff (owner/partner) write.
drop policy if exists knowledge_documents_read on public.knowledge_documents;
create policy knowledge_documents_read on public.knowledge_documents
  for select to authenticated using (true);

drop policy if exists knowledge_documents_write on public.knowledge_documents;
create policy knowledge_documents_write on public.knowledge_documents
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

grant select on public.knowledge_documents to authenticated;
grant select, insert, update, delete on public.knowledge_documents to service_role;
