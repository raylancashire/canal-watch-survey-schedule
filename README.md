# Canal Watch Survey Schedule — Volunteer / Team Coordinator Model

This version simplifies user management.

## Users
Every user is a **volunteer**. There are no global admin/coordinator/volunteer role labels in the user list.

## Project-team coordinator
A coordinator is selected **inside each project team**.

That means:
- Volunteer A can coordinate Team 1
- the same volunteer can just be a normal member of Team 2
- another volunteer can coordinate Team 2
- changing a team coordinator does not change the volunteer's global user record

When editing a project team, the administrator can:
1. change the team name
2. click one volunteer to make them the coordinator
3. click volunteers to add/remove team members
4. save the team

The chosen coordinator is automatically included as a member of that team.

## Site assignments
A survey site can still be assigned to:
- one or more individual volunteers
- one or more project teams
- both project teams and individual volunteers

All assignment choices are made by clicking names.

## Security
This remains a local browser prototype. The live version should use Supabase Auth and Row Level Security.


## Combined Project Team editor
Team membership and coordinator choice are now handled in the same interface.

Workflow:
1. enter or edit the project team name
2. click volunteers to add them to the team
3. choose one of the selected members as coordinator
4. save

A coordinator cannot be selected unless that volunteer is a team member.


## Calendar and recurrence
Survey rounds now use a calendar date picker.

Available recurrence methods:
- One-off
- Weekly
- Fortnightly
- Monthly
- Every N days

Each recurring round also has an **Automatically create the next survey round after this survey date has passed** option.

In the prototype, the next future occurrence is generated when the application is opened after an earlier recurring survey date has passed. The live Supabase version should move this logic to a scheduled database/server task so it does not depend on somebody opening the page.


## Survey-site scheduling change
Sampling frequency has been removed from the Survey Site setup.

A Survey Site is now only the reusable location record.

Survey scheduling is handled in Survey Rounds:
- choose one or more survey sites
- choose the calendar date
- choose recurrence
- choose automatic repeat

When a recurring round is generated, its selected survey sites are copied into the next round automatically.


## Optional volunteer email
Volunteer email addresses are now optional.

A volunteer can be:
- created with only a name
- edited later without adding an email
- updated to remove an existing email by leaving the field blank

If an email is present, it remains private in the administration side.


## Survey site location details
Each survey site can now store optional location information:
- postal/street address or landmark description
- GPS latitude and longitude
- three-word location in `word.word.word` format

GPS latitude and longitude must be entered together.
All three location methods are optional, so a site can use one, two, or all three.


## All Upcoming Surveys
The public Upcoming Surveys selector now defaults to **All upcoming surveys**.

Users can either:
- view all future active survey rounds together
- select one specific survey round from the same selector

In the combined view, each sampling site also shows its survey-round name beneath the site name.
