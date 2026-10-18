# Group Signup

A small web app that lets students sign up for groups, for any number of
assignments in any number of courses. Students can see who else is in each
group but can only change their own selections. The instructor describes each
course and its assignments in a Google Sheet, pre-seeds the groups and slot
counts, and is the only one who can download the data.

The same site also takes **attendance**: the instructor starts a check-in,
projects a QR code and a 4-digit class code, and students on the roster tap
once on their phone. See [Attendance](#attendance).

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
                                          ├─ Sessions      attendance check-ins you have started
                                          ├─ Attendance    one row per student per check-in
                                          └─ Log           audit trail
```

## Two ways to edit everything

Everything the instructor controls lives in the course's Google Sheet, and you
can edit it either directly in the Sheet or from the **Instructor** panel on
the site, which writes to the same Sheet. The panel has five tabs:

| Tab | What you edit |
|---|---|
| **Signups** | Who is in which group for the assignment on screen, with CSV downloads. |
| **Course & settings** | Course name, code, year, term, section, professor; whether signup is open; find-your-name and open enrollment; how names are shown; the site URL; the link email's sender name, reply-to, subject, and signature; and the default attendance window. |
| **Assignments & groups** | Add, edit, or remove assignments (name, due date, signup close, open flag, instructions) and the groups in each (id, name, slots, description). "Add several…" takes one group per line. |
| **Roster** | Paste `email, name` lines straight from a spreadsheet. Existing students keep their links. Tick "Remove students not listed" to drop people. |
| **Attendance** | Start a check-in, project the code, watch students arrive, mark exceptions by hand, and download the term's attendance as a CSV. See [Attendance](#attendance). |

The admin key itself can only be changed in the Sheet. Assignment ids cannot
be renamed from the panel once created, because they name the Sheet tabs.

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

Each student has a personal link containing a random token stored in the
Roster sheet next to their email. The page remembers the token per course, so
after the first visit students just open the site. One token covers every
assignment in the course.

Students get their link in one of three ways, depending on the Settings sheet:

| Mode | Settings | How it works | Trade-off |
|---|---|---|---|
| **Find your name** (default) | `SELF_SERVICE_LINKS` = `true` | You paste the class list into the Roster sheet and share the course URL. A student picks their name from a searchable list, and the script emails their link to the address you have on file. | Only listed students can sign up, nobody can act as someone else without access to their inbox, and there is no mail merge. Students see classmates' names in the list. Gmail allows about 100 messages a day from a consumer account (1,500 on Google Workspace). |
| **Invite links** | any | You run `generateTokens()` and `writeInviteLinks()` and send each student their link yourself, or run `sendInvites()`. | Same security as above with no waiting for email. Works alongside find-your-name. |
| **Open enrollment** | `OPEN_ENROLLMENT` = `true` | Any visitor enters a name and email once, gets a token, and is added to the Roster. | Easiest to launch. The first person to claim an email owns it, so impersonation is possible on first claim. Fine for low-stakes signups. |

Students can look after themselves without you:

- **Not you? Sign out on this device** forgets the link in that browser.
- **Email me a fresh link** replaces their token and emails the new link. The
  old link stops working everywhere. Use it after sharing a link by mistake or
  to sign in on another device. Group choices are kept.
- A student who loses their link just picks their name again. To stop the
  public page being used to flood an inbox, each student can request at most
  five links a day with a one-minute gap between requests.

If you need to intervene, a student's token is in the Roster sheet, and
clearing it and re-running `generateTokens()` has the same effect as a reset.

## Attendance

### In class

1. Open the site, click **Instructor**, and go to the **Attendance** tab.
2. Give the session a name (or leave it blank for today's date), set how many
   minutes it stays open, and click **Start check-in**. A 4-digit class code
   is generated and the display page opens in a new tab. If your browser
   blocks the pop-up, click **Show on screen**.
3. Put the display page on the projector. It shows a QR code, the class code,
   and a countdown. **Full screen** is in the top-right corner.
4. Students scan the QR code with their phone camera. It opens
   `attend.html` with the class code already filled in, so they see their
   name and one button, **I'm here**. Students who cannot scan open the same
   page from the address on the slide and type the code.
5. The Attendance tab refreshes every ten seconds while the check-in is open:
   how many have checked in, who, and any flags. **Extend 5 min** keeps it
   open longer, **Close now** ends it early. It closes by itself when the
   time is up, and a closed session can be reopened for five minutes from the
   same tab.

A student whose phone is dead can be marked present from the table (**Mark
present**), and a mistaken check-in removed (**Mark absent**). The table shows
who marked each row.

**Download CSV (all sessions)** gives one row per student and one column per
session (1 = present), plus a total, ready for your gradebook. The Sessions and
Attendance sheets hold the same data in long form.

To keep taps fast when a whole class checks in at once, the script keeps the
Course, Settings, Roster, Sessions and Attendance sheets in a short-lived cache
(about 25 seconds) instead of reading the Sheet on every request. Anything you
do from the instructor panel clears the cache at once, and a student always
sees their own check-in immediately, but a change made by editing the Sheet by
hand can take up to half a minute to reach students (or run
`invalidateSheetCache()` in the Apps Script editor).

### What stops a friend from checking in for someone

- **Students are identified by their personal link, not by typing an ID.**
  The check-in page uses the same token as the signup page, stored in the
  phone's browser. To check in as someone else you need their personal link,
  which also controls their group choices, so it is not something students
  hand around. Student numbers, by contrast, are easy to know.
- **The class code only works in the room, during the window.** It is random
  for each session and stops working when the session closes, so "text me the
  code" has to happen live, and the code on its own is useless without a
  personal link.
- **Wrong codes are limited.** Five wrong codes in one session locks that
  student out of it (they can still be marked present by hand), so the code
  cannot be guessed.
- **Two students from one phone are flagged.** Each browser gets a random
  device id on first use, and the script stores a hash of it with each
  check-in. If two students check in from the same device in one session, both
  rows are marked "Same phone as …" in the Attendance tab, so the main
  remaining trick, opening a friend's link on your own phone, is visible to
  you. (A private browsing window gets a fresh id, so this is a deterrent, not
  a guarantee.)

The script never reveals the class code to students, never shows who else has
checked in, and only ever returns a student's own record.

### Setting it up

New courses get the Sessions and Attendance sheets from `setup()`. For a
course set up before attendance existed:

1. Paste the current [`apps-script/Code.gs`](apps-script/Code.gs) over the
   old one in the Apps Script editor and save.
2. Run `addAttendanceSheets()` once. It adds the two sheets and the
   `ATTENDANCE_WINDOW_MINUTES` setting (default `10`).
3. **Deploy ▸ Manage deployments ▸ Edit ▸ New version** so the live URL picks
   up the new code.
4. Push the updated `docs/` folder to GitHub so `attend.html` and
   `display.html` are on the site.

The check-in page for a course is `attend.html?c=<course key>` next to the
signup page, and the signup page links to it in the footer.

## Setup for a course

Repeat these steps for each course. Each course has its own Sheet and its own
script deployment; the site just lists them all.

### 1. Create the Sheet and the script

1. Create a new Google Sheet in your Google Drive, named after the course.
2. Open **Extensions ▸ Apps Script**. Delete the sample code, paste in the
   contents of [`apps-script/Code.gs`](apps-script/Code.gs), and save.
3. In the function dropdown pick `setup` and click **Run**. Authorize the script
   when prompted (it only accesses this spreadsheet). This creates the sheets
   `Course`, `Settings`, `Assignments`, `Roster`, `Signups`, `Sessions`,
   `Attendance`, `Log`, and a sample assignment tab `a1`.
4. Fill in **Course**: `COURSE_NAME`, `COURSE_CODE`, `YEAR`, `TERM`, `SECTION`,
   `PROFESSOR`. These appear at the top of the page.
5. Fill in **Settings**:
   - `ADMIN_KEY` was generated for you. Keep it private; it unlocks the download.
   - `SIGNUP_OPEN` set to `false` to freeze every assignment at once.
   - `NAME_DISPLAY` is `initial` for "Ada L." or `full` for "Ada Lovelace".
   - `OPEN_ENROLLMENT` is `false` (roster mode) or `true`.
   - `SELF_SERVICE_LINKS` is `true` to let students find their name and get
     their link by email, or `false` to rely on invite links only.
   - `SITE_URL` is your GitHub Pages URL including the course key, e.g.
     `https://you.github.io/signup/?c=pol2230`. Filled in after step 4. Emailed
     links are built from it, so find-your-name does not work until it is set.
   - `EMAIL_SENDER_NAME`, `EMAIL_REPLY_TO`, `EMAIL_SUBJECT`, `EMAIL_SIGNATURE`
     customise the link email. See "How the email is sent" below.
   - `ATTENDANCE_WINDOW_MINUTES` is how long a check-in stays open unless you
     say otherwise when starting it. Default `10`.

   If you set up the Sheet with an older version of the script, run
   `addMissingSettings()` from the Apps Script editor to append any new keys.

### 2. Describe the assignments and their groups

You can do this step from the site's Instructor panel once steps 3 and 4 are
done, which most people will find easier. To do it in the Sheet instead:

1. In **Assignments**, one row per assignment:

   | column | meaning |
   |---|---|
   | `id` | Short, URL-safe, unique (e.g. `presentations`). Also the name of the tab that holds this assignment's groups. Cannot be `Course`, `Settings`, `Assignments`, `Roster`, `Signups`, `Sessions`, `Attendance`, or `Log`. |
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

### 5. Add students

1. Paste `email` and `name` for each student into the **Roster** sheet, or
   into the Roster tab of the site's Instructor panel. Use the email address
   students will recognise as theirs, since that is where their link goes.
2. Share the course URL (`SITE_URL`) with the class. Students pick their name
   on the page and receive their link by email. That is all that is needed.

If you would rather send links yourself, run `generateTokens()` and then
`writeInviteLinks()` from the Apps Script editor. The `invite_link` column then
holds each student's personal link for a mail merge, or run `sendInvites()` to
email them from the Google account that owns the script. If you use open
enrollment, just share the course URL.

## How the email is sent

Link emails go out through Gmail from the Google account that owns the script,
because the web app runs as you. The From address is that account; Google does
not let a script send as an arbitrary address. What you can set, all in the
Settings sheet:

| Key | Effect | Default |
|---|---|---|
| `EMAIL_SENDER_NAME` | Display name on the From line, e.g. "Zack Taylor" or "POL 3540 Course Team". | `PROFESSOR` from the Course sheet |
| `EMAIL_REPLY_TO` | Where replies go, e.g. your university address. | the Gmail account |
| `EMAIL_SUBJECT` | Subject line. | "`<code> <course name>`: your group signup link" |
| `EMAIL_SIGNATURE` | Closing lines. Line breaks in the cell are kept (Ctrl+Enter or Cmd+Enter inserts one). | `PROFESSOR` and the course title |

The To line shows the student's name from the Roster with their address. The
body says who the email is for, gives the link, and notes that it should not
be shared.

If you want the From address itself to be your university address, add it in
Gmail under **Settings ▸ Accounts ▸ Send mail as**, then ask for the script to
use `GmailApp` with that alias. That needs a broader Gmail permission on the
script, so it is not the default.

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
  leave with a timestamp and assignment, and every check-in, wrong code,
  session start and close.
- **Take attendance:** Instructor panel ▸ Attendance ▸ Start check-in. See
  [Attendance](#attendance).

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
  by default). With find-your-name on, they also see the full names on the
  roster. Their own email and selections are shown to them only.
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

With no courses in `config.js`, or with `?demo=1` in the address, the page runs
in demo mode with a sample course, three assignments, sample students, and one
past attendance session, kept in your browser's local storage so the signup
page, the check-in page, and the instructor panel share it. The demo admin key
is `demo`, and `t=demo-ada` (or `demo-grace`, `demo-alan`, `demo-kat`) signs
you in as a sample student. Find-your-name works in the demo but no email is
sent; the message tells you the token to use instead. To preview locally:

```bash
python3 -m http.server 8765 --directory docs
```

Then open <http://localhost:8765/?demo=1>. To try attendance, start a check-in
from the instructor panel, then open
<http://localhost:8765/attend.html?demo=1&t=demo-ada> and use the code shown.

## Files

```
docs/index.html        the signup page
docs/attend.html       the attendance check-in page students open from the QR code
docs/display.html      the QR code, class code and countdown you project in class
docs/app.js            front-end logic for both pages, including the demo backend
docs/styles.css        styling (light and dark)
docs/config.js         the one thing you edit: the list of courses and their script URLs
apps-script/Code.gs    the backend; paste into each course's Apps Script project
apps-script/appsscript.json  manifest (optional, for clasp users)
```
