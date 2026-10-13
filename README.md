# Group Signup

A small web app that lets students sign up for groups, for any number of
assignments in any number of courses. Students can see who else is in each
group but can only change their own selections. The instructor describes each
course and its assignments in a Google Sheet, pre-seeds the groups and slot
counts, and is the only one who can download the data.

- **Front end:** static HTML/JS in [`docs/`](docs/), hosted on GitHub Pages. One
  site serves every course.
- **Backend and data store:** one Google Sheet per course in the instructor's
  Google Drive, fronted by a Google Apps Script web app
  ([`apps-script/Code.gs`](apps-script/Code.gs)).
- **Cost:** free. No servers, no accounts for students.

```
 Student's browser ──HTTPS──▶ GitHub Pages (public static files)
        │                         ?c=pol2230&a=presentations
        │
        └─────────HTTPS──▶ Apps Script web app for POL 2230 (runs as the instructor)
                                   │
                                   └──▶ POL 2230 Google Sheet (private, in Drive)
                                          ├─ Course        name, code, year, term, section, professor
                                          ├─ Settings      admin key, open/closed, name display…
                                          ├─ Assignments   id, name, due, signup_closes, open, instructions
                                          ├─ presentations groups for that assignment (one tab per assignment)
                                          ├─ debates       …
                                          ├─ Roster        students and their personal tokens
                                          ├─ Signups       one row per student per assignment
                                          └─ Log           audit trail
```

## Why this design

GitHub Pages can only serve static files, so it cannot keep a secret or enforce
who may edit what. Anything the page itself could write to, a student could
also write to directly. The fix is a tiny server-side component that holds the
only credentials and applies the rules. Google Apps Script is the simplest one
available: it is free, lives next to the spreadsheet, runs under the
instructor's account, and needs no hosting.

The Sheets are never shared. Students talk only to the script, and the script
only ever returns display names, slot counts, and the requesting student's own
selections. Every change is checked server-side against a per-student token,
so no student can alter anyone else's selection.

## How the URL works

| URL | What the student sees |
|---|---|
| `https://you.github.io/signup/` | A list of courses to choose from (or straight into the course if only one is configured). |
| `…/?c=pol2230` | That course, on its first open assignment. |
| `…/?c=pol2230&a=debates` | That course, on that assignment. |
| `…/?c=pol2230&t=<token>` | The student's personal invite link. The token is stored in the browser and removed from the address bar. |

The course key (`pol2230`) is whatever you name it in `docs/config.js`. The
assignment id (`debates`) is the id in the Assignments sheet, which is also the
name of the tab holding that assignment's groups.

## How students are identified

Each student gets a personal link containing a random token stored in the
Roster sheet next to their email. The page remembers the token per course, so
after the first visit students just open the site. One token covers every
assignment in the course.

Two modes, set in the Settings sheet:

| Mode | `OPEN_ENROLLMENT` | How it works | Trade-off |
|---|---|---|---|
| **Roster** (recommended) | `false` | You paste the class list into the Roster sheet, run `generateTokens()`, and send each student their link. | Strongest: only listed students can sign up, and nobody can claim another student's identity. |
| **Open enrollment** | `true` | Any visitor enters a name and email once, gets a token, and is added to the Roster. | Easier to launch. The first person to claim an email owns it, so impersonation is possible on first claim. Fine for low-stakes signups. |

A student who loses their token (new device, cleared storage) can get it back
from you: it is in the Roster sheet.

## Setup for a course

Repeat these steps for each course. Each course has its own Sheet and its own
script deployment; the site just lists them all.

### 1. Create the Sheet and the script

1. Create a new Google Sheet in your Google Drive, named after the course.
2. Open **Extensions ▸ Apps Script**. Delete the sample code, paste in the
   contents of [`apps-script/Code.gs`](apps-script/Code.gs), and save.
3. In the function dropdown pick `setup` and click **Run**. Authorize the script
   when prompted (it only accesses this spreadsheet). This creates the sheets
   `Course`, `Settings`, `Assignments`, `Roster`, `Signups`, `Log`, and a sample
   assignment tab `a1`.
4. Fill in **Course**: `COURSE_NAME`, `COURSE_CODE`, `YEAR`, `TERM`, `SECTION`,
   `PROFESSOR`. These appear at the top of the page.
5. Fill in **Settings**:
   - `ADMIN_KEY` was generated for you. Keep it private; it unlocks the download.
   - `SIGNUP_OPEN` set to `false` to freeze every assignment at once.
   - `NAME_DISPLAY` is `initial` for "Ada L." or `full` for "Ada Lovelace".
   - `OPEN_ENROLLMENT` is `false` (roster mode) or `true`.
   - `SITE_URL` is your GitHub Pages URL including the course key, e.g.
     `https://you.github.io/signup/?c=pol2230`. Filled in after step 3.

### 2. Describe the assignments and their groups

1. In **Assignments**, one row per assignment:

   | column | meaning |
   |---|---|
   | `id` | Short, URL-safe, unique (e.g. `presentations`). Also the name of the tab that holds this assignment's groups. Cannot be `Course`, `Settings`, `Assignments`, `Roster`, `Signups`, or `Log`. |
   | `name` | Shown to students, e.g. "Seminar presentations". |
   | `due` | The assignment's due date, shown to students. A date cell or text like `2026-11-06`. Informational only. |
   | `signup_closes` | Optional. When signup for this assignment stops accepting changes, e.g. `2026-10-30T23:59`. Blank means no cutoff. |
   | `open` | `true` or `false` (blank counts as `true`). Set `false` to hide the Join buttons for this assignment without a date. |
   | `instructions` | A paragraph shown above the groups. Line breaks are kept. |

2. Run `addAssignmentSheets()` from the Apps Script editor. It creates a tab for
   every assignment id that does not have one yet, with sample groups.
3. In each assignment tab, one row per group: `id` (short, unique within the
   assignment), `name`, `slots` (blank or `0` for no limit), and an optional
   `description`. Edit these any time, including after signups start. Shrinking
   a group below its current size does not evict anyone; it just stops new joins.

You can also keep course and assignment details in a CSV and paste them in, or
use **File ▸ Import** in the Sheet. The Sheet is the source of truth; the
script reads it on every request, so edits take effect immediately.

### 3. Deploy the script as a web app

1. In the Apps Script editor click **Deploy ▸ New deployment**.
2. Type: **Web app**. Execute as: **Me**. Who has access: **Anyone**.
   ("Anyone" means anyone can *call the script*, which only does what the
   code allows. It does not share the spreadsheet.)
3. Click **Deploy** and copy the web app URL. It ends in `/exec`.

Whenever you edit the script later, use **Deploy ▸ Manage deployments ▸ Edit ▸
New version** so the live URL picks up the change.

### 4. Publish the site on GitHub Pages (once)

1. Create a GitHub repository and push this folder to it.
2. Edit [`docs/config.js`](docs/config.js) and add the course:

   ```js
   COURSES: {
     'pol2230': { url: 'https://script.google.com/macros/s/.../exec', label: 'POL 2230 — Canadian Politics (Fall 2026)' }
   }
   ```

   Add one entry per course. With one entry the site goes straight to it; with
   several it shows a chooser.
3. In the repository go to **Settings ▸ Pages**, choose **Deploy from a branch**,
   branch `main`, folder `/docs`. Save. After a minute the site is live at
   `https://<your-username>.github.io/<repo>/`.
4. Put `https://<your-username>.github.io/<repo>/?c=pol2230` into `SITE_URL`
   in that course's Settings sheet.

Nothing private is in the repository: the Apps Script URLs are public by
design, and the admin keys and student data live only in the Sheets.

### 5. Invite students (roster mode)

1. Paste `email` and `name` for each student into the **Roster** sheet.
2. Run `generateTokens()` from the Apps Script editor.
3. Run `writeInviteLinks()`. The `invite_link` column now holds each student's
   personal link. Send them out with a mail merge from your usual email, or run
   `sendInvites()` to email them from the Google account that owns the script.

If you use open enrollment instead, just send everyone the course URL.

## Day to day

- **Add an assignment mid-term:** add a row to Assignments, run
  `addAssignmentSheets()`, fill in the groups. It appears on the site at once.
- **Who is where:** open the Sheet, or click **Instructor** at the bottom of
  the site and enter the admin key. The panel shows the roster for the
  assignment currently selected on the page, with a per-group tally.
- **Download:** the instructor panel has **Download CSV (this assignment)** and
  **Download CSV (all assignments)**. The all-assignments file is long format,
  one row per student per assignment (email, name, assignment id and name,
  group id and name, last updated), including blanks for students who have not
  chosen. In the Sheet, **File ▸ Download** works too.
- **Move a student yourself:** edit their row in the Signups sheet.
- **Freeze one assignment:** set its `open` to `false`, or let `signup_closes`
  pass. **Freeze everything:** set `SIGNUP_OPEN` to `false`. Students can still
  view the groups.
- **Audit trail:** the Log sheet records every register, join, switch, and
  leave with a timestamp and assignment.

## Storing the data: Google Drive or Dropbox?

**Recommendation: keep the live data in Google Sheets in Drive, and if you want
a copy in Dropbox, push a snapshot there automatically.** The reasoning:

| | Google Sheet in Drive | Dropbox file |
|---|---|---|
| Can a static site write to it safely? | Yes, through Apps Script, which holds the credentials and enforces the rules. | No. Dropbox has no built-in server-side scripting. You would need a separate serverless function (Cloudflare Worker, Netlify, etc.) holding a Dropbox token, plus your own locking and validation code. |
| Concurrency | The script takes a lock around each change, so two students cannot both take the last slot. | A JSON file on Dropbox has no locking; the last writer wins. |
| Instructor editing | Edit course details, assignments, groups, roster, and signups directly in the Sheet. | Edit a JSON or CSV by hand. |
| Privacy | Private to your Google account unless you share it. Students never see the Sheet. | Private to your Dropbox account. Same property, but only if nothing client-side ever holds a token. |
| Institutional considerations | Check your institution's policy on storing student data in Google Drive. | Same question for Dropbox. |

If Dropbox is where you want the record of truth to end up, the script includes
`backupToDropbox()`, which uploads the same all-assignments CSV the instructor
panel produces, named after the course code. Run it on a time-driven trigger
(for example nightly) in each course's script and the Dropbox copies stay
current while the Sheets do the real work. One-time setup:

1. At <https://www.dropbox.com/developers/apps> create a **Scoped access** app
   with **App folder** access and enable the `files.content.write` permission.
   Note the **App key** and **App secret**.
2. Visit this URL in your browser (substitute your app key) and approve:
   `https://www.dropbox.com/oauth2/authorize?client_id=APP_KEY&response_type=code&token_access_type=offline`
3. Exchange the code it shows for a refresh token:

   ```bash
   curl https://api.dropboxapi.com/oauth2/token -d code=THE_CODE -d grant_type=authorization_code -u APP_KEY:APP_SECRET
   ```

4. In the Apps Script editor open **Project Settings ▸ Script Properties** and
   add `DROPBOX_APP_KEY`, `DROPBOX_APP_SECRET`, `DROPBOX_REFRESH_TOKEN`, and
   optionally `DROPBOX_PATH` (default `/group-signup/<COURSE_CODE>_signups.csv`).
   The same Dropbox app and refresh token can be reused in every course's script.
5. Run `backupToDropbox()` once to test, then add a trigger under
   **Triggers ▸ Add trigger** (function `backupToDropbox`, time-driven, daily).

The Dropbox credentials live in Script Properties, which only the script owner
can read. They are never sent to the browser.

## What students can and cannot see

- Can see: course details, assignment names, due dates and instructions, group
  names, descriptions, slot counts, and the display names of members ("Ada L."
  by default). Their own name, email, and selections are shown to them only.
- Cannot see: other students' emails, tokens, the Sheet, the admin key, or the
  export.
- Cannot do: change anyone else's selection, join a full group, or make changes
  to a closed assignment. All of this is enforced by the script, not the page.

Limits worth knowing: a student who shares their personal link lets someone else
act as them (the same as sharing a password), so the invite email says not to.
Apps Script has daily quotas (roughly tens of thousands of requests per day),
which is far more than a class needs. The first request after a quiet period
can take a few seconds.

## Local preview

With no courses in `config.js`, the page runs in demo mode with a sample
course, three assignments, and sample students held in memory, so you can see
the interface before wiring anything up. The demo admin key is `demo`, and
`?t=demo-ada` signs you in as a sample student. To preview locally:

```bash
python3 -m http.server 8765 --directory docs
```

Then open <http://localhost:8765>.

## Files

```
docs/index.html        the page
docs/app.js            front-end logic, including the demo backend
docs/styles.css        styling (light and dark)
docs/config.js         the one thing you edit: the list of courses and their script URLs
apps-script/Code.gs    the backend; paste into each course's Apps Script project
apps-script/appsscript.json  manifest (optional, for clasp users)
```
