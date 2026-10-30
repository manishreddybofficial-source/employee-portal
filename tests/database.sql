-- Runs against the linked project. All fixtures and punches are rolled back.
begin;

do $$
declare
  v_employee uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
begin
  perform set_config('portal_test.employee', v_employee::text, true);
  perform set_config('portal_test.other', v_other::text, true);
  insert into auth.users (id, email, raw_user_meta_data)
  values (v_employee, v_employee::text || '@example.invalid', '{"full_name":"Verification employee","role":"admin"}'::jsonb),
         (v_other, v_other::text || '@example.invalid', '{"full_name":"Verification administrator"}'::jsonb);
  if (select role from public.profiles where id = v_employee) <> 'employee' then
    raise exception 'Registration incorrectly granted administrator access.';
  end if;
  update public.profiles set role = 'admin' where id = v_other;
  -- An invitation cannot be claimed by signing up with someone else's address.
  insert into public.admin_invitations (email) values (v_employee::text || '@example.invalid');
  if (select role from public.profiles where id = v_employee) <> 'employee' then
    raise exception 'Unverified invited account received administrator access.';
  end if;
  update auth.users set email_confirmed_at = now() where id = v_employee;
  if (select role from public.profiles where id = v_employee) <> 'admin' then
    raise exception 'Verified administrator invitation was not applied.';
  end if;
  update public.profiles set role = 'employee' where id = v_employee;
  perform set_config('request.jwt.claim.sub', v_employee::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
end;
$$;

set local role authenticated;
do $$
declare
  v_rows integer;
  v_request bigint;
begin
  if (select count(*) from public.profiles) <> 1 then
    raise exception 'Employee can read another profile.';
  end if;
  update public.profiles set role = 'admin' where id = auth.uid();
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then raise exception 'Employee can elevate their role.'; end if;

  begin
    insert into public.attendance_events (user_id, work_date, event_type)
    values (auth.uid(), current_date, 'time_in');
    raise exception 'Direct attendance insertion was allowed.';
  exception when insufficient_privilege then null;
  end;
  perform public.record_attendance('time_in');
  begin
    perform public.record_attendance('time_in');
    raise exception 'Duplicate time-in was allowed.';
  exception when raise_exception then
    if sqlerrm <> 'You are already timed in.' then raise; end if;
  end;
  perform public.record_attendance('break_start');
  perform public.record_attendance('time_out');
  if (select count(*) from public.attendance_events where user_id = auth.uid()) <> 4 then
    raise exception 'Time-out during a break did not close the break.';
  end if;

  insert into public.leave_requests (leave_type, start_date, end_date, days, reason)
  values ('Casual Leave', '2030-01-07', '2030-01-08', 2, 'Transactional verification')
  returning id into v_request;

  begin
    insert into public.leave_requests (leave_type, start_date, end_date, days, reason)
    values ('Casual Leave', '2030-01-08', '2030-01-09', 2, 'Overlapping request');
    raise exception 'Overlapping leave was allowed.';
  exception when raise_exception then
    if sqlerrm <> 'You already have leave on these dates.' then raise; end if;
  end;
  begin
    insert into public.leave_requests (leave_type, start_date, end_date, days, reason)
    values ('Sick Leave', '2030-01-14', '2030-01-15', 0.5, 'Forged days');
    raise exception 'Forged leave duration was allowed.';
  exception when raise_exception then
    if sqlerrm <> 'Leave days must match the working days in the selected dates.' then raise; end if;
  end;
  begin
    insert into public.leave_requests (leave_type, start_date, end_date, days, reason)
    values ('Casual Leave', '2030-02-04', '2030-02-19', 12, 'Exceeds remaining allowance');
    raise exception 'Leave above the allowance was allowed.';
  exception when raise_exception then
    if sqlerrm not like 'Not enough %' then raise; end if;
  end;
  update public.leave_requests set status = 'approved' where id = v_request;
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then raise exception 'Employee approved their own leave.'; end if;
  perform set_config('portal_test.request', v_request::text, true);
end;
$$;
reset role;

select set_config('request.jwt.claim.sub', current_setting('portal_test.other'), true);
set local role authenticated;
do $$
begin
  if not public.is_admin() then raise exception 'Administrator access is broken.'; end if;
  update public.leave_requests set status = 'approved'
  where id = current_setting('portal_test.request')::bigint;
  if not exists (
    select 1 from public.leave_requests
    where id = current_setting('portal_test.request')::bigint
      and status = 'approved' and reviewed_by = auth.uid() and reviewed_at is not null
  ) then raise exception 'Administrator review was not stamped on the server.'; end if;
  begin
    update public.office_details set timezone = 'Invalid/Timezone' where id = 1;
    raise exception 'Invalid office time zone was allowed.';
  exception when raise_exception then
    if sqlerrm <> 'Use a valid IANA office time zone.' then raise; end if;
  end;
  begin
    update public.profiles set role = 'employee' where id = auth.uid();
    raise exception 'Administrator self-demotion was allowed.';
  exception when raise_exception then
    if sqlerrm <> 'You cannot remove your own administrator role.' then raise; end if;
  end;
end;
$$;
reset role;

select set_config('request.jwt.claim.sub', '', true);
set local role anon;
do $$
begin
  if exists (select 1 from public.profiles) or exists (select 1 from public.leave_requests)
    or exists (select 1 from public.attendance_events) or exists (select 1 from public.office_details) then
    raise exception 'Anonymous visitors can read employee data.';
  end if;
  begin
    perform public.record_attendance('time_in');
    raise exception 'Anonymous attendance was allowed.';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;
rollback;
select 'Database checks passed; all verification data rolled back.' as result;
