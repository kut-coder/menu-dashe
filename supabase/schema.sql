-- Меню Даше: схема PostgreSQL для Supabase.
-- Вставить целиком в SQL Editor и выполнить один раз.
-- Authentication → Providers → Email: включите Email, выключите Confirm email.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null,
  email text not null,
  role text not null check (role in ('admin', 'user'))
);

create table if not exists public.weeks (
  user_id uuid not null references public.profiles (id) on delete cascade,
  week_start text not null,
  week_end text not null,
  status text not null check (status in ('draft', 'published')),
  published_at timestamptz,
  published_dates text[] not null default '{}',
  days jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, week_start)
);

create table if not exists public.shopping_lists (
  user_id uuid not null references public.profiles (id) on delete cascade,
  id text not null,
  selected_dates text[] not null default '{}',
  items jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.water_profiles (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  weight_kg numeric not null default 0,
  by_date jsonb not null default '{}'::jsonb,
  training_days jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.meal_checks (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  checks jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.weeks enable row level security;
alter table public.shopping_lists enable row level security;
alter table public.water_profiles enable row level security;
alter table public.meal_checks enable row level security;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, name, role)
  values (
    new.id,
    coalesce(new.email, ''),
    case
      when coalesce(new.email, '') ilike 'admin@%' then 'Админ'
      else 'Даша'
    end,
    case
      when coalesce(new.email, '') ilike 'admin@%' then 'admin'
      else 'user'
    end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.weeks to authenticated;
grant select, insert, update, delete on public.shopping_lists to authenticated;
grant select, insert, update, delete on public.water_profiles to authenticated;
grant select, insert, update, delete on public.meal_checks to authenticated;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_admin());

drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles
  for insert to authenticated
  with check (
    id = auth.uid()
    and (
      role = 'user'
      or (role = 'admin' and email ilike 'admin@%')
    )
  );

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (
    public.is_admin()
    or (id = auth.uid() and role = (select p.role from public.profiles p where p.id = auth.uid()))
  );

drop policy if exists weeks_select on public.weeks;
create policy weeks_select on public.weeks
  for select to authenticated
  using (
    public.is_admin()
    or (user_id = auth.uid() and status = 'published')
  );

drop policy if exists weeks_insert on public.weeks;
create policy weeks_insert on public.weeks
  for insert to authenticated
  with check (public.is_admin() or user_id = auth.uid());

drop policy if exists weeks_update on public.weeks;
create policy weeks_update on public.weeks
  for update to authenticated
  using (
    public.is_admin()
    or (user_id = auth.uid() and status = 'published')
  )
  with check (public.is_admin() or user_id = auth.uid());

drop policy if exists weeks_delete on public.weeks;
create policy weeks_delete on public.weeks
  for delete to authenticated
  using (public.is_admin() or user_id = auth.uid());

drop policy if exists shopping_all on public.shopping_lists;
create policy shopping_all on public.shopping_lists
  for all to authenticated
  using (public.is_admin() or user_id = auth.uid())
  with check (public.is_admin() or user_id = auth.uid());

drop policy if exists water_all on public.water_profiles;
create policy water_all on public.water_profiles
  for all to authenticated
  using (public.is_admin() or user_id = auth.uid())
  with check (public.is_admin() or user_id = auth.uid());

drop policy if exists checks_all on public.meal_checks;
create policy checks_all on public.meal_checks
  for all to authenticated
  using (public.is_admin() or user_id = auth.uid())
  with check (public.is_admin() or user_id = auth.uid());

do $$
begin
  alter publication supabase_realtime add table public.water_profiles;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.meal_checks;
exception
  when duplicate_object then null;
end $$;
