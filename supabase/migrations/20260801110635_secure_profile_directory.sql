-- Keep private profile preferences on the base table while exposing only the
-- intentionally public directory fields through a controlled RPC.

create or replace function public.is_signal_share_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.site_admins
    where email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

create or replace function public.get_signal_share_profile_directory()
returns table (
  id uuid,
  display_name text,
  email text
)
language sql
stable
security definer
set search_path = ''
as $$
  with caller as (
    select exists (
      select 1
      from public.site_admins
      where email = lower(coalesce(auth.jwt() ->> 'email', ''))
    ) as is_admin
  )
  select
    profile.id,
    profile.display_name,
    case
      when profile.show_email or caller.is_admin then profile.email
      else null::text
    end as email
  from public.profiles as profile
  cross join caller
  order by lower(profile.display_name), profile.id;
$$;

revoke all privileges on table public.profiles from public, anon, authenticated;
grant select, insert, update on table public.profiles to authenticated;

revoke all on function public.is_signal_share_admin() from public, anon, authenticated;
grant execute on function public.is_signal_share_admin() to authenticated;

revoke all on function public.get_signal_share_profile_directory() from public, anon, authenticated;
grant execute on function public.get_signal_share_profile_directory() to anon, authenticated;

drop policy if exists "public can read profiles" on public.profiles;
drop policy if exists "authenticated can read profiles" on public.profiles;
drop policy if exists "users and admins can read profiles" on public.profiles;

create policy "users and admins can read profiles"
on public.profiles
for select
to authenticated
using (
  (select auth.uid()) = id
  or (select public.is_signal_share_admin())
);
