-- Additive release fix: retain the already-applied security operations migration.
-- Safe supervisor handover directory, active-incident visibility, and scoped patrol/team reporting.
begin;

create or replace function public.security_snapshot(p_from date,p_to date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_role text:=public.security_role(); v_result jsonb;
begin
 if v_role is null then raise exception 'Active employee sign-in required.'; end if;
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>366 then raise exception 'Select a date range of at most 367 days.'; end if;
 select jsonb_build_object(
  'employees',coalesce((select jsonb_agg(case when public.security_can_see_employee(p.id) then to_jsonb(p)
   else to_jsonb(p)-'contact_number'-'email'-'joining_date'-'created_at'||jsonb_build_object('contact_number',null,'email',null) end order by p.employee_id nulls last,p.full_name)
   from public.profiles p where public.security_can_see_employee(p.id) or v_role in ('gsoc','controller')),'[]'::jsonb),
  'handoverRecipients',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'full_name',p.full_name,'employee_id',p.employee_id,'shift_id',p.shift_id,'role','supervisor') order by p.full_name)
    from public.profiles p where p.role='supervisor' and p.employment_status='Active' and v_role in ('admin','director','asm','supervisor')),'[]'::jsonb),
  'floors',coalesce((select jsonb_agg(f order by f.id) from public.floors f),'[]'::jsonb),
  'shifts',coalesce((select jsonb_agg(s order by s.id) from public.shifts s),'[]'::jsonb),
  'attendance',coalesce((select jsonb_agg(e order by e.created_at,e.id) from public.attendance_events e
    where e.work_date between p_from and p_to and (public.security_can_see_employee(e.user_id) or v_role in ('gsoc','controller'))),'[]'::jsonb),
  'assignments',coalesce((select jsonb_agg(a order by a.starts_at,a.id) from public.shift_assignments a
    where public.security_can_see_employee(a.user_id) or v_role in ('gsoc','controller')),'[]'::jsonb),
  'patrolRoutes',coalesce((select jsonb_agg(r order by r.id) from public.patrol_routes r),'[]'::jsonb),
  'patrols',coalesce((select jsonb_agg(r order by r.scheduled_at desc,r.id desc) from public.patrol_records r
   where (r.scheduled_at at time zone (select timezone from public.office_details where id=1))::date between p_from and p_to
    and (public.security_can_see_employee(r.officer_id) or v_role in ('gsoc','controller'))),'[]'::jsonb),
  'incidents',coalesce((select jsonb_agg(i order by i.created_at desc,i.id desc) from public.incidents i
   where ((i.created_at at time zone (select timezone from public.office_details where id=1))::date between p_from and p_to or i.status<>'Resolved')
    and (v_role in ('admin','director','asm','gsoc') or i.reported_by=auth.uid() or
      (v_role='controller' and (i.controller_id=auth.uid() or i.floor_id=public.security_floor())) or
      (v_role='supervisor' and (public.security_can_see_employee(i.reported_by) or i.floor_id=public.security_floor())))),'[]'::jsonb),
  'handovers',coalesce((select jsonb_agg(h order by h.shift_date desc,h.id desc) from public.handovers h
   where h.shift_date between p_from and p_to and (v_role in ('admin','director','asm') or
    (v_role='supervisor' and (h.shift_id=public.security_shift() or h.incoming_id=auth.uid())))),'[]'::jsonb),
  'audit',coalesce((select jsonb_agg(a order by a.created_at desc,a.id desc) from public.audit_logs a
   where v_role in ('admin','director','asm') and
    (a.created_at at time zone (select timezone from public.office_details where id=1))::date between p_from and p_to),'[]'::jsonb)
 ) into v_result;
 return v_result;
end $$;

create or replace function public.security_mutate(p_action text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 v_role text:=public.security_role(); v_uid uuid:=auth.uid(); v_id bigint;
 v_user uuid; v_employee public.profiles; v_old jsonb; v_new jsonb; v_row jsonb;
 v_login timestamptz; v_logout timestamptz; v_date date; v_original date; v_tz text;
 v_patrol public.patrol_records; v_incident public.incidents; v_handover public.handovers;
 v_floor integer; v_shift integer; v_status text; v_item jsonb; v_route bigint;
begin
 if v_role is null then raise exception 'Active employee sign-in required.'; end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'Invalid operation payload.'; end if;
 perform set_config('portal.audit_reason',coalesce(nullif(btrim(p_payload->>'reason'),''),p_action),true);
 if p_action='employee.update' then
   v_user:=(p_payload->>'id')::uuid;
   select * into strict v_employee from public.profiles where id=v_user for update;
   if v_role not in ('admin','asm','supervisor') then raise exception 'Employee management is not permitted.'; end if;
   if v_role='supervisor' and (v_employee.shift_id is distinct from public.security_shift()
       or (p_payload ? 'shift_id' and (p_payload->>'shift_id')::integer is distinct from public.security_shift())) then
     raise exception 'Supervisors can manage only their assigned shift.';
   end if;
   if v_role<>'admin' and exists(select 1 from jsonb_object_keys(p_payload) k
       where k not in ('id','floor_id','shift_id','reason')) then raise exception 'Only an administrator can edit personal details or roles.'; end if;
   if p_payload ? 'full_name' and length(btrim(p_payload->>'full_name')) not between 1 and 120 then raise exception 'Enter a full name.'; end if;
   update public.profiles set
    full_name=case when p_payload ? 'full_name' then btrim(p_payload->>'full_name') else full_name end,
    department=case when p_payload ? 'department' then p_payload->>'department' else department end,
    employee_id=case when p_payload ? 'employee_id' then nullif(p_payload->>'employee_id','') else employee_id end,
    gender=case when p_payload ? 'gender' then p_payload->>'gender' else gender end,
    designation=case when p_payload ? 'designation' then p_payload->>'designation' else designation end,
    secondary_duty=case when p_payload ? 'secondary_duty' then nullif(p_payload->>'secondary_duty','') else secondary_duty end,
    floor_id=case when p_payload ? 'floor_id' then (p_payload->>'floor_id')::integer else floor_id end,
    shift_id=case when p_payload ? 'shift_id' then (p_payload->>'shift_id')::integer else shift_id end,
    role=case when p_payload ? 'role' then p_payload->>'role' else role end,
    employment_status=case when p_payload ? 'employment_status' then p_payload->>'employment_status' else employment_status end,
    contact_number=case when p_payload ? 'contact_number' then p_payload->>'contact_number' else contact_number end,
    joining_date=case when p_payload ? 'joining_date' then (p_payload->>'joining_date')::date else joining_date end,
    avatar_url=case when p_payload ? 'avatar_url' then nullif(p_payload->>'avatar_url','') else avatar_url end
   where id=v_user returning to_jsonb(profiles.*) into v_row;
   if v_user=v_uid and v_row->>'employment_status'<>'Active' then raise exception 'You cannot deactivate your own account.'; end if;

 elsif p_action='attendance.correct' then
   if v_role<>'admin' then raise exception 'Only administrators can correct attendance.'; end if;
   if length(btrim(coalesce(p_payload->>'reason','')))<3 then raise exception 'A correction reason is required.'; end if;
   v_user:=(p_payload->>'user_id')::uuid; v_date:=(p_payload->>'work_date')::date;
   v_original:=coalesce((p_payload->>'original_work_date')::date,v_date);
   v_login:=nullif(p_payload->>'login_at','')::timestamptz; v_logout:=nullif(p_payload->>'logout_at','')::timestamptz;
   select timezone into v_tz from public.office_details where id=1;
   if v_date is null or v_original is null or v_date>(now() at time zone v_tz)::date then raise exception 'Invalid attendance date.'; end if;
   if v_login is null and v_logout is not null then raise exception 'Check-in is required before check-out.'; end if;
   if v_login>now() or v_logout>now() or v_logout<v_login or v_logout-v_login>interval '24 hours' then raise exception 'Attendance must be chronological, no longer than 24 hours, and not in the future.'; end if;
   if v_login is not null and (v_login at time zone v_tz)::date not between v_date and v_date+1 then raise exception 'Check-in must belong to the work date or its overnight continuation.'; end if;
   perform 1 from public.profiles where id=v_user;
   if not found then raise exception 'Employee not found.'; end if;
   perform pg_advisory_xact_lock(hashtext(v_user::text));
   if v_original<>v_date and exists(select 1 from public.attendance_events where user_id=v_user and work_date=v_date) then raise exception 'The destination date already has attendance.'; end if;
   select coalesce(jsonb_agg(e order by e.created_at,e.id),'[]'::jsonb) into v_old from public.attendance_events e where user_id=v_user and work_date=v_original;
   if v_login is not null and exists(
     select 1 from public.attendance_events where user_id=v_user and work_date<>v_original
     group by work_date having
       min(created_at)<coalesce(v_logout,now()) and
       (case when (array_agg(event_type order by created_at desc,id desc))[1]='time_out'
             then max(created_at) else now() end)>v_login
   ) then raise exception 'Attendance overlaps another work date.'; end if;
   if v_login is not null and exists(select 1 from public.attendance_events where user_id=v_user and work_date=v_original
      and event_type in ('break_start','break_end') and (created_at<v_login or created_at>coalesce(v_logout,now()))) then
     raise exception 'Corrected times must retain the existing break sequence.';
   end if;
   if v_login is null then delete from public.attendance_events where user_id=v_user and work_date=v_original;
   else
     delete from public.attendance_events where user_id=v_user and work_date=v_original and event_type in ('time_in','time_out');
     update public.attendance_events set work_date=v_date where user_id=v_user and work_date=v_original;
     insert into public.attendance_events(user_id,work_date,event_type,created_at) values(v_user,v_date,'time_in',v_login);
     if v_logout is not null then
       if (select event_type from public.attendance_events where user_id=v_user and work_date=v_date order by created_at desc,id desc limit 1)='break_start' then
         insert into public.attendance_events(user_id,work_date,event_type,created_at) values(v_user,v_date,'break_end',v_logout);
       end if;
       insert into public.attendance_events(user_id,work_date,event_type,created_at) values(v_user,v_date,'time_out',v_logout);
     end if;
   end if;
   select coalesce(jsonb_agg(e order by e.created_at,e.id),'[]'::jsonb) into v_new from public.attendance_events e where user_id=v_user and work_date=v_date;
   insert into public.audit_logs(actor_id,entity_type,entity_id,action,old_values,new_values,reason)
    values(v_uid,'attendance',v_user::text||'/'||v_original,'attendance.correct',
     jsonb_build_object('work_date',v_original,'events',v_old),jsonb_build_object('work_date',v_date,'events',v_new),btrim(p_payload->>'reason'));
   v_row:=jsonb_build_object('work_date',v_date,'events',v_new);

 elsif p_action='floor.save' then
   if v_role<>'admin' then raise exception 'Only administrators can configure floors.'; end if;
   if nullif(p_payload->>'id','') is null then
     insert into public.floors(name,location,required_staff) values(btrim(p_payload->>'name'),coalesce(p_payload->>'location',''),coalesce((p_payload->>'required_staff')::integer,3)) returning to_jsonb(floors.*) into v_row;
   else
     update public.floors set name=btrim(p_payload->>'name'),location=coalesce(p_payload->>'location',''),required_staff=coalesce((p_payload->>'required_staff')::integer,3) where id=(p_payload->>'id')::integer returning to_jsonb(floors.*) into v_row;
   end if;

 elsif p_action='shift.save' then
   if v_role<>'admin' then raise exception 'Only administrators can configure shifts.'; end if;
   -- Lock the schedule so concurrent edits cannot jointly introduce an overlap.
   perform pg_advisory_xact_lock(hashtext('portal.shift.configuration'));
   for v_item in select value from jsonb_array_elements(coalesce(p_payload->'shifts',jsonb_build_array(p_payload))) loop
     update public.shifts set name=btrim(v_item->>'name'),start_time=(v_item->>'start_time')::time,end_time=(v_item->>'end_time')::time where id=(v_item->>'id')::integer returning to_jsonb(shifts.*) into v_row;
     if v_row is null then raise exception 'Shift not found.'; end if;
   end loop;

 elsif p_action='patrol.route' then
   if v_role not in ('admin','asm','supervisor') then raise exception 'Route configuration is not permitted.'; end if;
   if not (p_payload ? 'floor_ids') or jsonb_array_length(p_payload->'floor_ids')=0 or exists
     (select 1 from jsonb_array_elements_text(p_payload->'floor_ids') x where not exists(select 1 from public.floors where id=x::integer)) then raise exception 'Select valid route floors.'; end if;
   insert into public.patrol_routes(name,floor_ids) values(btrim(p_payload->>'name'),array(select value::integer from jsonb_array_elements_text(p_payload->'floor_ids'))) returning to_jsonb(patrol_routes.*) into v_row;

 elsif p_action='patrol.create' then
   if v_role not in ('admin','asm','supervisor') then raise exception 'Patrol scheduling is not permitted.'; end if;
   v_user:=(p_payload->>'officer_id')::uuid; v_shift:=(p_payload->>'shift_id')::integer; v_floor:=(p_payload->>'floor_id')::integer; v_route:=(p_payload->>'route_id')::bigint;
   select * into strict v_employee from public.profiles where id=v_user;
   if v_employee.employment_status<>'Active' or not(v_employee.role='patrol' or v_employee.secondary_duty='Patrolling Officer' or v_employee.designation='Patrolling Officer') then raise exception 'Select an active patrol officer.'; end if;
   if v_employee.shift_id is distinct from v_shift then raise exception 'Patrol must use the officer assigned shift.'; end if;
   if v_role='supervisor' and v_shift is distinct from public.security_shift() then raise exception 'Supervisors can schedule only their shift.'; end if;
   if not exists(select 1 from public.patrol_routes where id=v_route and v_floor=any(floor_ids)) then raise exception 'The patrol floor is not on this route.'; end if;
   insert into public.patrol_records(officer_id,shift_id,floor_id,route_id,scheduled_at) values(v_user,v_shift,v_floor,v_route,(p_payload->>'scheduled_at')::timestamptz) returning to_jsonb(patrol_records.*) into v_row;

 elsif p_action='patrol.update' then
   v_id:=(p_payload->>'id')::bigint; select * into strict v_patrol from public.patrol_records where id=v_id for update;
   if not coalesce(v_role in ('admin','asm') or (v_role='supervisor' and v_patrol.shift_id=public.security_shift()) or v_patrol.officer_id=v_uid,false) then raise exception 'This patrol is outside your assignment.'; end if;
   v_status:=coalesce(p_payload->>'status',v_patrol.status);
   if v_status<>v_patrol.status and not ((v_patrol.status='Scheduled' and v_status in ('In Progress','Missed')) or
      (v_patrol.status='In Progress' and v_status in ('Completed','Incident Reported'))) then raise exception 'Invalid patrol status transition.'; end if;
   if v_status='Missed' and v_patrol.scheduled_at>now() then raise exception 'A future patrol cannot be missed.'; end if;
   if v_status='Incident Reported' and not exists(select 1 from public.incidents where id=(p_payload->>'incident_id')::bigint and floor_id=v_patrol.floor_id) then raise exception 'Link an incident on the patrol floor.'; end if;
   update public.patrol_records set status=v_status,
    started_at=case when v_status='In Progress' and started_at is null then now() else started_at end,
    completed_at=case when v_status in ('Completed','Incident Reported') and completed_at is null then now() else completed_at end,
    observations=coalesce(p_payload->>'observations',observations),incident_id=case when p_payload ? 'incident_id' then (p_payload->>'incident_id')::bigint else incident_id end
    where id=v_id returning to_jsonb(patrol_records.*) into v_row;

 elsif p_action='incident.create' then
   v_floor:=(p_payload->>'floor_id')::integer;
   if v_role not in ('admin','asm','gsoc') and v_floor is distinct from public.security_floor()
      and not exists(select 1 from public.patrol_records where officer_id=v_uid and floor_id=v_floor and status='In Progress')
      and not (v_role='supervisor' and exists(select 1 from public.profiles where shift_id=public.security_shift() and floor_id=v_floor and employment_status='Active'))
   then raise exception 'Report incidents only for your assigned floor or active patrol/team floor.'; end if;
   insert into public.incidents(category,description,reported_by,floor_id,severity)
    values(btrim(p_payload->>'category'),btrim(p_payload->>'description'),v_uid,v_floor,coalesce(p_payload->>'severity','Low')) returning to_jsonb(incidents.*) into v_row;

 elsif p_action='incident.update' then
   v_id:=(p_payload->>'id')::bigint; select * into strict v_incident from public.incidents where id=v_id for update;
   if not coalesce(v_role in ('admin','asm','gsoc') or (v_role='supervisor' and (public.security_can_see_employee(v_incident.reported_by) or v_incident.floor_id=public.security_floor())) or
       (v_role='controller' and (v_incident.controller_id=v_uid or v_incident.floor_id=public.security_floor())),false) then raise exception 'Incident management is not permitted for this incident.'; end if;
   if nullif(p_payload->>'controller_id','') is not null and not exists(select 1 from public.profiles where id=(p_payload->>'controller_id')::uuid and role='controller' and employment_status='Active') then raise exception 'Select an active controller.'; end if;
   if nullif(p_payload->>'analyst_id','') is not null and not exists(select 1 from public.profiles where id=(p_payload->>'analyst_id')::uuid and role='gsoc' and employment_status='Active') then raise exception 'Select an active GSOC analyst.'; end if;
   update public.incidents set status=coalesce(p_payload->>'status',status),severity=coalesce(p_payload->>'severity',severity),resolution=coalesce(p_payload->>'resolution',resolution),
    controller_id=case when p_payload ? 'controller_id' then nullif(p_payload->>'controller_id','')::uuid else controller_id end,
    analyst_id=case when p_payload ? 'analyst_id' then nullif(p_payload->>'analyst_id','')::uuid else analyst_id end
    where id=v_id returning to_jsonb(incidents.*) into v_row;

 elsif p_action='handover.create' then
   if v_role not in ('admin','asm','supervisor') then raise exception 'Handover submission is not permitted.'; end if;
   v_shift:=(p_payload->>'shift_id')::integer; v_user:=(p_payload->>'incoming_id')::uuid;
   if v_role='supervisor' and v_shift is distinct from public.security_shift() then raise exception 'Use your assigned shift.'; end if;
   if not exists(select 1 from public.profiles where id=v_user and role='supervisor' and employment_status='Active') then raise exception 'Select an active incoming supervisor.'; end if;
   if length(coalesce(p_payload->>'pending_incidents',''))>4000 or length(coalesce(p_payload->>'shortages',''))>4000 or length(coalesce(p_payload->>'observations',''))>4000 then raise exception 'Handover notes must be no longer than 4000 characters per field.'; end if;
   if coalesce(p_payload->>'status','Submitted') not in ('Draft','Submitted') then raise exception 'New handovers must be draft or submitted.'; end if;
   insert into public.handovers(outgoing_id,incoming_id,shift_id,shift_date,pending_incidents,shortages,observations,status)
    values(v_uid,v_user,v_shift,(p_payload->>'shift_date')::date,coalesce(p_payload->>'pending_incidents',''),coalesce(p_payload->>'shortages',''),coalesce(p_payload->>'observations',''),coalesce(p_payload->>'status','Submitted')) returning to_jsonb(handovers.*) into v_row;

 elsif p_action='handover.update' then
   v_id:=(p_payload->>'id')::bigint; select * into strict v_handover from public.handovers where id=v_id for update;
   if v_handover.status='Draft' and p_payload->>'status'='Submitted' then
     if not(v_role in ('admin','asm') or v_handover.outgoing_id=v_uid) then raise exception 'Only the outgoing supervisor may submit this draft.'; end if;
     if length(coalesce(p_payload->>'pending_incidents',v_handover.pending_incidents))>4000
        or length(coalesce(p_payload->>'shortages',v_handover.shortages))>4000
        or length(coalesce(p_payload->>'observations',v_handover.observations))>4000 then raise exception 'Handover notes must be no longer than 4000 characters per field.'; end if;
     update public.handovers set status='Submitted',pending_incidents=coalesce(p_payload->>'pending_incidents',pending_incidents),
       shortages=coalesce(p_payload->>'shortages',shortages),observations=coalesce(p_payload->>'observations',observations)
       where id=v_id returning to_jsonb(handovers.*) into v_row;
   else
     if v_handover.status<>'Submitted' or p_payload->>'status' is distinct from 'Acknowledged' then raise exception 'Only submitted handovers can be acknowledged.'; end if;
     if not(v_role in ('admin','asm') or v_handover.incoming_id=v_uid) then raise exception 'Only the incoming supervisor may acknowledge this handover.'; end if;
     update public.handovers set status='Acknowledged' where id=v_id returning to_jsonb(handovers.*) into v_row;
   end if;
 else raise exception 'Unknown security operation.';
 end if;
 if v_row is null then raise exception 'Record not found.'; end if;
 return v_row;
end $$;

commit;
