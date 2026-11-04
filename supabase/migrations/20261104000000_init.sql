-- VendorBooks schema, helpers, and row-level security.
-- Square access is OAuth only. A Square account password is never collected or stored.
-- Money is integer USD cents. Square tokens are ciphertext and are not readable
-- by authenticated or anon roles. The app's service role is the only writer of
-- ledger lines, webhook events, and token rows.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  email text,
  full_name text,
  is_platform_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.shops (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  plan text not null default 'free' check (plan in ('free', 'shop', 'mall')),
  trial_ends_at timestamptz,
  stripe_customer_id text unique,
  stripe_subscription_id text,
  stripe_status text,
  billing_grace_until timestamptz,
  trial_ending_email_sent_at timestamptz,
  timezone text not null default 'America/New_York',
  statement_day int not null default 1 check (statement_day between 1 and 28),
  created_at timestamptz not null default now()
);

create table public.shop_members (
  shop_id uuid not null references public.shops on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  role text not null check (role in ('owner', 'manager', 'bookkeeper')),
  created_at timestamptz not null default now(),
  primary key (shop_id, user_id)
);

create table public.shop_payout_settings (
  shop_id uuid primary key references public.shops on delete cascade,
  exclude_sales_tax boolean not null default true,
  exclude_tips boolean not null default true,
  fee_mode text not null default 'shop_absorbs' check (fee_mode in ('shop_absorbs', 'pass_through')),
  booth_rent_mode text not null default 'deduct' check (booth_rent_mode in ('deduct', 'separate')),
  negative_balance_mode text not null default 'carry' check (negative_balance_mode in ('carry', 'forgive')),
  service_charge_mode text not null default 'exclude' check (service_charge_mode in ('exclude', 'include', 'map')),
  service_charge_rules jsonb not null default '[]'::jsonb,
  rounding_mode text not null default 'half_even',
  updated_at timestamptz not null default now()
);

-- Square OAuth tokens. No policies for authenticated/anon. Service role only.
create table public.square_connections (
  shop_id uuid primary key references public.shops on delete cascade,
  merchant_id text not null,
  access_token_cipher text not null,
  refresh_token_cipher text not null,
  token_expires_at timestamptz not null,
  scopes text[] not null,
  last_refreshed_at timestamptz,
  revoked_at timestamptz,
  sandbox boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.shop_locations (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops on delete cascade,
  square_location_id text not null,
  name text not null,
  active boolean not null default true,
  unique (shop_id, square_location_id)
);

create table public.vendors (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops on delete cascade,
  display_name text not null,
  email text,
  phone text,
  commission_bps int not null default 6000 check (commission_bps between 0 and 10000),
  booth_rent_cents int not null default 0,
  payout_method text check (payout_method in ('check', 'ach', 'zelle', 'other')),
  payout_details text,
  payout_day int check (payout_day between 1 and 28),
  archived_at timestamptz,
  created_at timestamptz not null default now()
);
create index vendors_shop_active_idx on public.vendors (shop_id) where archived_at is null;

create table public.vendor_portal_accounts (
  vendor_id uuid primary key references public.vendors on delete cascade,
  auth_user_id uuid unique references public.profiles on delete set null,
  invited_email text not null,
  invited_at timestamptz not null default now(),
  last_login_at timestamptz
);

create table public.catalog_items (
  shop_id uuid not null references public.shops on delete cascade,
  catalog_object_id text not null,
  parent_object_id text,
  object_type text not null check (object_type in ('ITEM', 'ITEM_VARIATION')),
  name text,
  sku text,
  category_name text,
  catalog_version bigint,
  updated_at timestamptz not null default now(),
  primary key (shop_id, catalog_object_id)
);

create table public.catalog_vendor_attrs (
  shop_id uuid not null references public.shops on delete cascade,
  catalog_object_id text not null,
  catalog_version bigint,
  vendor_id uuid references public.vendors on delete set null,
  vendor_attr_value text,
  source text not null check (source in ('square_attr', 'sku_rule', 'category_rule', 'name_rule', 'csv', 'manual')),
  updated_at timestamptz not null default now(),
  primary key (shop_id, catalog_object_id)
);

create table public.attribution_rules (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops on delete cascade,
  priority int not null default 100,
  rule_type text not null check (rule_type in ('sku_prefix', 'category', 'name_pattern')),
  pattern text not null,
  vendor_id uuid not null references public.vendors on delete cascade,
  active boolean not null default true
);

create table public.ledger_lines (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops on delete cascade,
  location_id uuid references public.shop_locations,
  vendor_id uuid references public.vendors,
  square_order_id text not null,
  square_line_uid text not null,
  square_payment_id text,
  catalog_object_id text,
  catalog_version bigint,
  line_kind text not null check (line_kind in ('sale', 'refund', 'adjustment', 'booth_rent', 'fee_passthrough')),
  sold_at timestamptz not null,
  period_ym char(7),
  quantity numeric(18, 6) not null default 1,
  gross_cents int not null default 0,
  discount_cents int not null default 0,
  tax_cents int not null default 0,
  tip_cents int not null default 0,
  fee_cents int not null default 0,
  service_charge_cents int not null default 0,
  base_cents int not null default 0,
  vendor_earn_cents int not null default 0,
  commission_bps int,
  fee_mode text not null default 'shop_absorbs' check (fee_mode in ('shop_absorbs', 'pass_through')),
  attribution_source text,
  is_offline boolean not null default false,
  statement_id uuid,
  source_order_id text,
  source_line_uid text,
  item_name text,
  currency text not null default 'USD',
  raw_hash text not null,
  created_at timestamptz not null default now(),
  unique (shop_id, square_order_id, square_line_uid, line_kind)
);
create index ledger_shop_period_idx on public.ledger_lines (shop_id, period_ym);
create index ledger_vendor_idx on public.ledger_lines (shop_id, vendor_id, sold_at);

create table public.unassigned_queue (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops on delete cascade,
  ledger_line_id uuid not null unique references public.ledger_lines on delete cascade,
  reason text not null,
  status text not null default 'open' check (status in ('open', 'allocated', 'ignored')),
  allocated_vendor_id uuid references public.vendors,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.statements (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops on delete cascade,
  vendor_id uuid not null references public.vendors on delete cascade,
  period_ym char(7) not null,
  status text not null default 'draft' check (status in ('draft', 'pending_review', 'approved', 'paid')),
  opening_balance_cents int not null default 0,
  sales_earn_cents int not null default 0,
  refunds_cents int not null default 0,
  adjustments_cents int not null default 0,
  booth_rent_cents int not null default 0,
  payout_cents int not null default 0,
  square_sales_total_cents int,
  reconcile_delta_cents int,
  pdf_path text,
  csv_path text,
  approved_at timestamptz,
  paid_at timestamptz,
  paid_method text,
  paid_reference text,
  written_off_at timestamptz,
  unique (shop_id, vendor_id, period_ym)
);

alter table public.ledger_lines
  add constraint ledger_statement_fk foreign key (statement_id) references public.statements on delete set null;

create table public.webhook_events (
  event_id text primary key,
  merchant_id text,
  event_type text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  status text not null default 'received' check (status in ('received', 'processed', 'ignored', 'error')),
  error text
);

create table public.reconcile_runs (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops on delete cascade,
  ran_at timestamptz not null default now(),
  window_start timestamptz not null,
  window_end timestamptz not null,
  square_order_count int,
  ledger_line_count int,
  mismatch_count int,
  notes jsonb
);

create table public.backfill_runs (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops on delete cascade,
  status text not null check (status in ('running', 'completed', 'error')),
  orders_seen int not null default 0,
  lines_upserted int not null default 0,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create table public.admin_audit_log (
  id bigserial primary key,
  actor_user_id uuid,
  action text not null,
  meta jsonb,
  created_at timestamptz not null default now()
);

create table public.email_log (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid references public.shops on delete cascade,
  to_email text not null,
  template text not null,
  subject text not null,
  body_preview text,
  status text not null default 'logged' check (status in ('logged', 'sent', 'error')),
  error text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.is_shop_member(p_shop uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.shop_members m
    where m.shop_id = p_shop and m.user_id = auth.uid()
  );
$$;

create or replace function public.shop_role(p_shop uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select m.role from public.shop_members m
  where m.shop_id = p_shop and m.user_id = auth.uid()
  limit 1;
$$;

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select p.is_platform_admin from public.profiles p where p.id = auth.uid()), false);
$$;

create or replace function public.vendor_id_for_user()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select vendor_id from public.vendor_portal_accounts where auth_user_id = auth.uid();
$$;

create or replace function public.active_vendor_count(p_shop uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int from public.vendors
  where shop_id = p_shop and archived_at is null;
$$;

-- Mirrors src/domain/plans.ts resolveAccess. Keep the two in sync.
create or replace function public.shop_access(p_shop uuid)
returns table(plan text, read_only boolean, vendor_cap int, location_cap int)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s public.shops%rowtype;
  effective text;
  trial_active boolean;
  grace_active boolean;
begin
  select * into s from public.shops where id = p_shop;
  if not found then
    return;
  end if;
  trial_active := s.plan <> 'free' and s.trial_ends_at is not null and s.trial_ends_at > now();
  grace_active := s.billing_grace_until is not null and s.billing_grace_until > now();
  if s.stripe_status in ('past_due', 'unpaid', 'incomplete') and not grace_active then
    effective := s.plan;
    read_only := true;
  elsif s.stripe_status in ('active', 'trialing') or trial_active then
    effective := s.plan;
    read_only := false;
  elsif s.plan = 'free' then
    effective := 'free';
    read_only := false;
  else
    effective := 'free';
    read_only := false;
  end if;
  plan := effective;
  vendor_cap := case effective when 'free' then 5 when 'shop' then 50 else null end;
  location_cap := case effective when 'free' then 1 else null end;
  return next;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', '')
  )
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.create_shop(p_name text, p_timezone text, p_statement_day int)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_slug text;
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;
  if p_name is null or length(trim(p_name)) < 2 then
    raise exception 'Shop name is required';
  end if;
  if p_statement_day < 1 or p_statement_day > 28 then
    raise exception 'Statement day must be between 1 and 28';
  end if;
  v_slug := trim(both '-' from lower(regexp_replace(p_name, '[^a-zA-Z0-9]+', '-', 'g')))
    || '-' || substr(gen_random_uuid()::text, 1, 8);
  insert into public.shops (name, slug, timezone, statement_day, plan)
  values (trim(p_name), v_slug, coalesce(nullif(p_timezone, ''), 'America/New_York'), p_statement_day, 'free')
  returning id into v_id;
  insert into public.shop_members (shop_id, user_id, role) values (v_id, auth.uid(), 'owner');
  insert into public.shop_payout_settings (shop_id) values (v_id);
  return v_id;
end;
$$;

revoke all on function public.create_shop(text, text, int) from public;
grant execute on function public.create_shop(text, text, int) to authenticated;

-- ---------------------------------------------------------------------------
-- Triggers: plan caps, billing fields, locked statements, admin flag
-- ---------------------------------------------------------------------------

create or replace function public.enforce_vendor_cap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  acc record;
  cnt int;
begin
  if tg_op = 'UPDATE' and new.archived_at is not null then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.archived_at is null and new.archived_at is null then
    return new;
  end if;
  select * into acc from public.shop_access(new.shop_id);
  if acc.read_only then
    raise exception 'shop is read-only until billing is updated' using errcode = '42501';
  end if;
  if acc.vendor_cap is null then
    return new;
  end if;
  select count(*) into cnt from public.vendors
    where shop_id = new.shop_id and archived_at is null and id is distinct from new.id;
  if cnt >= acc.vendor_cap then
    raise exception 'vendor limit reached for plan' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists vendors_cap on public.vendors;
create trigger vendors_cap
  before insert or update on public.vendors
  for each row execute function public.enforce_vendor_cap();

create or replace function public.enforce_location_cap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  acc record;
  cnt int;
begin
  if new.active is not true then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.active is true then
    return new;
  end if;
  select * into acc from public.shop_access(new.shop_id);
  if acc.read_only then
    raise exception 'shop is read-only until billing is updated' using errcode = '42501';
  end if;
  if acc.location_cap is null then
    return new;
  end if;
  select count(*) into cnt from public.shop_locations
    where shop_id = new.shop_id and active and id is distinct from new.id;
  if cnt >= acc.location_cap then
    raise exception 'location limit reached for plan' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists locations_cap on public.shop_locations;
create trigger locations_cap
  before insert or update on public.shop_locations
  for each row execute function public.enforce_location_cap();

create or replace function public.enforce_statement_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  acc record;
  cnt int;
begin
  select * into acc from public.shop_access(new.shop_id);
  if tg_op = 'INSERT' then
    if acc.read_only then
      raise exception 'monthly close is paused until billing is updated' using errcode = '42501';
    end if;
    if acc.vendor_cap is not null then
      cnt := public.active_vendor_count(new.shop_id);
      if cnt > acc.vendor_cap then
        raise exception 'monthly close is blocked until the shop is within its vendor limit' using errcode = '42501';
      end if;
    end if;
    return new;
  end if;
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    if new.opening_balance_cents is distinct from old.opening_balance_cents
       or new.sales_earn_cents is distinct from old.sales_earn_cents
       or new.refunds_cents is distinct from old.refunds_cents
       or new.adjustments_cents is distinct from old.adjustments_cents
       or new.booth_rent_cents is distinct from old.booth_rent_cents
       or new.payout_cents is distinct from old.payout_cents
       or new.vendor_id is distinct from old.vendor_id
       or new.period_ym is distinct from old.period_ym
    then
      raise exception 'statement totals are calculated by VendorBooks' using errcode = '42501';
    end if;
  end if;
  if acc.read_only and coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'shop is read-only until billing is updated' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists statements_write on public.statements;
create trigger statements_write
  before insert or update on public.statements
  for each row execute function public.enforce_statement_write();

create or replace function public.lock_approved_ledger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  status text;
begin
  if old.statement_id is null then
    return new;
  end if;
  select s.status into status from public.statements s where s.id = old.statement_id;
  if status in ('approved', 'paid') and coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'lines on an approved statement are locked' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists ledger_lock on public.ledger_lines;
create trigger ledger_lock
  before update on public.ledger_lines
  for each row execute function public.lock_approved_ledger();

create or replace function public.protect_billing_columns()
returns trigger
language plpgsql
as $$
begin
  if coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;
  if new.plan is distinct from old.plan
     or new.stripe_customer_id is distinct from old.stripe_customer_id
     or new.stripe_subscription_id is distinct from old.stripe_subscription_id
     or new.stripe_status is distinct from old.stripe_status
     or new.trial_ends_at is distinct from old.trial_ends_at
     or new.billing_grace_until is distinct from old.billing_grace_until
     or new.trial_ending_email_sent_at is distinct from old.trial_ending_email_sent_at
  then
    raise exception 'billing fields are managed by Stripe' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists shops_billing_lock on public.shops;
create trigger shops_billing_lock
  before update on public.shops
  for each row execute function public.protect_billing_columns();

create or replace function public.protect_admin_flag()
returns trigger
language plpgsql
as $$
begin
  if coalesce(auth.role(), '') is distinct from 'service_role'
     and new.is_platform_admin is distinct from old.is_platform_admin then
    raise exception 'platform admin is assigned by VendorBooks' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_admin_lock on public.profiles;
create trigger profiles_admin_lock
  before update on public.profiles
  for each row execute function public.protect_admin_flag();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.shops enable row level security;
alter table public.shop_members enable row level security;
alter table public.shop_payout_settings enable row level security;
alter table public.square_connections enable row level security;
alter table public.square_connections force row level security;
alter table public.shop_locations enable row level security;
alter table public.vendors enable row level security;
alter table public.vendor_portal_accounts enable row level security;
alter table public.catalog_items enable row level security;
alter table public.catalog_vendor_attrs enable row level security;
alter table public.attribution_rules enable row level security;
alter table public.ledger_lines enable row level security;
alter table public.unassigned_queue enable row level security;
alter table public.statements enable row level security;
alter table public.webhook_events enable row level security;
alter table public.webhook_events force row level security;
alter table public.reconcile_runs enable row level security;
alter table public.backfill_runs enable row level security;
alter table public.admin_audit_log enable row level security;
alter table public.email_log enable row level security;

-- square_connections: intentionally NO policies for authenticated or anon.
-- webhook_events: intentionally NO policies for authenticated or anon.

create policy profiles_select_self on public.profiles
  for select using (id = auth.uid() or public.is_platform_admin());
create policy profiles_insert_self on public.profiles
  for insert with check (id = auth.uid() and is_platform_admin = false);
create policy profiles_update_self on public.profiles
  for update using (id = auth.uid());

create policy shops_member_select on public.shops
  for select using (public.is_shop_member(id) or public.is_platform_admin());
create policy shops_owner_update on public.shops
  for update using (public.shop_role(id) = 'owner');

create policy members_select on public.shop_members
  for select using (public.is_shop_member(shop_id) or public.is_platform_admin());
create policy members_owner_write on public.shop_members
  for all using (public.shop_role(shop_id) = 'owner')
  with check (public.shop_role(shop_id) = 'owner');

create policy settings_select on public.shop_payout_settings
  for select using (public.is_shop_member(shop_id));
create policy settings_owner_update on public.shop_payout_settings
  for update using (public.shop_role(shop_id) = 'owner');

create policy locations_select on public.shop_locations
  for select using (public.is_shop_member(shop_id) or public.is_platform_admin());
create policy locations_owner_write on public.shop_locations
  for all using (public.shop_role(shop_id) = 'owner')
  with check (public.shop_role(shop_id) = 'owner');

create policy vendors_member_select on public.vendors
  for select using (public.is_shop_member(shop_id) or public.is_platform_admin());
create policy vendors_portal_select on public.vendors
  for select using (id = public.vendor_id_for_user());
create policy vendors_staff_write on public.vendors
  for all using (public.shop_role(shop_id) in ('owner', 'manager'))
  with check (public.shop_role(shop_id) in ('owner', 'manager'));

create policy portal_staff_select on public.vendor_portal_accounts
  for select using (
    public.shop_role((select v.shop_id from public.vendors v where v.id = vendor_id)) in ('owner', 'manager')
    or auth_user_id = auth.uid()
  );
create policy portal_staff_write on public.vendor_portal_accounts
  for all using (
    public.shop_role((select v.shop_id from public.vendors v where v.id = vendor_id)) in ('owner', 'manager')
  )
  with check (
    public.shop_role((select v.shop_id from public.vendors v where v.id = vendor_id)) in ('owner', 'manager')
  );

create policy catalog_items_select on public.catalog_items
  for select using (public.is_shop_member(shop_id));
create policy catalog_items_write on public.catalog_items
  for all using (public.shop_role(shop_id) in ('owner', 'manager'))
  with check (public.shop_role(shop_id) in ('owner', 'manager'));

create policy catalog_attrs_select on public.catalog_vendor_attrs
  for select using (public.is_shop_member(shop_id));
create policy catalog_attrs_write on public.catalog_vendor_attrs
  for all using (public.shop_role(shop_id) in ('owner', 'manager'))
  with check (public.shop_role(shop_id) in ('owner', 'manager'));

create policy rules_select on public.attribution_rules
  for select using (public.is_shop_member(shop_id));
create policy rules_write on public.attribution_rules
  for all using (public.shop_role(shop_id) in ('owner', 'manager'))
  with check (public.shop_role(shop_id) in ('owner', 'manager'));

create policy ledger_member_select on public.ledger_lines
  for select using (public.is_shop_member(shop_id) or public.is_platform_admin());
create policy ledger_portal_select on public.ledger_lines
  for select using (vendor_id = public.vendor_id_for_user());
create policy ledger_staff_update on public.ledger_lines
  for update using (public.shop_role(shop_id) in ('owner', 'manager'));

create policy queue_member on public.unassigned_queue
  for all using (public.is_shop_member(shop_id) and public.shop_role(shop_id) in ('owner', 'manager', 'bookkeeper'))
  with check (public.shop_role(shop_id) in ('owner', 'manager'));

create policy statements_member_select on public.statements
  for select using (public.is_shop_member(shop_id) or public.is_platform_admin());
create policy statements_portal_select on public.statements
  for select using (
    vendor_id = public.vendor_id_for_user()
    and status in ('approved', 'paid')
  );
create policy statements_staff_update on public.statements
  for update using (public.shop_role(shop_id) in ('owner', 'manager', 'bookkeeper'));

create policy reconcile_select on public.reconcile_runs
  for select using (public.is_shop_member(shop_id) or public.is_platform_admin());
create policy backfill_select on public.backfill_runs
  for select using (public.is_shop_member(shop_id) or public.is_platform_admin());

create policy audit_admin_select on public.admin_audit_log
  for select using (public.is_platform_admin());

create policy email_owner_select on public.email_log
  for select using (shop_id is not null and public.shop_role(shop_id) = 'owner');

-- ---------------------------------------------------------------------------
-- Grants. Token and webhook tables are revoked from browser roles.
-- ---------------------------------------------------------------------------

revoke all on public.square_connections from public, anon, authenticated;
revoke all on public.webhook_events from public, anon, authenticated;

grant select, update on public.profiles to authenticated;
grant select, update on public.shops to authenticated;
grant select, insert, update, delete on public.shop_members to authenticated;
grant select, update on public.shop_payout_settings to authenticated;
grant select, insert, update, delete on public.shop_locations to authenticated;
grant select, insert, update, delete on public.vendors to authenticated;
grant select, insert, update, delete on public.vendor_portal_accounts to authenticated;
grant select, insert, update, delete on public.catalog_items to authenticated;
grant select, insert, update, delete on public.catalog_vendor_attrs to authenticated;
grant select, insert, update, delete on public.attribution_rules to authenticated;
grant select, update on public.ledger_lines to authenticated;
grant select, insert, update, delete on public.unassigned_queue to authenticated;
grant select, update on public.statements to authenticated;
grant select on public.reconcile_runs to authenticated;
grant select on public.backfill_runs to authenticated;
grant select on public.admin_audit_log to authenticated;
grant select on public.email_log to authenticated;

-- Private statement files. Path: {shop_id}/{statement_id}.pdf
insert into storage.buckets (id, name, public)
values ('statements', 'statements', false)
on conflict (id) do nothing;

create policy statement_files_member_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'statements'
    and public.is_shop_member(((storage.foldername(name))[1])::uuid)
  );

create policy statement_files_portal_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'statements'
    and exists (
      select 1 from public.statements s
      where s.id::text = split_part(storage.filename(name), '.', 1)
        and s.vendor_id = public.vendor_id_for_user()
        and s.status in ('approved', 'paid')
    )
  );
