# Canal Watch — Survey Scheduler

Queen’s Park Trust’s public survey schedule, volunteer self-assignment portal and secure administration system for monitoring the Grand Union Canal. The site is hosted on GitHub Pages, embedded or linked from Webador, and backed by Supabase.

**Documentation updated:** 22 September 2026. This README describes the recent implementation packages and intended configuration. Check the deployment checklist below if some files or database updates have not yet been published.

## Links and application files

| Area | Address or file |
| --- | --- |
| Public schedule | https://raylancashire.github.io/canal-watch-survey-schedule/ (`index.html`, `app.js`) |
| Volunteer portal | https://www.queensparktrust.org/what-we-do/canal-watch/canal-watch-volunteer (Webador embeds `volunteer.html`, `volunteer.js`) |
| Administrator | https://raylancashire.github.io/canal-watch-survey-schedule/admin.html (`admin.html`, `admin.js`) |
| Shared styles | `styles.css` |
| Public Supabase configuration | `config.js` — URL and **publishable/anon** key only |
| Database / Edge Functions | Supabase project; keep deployed function source and migrations under `supabase/` |

Do not put service-role keys, SMTP passwords, Resend keys or private contact addresses in GitHub files.

## Public schedule

- Lists **planned future** survey rounds. **Conducted** and **cancelled** rounds are excluded from the public Upcoming Surveys view; their history is retained in Admin.
- The **View** date dropdown has four choices: **All upcoming surveys**, **This week** (Monday–Sunday), **Next week** (the following Monday–Sunday) and **Next month** (the next calendar month). Periods use the Europe/London calendar. Summary cards recalculate for the selected period.
- Shows the scheduled site, date, assignment coverage and a **Volunteer sign-up** link. The sign-up link opens the Webador volunteer page with `round` and `site` parameters.
- **View map** opens a full-width Leaflet/OpenStreetMap map beneath the relevant schedule row, rather than squeezing the map into the site-name column. Where supplied, location details include coordinates, address and three-word location.
- The map pin represents the **latest matched water-quality assessment** from the Canal Watch `freshwater.csv`; it does **not** represent whether a volunteer has been assigned. The assessment palette is **Excellent** dark green, **Good** emerald, **Fair** yellow, **Poor** orange and **Very Poor** red. A missing or unmatched result is grey.
- The map popup includes the assessment, the **last water-survey date in UK DD/MM/YYYY format**, and a small *Matched site* diagnostic label for checking CSV names. Matching accounts for the `Grand Union Canal -` prefix and common `Site`/`Group` suffixes. **Grand Junction has not yet been surveyed**; it should remain unrated until its first result is published.
- Weather forecasts may appear where the existing `weather_forecasts` feed has a suitable match. Weather forecast data and historical observations are separate from visual assessments and laboratory measurements.

**CSV consistency:** use the same core sampling-site name in the scheduler and FreshWater Watch export. Check the popup’s matched site and date when an assessment differs between maps. Do not create separate locations for different names referring to the same sampling site.

## Administrator

Only active, authorised `admin_profiles` with `can_manage` can administer the schedule. Accounts with `can_manage_admins` can additionally manage other administrators through the `manage-admins` Edge Function.

### Survey Rounds

| Admin tab | Meaning |
| --- | --- |
| **Planned** | Status `planned`; scheduled for today or later |
| **Overdue** | Still `planned`, but the scheduled date has passed |
| **Conducted** | Explicitly marked `conducted`; actual date may be recorded separately |
| **Cancelled** | Explicitly marked `cancelled`; retained as history, not public |

**Overdue is a display group, not a new database status.** A round remains `planned` until an administrator marks it Conducted or Cancelled. The existing row-level status dropdown and Edit control remain available. A conducted survey should be recorded explicitly; an assigned volunteer does not prove that sampling happened.

### Site Assignments

The Site Assignments panel is now divided into **Active**, **Covered** and **Passed**, with counts:

| Tab | Meaning |
| --- | --- |
| **Active** | Upcoming assignments without an assigned volunteer/team and not marked covered |
| **Covered** | Upcoming assignments with volunteer/team coverage or an explicit covered/completed assignment status |
| **Passed** | Past scheduled dates, plus assignments for Conducted or Cancelled rounds |

Each assignment shows its **sampling site, survey-round name, scheduled date, assigned volunteers/teams and current status**. Conducted dates appear where recorded. Existing Edit and Delete controls are retained. These groups are computed in the browser; **no SQL migration or new assignment status is required**.

Other Admin features include volunteer records, sampling-site locations, project teams and coordinators, optional team email addresses, assignment editing, recurring rounds and restricted administrator management. The three-word-location finder uses a manual what3words workflow; automatic coordinate conversion requires an appropriate what3words API subscription.

## Volunteer portal

- Volunteers sign in with Supabase passwordless email links. Their sign-in email must match an **active** existing `volunteers` record; volunteering does **not** grant Admin access.
- The public site passes the selected survey round and site to the Webador volunteer page. The page forwards those parameters and the Supabase sign-in callback into its embedded GitHub volunteer portal. Set the Webador volunteer page as an allowed Supabase Auth redirect URL.
- Portal tabs show **Available Surveys** and **My Surveys**. A selected survey is highlighted; nothing is assigned until the user selects **Assign me**. **View map** appears before **Assign me** / **Remove me**, and the expanded map uses the full card width.
- Database checks prevent duplicate round/site assignments and conflicting assignments at different sites on the same survey date, including conflicts through team membership. Volunteers can remove only their own assignments.
- The sign-in screen displays sending, success and error feedback. An unrecognised or inactive volunteer email receives an explanatory message **after** its owner opens the magic link, not at initial email entry.
- An optional **Contact Canal Watch** form for unregistered volunteers calls the `contact-canal-watch` Edge Function; it needs a working mail provider, private recipient and verified sending identity before it can deliver messages in production. Do not display a successful-send claim if the provider has not accepted the message.

## Weather and historical surveys

The live weather collector is separate from the survey scheduler. An active cron entry alone does not prove collection succeeded: inspect the Edge Function HTTP status and `weather_observations` for new rows. A previous `401 Unauthorized` indicated the scheduled collector was being rejected. If gateway JWT verification is disabled for a cron-called collector, protect the endpoint by verifying a separate server-held secret or other suitable caller authentication; **do not leave a privileged collection endpoint unrestricted**.

One-off historical coverage work created `survey_weather_observation_coverage` and `survey_weather_backfill_gaps()`. The gap-check view is an **internal diagnostic tool**; configure it as `security_invoker` and restrict grants rather than exposing it to public/API users. Survey rounds with unknown actual sampling time were checked against a daytime window, not assigned a fictitious precise observation time.

A Northolt (Meteostat station 03672) historical file was used to prepare a one-off import for August–September 2026 survey dates. Preserve its source and any per-variable flags in `raw_observation`; do not mix model-filled values into columns labelled as direct observations. The associated SQL import uses conflict handling to avoid overwriting existing observations. The **Grand Union Canal Litter Pick** was linked to the existing **Half Penny Steps** survey site rather than creating a duplicate weather location. Retain the import/audit files under an archival migration or `docs/weather/` folder, not as an instruction to rerun them on every deployment.

## Database, security and recurring surveys

Principal tables include `admin_profiles`, `volunteers`, `project_teams`, `project_team_members`, `survey_sites`, `survey_rounds`, `survey_round_sites`, `site_assignments`, `assignment_teams` and `assignment_volunteers`. Weather is stored separately in `weather_monitoring_sites`, `weather_observations` and `weather_forecasts`.

- **Row Level Security:** public clients read only permitted schedule data. Protected edits require an authorised Admin; volunteer self-assignment uses scoped RPCs and authenticated identity.
- **Admin-management function:** checks both the authenticated caller and `can_manage_admins`. Its service-role key stays server-side.
- **Contact functions:** keep coordinator/team and public-enquiry destination addresses server-side; validate requests and apply suitable abuse prevention. Email delivery depends on configured provider credentials and an authorised sender domain.
- **Automatic recurrence:** the Supabase scheduled database job `canal-watch-auto-repeat` invokes `generate_due_recurring_rounds()` daily; recurrence no longer depends on an administrator opening the browser. Verify job execution and resulting rounds after deployment. New rounds should not silently inherit old volunteer commitments.
- **Changes to existing installations:** use incremental migrations; **do not rerun an old `database-reset-and-upgrade.sql`** against a live production database.

## Updating GitHub and Webador

Replace only the files needed for each feature, keeping working maps, charts, filters and volunteer routes intact. For the **latest Site Assignments grouping and prior Overdue Survey Rounds change**, replace `admin.js` from the corresponding current package; no accompanying database or stylesheet changes were required. For the **date-period public dropdown**, replace `app.js` based on the current file rather than an older starter package. Updating this README does not itself deploy any JavaScript, SQL or Edge Function.

After publishing changes, verify on desktop and mobile: planned-only public list; week/month filter and summary cards; full-width maps, water pin/site/date; Webador `round`/`site` links and magic-link return; volunteer assignment safeguards; all four round tabs and three assignment tabs; correct visibility of completed and cancelled history. Use a hard refresh if GitHub Pages or Webador still shows cached code.

## Documentation maintenance

- Keep this file as the **current overview**. Archive superseded setup instructions and potentially destructive database-reset scripts instead of presenting them as current deployment steps.
- Record future database changes as dated, incremental migrations in `supabase/migrations/`; keep the deployed sources of Edge Functions under `supabase/functions/`.
- Treat latest water-quality measurements and visual canal observations as different kinds of evidence. A favourable visual condition is **not** evidence that the water is safe.
