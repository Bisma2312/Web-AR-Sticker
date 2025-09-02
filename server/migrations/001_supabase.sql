-- Schema for Supabase Postgres: uploads table
create extension if not exists "uuid-ossp";

create table if not exists public.uploads (
  id uuid primary key default uuid_generate_v4(),
  storage_path text not null,
  token_hash text not null,
  expires_at timestamptz null,
  created_at timestamptz not null default now()
);

create index if not exists idx_uploads_token_hash on public.uploads(token_hash);

-- RLS policies (optional, typically use service role on server)
alter table public.uploads enable row level security;
do $$ begin
  create policy "server-only-select" on public.uploads
    for select using (auth.role() = 'service_role');
exception when others then null; end $$;

do $$ begin
  create policy "server-only-insert" on public.uploads
    for insert with check (auth.role() = 'service_role');
exception when others then null; end $$;

-- Note: Create a Storage bucket named 'uploads' in Supabase Dashboard

