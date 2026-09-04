# Changelog Archive — fantasy-snapshot

Entries moved out of `CLAUDE.md` on 2026-09-04 to keep the instruction file lean.
Historical record only — for current issues and feature ideas see
`_weekly-audit/audits/fantasy-snapshot/`.

**2026-05-22 (audit fixes — applied, committed + pushed in-cycle):**
- 🔴 0 Critical, 🟠 0 High, 🟡 3 Medium (all fixed), ⚪ 4 Low (2 fixed, 2 intentionally skipped) — prior score 95/100
- ✅ **Medium:** `buildLeagueSnapshot_` god-function split into `fetchSnapshotData_(league)` (I/O) + `renderSnapshotHtml_(data)` (pure HTML); `buildLeagueSnapshot_` is now a thin wrapper. HTML output preserved verbatim (verified via node render smoke test across full / off-season / empty / partial-error paths)
- ✅ **Medium:** pure `computeSeasonTrends_(rows)` + `median_(values)` extracted from `getSeasonTrends_`; `runTests()` now covers median (even/odd/empty), std-dev, scoring trend, expected wins, and luck factor
- ✅ **Medium:** off-season auto-pause — `pullFantasyData` suppresses the near-empty weekly email when no league has an active season; sends a single off-season notice (tracked via `OFFSEASON_NOTICE_SENT`), then stays silent until Week 1. Skipped if any league errored.
- ✅ **Low:** OAuth `state` nonce — `getYahooAuthUrl_` stores a UUID in `CacheService` and `doGet` validates it (CSRF hardening on the one external endpoint)
- ✅ **Low:** `retryWithBackoff_` now throws explicitly if the loop exhausts without a result (no implicit `undefined`)
- ✅ **Low:** `.gitignore` adds `.DS_Store` + `.claude/`; `.DS_Store` untracked
- Skipped (documented): `LockService` around `pullFantasyData` deliberately not added — audit recommends against it (adds lock-timeout failure modes for negligible payoff on a single-user weekly tool, where Supabase upserts are already idempotent)

**2026-05-18 (audit fixes — applied, committed + pushed in-cycle):**
- 🔴 0 Critical, 🟠 1 High (fixed), 🟡 4 Medium (2 fixed), ⚪ 3 Low (1 fixed) — Score: 95/100 (+4 from 91)
- ✅ **High:** `getTopPlayersForWeekAndPosition_` (called 6× in a loop, re-fetching all rostered-player stats per position) replaced with `getTopPlayersByPositionForWeek_` — one batched fetch bucketed by position (~48 → ~8 Yahoo API calls/league)
- ✅ **Medium:** `isNaN(currentWeek)` added to the season-not-started guard in `buildLeagueSnapshot_` (a NaN week no longer produces a "Week null" email)
- ✅ **Medium:** `retryWithBackoff_` closures in `yahooApiRequest_` and `supabaseRequest_` now throw on 429/5xx so transient failures actually get exponential backoff (previously masked by `muteHttpExceptions`); Yahoo 401 token-refresh path unaffected
- ✅ **Low:** plain-text email fallback now decodes `&#39;` and `&quot;`
- Verified: both 2026-04-22 High items already resolved in committed code (Season Trends ordering at `buildLeagueSnapshot_` persist→trends; single-quote escaping in `escapeHtml_`)
- Deferred (documented): split `buildLeagueSnapshot_` (~263-line god-function); extract pure `computeSeasonTrends_` for unit-testing; OAuth `state`; `LockService`
- See [docs/audits/2026-05-18-audit.md](docs/audits/2026-05-18-audit.md)

**2026-04-22 (audit findings):**
- 🔴 0 Critical, 🟠 2 High (Season Trends reads Supabase before current week is persisted; working tree has uncommitted fix pass), 🟡 3 Medium
- Score: 91/100 (-2 from 93 — structural, not code-quality; two new High items offset the 100% resolution rate on Apr-06 items)
- All 8 items from 2026-04-06 resolved in the working tree (bp.name escape, Supabase schema warning, `runTests()` expansion to cover `parseTeamMeta_` + `getPlayerSlot_`, README rewrite, `getWeeklyPowerRankings_` reusing shared scoreboard)
- Action required: reorder `getSeasonTrends_` to run after `persistWeeklySnapshot_` in `buildLeagueSnapshot_` so trends include the current completed week; commit + `clasp push` the working-tree changes
- See [docs/audits/2026-04-22-audit.md](docs/audits/2026-04-22-audit.md)

**2026-04-06 (audit fixes — applied in working tree, awaiting commit/push):**
- ✅ `escapeHtml_(bp.name)` applied in bench summary detail string (completes 100% coverage)
- ✅ `verifySupabaseSchema_()` return value checked — sends notification email when schema is missing
- ✅ `runTests()` expanded with `parseTeamMeta_` and `getPlayerSlot_` assertions (22+ assertions total)
- ✅ `getWeeklyPowerRankings_` now accepts `currentWeekScores` to reuse pre-fetched completedWeek scoreboard
- ✅ README.md expanded with full setup/OAuth/deployment steps
- See [docs/audits/2026-04-06-audit.md](docs/audits/2026-04-06-audit.md)

**2026-03-23 (audit fixes):**
- ✅ `escapeHtml_()` helper added — all dynamic values (team names, league names, error messages) now escaped before HTML insertion
- ✅ `fetchWeekRosterTeams_()` helper extracted — `getWeekBenchSummary_` and `getWeekStartedPlayerKeys_` now share one roster fetch per run
- ✅ Supabase persistence moved into `buildLeagueSnapshot_` — eliminates duplicate `getLeagueStandings_` call in `pullFantasyData`
- ✅ `verifySupabaseSchema_()` added — checks `weekly_snapshots` table on startup; logs clear error if schema is missing
- ✅ Global constants moved to top of file; `POWER_RANKING_WINDOW` and `SLOW_RUN_THRESHOLD_SEC` promoted to named constants
- ✅ `runTests()` added — unit tests for `escapeHtml_`, `validateWeek_`, `flattenYahooMeta_` (run manually from IDE)
- ✅ Execution time alert in `pullFantasyData` — sends notification email if run exceeds 4 minutes
- ✅ `doGet`: added basic `params.code` length validation
- ✅ JSDoc added to `getWeekTeamHighlights_`, `getWeekBenchSummary_`, `getWeekStartedPlayerKeys_`
- ✅ Rollback strategy documented
- See [docs/audits/2026-03-23-audit.md](docs/audits/2026-03-23-audit.md) for full details.

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
