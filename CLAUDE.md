# fantasy-snapshot

Google Apps Script that pulls Yahoo Fantasy Football league data, builds a weekly snapshot, and emails it.

## Tech stack

- **Runtime:** Google Apps Script (V8)
- **APIs:** Yahoo Fantasy Sports API v2 (OAuth2), Supabase (PostgREST)
- **Entry point:** `pullFantasyData()` — fetches all leagues, builds snapshots, emails the result

## Project layout

Single file: `Code.gs`

| Layer | Key functions |
|---|---|
| Config & secrets | `getConfig_()` — reads all credentials from Script Properties |
| Yahoo OAuth | `startYahooAuth()`, `doGet()` (callback), `refreshYahooAccessToken_()` |
| Yahoo API transport | `yahooApiRequest_()` — handles auth header, auto-refresh on 401 |
| Supabase transport | `supabaseRequest_()` — generic PostgREST helper (wired but not yet called in main flow) |
| League discovery | `getAllLeagues_()` |
| Standings | `getLeagueStandings_()` |
| Weekly highlights | `getWeekTeamHighlights_()`, `getWeekMatchups_()`, `getCurrentWeek_()` |
| Bench / roster | `getWeekBenchSummary_()`, `getWeekStartedPlayerKeys_()`, `getPlayerOwnerMap_()` |
| Waiver pickups | `getTopWaiverPickupsForWeek_()` |
| Per-position leaders | `getTopPlayersForWeekAndPosition_()`, `getWeekPointsMapForPlayerKeys_()` |
| Snapshot assembly | `buildLeagueSnapshot_()` |

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
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Supabase anon/publishable key |

## Yahoo API conventions

- The Yahoo Fantasy API returns deeply nested, array-of-single-key-objects structures. Helper pattern used throughout: iterate an array, check `Object.keys(entry).length === 1`, flatten into a plain object.
- Player/team data chunks are batched in groups of 25 (`chunkSize = 25`) to stay within API limits.
- `yahooApiRequest_()` automatically retries once after a token refresh if a 401 with `token_expired` is returned.

## Running & deploying

1. Open the project in the [Apps Script IDE](https://script.google.com).
2. Set all Script Properties listed above.
3. Deploy as a **Web App** (execute as: you, access: anyone) to get the `YAHOO_REDIRECT_URI`.
4. Run `startYahooAuth()` once in the IDE — copy the logged URL into a browser to complete the OAuth handshake.
5. Run `pullFantasyData()` (or set up a time-driven trigger) to send the snapshot email.

## Conventions & gotchas

- Private/internal helpers are suffixed with `_` (e.g. `getConfig_()`). The only public entry points are `pullFantasyData`, `startYahooAuth`, `doGet`, and the debug helper `debugAllLeaguesRaw`.
- `completedWeek` is always `currentWeek - 1` (the most recently finished week).
- `supabaseRequest_()` is available but the main snapshot flow doesn't persist to Supabase yet — that's the next integration point.
- The recipient email in `pullFantasyData()` is currently hardcoded.
