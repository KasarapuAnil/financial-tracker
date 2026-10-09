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

-- A cap on rows per account for any table it's attached to; the limit is the
-- trigger's argument (50,000 entries is decades of daily use).
create or replace function public.limit_rows_per_user() returns trigger
language plpgsql set search_path = '' as $$
declare
  n bigint;
  lim int := coalesce(tg_argv[0]::int, 50000);
begin
  execute format('select count(*) from %I.%I where user_id = $1', tg_table_schema, tg_table_name)
    into n using new.user_id;
  if n >= lim then
    raise exception 'Entry limit reached for this account';
  end if;
  return new;
end $$;

drop trigger if exists transactions_limit on public.transactions;
create trigger transactions_limit before insert on public.transactions
for each row execute function public.limit_rows_per_user('50000');

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

-- ═══════════════════════════════════════════════════════════════════════════
-- Lend & borrow
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.loans (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  direction     text not null check (direction in ('lent', 'borrowed')),
  person        text not null check (char_length(person) between 1 and 80),
  principal     numeric(14, 2) not null check (principal > 0 and principal <= 100000000000),
  start_date    date not null,
  due_date      date,
  rate          numeric(9, 4) not null default 0 check (rate >= 0 and rate <= 1000),
  -- per100_month: "₹2 per ₹100 a month"; pct_month: % a month; pct_year: % a year
  rate_unit     text not null default 'per100_month' check (rate_unit in ('per100_month', 'pct_month', 'pct_year')),
  interest_kind text not null default 'simple' check (interest_kind in ('simple', 'compound')),
  compounding   text not null default 'yearly' check (compounding in ('monthly', 'yearly')),
  note          text not null default '' check (char_length(note) <= 500),
  closed_on     date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists loans_user_idx on public.loans (user_id);

-- money paid back on a loan ('repaid'), or more money given on it ('added')
create table if not exists public.loan_payments (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  loan_id    uuid not null references public.loans (id) on delete cascade,
  kind       text not null default 'repaid' check (kind in ('repaid', 'added')),
  amount     numeric(14, 2) not null check (amount > 0 and amount <= 100000000000),
  paid_on    date not null,
  note       text not null default '' check (char_length(note) <= 200),
  created_at timestamptz not null default now()
);
create index if not exists loan_payments_loan_idx on public.loan_payments (loan_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- Investments
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.investments (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name            text not null check (char_length(name) between 1 and 80),
  kind            text not null default 'sip' check (kind in ('sip', 'fd', 'rd', 'stocks', 'gold', 'ppf', 'chit', 'property', 'other')),
  monthly_amount  numeric(14, 2) not null default 0 check (monthly_amount >= 0 and monthly_amount <= 100000000000),
  lump_amount     numeric(14, 2) not null default 0 check (lump_amount >= 0 and lump_amount <= 100000000000),
  start_date      date not null,
  end_date        date,
  expected_return numeric(6, 2) not null default 12 check (expected_return between -100 and 100),
  current_value   numeric(14, 2) check (current_value is null or (current_value >= 0 and current_value <= 100000000000)),
  note            text not null default '' check (char_length(note) <= 500),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (monthly_amount > 0 or lump_amount > 0)
);
create index if not exists investments_user_idx on public.investments (user_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- Vault — everything here is encrypted in the browser before it is sent.
-- The server only ever stores scrambled bytes; without the vault password
-- (which never leaves the device) nobody can read them, not even Supabase.
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.vault_keys (
  user_id     uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  salt        text not null check (char_length(salt) <= 64),
  iterations  int not null check (iterations between 100000 and 10000000),
  wrapped_key text not null check (char_length(wrapped_key) <= 200),  -- the vault key, locked with the vault password
  wrap_iv     text not null check (char_length(wrap_iv) <= 40),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.vault_items (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind       text not null check (kind in ('login', 'note', 'file')),
  data       text not null check (char_length(data) <= 200000),   -- encrypted JSON, base64
  iv         text not null check (char_length(iv) <= 40),
  file_path  text check (file_path is null or char_length(file_path) <= 200),
  file_size  bigint check (file_size is null or file_size between 0 and 15728640),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists vault_items_user_idx on public.vault_items (user_id);

-- ── shared setup for the new tables: own rows only, kept-current updated_at ──
do $$
declare
  t text;
begin
  foreach t in array array['loans', 'loan_payments', 'investments', 'vault_keys', 'vault_items'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "own rows: read" on public.%I', t);
    execute format('drop policy if exists "own rows: add" on public.%I', t);
    execute format('drop policy if exists "own rows: change" on public.%I', t);
    execute format('drop policy if exists "own rows: remove" on public.%I', t);
    execute format('create policy "own rows: read" on public.%I for select to authenticated using (auth.uid() = user_id)', t);
    execute format('create policy "own rows: add" on public.%I for insert to authenticated with check (auth.uid() = user_id)', t);
    execute format('create policy "own rows: change" on public.%I for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id)', t);
    execute format('create policy "own rows: remove" on public.%I for delete to authenticated using (auth.uid() = user_id)', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
  foreach t in array array['loans', 'investments', 'vault_keys', 'vault_items'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_touch', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.touch_updated_at()', t || '_touch', t);
  end loop;
end $$;

-- a payment can only be added to one of your own loans
drop policy if exists "own rows: add" on public.loan_payments;
create policy "own rows: add" on public.loan_payments for insert to authenticated
  with check (auth.uid() = user_id and exists (select 1 from public.loans l where l.id = loan_id and l.user_id = auth.uid()));

drop trigger if exists loans_limit on public.loans;
create trigger loans_limit before insert on public.loans for each row execute function public.limit_rows_per_user('2000');
drop trigger if exists loan_payments_limit on public.loan_payments;
create trigger loan_payments_limit before insert on public.loan_payments for each row execute function public.limit_rows_per_user('20000');
drop trigger if exists investments_limit on public.investments;
create trigger investments_limit before insert on public.investments for each row execute function public.limit_rows_per_user('500');
drop trigger if exists vault_items_limit on public.vault_items;
create trigger vault_items_limit before insert on public.vault_items for each row execute function public.limit_rows_per_user('2000');

-- ── private storage for the vault's (encrypted) files ──
-- Each user can only touch files under a folder named after their own id.
insert into storage.buckets (id, name, public, file_size_limit)
values ('vault', 'vault', false, 15728640)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

drop policy if exists "vault: read own files"   on storage.objects;
drop policy if exists "vault: add own files"    on storage.objects;
drop policy if exists "vault: change own files" on storage.objects;
drop policy if exists "vault: remove own files" on storage.objects;
create policy "vault: read own files" on storage.objects for select to authenticated
  using (bucket_id = 'vault' and (storage.foldername(name))[1] = (select auth.uid()::text));
create policy "vault: add own files" on storage.objects for insert to authenticated
  with check (bucket_id = 'vault' and (storage.foldername(name))[1] = (select auth.uid()::text));
create policy "vault: change own files" on storage.objects for update to authenticated
  using (bucket_id = 'vault' and (storage.foldername(name))[1] = (select auth.uid()::text));
create policy "vault: remove own files" on storage.objects for delete to authenticated
  using (bucket_id = 'vault' and (storage.foldername(name))[1] = (select auth.uid()::text));
