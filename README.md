# Canal Watch Survey Schedule — LIVE Supabase version

This package connects the schedule to the Queen's Park Trust Supabase project.

## Important database correction
The live schema separates:

- **Supabase Auth / admin_profiles** — secure schedule administrators
- **volunteers** — ordinary volunteer records with optional email addresses

This means volunteers do **not** need a login and do **not** need an email address.

## Files
- `database-reset-and-upgrade.sql` — run this FIRST in Supabase SQL Editor
- `config.js` — contains the public Supabase project URL and anon key
- `index.html` — public schedule
- `admin.html` — secure sign-in and schedule administration
- `app.js` — public Supabase data loading
- `admin.js` — authenticated administration
- `styles.css`

## Setup order

1. In Supabase SQL Editor, run `database-reset-and-upgrade.sql`.
   It removes the earlier empty prototype tables and recreates the correct live schema.
   It does NOT delete users from Supabase Authentication.

2. Re-enable your manager account:
   ```sql
   update public.admin_profiles
   set can_manage = true
   where id = (
     select id from auth.users where email = 'YOUR EMAIL ADDRESS'
   );
   ```

3. Test `admin.html` locally or after uploading to GitHub Pages.

4. Upload all web files (`index.html`, `admin.html`, `app.js`, `admin.js`,
   `config.js`, `styles.css`) to the same GitHub Pages folder.

5. Link `index.html` from the Queen's Park Trust Webador page.

## Security
The browser contains only the Supabase anon/public key. This is expected for a
Supabase browser application. The service-role key must never be added to these files.

Row Level Security controls database access:
- public visitors can read safe schedule information
- volunteer email addresses are not granted to the anonymous role
- team membership is private
- only authenticated users with `admin_profiles.can_manage = true` can change data

## Automatic recurrence
When an authorised manager opens the admin page, overdue auto-repeat survey
rounds are rolled forward and the selected survey sites are copied into the
new round. This can later be moved to a scheduled server job if desired.


# Administrator Management Upgrade

This package now includes an **Administrators** section for Admin Managers.

## What an Admin Manager can do
- view administrator accounts
- invite a new administrator by email
- grant normal schedule-management access
- optionally grant Admin Manager access
- disable/re-enable another administrator's access
- see their own account but cannot accidentally remove their own Admin Manager rights

## Security design
Administrator invitation and permission changes are NOT performed directly by browser code.

They go through the Supabase Edge Function:

`supabase/functions/manage-admins/index.ts`

That function:
1. verifies the signed-in user
2. confirms that `can_manage_admins = true`
3. uses Supabase's server-side Auth Admin API
4. sends the invitation or changes the permissions

The Supabase service-role/secret key remains server-side only.

## Installation

### 1. Run the migration
In Supabase SQL Editor, run:

`administrator-management-upgrade.sql`

Your existing schedule manager is promoted to Admin Manager automatically.

### 2. Deploy the Edge Function
In Supabase Dashboard, create/deploy an Edge Function named:

`manage-admins`

Use the supplied:

`supabase/functions/manage-admins/index.ts`

The hosted Supabase Edge Function environment provides `SUPABASE_URL` and the legacy `SUPABASE_SERVICE_ROLE_KEY` automatically.

### 3. Upload updated website files
Replace these files in GitHub Pages:
- `admin.html`
- `admin.js`

The public schedule files do not need to change for this feature.

### 4. Configure invitation redirect
In Supabase Authentication URL Configuration, add:

`https://raylancashire.github.io/canal-watch-survey-schedule/admin.html`

to the allowed redirect URLs.

## Invitation note
Supabase invitation links use the project's Auth email template and expiration settings.


## Webador public-page cleanup
The public `index.html` no longer shows the Schedule administration link.
Administration remains available directly at:

`https://raylancashire.github.io/canal-watch-survey-schedule/admin.html`

A recommended Webador iframe snippet is included in `WEBADOR-EMBED.html`.
