# fantasy-snapshot

Google Apps Script that pulls Yahoo Fantasy Football league data, builds a weekly snapshot, and emails it.

## Tech stack

- **Runtime:** Google Apps Script (V8)
- **APIs:** Yahoo Fantasy Sports API v2 (OAuth2), Supabase (PostgREST) - *planned, not yet integrated*
- **Entry point:** `pullFantasyData()` — fetches all leagues, builds snapshots, emails the result

## Project layout

Single file: `Code.gs` (1377 lines)

## Function Index

### Public Entry Points
- `pullFantasyData()` — Main entry point: fetches all leagues, builds snapshots, emails result
- `startYahooAuth()` — Initiates Yahoo OAuth flow (run once in IDE)
- `doGet(e)` — OAuth callback handler (Web App endpoint)
- `debugAllLeaguesRaw()` — Debug helper: logs raw Yahoo API response

### Private Helpers (suffix: `_`)

**Config & Auth:**
- `getConfig_()` — Reads script properties (credentials)
- `getLeagueKey_()` — Retrieves default league key from properties
- `getYahooAuthUrl_()` — Constructs Yahoo OAuth URL
- `getYahooAccessToken_()` — Retrieves access token, checks expiration
- `refreshYahooAccessToken_()` — Refreshes expired token

**API Transport:**
- `yahooApiRequest_(resourcePath, queryParams)` — Generic Yahoo API wrapper with auto-refresh on 401
- `supabaseRequest_(path, method, payload)` — Generic Supabase PostgREST wrapper (*not yet used in main flow*)

**League Discovery:**
- `getAllLeagues_()` — Fetches all NFL leagues for authenticated user

**Standings:**
- `getLeagueStandings_(leagueKey)` — Fetches league standings with W-L-T, PF, PA

**Weekly Data:**
- `getCurrentWeek_(leagueKey)` — Determines current NFL week
- `getWeekMatchups_(week)` — Fetches scoreboard, calculates close matchups
- `getWeekTeamHighlights_(week, leagueKey)` — Top teams, blowouts, bad beats
- `getWeekBenchSummary_(week, leagueKey)` — Most points left on bench
- `getTopWaiverPickupsForWeek_(week, limit, leagueKey)` — Best pickups started

**Player Data:**
- `getWeekPointsMapForPlayerKeys_(week, playerKeys, leagueKey)` — Batch fetch player points
- `getWeekStartedPlayerKeys_(week, leagueKey)` — All non-bench players
- `getPlayerOwnerMap_(leagueKey)` — Maps player_key → team_name
- `getTopPlayersForWeekAndPosition_(week, position, limit, ownerMap, leagueKey)` — Position leaders (QB, RB, WR, TE, K, DEF)

**Snapshot Assembly:**
- `buildLeagueSnapshot_(league)` — Assembles full weekly snapshot text

## Script Properties (secrets)

All credentials live in Apps Script Script Properties — never hardcode them.

| Property | Purpose |
|---|---|
| `YAHOO_CLIENT_ID` | Yahoo OAuth app client ID |
| `YAHOO_CLIENT_SECRET` | Yahoo OAuth app client secret |
| `YAHOO_REDIRECT_URI` | Apps Script Web App URL (OAuth callback) |
| `YAHOO_LEAGUE_KEY` | Default league key (used when none is passed explicitly) |
| `YAHOO_ACCESS_TOKEN` | Current OAuth access token (written by auth flow) |
| `YAHOO_REFRESH_TOKEN` | OAuth refresh token (written by auth flow) |
| `YAHOO_EXPIRES_IN` | Token TTL in seconds |
| `YAHOO_TOKEN_CREATED_AT` | Epoch ms when the token was issued |
| `RECIPIENT_EMAIL` | Email address to send snapshots to (*recommended - currently hardcoded in Code.gs:1184*) |
| `SUPABASE_URL` | Supabase project URL (*optional - not yet used*) |
| `SUPABASE_ANON_KEY` | Supabase anon/publishable key (*optional - not yet used*) |

## Yahoo API conventions

- The Yahoo Fantasy API returns deeply nested, array-of-single-key-objects structures. Helper pattern used throughout: iterate an array, check `Object.keys(entry).length === 1`, flatten into a plain object.
- Player/team data chunks are batched in groups of 25 (`chunkSize = 25`) to stay within API limits.
- `yahooApiRequest_()` automatically retries once after a token refresh if a 401 with `token_expired` is returned.

## Running & deploying

### Deployment Checklist
- [ ] Create Apps Script project
- [ ] Set all required Script Properties (see table above)
- [ ] Deploy as **Web App** (Execute as: Me, Access: Anyone)
- [ ] Copy Web App URL to `YAHOO_REDIRECT_URI` property
- [ ] Run `startYahooAuth()` in IDE and complete OAuth flow in browser
- [ ] Test `pullFantasyData()` manually
- [ ] Set up time-driven trigger (recommended: weekly, Monday 9 AM)
- [ ] Verify first automated run succeeds

### Manual Steps
1. Open the project in the [Apps Script IDE](https://script.google.com).
2. Set all Script Properties listed above.
3. Deploy as a **Web App** (execute as: you, access: anyone) to get the `YAHOO_REDIRECT_URI`.
4. Run `startYahooAuth()` once in the IDE — copy the logged URL into a browser to complete the OAuth handshake.
5. Run `pullFantasyData()` (or set up a time-driven trigger) to send the snapshot email.

## Conventions & gotchas

- Private/internal helpers are suffixed with `_` (e.g. `getConfig_()`). The only public entry points are `pullFantasyData`, `startYahooAuth`, `doGet`, and the debug helper `debugAllLeaguesRaw`.
- `completedWeek` is always `currentWeek - 1` (the most recently finished week).
- `supabaseRequest_()` is available but the main snapshot flow doesn't persist to Supabase yet — that's the next integration point.
- Yahoo API batches player data in chunks of 25 to stay within API limits.
- All error messages follow the format `[FunctionName] Message: details` for easy log filtering.
- Week parameters are validated (1-18 range) across all functions with `validateWeek_()`.
- Token expiration is checked proactively (5-minute buffer) to avoid wasted API calls.
- All Yahoo API calls have retry logic with exponential backoff (3 attempts: 2s, 4s, 8s).
- API call count is tracked globally in `API_CALL_COUNT` and logged with snapshot results.

## Recent Improvements (2026-02-09)

**Fixed:**
- ✅ Extracted hardcoded email to `RECIPIENT_EMAIL` script property
- ✅ Added comprehensive error handling to `pullFantasyData()` with email notifications
- ✅ Implemented retry logic with exponential backoff for all API calls
- ✅ Added input validation for week parameters (1-18 range)
- ✅ Proactive token expiration checks (5-minute buffer)
- ✅ API call counter and duration logging
- ✅ Per-league error handling (one league failure doesn't break entire snapshot)
- ✅ Email quota checks before sending

**Remaining:**
See [docs/audits/2026-02-09-audit.md](docs/audits/2026-02-09-audit.md) for remaining medium and low priority items.
