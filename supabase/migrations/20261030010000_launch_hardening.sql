-- Public registration must never decide who administers the company.
-- Promote the intended owner explicitly from a trusted SQL session after signup.
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
    'employee'
  );
  return new;
end;
$$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- Frontend checks are helpful feedback; these rules protect direct API requests too.
create function public.validate_leave_request()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_working_days integer;
  v_allowance numeric;
  v_booked numeric;
begin
  perform pg_advisory_xact_lock(hashtext(new.user_id::text));

  if tg_op = 'UPDATE' then
    if row(new.user_id, new.leave_type, new.start_date, new.end_date, new.days, new.reason, new.created_at)
       is distinct from row(old.user_id, old.leave_type, old.start_date, old.end_date, old.days, old.reason, old.created_at) then
      raise exception 'Leave request details cannot be changed. Cancel and submit a new request.';
    end if;
    if old.status <> 'pending' or new.status not in ('approved', 'rejected') then
      raise exception 'Only pending leave requests can be reviewed.';
    end if;
    new.reviewed_by := auth.uid();
    new.reviewed_at := now();
  else
    if new.status <> 'pending' or new.reviewed_by is not null or new.reviewed_at is not null or new.admin_note is not null then
      raise exception 'New leave requests must be pending and unreviewed.';
    end if;
    new.created_at := now();
  end if;

  if new.end_date < new.start_date or extract(year from new.start_date) <> extract(year from new.end_date) then
    raise exception 'Submit a separate leave request for each calendar year.';
  end if;
  if length(btrim(new.reason)) = 0 or length(new.reason) > 500 then
    raise exception 'Enter a leave reason between 1 and 500 characters.';
  end if;

  select count(*) into v_working_days
  from generate_series(0, new.end_date - new.start_date) as dates(day_offset)
  where extract(isodow from (new.start_date + dates.day_offset)) <= 5;

  if v_working_days = 0 or not (
    new.days = v_working_days or
    (new.start_date = new.end_date and new.days = 0.5)
  ) then
    raise exception 'Leave days must match the working days in the selected dates.';
  end if;

  case new.leave_type
    when 'Casual Leave' then v_allowance := 12;
    when 'Sick Leave' then v_allowance := 10;
    when 'Annual Leave' then v_allowance := 15;
    when 'Unpaid Leave' then v_allowance := null;
    else raise exception 'Unknown leave type.';
  end case;

  if new.status in ('pending', 'approved') then
    if exists (
      select 1 from public.leave_requests as r
      where r.user_id = new.user_id and r.id <> new.id
        and r.status in ('pending', 'approved')
        and r.start_date <= new.end_date and r.end_date >= new.start_date
    ) then
      raise exception 'You already have leave on these dates.';
    end if;

    select coalesce(sum(r.days), 0) into v_booked
    from public.leave_requests as r
    where r.user_id = new.user_id and r.id <> new.id
      and r.leave_type = new.leave_type and r.status in ('pending', 'approved')
      and extract(year from r.start_date) = extract(year from new.start_date);

    if v_allowance is not null and v_booked + new.days > v_allowance then
      raise exception 'Not enough % left for this request.', new.leave_type;
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.validate_leave_request() from public, anon, authenticated;
create trigger validate_leave_before_write
  before insert or update on public.leave_requests
  for each row execute function public.validate_leave_request();

-- An invalid time zone would break every attendance punch and all date displays.
create function public.validate_office_timezone()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'Use a valid IANA office time zone.';
  end if;
  return new;
end;
$$;
revoke execute on function public.validate_office_timezone() from public, anon, authenticated;
create trigger validate_office_before_write
  before insert or update on public.office_details
  for each row execute function public.validate_office_timezone();

-- Keep the administrator account usable even when the API is called directly.
create function public.protect_admin_role()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if old.id = auth.uid() and old.role = 'admin' and new.role <> 'admin' then
    raise exception 'You cannot remove your own administrator role.';
  end if;
  return new;
end;
$$;
revoke execute on function public.protect_admin_role() from public, anon, authenticated;
create trigger protect_admin_before_update
  before update on public.profiles
  for each row execute function public.protect_admin_role();

create index leave_requests_user_status_year_idx
  on public.leave_requests (user_id, status, start_date);
