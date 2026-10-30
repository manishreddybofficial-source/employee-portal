-- Local development data. Applied by `npm run db:start` (first run) and `npm run db:reset`.
update public.office_details
set company_name  = 'Demo Company',
    address       = '123 Main Street, New York, NY 10001',
    phone         = '+1 (555) 010-2000',
    email         = 'hr@example.com',
    timezone      = 'America/New_York',
    work_start    = '09:00',
    work_end      = '18:00',
    grace_minutes = 15
where id = 1;
