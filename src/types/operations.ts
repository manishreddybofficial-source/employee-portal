import type { AttendanceEvent, Profile } from './models';

export interface Employee extends Profile {
  employee_id: string | null;
  gender: 'Male' | 'Female';
  designation: string;
  secondary_duty: string | null;
  floor_id: number | null;
  shift_id: number | null;
  employment_status: 'Active' | 'Inactive';
  contact_number: string | null;
  joining_date: string;
  avatar_url: string | null;
  is_demo: boolean;
}

export interface Floor {
  id: number;
  name: string;
  location: string;
  /** Required people on this floor in each shift. */
  required_staff: number;
}

export interface Shift {
  id: number;
  name: string;
  start_time: string;
  end_time: string;
}

export interface PatrolRoute {
  id: number;
  name: string;
  floor_ids: number[];
}

export type PatrolStatus = 'Scheduled' | 'In Progress' | 'Completed' | 'Missed' | 'Incident Reported';

export interface PatrolRecord {
  id: number;
  officer_id: string;
  shift_id: number;
  floor_id: number;
  route_id: number;
  scheduled_at: string;
  started_at: string | null;
  completed_at: string | null;
  status: PatrolStatus;
  observations: string;
  incident_id: number | null;
}

export type IncidentSeverity = 'Low' | 'Medium' | 'High' | 'Critical';
export type IncidentStatus = 'Open' | 'Pending' | 'Escalated' | 'Resolved';

export interface Incident {
  id: number;
  category: string;
  description: string;
  reported_by: string;
  floor_id: number;
  created_at: string;
  severity: IncidentSeverity;
  controller_id: string | null;
  analyst_id: string | null;
  status: IncidentStatus;
  resolution: string;
}

export type HandoverStatus = 'Draft' | 'Submitted' | 'Acknowledged';

export interface Handover {
  id: number;
  outgoing_id: string;
  incoming_id: string;
  shift_id: number;
  shift_date: string;
  pending_incidents: string;
  shortages: string;
  observations: string;
  status: HandoverStatus;
  created_at: string;
}

export interface AuditLog {
  id: number;
  actor_id: string | null;
  entity_type: string;
  entity_id: string;
  action: string;
  old_values: Record<string, unknown> | unknown[] | null;
  new_values: Record<string, unknown> | unknown[] | null;
  reason: string;
  created_at: string;
}

export interface ShiftAssignment {
  id: number;
  user_id: string;
  floor_id: number | null;
  shift_id: number | null;
  starts_at: string;
  ends_at: string | null;
  assigned_by: string | null;
}

export type HandoverRecipient = Pick<Employee, 'id' | 'full_name' | 'employee_id' | 'role' | 'shift_id'>;

/** One server-authorized read shared by every operations dashboard. */
export interface OperationsSnapshot {
  employees: Employee[];
  floors: Floor[];
  shifts: Shift[];
  attendance: AttendanceEvent[];
  patrolRoutes: PatrolRoute[];
  patrols: PatrolRecord[];
  incidents: Incident[];
  handovers: Handover[];
  audit: AuditLog[];
  assignments?: ShiftAssignment[];
  handoverRecipients?: HandoverRecipient[];
}

export type MutationAction =
  | 'employee.update'
  | 'attendance.correct'
  | 'floor.save'
  | 'shift.save'
  | 'patrol.route'
  | 'patrol.create'
  | 'patrol.update'
  | 'incident.create'
  | 'incident.update'
  | 'handover.create'
  | 'handover.update';
