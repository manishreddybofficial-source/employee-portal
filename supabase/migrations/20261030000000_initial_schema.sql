-- =====================================================================
-- Initial schema: profiles, office settings, attendance, leave
-- =====================================================================

-- ---------- Tables ----------
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null default '',
  email       text,
  department  text not null default '',
  role        text not null default 'employee' check (role in ('employee', 'admin')),
  created_at  timestamptz not null default now()
);

create table public.office_details (
  id             int primary key default 1 check (id = 1),
  company_name   text not null default 'Your Company',
  address        text not null default '',
  phone          text not null default '',
  email          text not null default '',
  map_url        text not null default '',
  timezone       text not null default 'America/New_York',
  work_start     time not null default '09:00',
  work_end       time not null default '18:00',
  grace_minutes  int  not null default 15 check (grace_minutes between 0 and 240),
  break_policy   text not null default '1 hour of total break time per day.',
  notes          text not null default '',
  updated_at     timestamptz not null default now()
);
insert into public.office_details (id) values (1);

create table public.attendance_events (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  work_date   date not null,
  event_type  text not null check (event_type in ('time_in', 'break_start', 'break_end', 'time_out')),
  auto        boolean not null default false,
  created_at  timestamptz not null default now()
);
comment on column public.attendance_events.auto is 'True when the system closed a forgotten session.';
create index attendance_events_user_date_idx on public.attendance_events (user_id, work_date);
create index attendance_events_date_idx      on public.attendance_events (work_date);

create table public.leave_requests (
  id           bigint generated always as identity primary key,
  user_id      uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  leave_type   text not null,
  start_date   date not null,
  end_date     date not null,
  days         numeric(4, 1) not null check (days > 0),
  reason       text not null check (length(reason) <= 500),
  status       text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  admin_note   text,
  reviewed_by  uuid references public.profiles(id),
  reviewed_at  timestamptz,
  created_at   timestamptz not null default now(),
  check (end_date >= start_date)
);
create index leave_requests_user_idx on public.leave_requests (user_id);

-- ---------- Helpers ----------
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- Creates an employee profile; administrators are provisioned by a trusted owner.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email, department, role)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), split_part(new.email, '@', 1)),
    new.email,
    coalesce(new.raw_user_meta_data->>'department', ''),
    'employee'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Attendance punches (server time, validated sequence) ----------
create or replace function public.record_attendance(p_event text)
returns public.attendance_events
language plpgsql security definer set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_tz    text;
  v_end   time;
  v_today date;
  v_last  public.attendance_events;
  v_state text := 'out';
  v_close timestamptz;
  v_row   public.attendance_events;
begin
  if v_uid is null then
    raise exception 'Please sign in again.';
  end if;
  if p_event not in ('time_in', 'break_start', 'break_end', 'time_out') then
    raise exception 'Unknown action: %', p_event;
  end if;

  -- Serialize punches per user so double clicks cannot interleave.
  perform pg_advisory_xact_lock(hashtext(v_uid::text));

  select timezone, work_end into v_tz, v_end from office_details where id = 1;
  v_tz    := coalesce(v_tz, 'UTC');
  v_today := (now() at time zone v_tz)::date;

  select * into v_last
    from attendance_events
   where user_id = v_uid
   order by created_at desc, id desc
   limit 1;

  if found and v_last.event_type <> 'time_out' then
    v_state := case when v_last.event_type = 'break_start' then 'break' else 'working' end;

    -- A session left open on an earlier day is closed at office closing time.
    -- Keep the 12 hours in sync with app.staleSessionHours in src/config/app.ts.
    if v_last.work_date < v_today and now() - v_last.created_at > interval '12 hours' then
      v_close := greatest(v_last.created_at, (v_last.work_date + coalesce(v_end, '18:00')) at time zone v_tz);
      if v_state = 'break' then
        insert into attendance_events (user_id, work_date, event_type, created_at, auto)
        values (v_uid, v_last.work_date, 'break_end', v_close, true);
      end if;
      insert into attendance_events (user_id, work_date, event_type, created_at, auto)
      values (v_uid, v_last.work_date, 'time_out', v_close, true);
      v_state := 'out';
    end if;
  end if;

  if p_event = 'time_in' and v_state <> 'out' then
    raise exception 'You are already timed in.';
  elsif p_event <> 'time_in' and v_state = 'out' then
    raise exception 'Time in first.';
  elsif p_event = 'break_start' and v_state = 'break' then
    raise exception 'You are already on a break.';
  elsif p_event = 'break_end' and v_state <> 'break' then
    raise exception 'You are not on a break.';
  end if;

  if p_event = 'time_out' and v_state = 'break' then
    insert into attendance_events (user_id, work_date, event_type)
    values (v_uid, v_last.work_date, 'break_end');
  end if;

  insert into attendance_events (user_id, work_date, event_type)
  values (v_uid, case when p_event = 'time_in' then v_today else v_last.work_date end, p_event)
  returning * into v_row;

  return v_row;
end;
$$;

-- ---------- Row Level Security ----------
alter table public.profiles          enable row level security;
alter table public.office_details    enable row level security;
alter table public.attendance_events enable row level security;
alter table public.leave_requests    enable row level security;

create policy "profiles_select_own_or_admin" on public.profiles
  for select to authenticated using (id = auth.uid() or public.is_admin());
create policy "profiles_update_admin" on public.profiles
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "office_select" on public.office_details
  for select to authenticated using (true);
create policy "office_update_admin" on public.office_details
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- No insert/update/delete policies: punches only go through record_attendance().
create policy "attendance_select_own_or_admin" on public.attendance_events
  for select to authenticated using (user_id = auth.uid() or public.is_admin());

create policy "leave_select_own_or_admin" on public.leave_requests
  for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy "leave_insert_own_pending" on public.leave_requests
  for insert to authenticated
  with check (user_id = auth.uid() and status = 'pending' and reviewed_by is null);
create policy "leave_delete_own_pending" on public.leave_requests
  for delete to authenticated using (user_id = auth.uid() and status = 'pending');
create policy "leave_update_admin" on public.leave_requests
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------- Privileges ----------
grant select, update                 on public.profiles          to authenticated;
grant select, update                 on public.office_details    to authenticated;
grant select                         on public.attendance_events to authenticated;
grant select, insert, update, delete on public.leave_requests    to authenticated;
revoke execute on function public.record_attendance(text) from public, anon;
grant  execute on function public.record_attendance(text) to authenticated;
