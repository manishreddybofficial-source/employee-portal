-- Transactional integration checks: run after all migrations, as the database owner.
begin;
do $$
declare v_admin uuid:=gen_random_uuid(); v_staff uuid:=gen_random_uuid(); v_other uuid:=gen_random_uuid();
 v_super uuid:=gen_random_uuid(); v_gsoc uuid:=gen_random_uuid(); v_director uuid:=gen_random_uuid(); v_patrol uuid:=gen_random_uuid();
 v_controller uuid:=gen_random_uuid(); v_incoming uuid:=gen_random_uuid(); v_incident bigint;
begin
 perform set_config('security_test.admin',v_admin::text,true);
 perform set_config('security_test.staff',v_staff::text,true);
 perform set_config('security_test.other',v_other::text,true);
 perform set_config('security_test.super',v_super::text,true);
 perform set_config('security_test.gsoc',v_gsoc::text,true);
 perform set_config('security_test.director',v_director::text,true);
 perform set_config('security_test.patrol',v_patrol::text,true);
 perform set_config('security_test.controller',v_controller::text,true);
 perform set_config('security_test.incoming',v_incoming::text,true);
 insert into auth.users(id,email,raw_user_meta_data) values
 (v_admin,v_admin||'@example.test','{"full_name":"Security test admin"}'),
 (v_staff,v_staff||'@example.test','{"full_name":"Security test staff"}'),
 (v_other,v_other||'@example.test','{"full_name":"Security test other"}'),
 (v_super,v_super||'@example.test','{"full_name":"Security test supervisor"}'),
 (v_gsoc,v_gsoc||'@example.test','{"full_name":"Security test GSOC"}'),
 (v_director,v_director||'@example.test','{"full_name":"Security test director"}'),
 (v_patrol,v_patrol||'@example.test','{"full_name":"Security test patrol"}'),
 (v_controller,v_controller||'@example.test','{"full_name":"Unassigned controller"}'),
 (v_incoming,v_incoming||'@example.test','{"full_name":"Incoming supervisor"}');
 update public.profiles set role='admin' where id=v_admin;
 update public.profiles set role='security',shift_id=3,floor_id=1 where id=v_staff;
 update public.profiles set role='security',shift_id=2,floor_id=2 where id=v_other;
 update public.profiles set role='supervisor',shift_id=3,floor_id=1 where id=v_super;
 update public.profiles set role='gsoc',shift_id=3,floor_id=1 where id=v_gsoc;
 update public.profiles set role='director',shift_id=1,floor_id=1 where id=v_director;
 update public.profiles set role='patrol',designation='Patrolling Officer',shift_id=3,floor_id=1 where id=v_patrol;
 update public.profiles set role='controller' where id=v_controller;
 update public.profiles set role='supervisor',shift_id=2,floor_id=6 where id=v_incoming;
 insert into public.incidents(category,description,reported_by,floor_id,created_at,severity,status)
  values('Verification','Longstanding active incident',v_gsoc,8,now()-interval '40 days','Medium','Open') returning id into v_incident;
 perform set_config('security_test.old_incident',v_incident::text,true);
 perform set_config('request.jwt.claim.sub',v_staff::text,true);
 perform set_config('request.jwt.claim.role','authenticated',true);
end $$;

set local role authenticated;
do $$
declare v_snapshot jsonb; v_work_date date;
begin
 v_snapshot:=public.security_snapshot(current_date-7,current_date);
 if jsonb_array_length(v_snapshot->'employees')<>1 then raise exception 'Staff snapshot exposes another employee.'; end if;
 if not exists(select 1 from public.floors where id=8) or (select count(*) from public.shifts)<>3 then raise exception 'Building configuration missing.'; end if;
 begin
  perform public.security_mutate('employee.update',jsonb_build_object('id',auth.uid(),'role','admin'));
  raise exception 'Staff elevation succeeded.';
 exception when raise_exception then if sqlerrm<>'Employee management is not permitted.' then raise; end if; end;
 begin
  perform public.security_mutate('attendance.correct',jsonb_build_object('user_id',auth.uid(),'work_date',current_date,'reason','Fraud'));
  raise exception 'Staff correction succeeded.';
 exception when raise_exception then if sqlerrm<>'Only administrators can correct attendance.' then raise; end if; end;
 perform public.record_attendance('time_in');
 select work_date into v_work_date from public.attendance_events where user_id=auth.uid() order by id desc limit 1;
 if v_work_date<>(case when (now() at time zone (select timezone from public.office_details where id=1))::time<'06:00'::time
   then (now() at time zone (select timezone from public.office_details where id=1))::date-1
   else (now() at time zone (select timezone from public.office_details where id=1))::date end) then
  raise exception 'Night shift did not select its start work date.';
 end if;
 perform public.record_attendance('break_start');
 perform public.record_attendance('time_out');
 if (select event_type from public.attendance_events where user_id=auth.uid() order by id desc limit 1)<>'time_out' then raise exception 'Break checkout failed.'; end if;
end $$;
reset role;

select set_config('request.jwt.claim.sub',current_setting('security_test.super'),true);
set local role authenticated;
do $$
declare v_snapshot jsonb; v_handover bigint;
begin
 if not exists(select 1 from public.profiles where id=current_setting('security_test.staff')::uuid)
 or exists(select 1 from public.profiles where id=current_setting('security_test.other')::uuid) then raise exception 'Supervisor team scope failed.'; end if;
 begin
  perform public.security_mutate('employee.update',jsonb_build_object('id',current_setting('security_test.other'),'floor_id',1));
  raise exception 'Supervisor transferred another shift.';
 exception when raise_exception then if sqlerrm<>'Supervisors can manage only their assigned shift.' then raise; end if; end;
 perform public.security_mutate('employee.update',jsonb_build_object('id',current_setting('security_test.staff'),'floor_id',3));
 -- Other-shift recipients are discoverable without exposing their personal employee records.
 v_snapshot:=public.security_snapshot(current_date-7,current_date);
 if not exists(select 1 from jsonb_array_elements(v_snapshot->'handoverRecipients') p
    where p->>'id'=current_setting('security_test.incoming')) then raise exception 'Incoming handover supervisor is undiscoverable.'; end if;
 if exists(select 1 from jsonb_array_elements(v_snapshot->'employees') p
    where p->>'id'=current_setting('security_test.incoming')) then raise exception 'Recipient directory exposed an out-of-shift employee record.'; end if;
 if exists(select 1 from jsonb_array_elements(v_snapshot->'handoverRecipients') p
    where p ? 'email' or p ? 'contact_number') then raise exception 'Recipient directory exposes contacts.'; end if;
 perform public.security_mutate('incident.create','{"floor_id":3,"category":"Team-floor check","description":"Supervisor reports a team-floor observation"}'::jsonb);
 v_handover:=(public.security_mutate('handover.create',jsonb_build_object('incoming_id',current_setting('security_test.incoming'),
    'shift_id',3,'shift_date',current_date,'status','Draft'))->>'id')::bigint;
 begin
   perform public.security_mutate('handover.update',jsonb_build_object('id',v_handover,'status','Submitted','shortages',repeat('x',4001)));
   raise exception 'Oversized handover note accepted.';
 exception when raise_exception then if sqlerrm<>'Handover notes must be no longer than 4000 characters per field.' then raise; end if; end;
 perform public.security_mutate('handover.update',jsonb_build_object('id',v_handover,'status','Submitted','observations','Equipment and keys checked.'));
 begin
   perform public.security_mutate('handover.update',jsonb_build_object('id',v_handover,'status','Acknowledged'));
   raise exception 'Outgoing supervisor acknowledged own handover.';
 exception when raise_exception then if sqlerrm<>'Only the incoming supervisor may acknowledge this handover.' then raise; end if; end;
 perform set_config('security_test.handover',v_handover::text,true);
end $$;
reset role;

select set_config('request.jwt.claim.sub',current_setting('security_test.incoming'),true);
set local role authenticated;
do $$ begin
 perform public.security_mutate('handover.update',jsonb_build_object('id',current_setting('security_test.handover'),'status','Acknowledged'));
 if not exists(select 1 from public.handovers where id=current_setting('security_test.handover')::bigint and status='Acknowledged') then raise exception 'Incoming supervisor acknowledgement failed.'; end if;
end $$;
reset role;

select set_config('request.jwt.claim.sub',current_setting('security_test.admin'),true);
set local role authenticated;
do $$
declare v_date date:=current_date-3; v_before integer; v_id bigint; v_route bigint; v_patrol bigint;
begin
 select count(*) into v_before from public.audit_logs where action='attendance.correct';
 perform public.security_mutate('attendance.correct',jsonb_build_object('user_id',current_setting('security_test.staff'),
   'work_date',v_date,'login_at',v_date||'T22:00:00Z','logout_at',(v_date+1)||'T06:00:00Z','reason','Missed overnight punches'));
 if (select count(*) from public.audit_logs where action='attendance.correct')<>v_before+1 then raise exception 'Correction audit missing.'; end if;
 select id into v_id from public.audit_logs where action='attendance.correct' order by id desc limit 1;
 if not exists(select 1 from public.audit_logs where id=v_id and actor_id=auth.uid() and
   jsonb_array_length(new_values->'events')=2 and jsonb_array_length(old_values->'events')=0 and reason='Missed overnight punches') then raise exception 'Correction audit contents incomplete.'; end if;
 begin
  update public.audit_logs set reason='Hidden' where id=v_id;
  raise exception 'Browser changed audit.';
 exception when insufficient_privilege then null; end;
 begin
  delete from public.audit_logs where id=v_id;
  raise exception 'Browser erased audit.';
 exception when insufficient_privilege then null; end;
 begin
  perform public.security_mutate('attendance.correct',jsonb_build_object('user_id',current_setting('security_test.staff'),
    'work_date',v_date,'login_at',v_date||'T22:00:00Z','logout_at',v_date||'T06:00:00Z','reason','Invalid reverse time'));
  raise exception 'Reverse timestamps accepted.';
 exception when raise_exception then if sqlerrm not like 'Attendance must be chronological%' then raise; end if; end;
 perform public.security_mutate('employee.update',jsonb_build_object('id',current_setting('security_test.staff'),'shift_id',1,'floor_id',2));
 if (select count(*) from public.shift_assignments where user_id=current_setting('security_test.staff')::uuid and ends_at is null)<>1 then raise exception 'Double current shift assignment.'; end if;
 v_route:=(public.security_mutate('patrol.route','{"name":"Verification route","floor_ids":[1,2]}'::jsonb)->>'id')::bigint;
 v_patrol:=(public.security_mutate('patrol.create',jsonb_build_object('officer_id',current_setting('security_test.patrol'),
  'shift_id',3,'floor_id',2,'route_id',v_route,'scheduled_at',now()-interval '10 minutes'))->>'id')::bigint;
 perform set_config('security_test.patrol_record',v_patrol::text,true);
 -- Transfer must never change the shift associated with an open session.
 perform public.record_attendance('time_in');
 begin
  perform public.security_mutate('employee.update',jsonb_build_object('id',auth.uid(),'floor_id',4));
  raise exception 'Open-session transfer succeeded.';
 exception when raise_exception then if sqlerrm<>'Check out before transferring an employee to another floor or shift.' then raise; end if; end;
 perform public.record_attendance('time_out');
 begin
  update public.profiles set employment_status='Inactive' where id=auth.uid();
  raise exception 'Direct self-deactivation succeeded.';
 exception when raise_exception then if sqlerrm<>'You cannot deactivate your own account.' then raise; end if; end;
 begin
  perform public.security_mutate('handover.create',jsonb_build_object('incoming_id',current_setting('security_test.super'),
   'shift_id',3,'shift_date',current_date,'status','Acknowledged'));
  raise exception 'Outgoing supervisor forged acknowledgement.';
 exception when raise_exception then if sqlerrm<>'New handovers must be draft or submitted.' then raise; end if; end;
end $$;
reset role;

select set_config('request.jwt.claim.sub',current_setting('security_test.patrol'),true);
set local role authenticated;
do $$
declare v_id bigint:=current_setting('security_test.patrol_record')::bigint;
begin
 perform public.security_mutate('patrol.update',jsonb_build_object('id',v_id,'status','In Progress'));
 perform public.security_mutate('incident.create','{"floor_id":2,"category":"Patrol observation","description":"Officer reports observation on active round floor"}'::jsonb);
 begin
  perform public.security_mutate('incident.create','{"floor_id":8,"category":"Outside assignment","description":"Should be rejected"}'::jsonb);
  raise exception 'Officer reported an unrelated floor.';
 exception when raise_exception then if sqlerrm<>'Report incidents only for your assigned floor or active patrol/team floor.' then raise; end if; end;
 perform public.security_mutate('patrol.update',jsonb_build_object('id',v_id,'status','Completed','observations','Manual round checked.'));
 if not exists(select 1 from public.patrol_records where id=v_id and status='Completed' and started_at is not null and completed_at>=started_at) then raise exception 'Patrol completion failed.'; end if;
 begin
  perform public.security_mutate('patrol.update',jsonb_build_object('id',v_id,'status','Scheduled'));
  raise exception 'Completed patrol reset allowed.';
 exception when raise_exception then if sqlerrm<>'Invalid patrol status transition.' then raise; end if; end;
end $$;
reset role;

select set_config('request.jwt.claim.sub',current_setting('security_test.gsoc'),true);
set local role authenticated;
do $$
declare v_incident bigint; v_snapshot jsonb;
begin
 v_incident:=(public.security_mutate('incident.create','{"floor_id":8,"category":"Access control","description":"Demo access point check","severity":"High"}'::jsonb)->>'id')::bigint;
 perform set_config('security_test.incident',v_incident::text,true);
 perform public.security_mutate('incident.update',jsonb_build_object('id',v_incident,'status','Escalated'));
 perform public.security_mutate('incident.update',jsonb_build_object('id',v_incident,'status','Resolved','resolution','Access point verified.'));
 v_snapshot:=public.security_snapshot(current_date-7,current_date);
 if not exists(select 1 from jsonb_array_elements(v_snapshot->'incidents') i where i->>'id'=current_setting('security_test.old_incident')) then raise exception 'Longstanding active incident disappeared from operations.'; end if;
 if exists(select 1 from jsonb_array_elements(v_snapshot->'employees') p where p->>'id'<>auth.uid()::text and
  (nullif(p->>'email','') is not null or nullif(p->>'contact_number','') is not null)) then raise exception 'GSOC snapshot leaked contacts.'; end if;
end $$;
reset role;

-- Null assignments must deny access, rather than produce a null IF condition.
select set_config('request.jwt.claim.sub',current_setting('security_test.controller'),true);
set local role authenticated;
do $$ begin
 begin
  perform public.security_mutate('incident.update',jsonb_build_object('id',current_setting('security_test.incident'),'status','Open'));
  raise exception 'Unassigned controller changed an incident.';
 exception when raise_exception then if sqlerrm<>'Incident management is not permitted for this incident.' then raise; end if; end;
end $$;
reset role;
update public.profiles set shift_id=null where id=current_setting('security_test.super')::uuid;
select set_config('request.jwt.claim.sub',current_setting('security_test.super'),true);
set local role authenticated;
do $$ begin
 begin
  perform public.security_mutate('patrol.update',jsonb_build_object('id',current_setting('security_test.patrol_record'),'observations','Unassigned supervisor edit'));
  raise exception 'Unassigned supervisor changed a patrol.';
 exception when raise_exception then if sqlerrm<>'This patrol is outside your assignment.' then raise; end if; end;
end $$;
reset role;

select set_config('request.jwt.claim.sub',current_setting('security_test.admin'),true);
-- Another work date can enclose the proposed interval without either endpoint falling inside it.
insert into public.attendance_events(user_id,work_date,event_type,created_at) values
 (current_setting('security_test.staff')::uuid,current_date-5,'time_in',((current_date-5)+'22:00'::time) at time zone (select timezone from public.office_details where id=1)),
 (current_setting('security_test.staff')::uuid,current_date-5,'time_out',((current_date-4)+'06:00'::time) at time zone (select timezone from public.office_details where id=1));
set local role authenticated;
do $$ begin
 begin
  perform public.security_mutate('attendance.correct',jsonb_build_object('user_id',current_setting('security_test.staff'),
   'work_date',current_date-4,'login_at',((current_date-4)+'01:00'::time) at time zone (select timezone from public.office_details where id=1),
   'logout_at',((current_date-4)+'02:00'::time) at time zone (select timezone from public.office_details where id=1),'reason','Overlapping night continuation'));
  raise exception 'Enclosing attendance overlap accepted.';
 exception when raise_exception then if sqlerrm<>'Attendance overlaps another work date.' then raise; end if; end;
 begin
  perform public.security_mutate('shift.save','{"id":1,"name":"Morning","start_time":"07:00","end_time":"15:00"}'::jsonb);
  set constraints shifts_no_overlap immediate;
  raise exception 'Overlapping recurring shifts accepted.';
 exception when raise_exception then if sqlerrm<>'Shift times overlap. Submit all affected shifts together.' then raise; end if; end;
 -- A rotation is valid when all three boundaries change in the same transaction.
 perform public.security_mutate('shift.save','{"shifts":[{"id":1,"name":"Morning","start_time":"07:00","end_time":"15:00"},{"id":2,"name":"Evening","start_time":"15:00","end_time":"23:00"},{"id":3,"name":"Night","start_time":"23:00","end_time":"07:00"}]}'::jsonb);
 set constraints shifts_no_overlap immediate;
end $$;
reset role;

select set_config('request.jwt.claim.sub',current_setting('security_test.director'),true);
set local role authenticated;
do $$
begin
 if jsonb_array_length(public.security_snapshot(current_date-7,current_date)->'employees')<7 then raise exception 'Director visibility failed.'; end if;
 begin
  perform public.security_mutate('floor.save','{"id":1,"name":"Unauthorized edit"}'::jsonb);
  raise exception 'Director changed system configuration.';
 exception when raise_exception then if sqlerrm<>'Only administrators can configure floors.' then raise; end if; end;
end $$;
reset role;

-- Append-only audit protects even accidental privileged SQL, not merely browser access.
do $$ begin
 begin
  delete from public.audit_logs where id=(select min(id) from public.audit_logs);
  raise exception 'Privileged audit deletion succeeded.';
 exception when raise_exception then if sqlerrm<>'Audit history is immutable.' then raise; end if; end;
end $$;
select set_config('request.jwt.claim.sub','',true);
set local role anon;
do $$ begin
 begin perform public.security_snapshot(current_date,current_date); raise exception 'Anonymous snapshot succeeded.';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
select 'Security operations database checks passed; fixtures rolled back.' as result;
