/** A section of the admin panel that can reload its data. */
export interface AdminView {
  refresh: () => Promise<void>;
}