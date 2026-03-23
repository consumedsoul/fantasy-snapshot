# fantasy-snapshot

Google Apps Script that pulls Yahoo Fantasy Football league data, builds a weekly snapshot, and emails it.

## Tech stack

- **Runtime:** Google Apps Script (V8)
- **APIs:** Yahoo Fantasy Sports API v2 (OAuth2), Supabase (PostgREST) - *optional, degrades gracefully when not configured*
- **Entry point:** `pullFantasyData()` — fetches all leagues, builds snapshots, emails the result

## Project layout

Single file: `Code.gs` (2068 lines)

## Function Index

### Public Entry Points
- `pullFantasyData()` — Main entry point: fetches all leagues, builds snapshots, emails result
- `startYahooAuth()` — Initiates Yahoo OAuth flow (run once in IDE)
- `doGet(e)` — OAuth callback handler (Web App endpoint)
- `debugAllLeaguesRaw()` — Debug helper: logs raw Yahoo API response
- `debugSnapshotToLog()` — Debug helper: generates snapshot and logs to console (no email)

### Private Helpers (suffix: `_`)

**Config & Auth:**
- `getConfig_()` — Reads script properties (credentials)
- `getLeagueKey_()` — Retrieves default league key from properties
- `getYahooAuthUrl_()` — Constructs Yahoo OAuth URL
- `getYahooAccessToken_()` — Retrieves access token, checks expiration
- `refreshYahooAccessToken_()` — Refreshes expired token

**API Transport:**
- `yahooApiRequest_(resourcePath, queryParams)` — Generic Yahoo API wrapper with auto-refresh on 401
- `supabaseRequest_(path, method, payload)` — Generic Supabase PostgREST wrapper (used by persistence and trends)

**League Discovery:**
- `getAllLeagues_()` — Fetches all NFL leagues for authenticated user

**Standings:**
- `getLeagueStandings_(leagueKey)` — Fetches league standings with W-L-T, PF, PA

**Weekly Data:**
- `getCurrentWeek_(leagueKey)` — Determines current NFL week
- `getWeekMatchups_(week, leagueKey)` — Fetches scoreboard, calculates close matchups and projected scores
- `getWeekTeamHighlights_(week, leagueKey)` — Top teams, blowouts, bad beats
- `getWeekTeamScores_(week, leagueKey)` — Fetches ALL team scores from scoreboard (sorted by points desc)
- `getWeeklyPowerRankings_(completedWeek, leagueKey)` — 3-week rolling average power rankings with trend arrows
- `getWeekBenchSummary_(week, leagueKey)` — Most points left on bench
- `getTopWaiverPickupsForWeek_(week, limit, leagueKey)` — Best pickups started

**Player Data:**
- `getWeekPointsMapForPlayerKeys_(week, playerKeys, leagueKey)` — Batch fetch player points
- `getWeekStartedPlayerKeys_(week, leagueKey)` — All non-bench players
- `getPlayerOwnerMap_(leagueKey)` — Maps player_key → team_name
- `getTopPlayersForWeekAndPosition_(week, position, limit, ownerMap, leagueKey)` — Position leaders (QB, RB, WR, TE, K, DEF)

**Email:**
- `sendSnapshotEmail_(subject, htmlBody)` — Sends HTML email with plain text fallback and quota check
- `sendNotificationEmail_(subject, body)` — Sends error notifications (non-throwing)
- `getRecipientEmail_()` — Gets recipient email from script properties

**Supabase / Persistence:**
- `isSupabaseConfigured_()` — Returns boolean; gates all Supabase operations
- `persistWeeklySnapshot_(leagueKey, completedWeek, standings, weeklyScoreMap)` — Upserts standings + scores to Supabase `weekly_snapshots` table
- `getSeasonTrends_(leagueKey)` — Fetches historical data from Supabase, calculates scoring trends, consistency, luck factor (requires 3+ weeks)

**Utilities:**
- `flattenYahooMeta_(arr)` — Flattens Yahoo's array-of-single-key-objects into a plain object
- `parseTeamMeta_(teamWrapper, pointsField)` — Extracts team name, manager, and points from Yahoo team wrapper
- `getPlayerSlot_(playerArr)` — Extracts selected position/slot from Yahoo player array
- `validateWeek_(week, functionName)` — Validates week is 1-18
- `retryWithBackoff_(fn, maxRetries)` — Exponential backoff retry (3 attempts: 2s, 4s, 8s)

**Snapshot Assembly:**
- `buildLeagueSnapshot_(league)` — Assembles full weekly snapshot as styled HTML

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
| `RECIPIENT_EMAIL` | Email address to send snapshots to (required) |
| `SUPABASE_URL` | Supabase project URL (*optional — enables season trends & persistence*) |
| `SUPABASE_ANON_KEY` | Supabase anon/publishable key (*optional — enables season trends & persistence*) |

## Yahoo API conventions

- The Yahoo Fantasy API returns deeply nested, array-of-single-key-objects structures. Use `flattenYahooMeta_(arr)` to flatten these into plain objects. Use `parseTeamMeta_(teamWrapper, pointsField)` to extract team name, manager, and points from team wrappers.
- Player/team data chunks are batched in groups of 25 (`YAHOO_API_BATCH_SIZE`) to stay within API limits.
- `yahooApiRequest_()` automatically retries once after a token refresh if a 401 with `token_expired` is returned.

## Supabase Setup (Optional)

To enable season-long trends and data persistence, create a Supabase project and run this SQL:

```sql
CREATE TABLE weekly_snapshots (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  league_id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  team_name TEXT NOT NULL,
  manager_name TEXT,
  week INT NOT NULL,
  rank INT,
  wins INT,
  losses INT,
  ties INT,
  points_for NUMERIC,
  points_against NUMERIC,
  weekly_score NUMERIC,
  snapshot_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(league_id, team_id, week)
);

CREATE INDEX idx_weekly_snapshots_league_week ON weekly_snapshots(league_id, week);

-- RLS policies (enable RLS first)
ALTER TABLE weekly_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anon insert" ON weekly_snapshots
  FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "Allow anon select" ON weekly_snapshots
  FOR SELECT TO anon USING (true);
```

Then set `SUPABASE_URL` and `SUPABASE_ANON_KEY` in Script Properties. The snapshot will automatically persist data and show season trends after 3+ weeks of data.

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

## Deployment workflow

**After any code changes, always commit/push to git AND push to Google Apps Script via `clasp push`.** Both destinations must stay in sync. Never consider a code change complete until it has been committed to git and deployed to GAS.

## Conventions & gotchas

- Private/internal helpers are suffixed with `_` (e.g. `getConfig_()`). Public entry points: `pullFantasyData`, `startYahooAuth`, `doGet`, `debugAllLeaguesRaw`, `debugSnapshotToLog`.
- Snapshot output is HTML with inline CSS (for email client compatibility). `sendSnapshotEmail_()` sends both HTML and a plain text fallback.
- `completedWeek` is always `currentWeek - 1` (the most recently finished week).
- Supabase integration is optional — when `SUPABASE_URL` and `SUPABASE_ANON_KEY` are set, `pullFantasyData()` persists weekly data and `buildLeagueSnapshot_()` shows season trends. All Supabase code degrades gracefully when not configured.
- Yahoo API batches player data in chunks of 25 to stay within API limits.
- All error messages follow the format `[FunctionName] Message: details` for easy log filtering.
- Week parameters are validated (1-18 range) across all functions with `validateWeek_()`.
- Token expiration is checked proactively (5-minute buffer) to avoid wasted API calls.
- All Yahoo API calls have retry logic with exponential backoff (3 attempts: 2s, 4s, 8s).
- API call count is tracked globally in `API_CALL_COUNT` and logged with snapshot results.

## Global Constants

Defined at `Code.gs:1513-1519`:

| Constant | Value | Purpose |
|---|---|---|
| `YAHOO_API_BATCH_SIZE` | 25 | Yahoo API player batch limit |
| `WAIVER_PICKUP_WINDOW_DAYS` | 7 | How far back to look for waiver pickups |
| `TOKEN_REFRESH_BUFFER_MS` | 300000 | Refresh token 5 min before expiry |
| `RATE_LIMIT_DELAY_MS` | 200 | Delay between API batches |
| `MIN_WEEK` / `MAX_WEEK` | 1 / 18 | NFL week range for validation |

## Recent Improvements

**2026-02-19 (new features + audit fixes):**
- ✅ **Matchup Projections** — projected scores, spread, and confidence % for upcoming week
- ✅ **Weekly Power Rankings** — 3-week rolling average with trend arrows (up/down/stable)
- ✅ **Season-Long Trends** — scoring trends, consistency, luck factor via Supabase (optional, degrades gracefully)
- ✅ Supabase persistence in `pullFantasyData()` — upserts standings + scores after each league snapshot
- ✅ `getWeekMatchups_` signature fixed — added `leagueKey` parameter for multi-league support
- ✅ `getWeekTeamScores_()` — fetches all team scores from scoreboard
- ✅ `getWeeklyPowerRankings_()` — rolling average power rankings with trend comparison
- ✅ `isSupabaseConfigured_()`, `persistWeeklySnapshot_()`, `getSeasonTrends_()` — Supabase helpers
- ✅ Plain text fallback improved — proper HTML entity decoding and structural newlines
- ✅ JSDoc with Yahoo API response shapes added to `getAllLeagues_`, `getLeagueStandings_`, `getWeekMatchups_`
- ✅ `flattenYahooMeta_` now logs warning for multi-key entries instead of silently dropping

**2026-02-17 (audit fixes):**
- ✅ HTML email output with styled tables, callout boxes, and inline CSS
- ✅ Plain text fallback generated automatically from HTML
- ✅ `flattenYahooMeta_()` helper extracted — DRYed ~10 repeated parsing blocks
- ✅ `parseTeamMeta_()` helper extracted — unified team parsing in matchups and highlights
- ✅ `getPlayerSlot_()` helper extracted — shared slot-finding for bench/starter logic
- ✅ Unicode control character `\u0013` replaced with em dash
- ✅ `.clasp.json.example` template created for onboarding

**2026-02-14 (audit fixes):**
- ✅ Rate limiting between API batches (`Utilities.sleep(RATE_LIMIT_DELAY_MS)`)
- ✅ Named constants extracted from magic numbers
- ✅ CacheService caching for `getPlayerOwnerMap_()` (10-min TTL)
- ✅ `debugSnapshotToLog()` for testing without email
- ✅ JSDoc comments on all public entry points
- ✅ Preseason week validation (graceful handling when `currentWeek < 2`)
- ✅ Error message format consistency (`[FunctionName]` prefix)

**2026-02-09 (initial audit fixes):**
- ✅ Extracted hardcoded email to `RECIPIENT_EMAIL` script property
- ✅ Comprehensive error handling with email notifications
- ✅ Retry logic with exponential backoff for all API calls
- ✅ Input validation for week parameters (1-18 range)
- ✅ Proactive token expiration checks
- ✅ API call counter and duration logging
- ✅ Per-league error handling (partial success support)
- ✅ Email quota checks before sending

**Remaining:**
See [docs/audits/2026-02-19-audit.md](docs/audits/2026-02-19-audit.md) for current issues and feature ideas.
