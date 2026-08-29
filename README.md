# Canal Watch Volunteer Survey Portal

Adds a separate passwordless volunteer portal to the existing Canal Watch Survey Schedule.

## New files
- `volunteer.html`
- `volunteer.js`
- `volunteer-portal-upgrade.sql`

## Volunteer workflow
Volunteers sign in with the email already held in the Canal Watch volunteer record. Supabase sends a magic link. Once authenticated, the volunteer can see future survey sites and assign or unassign only themselves.

## Existing features
No existing public-schedule or administrator files need to be replaced for this upgrade.

## Security model
The upgrade adds an optional `auth_user_id` link to `volunteers`, plus narrowly scoped Security Definer RPC functions. Volunteers do not receive administrator rights or general write permissions to assignment tables.
