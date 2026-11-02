/** Product settings. Adjust these to your company; nothing else needs to change. */
export const app = {
  portalName: 'MY PORTAL',
  /** Put your logo at public/logo.png. It is hidden automatically if missing. */
  logoUrl: '/logo.png',
  /** Shows a "Desktop Only" screen below 900px, like the original portal. */
  desktopOnly: false,
  /** Set to false once every employee has an account. */
  allowSignup: true,
  fullDayHours: 8,
  halfDayHours: 4,
  /** Must match the 12-hour rule in record_attendance() (supabase/migrations). */
  staleSessionHours: 12,
} as const;

/** Leave allowance per calendar year. null means unlimited. */
export const leaveAllowance: Readonly<Record<string, number | null>> = {
  'Casual Leave': 12,
  'Sick Leave': 10,
  'Annual Leave': 15,
  'Unpaid Leave': null,
};
