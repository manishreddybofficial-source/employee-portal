-- Trusted project owners may reserve administrator access for a verified email.
-- This table has no Data API access for browser roles.
create table public.admin_invitations (
  email text primary key check (email = lower(btrim(email))),
  created_at timestamptz not null default now()
);
alter table public.admin_invitations enable row level security;
revoke all on public.admin_invitations from anon, authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, email, department, role)
  values (
    new.id,
    coalesce(nullif(btrim(new.raw_user_meta_data->>'full_name'), ''), split_part(new.email, '@', 1)),
    new.email,
    coalesce(new.raw_user_meta_data->>'department', ''),
    case when new.email_confirmed_at is not null and exists (
      select 1 from public.admin_invitations where email = lower(new.email)
    ) then 'admin' else 'employee' end
  );
  return new;
end;
$$;

create function public.assign_verified_admin()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  update public.profiles set role = 'admin', email = new.email
  where id = new.id and new.email_confirmed_at is not null
    and exists (select 1 from public.admin_invitations where email = lower(new.email));
  return new;
end;
$$;
revoke execute on function public.assign_verified_admin() from public, anon, authenticated;
create trigger on_auth_user_verified
  after update of email_confirmed_at on auth.users
  for each row execute function public.assign_verified_admin();
