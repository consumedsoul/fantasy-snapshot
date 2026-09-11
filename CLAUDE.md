# fantasy-snapshot

Google Apps Script that pulls Yahoo Fantasy Football league data, builds a weekly snapshot, and emails it.

## Talking to Hun (read before you reply)

Hun is a **vibe coder**, not a software engineer. He directs the work and judges the
result; he does not read diffs or scroll back through a transcript to work out whether
something is being asked of him. Write every response for him.

**End EVERY response with exactly one status line — including short ones.**

| Line | Use when |
|---|---|
| `✅ **Nothing needed from you.** <what changed>` | Done and verified. Pure FYI. |
| `👉 **Your turn:** <the exact thing to do>` | He must run, click, paste, or check something. |
| `❓ **Need your call:** <question + your recommendation>` | Blocked on a decision only he can make. |

If that line is `👉` or `❓`, repeat it as the FIRST line of the response as well as the
last. An ask buried in the middle is an ask he will miss.

- `👉` must be literal and complete: the command to paste, the button to click, the URL
  to open. Not "you may want to verify the deploy" — instead "open https://… and confirm
  the hero image loads."
- Never use `✅` when something is untested, partially done, or waiting on anything.
  "I think it works" is `👉 Your turn: check X`.
- `❓` always carries your recommendation, not just the question. He is choosing between
  options you have already thought through, not doing the thinking from scratch.
- Plain language. If a technical term is load-bearing, define it in the same sentence in
  six words or fewer. Name the file, page, or button — not the abstraction.
- Lead with what changed and what he can see. Reasoning and internals go below that, or
  are left out unless he asks.

## Tech stack

- **Runtime:** Google Apps Script (V8)
- **APIs:** Yahoo Fantasy Sports API v2 (OAuth2)
- **Entry point:** `pullFantasyData()` — fetches all leagues, builds snapshots, emails the result

## Project layout

Single file: `Code.gs` (~2,300 lines)

## Function Index

### Public Entry Points
- `pullFantasyData()` — Main entry point: fetches all leagues, builds snapshots, emails result
- `startYahooAuth()` — Initiates Yahoo OAuth flow (run once in IDE)
- `doGet(e)` — OAuth callback handler (Web App endpoint)
- `debugAllLeaguesRaw()` — Debug helper: logs raw Yahoo API response
- `debugSnapshotToLog()` — Debug helper: generates snapshot and logs to console (no email)
- `installWeeklyTrigger()` — Installs the weekly `pullFantasyData` trigger (Tuesday ~8:00, script timezone). Idempotent: removes existing `pullFantasyData` triggers first, so it never stacks duplicates
- `removeWeeklyTrigger()` — Removes all `pullFantasyData` time-driven triggers
- `checkSetup()` — Setup diagnostic: logs which Script Properties are SET/MISSING (never logs values), makes a **live Yahoo API call** to prove the token can actually read Fantasy data, reports installed `pullFantasyData` trigger count, and gives a READY / NOT READY verdict. Never reports READY on property presence alone

### Private Helpers (suffix: `_`)

**Config & Auth:**
- `getConfig_()` — Reads script properties (credentials)
- `getLeagueKey_()` — Retrieves default league key from properties
- `getYahooAuthUrl_()` — Constructs Yahoo OAuth URL
- `getYahooAccessToken_()` — Retrieves access token, checks expiration
- `refreshYahooAccessToken_()` — Refreshes expired token

**API Transport:**
- `yahooApiRequest_(resourcePath, queryParams)` — Generic Yahoo API wrapper with auto-refresh on 401

**League Discovery:**
- `getAllLeagues_()` — Fetches all NFL leagues for authenticated user

**Standings:**
- `getLeagueStandings_(leagueKey)` — Fetches league standings with W-L-T, PF, PA

**Weekly Data:**
- `getCurrentWeek_(leagueKey)` — Determines current NFL week
- `getWeekMatchups_(week, leagueKey)` — Fetches scoreboard, calculates close matchups and projected scores
- `getWeekTeamHighlights_(week, leagueKey, matchupsData?)` — Top teams, blowouts, bad beats
- `getWeekTeamScores_(week, leagueKey, matchupsData?)` — Fetches ALL team scores from scoreboard (sorted by points desc)
- `getWeeklyPowerRankings_(completedWeek, leagueKey, currentWeekScores?)` — 3-week rolling average power rankings with trend arrows
- `getWeekBenchSummary_(week, leagueKey, rosterTeams?)` — Most points left on bench
- `getTopWaiverPickupsForWeek_(week, limit, leagueKey, rosterTeams?)` — Best pickups started
- `fetchWeekRosterTeams_(week, leagueKey)` — Fetches teams+roster once; pass result to bench/waiver functions to avoid duplicate API calls
- `fetchWeekScoreboard_(week, leagueKey)` — Fetches scoreboard matchupsContainer once; pass result to highlights/scores/power rankings to avoid duplicate API calls

**Player Data:**
- `getWeekPointsMapForPlayerKeys_(week, playerKeys, leagueKey)` — Batch fetch player points
- `getWeekStartedPlayerKeys_(week, leagueKey, rosterTeams?)` — All non-bench players
- `getPlayerOwnerMap_(leagueKey)` — Maps player_key → team_name (intentionally uncached — contract §2.c.vii)
- `getTopPlayersByPositionForWeek_(week, positions, limit, ownerMap, leagueKey)` — Position leaders for ALL requested positions in one batched fetch; returns `{ position: [topN] }`. Replaced the old per-position `getTopPlayersForWeekAndPosition_` (which re-fetched all player stats 6×)

**Email:**
- `buildEmailHtml_(sections, failedLeagues)` — Pure: wraps league sections + error list into the email HTML and appends the contract-required "Fantasy data provided by Yahoo Fantasy" footer; unit-tested in `runTests()`
- `sendSnapshotEmail_(subject, htmlBody)` — Sends HTML email with plain text fallback (links kept as `text (url)`) and quota check
- `sendNotificationEmail_(subject, body)` — Sends error notifications (non-throwing)
- `getRecipientEmail_()` — Gets recipient email from script properties

**Utilities:**
- `flattenYahooMeta_(arr)` — Flattens Yahoo's array-of-single-key-objects into a plain object
- `parseTeamMeta_(teamWrapper, pointsField)` — Extracts team name, manager, and points from Yahoo team wrapper
- `getPlayerSlot_(playerArr)` — Extracts selected position/slot from Yahoo player array
- `validateWeek_(week, functionName)` — Validates week is 1-18
- `offseasonEmailDecision_(anySeasonActive, failedLeaguesCount, alreadyNotified)` — Pure decision for the weekly email: returns `'SEND_SNAPSHOT'`, `'SEND_NOTICE'` or `'STAY_SILENT'`. `pullFantasyData` executes the result; unit-tested in `runTests()`
- `retryWithBackoff_(fn, maxRetries)` — Exponential backoff retry (3 attempts: 2s, 4s, 8s); throws explicitly if exhausted without a result
- `escapeHtml_(str)` — Escapes `&`, `<`, `>`, `"` before inserting into HTML email output
- `runTests()` — Runs unit tests on pure utilities; results logged to execution log

**Snapshot Assembly:**
- `fetchSnapshotData_(league)` — I/O orchestration: fetches standings/week/scoreboard and gathers highlights/projections; returns a plain data object (no HTML). Sets the `seasonStarted` flag used by the off-season email gate.
- `renderSnapshotHtml_(data)` — Pure render: turns a `fetchSnapshotData_` object into styled HTML; no I/O, no throws on partial data
- `buildLeagueSnapshot_(league)` — Thin wrapper: `renderSnapshotHtml_(fetchSnapshotData_(league))`

## Script Properties (secrets)

All credentials live in Apps Script Script Properties — never hardcode them.

| Property | Purpose |
|---|---|
| `YAHOO_CLIENT_ID` | Yahoo OAuth app client ID |
| `YAHOO_CLIENT_SECRET` | Yahoo OAuth app client secret |
| `YAHOO_REDIRECT_URI` | Apps Script Web App URL (OAuth callback) |
| `YAHOO_LEAGUE_KEY` | Fallback league key (*optional* — `pullFantasyData` auto-discovers leagues and passes the key explicitly) |
| `YAHOO_SCOPE` | OAuth scope override (*optional*, default `fspt-r`). Set to `none` to omit the scope param entirely. See Yahoo API access below |
| `YAHOO_ACCESS_TOKEN` | Current OAuth access token (written by auth flow) |
| `YAHOO_REFRESH_TOKEN` | OAuth refresh token (written by auth flow) |
| `YAHOO_EXPIRES_IN` | Token TTL in seconds |
| `YAHOO_TOKEN_CREATED_AT` | Epoch ms when the token was issued |
| `RECIPIENT_EMAIL` | Email address to send snapshots to (required) |
| `OFFSEASON_NOTICE_SENT` | Internal flag (written by `pullFantasyData`): `'true'` once the one-time off-season pause notice has been sent; cleared automatically when a season becomes active |

## Yahoo Fantasy API access (approval required)

> **Status: contract received and signed 2026-09-09 — awaiting Yahoo's countersignature.**
> Yahoo's Fantasy API team (fantasyapiapplications@yahoosports.com) sent the *Personal Use —
> API Access and Use Agreement* via DocuSign (envelope `EC381C9D-2C93-8F78-8263-F0480F1DE641`).
> Hun signed 2026-09-09; Yahoo's signer (Dipesh Raichura, Sr Dir Product Management) has **not**
> countersigned — DocuSign status is still *Sent*. **Cover-page Effective Date: 2026-09-15.**
> A live `checkSetup()` run on 2026-09-09 still returned
> `HTTP 401 oauth_problem="additional_authorization_required"`, confirming access is not yet
> provisioned. OAuth itself remains healthy (token refreshed proactively, all Script Properties
> set, 1 `pullFantasyData` trigger installed). Until Yahoo countersigns and provisions,
> `pullFantasyData()` cannot work — every Fantasy API call returns 401. This remains the only
> outstanding blocker; code, deployment, and Script Properties are complete.
>
> **When approval arrives:** run `checkSetup()` first — if Yahoo provisioned access onto the
> existing Client ID, the stored token may already work and the probe will say READY. If the
> probe still fails, delete `YAHOO_SCOPE` (so it defaults back to `fspt-r`), re-run
> `startYahooAuth()`, complete the flow, then `checkSetup()` again.
>
> **Expect new credentials.** Agreement §2(a) says that after approval the Developer registers
> the application on the Yahoo Developer Network to receive an Application ID and OAuth 2.0
> credentials — so Yahoo may issue a **fresh Client ID / Secret** rather than granting Fantasy
> permission to the existing app. If so: paste the new pair into `YAHOO_CLIENT_ID` /
> `YAHOO_CLIENT_SECRET`, delete `YAHOO_SCOPE`, then re-run `startYahooAuth()`.
>
> **Contract obligations that bind this code** (Personal Use agreement, signed 2026-09-09):
> - **Attribution (Cover Page + §5):** any interface displaying Yahoo Fantasy Information must
>   show "Fantasy data provided by Yahoo Fantasy" with a hyperlink to an official Yahoo Fantasy
>   page. The snapshot email is that interface. **Implemented 2026-09-10:** `buildEmailHtml_`
>   appends the footer (linking https://football.fantasysports.yahoo.com/) to every snapshot
>   email, and `runTests()` asserts it on both the normal and errors-only paths. The plain-text
>   fallback keeps the link as `Yahoo Fantasy (url)`. Don't remove either.
> - **No storing, caching or indexing (§2.c.vii):** Supabase was removed 2026-08-13, and the
>   one transient cache of Fantasy data — `getPlayerOwnerMap_`'s 10-minute `CacheService` entry —
>   was removed 2026-09-10 (it never hit on a weekly run anyway). Every run re-derives from
>   Yahoo. The only remaining `CacheService` use is the OAuth `oauth_state` nonce, which is not
>   Fantasy data. Don't add caching of Yahoo responses.
> - **Read-only, personal use only:** data is for Hun's own leagues; do not forward, share or
>   redistribute the snapshot to league mates or any third party.

As of 2026 Yahoo gates Fantasy Sports API access behind an approval application at
<https://sports.yahoo.com/developer/access/>. Newly created Yahoo apps have **no** Fantasy
Sports permission — the option is absent from the app-creation form — and Yahoo rejects
`scope=fspt-r` with `invalid_scope` on the authorization redirect, before any login page.

Symptom: `startYahooAuth()` produces a URL that bounces straight back to the Web App with
`?error=invalid_scope&error_description=invalid+scope` and no `code`. `doGet` logs and
displays this. Nothing in this project can work around it — access must be granted by Yahoo.

Verified scope behaviour on an unapproved app (probing the authorization endpoint directly):
`fspt-r` rejected, `fspt-w` rejected, `profile` rejected, `openid` accepted, no-scope accepted.
An accepted authorization does not imply the resulting token can read Fantasy data.

**Confirmed empirically (2026-08-13):** authorizing with `YAHOO_SCOPE=none` completes the OAuth
handshake and stores valid access/refresh tokens, but every Fantasy API call then fails with
`HTTP 401 oauth_problem="additional_authorization_required"`. There is no client-side workaround —
the Yahoo app itself must be granted Fantasy Sports access. Token *refresh* is unaffected by scope
(`refreshYahooAccessToken_` sends only `grant_type`/`refresh_token`), so `YAHOO_SCOPE` matters only
for the initial authorization URL.

## Yahoo API conventions

- The Yahoo Fantasy API returns deeply nested, array-of-single-key-objects structures. Use `flattenYahooMeta_(arr)` to flatten these into plain objects. Use `parseTeamMeta_(teamWrapper, pointsField)` to extract team name, manager, and points from team wrappers.
- Player/team data chunks are batched in groups of 25 (`YAHOO_API_BATCH_SIZE`) to stay within API limits.
- `yahooApiRequest_()` automatically retries once after a token refresh if a 401 with `token_expired` is returned.

## Running & deploying

Setup, deployment and the step-by-step OAuth walkthrough live in
[README.md](README.md#quick-start) — including the
[Deployment Checklist](README.md#deployment-checklist). Not duplicated here.

The one thing worth repeating: none of it travels in code. Script Properties, the Web App
deployment, the Yahoo OAuth token and the time-driven trigger are all IDE-side state that
survives neither `git push` nor `clasp push`.

## Sync Policy

Always finish a working session by committing and pushing, without being
asked:

    git add -A && git commit -m "..." && git push origin main

**This is an Apps Script project — git push alone does NOT deploy.** After any
change to `Code.gs` or `appsscript.json`, you must also run:

    clasp push

Both destinations must stay in sync — git is the source-controlled history,
`clasp push` is what actually updates the live Apps Script project (script ID
in `.clasp.json` — gitignored, so a fresh clone must first copy
`.clasp.json.example` and fill in the script ID). A change committed to git but not pushed via `clasp` has
not shipped; a change pushed via `clasp` but not committed to git will be lost
on the next `clasp pull` or teardown. Neither Script Properties, the Web App
deployment, nor the Yahoo OAuth token/trigger state live in code — those are
IDE-side state that does not travel with either `git push` or `clasp push`
(see "Recent Improvements — 2026-08-12 (revival)" for what had to be
re-established by hand after the project's Apps Script side went blank).

### Rollback
- **Via Apps Script:** Editor → Project History → select a prior version → Restore
- **Via git:** `git checkout <commit> Code.gs && clasp push`

## Conventions & gotchas

- Private/internal helpers are suffixed with `_` (e.g. `getConfig_()`). Public entry points: `pullFantasyData`, `startYahooAuth`, `doGet`, `debugAllLeaguesRaw`, `debugSnapshotToLog`.
- Snapshot output is HTML with inline CSS (for email client compatibility). `sendSnapshotEmail_()` sends both HTML and a plain text fallback.
- `completedWeek` is always `currentWeek - 1` (the most recently finished week).
- Yahoo API batches player data in chunks of 25 to stay within API limits.
- All error messages follow the format `[FunctionName] Message: details` for easy log filtering.
- Week parameters are validated (1-18 range) across all functions with `validateWeek_()`.
- Token expiration is checked proactively (5-minute buffer) to avoid wasted API calls.
- All Yahoo API calls have retry logic with exponential backoff (3 attempts: 2s, 4s, 8s).
- API call count is tracked globally in `API_CALL_COUNT` and logged with snapshot results.
- Script timezone is **America/Los_Angeles** (`appsscript.json`). It drives both the trigger hour and `Session.getScriptTimeZone()` used for waiver "added day" labels — changing it shifts both.
- Time-driven triggers fire within roughly an hour of the requested time, not exactly on the hour.

## Global Constants

Defined at the top of `Code.gs` (lines 2-13):

| Constant | Value | Purpose |
|---|---|---|
| `YAHOO_API_BATCH_SIZE` | 25 | Yahoo API player batch limit |
| `WAIVER_PICKUP_WINDOW_DAYS` | 7 | How far back to look for waiver pickups |
| `TOKEN_REFRESH_BUFFER_MS` | 300000 | Refresh token 5 min before expiry |
| `RATE_LIMIT_DELAY_MS` | 200 | Delay between API batches |
| `MIN_WEEK` / `MAX_WEEK` | 1 / 18 | NFL week range for validation |
| `POWER_RANKING_WINDOW` | 3 | Rolling weeks for power rankings |
| `SLOW_RUN_THRESHOLD_SEC` | 240 | Alert if execution exceeds 4 minutes |
| `WEEKLY_TRIGGER_DAY` | `'TUESDAY'` | Day `installWeeklyTrigger()` schedules the run |
| `WEEKLY_TRIGGER_HOUR` | 8 | Hour for that trigger, in the script's timezone |

## Recent Improvements

**2026-09-10 (contract compliance, from the 2026-09-10 audit):**
- ✅ Yahoo attribution footer added to every snapshot email via new pure `buildEmailHtml_` (extracted from `pullFantasyData`); 4 new `runTests()` assertions guard it
- ✅ Plain-text fallback now keeps links as `text (url)`, so the attribution link survives there too
- ✅ Removed `getPlayerOwnerMap_`'s 10-minute `CacheService` cache (contract §2.c.vii); it was fetched once per league per run, so no extra API calls
- ✅ README status brought up to the signed-agreement state; audit links no longer point at the historical `docs/audits/` as if it were current

**2026-09-04 (audit follow-up):**
- ✅ Off-season gate extracted as pure `offseasonEmailDecision_(anySeasonActive, failedLeaguesCount, alreadyNotified)` → `'SEND_SNAPSHOT'` / `'SEND_NOTICE'` / `'STAY_SILENT'`; `pullFantasyData` now just executes the decision. Behaviour unchanged — the gate's failure mode is *silence*, so all six input combinations are asserted in `runTests()`, including the "a league errored, send anyway" carve-out
- ✅ `runTests()` also covers `retryWithBackoff_`: returns the fn result without retrying, rethrows the original error rather than returning `undefined`, and recovers on a second attempt
- ✅ `doGet` no longer logs the Yahoo token endpoint's response body verbatim — it parses `error`/`error_description`, falling back to a 200-char truncation. That endpoint is the only one whose payloads carry tokens
- ✅ CLAUDE.md trimmed 317 → ~230 lines: pre-2026-08-12 changelog moved to [docs/audits/CHANGELOG-ARCHIVE.md](docs/audits/CHANGELOG-ARCHIVE.md), duplicate Deployment Checklist / Manual Steps merged, "Remaining" repointed from the stale 2026-05-18 audit to `_weekly-audit/audits/fantasy-snapshot/`, constants line range corrected to 2-13
- ⚠️ Still open: the Yahoo approval itself, and the scheduled `checkSetup()` approval watcher (audit idea 1) — neither shipped in this pass

**2026-08-13 (Supabase removal):**
- Supabase dropped entirely — the project no longer uses any external datastore
- Removed: `supabaseRequest_`, `isSupabaseConfigured_`, `verifySupabaseSchema_`, `persistWeeklySnapshot_`, `getSeasonTrends_`, `computeSeasonTrends_`, `median_`, their `runTests()` assertions, the `seasonTrends` field on `fetchSnapshotData_`, and the Season Trends renderer block
- The **Season Trends** email section (scoring trend / consistency / luck factor) is gone with it — it was the only Supabase-dependent feature. Everything else re-derives from Yahoo per run; power rankings already re-fetch prior weeks directly, so they are unaffected
- `SUPABASE_URL` / `SUPABASE_ANON_KEY` script properties are no longer read and can be deleted
- Verified: `renderSnapshotHtml_` output is byte-identical to the prior version across off-season / no-standings / error / full-week paths (differential node render test); `runTests()` passes

**2026-08-12 (revival):**
- Project un-retired. Apps Script project was blank; `Code.gs` + `appsscript.json` re-pushed via `clasp push` to script ID `1sdSUJHak5FVMt1yxvSW9dFyoF-HRYniTmlg0cMXclfyoF-4m1F4reEw3`
- ✅ Added `checkSetup()` — reports which Script Properties are set (values never logged) and whether a `pullFantasyData` trigger exists; gives a READY / NOT READY verdict
- ✅ README retirement notice replaced with active status
- Note: Script Properties, the Web App deployment, the Yahoo OAuth handshake, and the time-driven trigger must be re-established manually in the IDE — none of them survive in code

**Older entries:** moved to [docs/audits/CHANGELOG-ARCHIVE.md](docs/audits/CHANGELOG-ARCHIVE.md) (2026-02-09 → 2026-05-22).

**Current issues & feature ideas:** see the latest weekly audit in
`_weekly-audit/audits/fantasy-snapshot/` — that directory, not `docs/audits/`, is the
live backlog. `docs/audits/` holds the historical record only.
