-- Agenda: run this once in Supabase → SQL Editor → New query → Run.
-- Safe to run again.

create table if not exists public.agenda_items (
  user_id     uuid    not null default auth.uid() references auth.users (id) on delete cascade,
  id          text    not null,
  type        text    not null default 'event',
  title       text,
  date        text,              -- YYYY-MM-DD (local date, stored as text so time zones never shift it)
  start_time  text,              -- HH:MM
  end_time    text,
  color       text,
  notes       text,
  alert       integer,           -- minutes before; null = no alert
  done        boolean not null default false,
  done_at     bigint,
  updated_at  bigint  not null default (extract(epoch from now()) * 1000)::bigint,
  deleted     boolean not null default false,
  cal         text,              -- Apple calendar this event is also saved to (null = Agenda only)
  primary key (user_id, id)
);

-- added in v3.4 (Apple Calendar). Safe to run on an existing table:
alter table public.agenda_items add column if not exists cal text;

alter table public.agenda_items enable row level security;

-- Newer Supabase projects don't expose tables to the app automatically: allow signed-in users only.
-- (Row-level security below still limits each person to their own rows. Signed-out visitors get nothing.)
grant select, insert, update, delete on public.agenda_items to authenticated;
revoke all on public.agenda_items from anon;

drop policy if exists "agenda: read own"   on public.agenda_items;
drop policy if exists "agenda: insert own" on public.agenda_items;
drop policy if exists "agenda: update own" on public.agenda_items;
drop policy if exists "agenda: delete own" on public.agenda_items;

create policy "agenda: read own"   on public.agenda_items for select using (auth.uid() = user_id);
create policy "agenda: insert own" on public.agenda_items for insert with check (auth.uid() = user_id);
create policy "agenda: update own" on public.agenda_items for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "agenda: delete own" on public.agenda_items for delete using (auth.uid() = user_id);

-- live updates between devices
do $$ begin
  alter publication supabase_realtime add table public.agenda_items;
exception when duplicate_object then null; end $$;
