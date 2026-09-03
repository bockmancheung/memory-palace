-- =========================================================
-- Run this once in your Supabase project's SQL Editor
-- (Dashboard -> SQL Editor -> New query -> paste -> Run).
-- It creates the table that stores every signed-in user's
-- per-deck progress, and locks it down so each user can only
-- ever see or change their own rows.
-- =========================================================

create table if not exists public.deck_progress (
  user_id     uuid references auth.users(id) on delete cascade not null,
  deck_key    text not null,
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  primary key (user_id, deck_key)
);

alter table public.deck_progress enable row level security;

create policy "Users can read their own progress"
  on public.deck_progress for select
  using (auth.uid() = user_id);

create policy "Users can insert their own progress"
  on public.deck_progress for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own progress"
  on public.deck_progress for update
  using (auth.uid() = user_id);

create policy "Users can delete their own progress"
  on public.deck_progress for delete
  using (auth.uid() = user_id);
