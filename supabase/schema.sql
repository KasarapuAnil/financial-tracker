-- FinTrack — database setup for Supabase.
-- Run once: Supabase dashboard → SQL Editor → New query → paste all → Run.
-- Safe to run again: it only creates what is missing.

-- Each row is one credit or debit, owned by the signed-in user who made it.
create table if not exists public.transactions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  type         text not null check (type in ('debit', 'credit')),
  amount       numeric(14, 2) not null check (amount > 0),
  category     text not null,
  description  text not null default '',
  payment_mode text not null default 'UPI',
  tx_date      date not null,
  tx_time      text,                       -- "HH:MM", as the app shows it
  legacy_id    text,                       -- the id an entry had in the old browser-only app
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists transactions_user_date_idx on public.transactions (user_id, tx_date desc);
-- moving old browser entries in twice never makes duplicates
create unique index if not exists transactions_user_legacy_idx on public.transactions (user_id, legacy_id) where legacy_id is not null;

-- keep updated_at current on every edit
create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists transactions_touch on public.transactions;
create trigger transactions_touch before update on public.transactions
for each row execute function public.touch_updated_at();

-- Row Level Security: every user sees and changes only their own rows.
-- This is what makes the publishable key safe to use in the browser.
alter table public.transactions enable row level security;

drop policy if exists "own rows: read"   on public.transactions;
drop policy if exists "own rows: add"    on public.transactions;
drop policy if exists "own rows: change" on public.transactions;
drop policy if exists "own rows: remove" on public.transactions;

create policy "own rows: read"   on public.transactions for select to authenticated using (auth.uid() = user_id);
create policy "own rows: add"    on public.transactions for insert to authenticated with check (auth.uid() = user_id);
create policy "own rows: change" on public.transactions for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows: remove" on public.transactions for delete to authenticated using (auth.uid() = user_id);

revoke all on public.transactions from anon;
grant select, insert, update, delete on public.transactions to authenticated;

-- Limits, so the public key can't be used to fill the database with junk.
-- The app never comes near them; a script abusing the API hits them at once.
alter table public.transactions drop constraint if exists transactions_sane;
alter table public.transactions add constraint transactions_sane check (
  amount <= 100000000000
  and char_length(category) between 1 and 60
  and char_length(description) <= 500
  and char_length(payment_mode) between 1 and 30
  and (tx_time is null or tx_time ~ '^[0-2][0-9]:[0-5][0-9]$')
  and (legacy_id is null or char_length(legacy_id) <= 80)
  and tx_date between date '1990-01-01' and date '2100-12-31'
);

-- At most 50,000 entries per account (decades of daily use).
create or replace function public.limit_rows_per_user() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (select count(*) from public.transactions where user_id = new.user_id) >= 50000 then
    raise exception 'Entry limit reached for this account';
  end if;
  return new;
end $$;

drop trigger if exists transactions_limit on public.transactions;
create trigger transactions_limit before insert on public.transactions
for each row execute function public.limit_rows_per_user();

-- Live sync: changes made on one phone show up on another without a refresh.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'transactions'
  ) then
    alter publication supabase_realtime add table public.transactions;
  end if;
end $$;
