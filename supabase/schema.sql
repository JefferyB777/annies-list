-- Annie's List — Phase one database
-- Paste this whole file into Supabase → SQL Editor → Run.
-- Then: Authentication → Sign In / Providers → turn ON "Allow anonymous sign-ins".

create table if not exists public.budgets (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null default 'My budget',
  total       numeric(10,2) not null check (total >= 0),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.items (
  id           uuid primary key default gen_random_uuid(),
  owner        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  budget_id    uuid not null references public.budgets(id) on delete cascade,
  product_key  text not null,          -- barcode, or "name:<item name>" when typed in
  barcode      text,
  name         text not null,
  store        text not null,
  price        numeric(10,2) not null check (price >= 0),   -- price for one unit
  qty          integer not null default 1 check (qty > 0),
  created_at   timestamptz not null default now()
);

create index if not exists items_owner_product_idx on public.items (owner, product_key);
create index if not exists items_budget_idx        on public.items (budget_id);
create index if not exists budgets_owner_active_idx on public.budgets (owner, active);

alter table public.budgets enable row level security;
alter table public.items   enable row level security;

-- Each person only ever sees their own budgets and items.
drop policy if exists "own budgets" on public.budgets;
create policy "own budgets" on public.budgets
  for all to authenticated
  using (owner = auth.uid())
  with check (owner = auth.uid());

drop policy if exists "own items" on public.items;
create policy "own items" on public.items
  for all to authenticated
  using (owner = auth.uid())
  with check (
    owner = auth.uid()
    and exists (select 1 from public.budgets b where b.id = budget_id and b.owner = auth.uid())
  );

-- Phase two will add a shared, read-only community price view built from these items
-- (store + product_key + price + date only, no personal details).
