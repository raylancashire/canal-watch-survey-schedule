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
