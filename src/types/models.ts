export type Role =
  'employee' | 'admin' | 'director' | 'asm' | 'supervisor' | 'gsoc' | 'controller' | 'security' | 'patrol';
export type EventType = 'time_in' | 'break_start' | 'break_end' | 'time_out';
export type WorkState = 'working' | 'break' | 'out';
export type LeaveStatus = 'pending' | 'approved' | 'rejected';
export type Tone = '' | 'green' | 'amber' | 'red' | 'blue';

export interface Profile {
  id: string;
  full_name: string;
  email: string | null;
  department: string;
  role: Role;
  secondary_duty?: string | null;
  created_at: string;
}

export interface OfficeDetails {
  id: number;
  company_name: string;
  address: string;
  phone: string;
  email: string;
  map_url: string;
  timezone: string;
  work_start: string;
  work_end: string;
  grace_minutes: number;
  break_policy: string;
  notes: string;
  updated_at: string;
}

export type OfficeUpdate = Partial<Omit<OfficeDetails, 'id' | 'updated_at'>>;

export interface AttendanceEvent {
  id: number;
  user_id: string;
  work_date: string;
  event_type: EventType;
  auto: boolean;
  created_at: string;
}

export interface LeaveRequest {
  id: number;
  user_id: string;
  leave_type: string;
  start_date: string;
  end_date: string;
  days: number;
  reason: string;
  status: LeaveStatus;
  admin_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  employee?: Pick<Profile, 'full_name' | 'email'> | null;
}
