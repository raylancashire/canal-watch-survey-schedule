-- ============================================================
-- Canal Watch Survey Schedule
-- Administrator Management Upgrade
-- Run this ONCE in Supabase SQL Editor.
-- ============================================================

-- Add administration-management fields.
alter table public.admin_profiles
  add column if not exists email text,
  add column if not exists can_manage_admins boolean not null default false,
  add column if not exists active boolean not null default true;

-- Backfill email addresses from Supabase Auth.
update public.admin_profiles p
set email = u.email
from auth.users u
where p.id = u.id
  and (p.email is null or p.email <> u.email);

-- Promote existing schedule managers to Admin Managers.
-- At this stage that should normally be your original administrator account.
update public.admin_profiles
set can_manage_admins = true
where can_manage = true;

-- Keep newly-created admin profiles aware of the login email.
create or replace function public.handle_new_admin_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.admin_profiles (
    id,
    display_name,
    email,
    can_manage,
    can_manage_admins,
    active
  )
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'display_name',
      split_part(new.email, '@', 1),
      'Schedule manager'
    ),
    new.email,
    false,
    false,
    true
  )
  on conflict (id) do update
  set email = excluded.email;

  return new;
end;
$$;

-- Schedule-manager helper now also checks active status.
create or replace function public.is_schedule_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_profiles
    where id = auth.uid()
      and active = true
      and can_manage = true
  );
$$;

-- Separate helper for managing other administrators.
create or replace function public.is_admin_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_profiles
    where id = auth.uid()
      and active = true
      and can_manage = true
      and can_manage_admins = true
  );
$$;

grant execute on function public.is_schedule_manager() to authenticated;
grant execute on function public.is_admin_manager() to authenticated;

-- Admin managers can read the administrator directory.
drop policy if exists "Admin reads own profile" on public.admin_profiles;
drop policy if exists "Admin managers read profiles" on public.admin_profiles;

create policy "Admin managers read profiles"
on public.admin_profiles
for select
to authenticated
using (
  id = auth.uid()
  or public.is_admin_manager()
);

-- No browser-side INSERT/UPDATE/DELETE policy is added for admin_profiles.
-- Changes to administrators are deliberately performed by the secure
-- manage-admins Edge Function using a server-side secret key.

-- The authenticated role needs SELECT only.
grant select on public.admin_profiles to authenticated;
revoke insert, update, delete on public.admin_profiles from authenticated;

-- Helpful index.
create index if not exists admin_profiles_email_idx
on public.admin_profiles (lower(email));

-- Check result after running:
select
  display_name,
  email,
  can_manage,
  can_manage_admins,
  active
from public.admin_profiles
order by created_at;
