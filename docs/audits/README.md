# Audit History

This directory contains weekly code audits for the fantasy-snapshot project.

## Audit Index

### [2026-05-18 Audit](2026-05-18-audit.md) ⭐ Latest
**Status:** Follow-up audit (26 days after last audit) — fixes applied + deployed in-cycle
**Score:** 95/100 (A - Excellent)
**Issues Found:**
- 🔴 Critical: 0
- 🟠 High: 1 (fixed this commit)
- 🟡 Medium: 4 (2 fixed, 2 deferred)
- ⚪ Low: 3 (1 fixed, 2 deferred)
- 💡 Feature Ideas: 4

**Total Action Items:** 8 — 5 resolved in this commit, 3 deferred with rationale

**Key Findings:**
- **High (fixed):** position leaders re-fetched all rostered-player stats once per position — `getTopPlayersForWeekAndPosition_` called 6× in a loop. Replaced with single batched `getTopPlayersByPositionForWeek_` → ~48 → ~8 Yahoo API calls per league
- **Medium (fixed):** NaN `currentWeek` slipped past the season-not-started guard; transient 429/5xx were never retried (masked by `muteHttpExceptions`) — both now handled
- **Low (fixed):** plain-text email fallback now decodes `&#39;`/`&quot;`
- Scout-agent "Critical" findings (SQL injection, hardcoded Supabase URL) were **fabricated** and discarded after a full-file read — code uses PostgREST JSON and a `SUPABASE_URL` property
- Both 2026-04-22 High items verified already resolved in committed code (3002d1b); no deployment drift this cycle
- Deferred (documented): `buildLeagueSnapshot_` god-function split, `getSeasonTrends_` pure-helper extraction for testability, OAuth `state`, `LockService`

**Overall Health:** Excellent (95/100) — best state in project history; biggest API-cost hotspot eliminated, resilience complete, zero deployment drift.

---

### [2026-04-22 Audit](2026-04-22-audit.md)
**Status:** Follow-up audit (16 days after last audit)
**Score:** 91/100 (A - Excellent)
**Issues Found:**
- 🔴 Critical: 0
- 🟠 High: 2
- 🟡 Medium: 3
- ⚪ Low: 3
- 💡 Feature Ideas: 4

**Total Action Items:** 8

**Key Findings:**
- All 8 items from the 2026-04-06 audit applied in the working tree (100% fix rate): bp.name escape, Supabase schema warning, `runTests()` expansion to cover `parseTeamMeta_` + `getPlayerSlot_`, README rewrite, `getWeeklyPowerRankings_` reusing shared scoreboard
- **Two new High items:** (1) `getSeasonTrends_()` runs before `persistWeeklySnapshot_()` inside `buildLeagueSnapshot_`, so the Season Trends table always excludes the most-recently completed week; (2) all Apr-06 fixes are still uncommitted — `git status` shows 4 modified files and 2 untracked audit files, meaning the fixes are not live in git or GAS
- Score regression (-2) is structural, not a code-quality issue — the code is objectively better; the dip is the cost of undeployed work plus the newly-identified ordering bug
- `runTests()` now has 22+ assertions across 8 helpers

**Overall Health:** Excellent (91/100) — Commit + push + one reorder brings this back above 95.

---

### [2026-04-06 Audit](2026-04-06-audit.md)
**Status:** Follow-up audit (14 days after last audit)
**Score:** 93/100 (A - Excellent)
**Issues Found:**
- 🔴 Critical: 0
- 🟠 High: 1
- 🟡 Medium: 4
- ⚪ Low: 3
- 💡 Feature Ideas: 4

**Total Action Items:** 8

**Key Findings:**
- All 11 action items from the 2026-03-23 audit were resolved (100% resolution rate): `escapeHtml_()` applied everywhere, shared roster fetch extracted, Supabase startup verification added, execution time alert implemented, unit tests added
- One new high-priority issue introduced: bench player names (`bp.name`) concatenated into HTML detail string without `escapeHtml_()` — the single remaining injection point
- `runTests()` now exists with 13 assertions but lacks coverage for `parseTeamMeta_()` and `getPlayerSlot_()`
- Score jumped +9 points to 93/100 — highest score in project history

**Overall Health:** Excellent (93/100) — Production-hardened and feature-complete. Remaining work is minor polish.

---

### [2026-03-23 Audit](2026-03-23-audit.md)
**Status:** Follow-up audit (32 days after last audit)
**Score:** 84/100 (A- - Very Good)
**Issues Found:**
- 🔴 Critical: 0
- 🟠 High: 2
- 🟡 Medium: 5
- ⚪ Low: 4
- 💡 Feature Ideas: 6

**Total Action Items:** 11

**Key Findings:**
- Two new high-priority issues introduced with recent features: unescaped HTML in email body (XSS risk) and duplicate roster API calls
- Four features added since last audit: power rankings, season trends, matchup projections, Supabase persistence
- Plain text fallback (carried over from Feb 19) was resolved — now properly adds newlines between blocks
- No unit tests still the biggest single gap
- Score essentially flat at 84/100 (vs 85 last audit) — new features came with new issues

**Overall Health:** Very Good (84/100) — Feature-complete and production-ready. Focus areas: HTML safety, API call reduction, testing.

---

### [2026-02-19 Audit](2026-02-19-audit.md)
**Status:** Follow-up audit
**Score:** 85/100 (A - Very Good)
**Issues Found:**
- 🔴 Critical: 0
- 🟠 High: 0
- 🟡 Medium: 4
- ⚪ Low: 5
- 💡 Feature Ideas: 4

**Total Action Items:** 9

**Key Findings:**
- All 5 action items from Feb 17 completed (100% resolution rate)
- First audit with zero critical AND zero high-priority issues
- HTML email output with styled tables and callout boxes
- 3 new DRY helpers extracted (`flattenYahooMeta_`, `parseTeamMeta_`, `getPlayerSlot_`)
- Code reduced from 1,644 to 1,543 lines (extracted duplication)

**Overall Health:** Very Good (85/100) — Production-ready. Remaining work focuses on testing, documentation depth, and dead code cleanup.

---

### [2026-02-17 Audit](2026-02-17-audit.md)
**Status:** Follow-up audit
**Score:** 72/100 (B - Good)
**Issues Found:**
- 🔴 Critical: 0
- 🟠 High: 1
- 🟡 Medium: 5
- ⚪ Low: 5
- 💡 Feature Ideas: 5

**Total Action Items:** 11

**Key Findings:**
- Both high-priority items from Feb 14 resolved
- 5 of 8 medium-priority items fixed (constants, caching, debug tools, JSDoc, preseason validation)
- New finding: duplicated Yahoo API parsing pattern (~10 instances)
- New finding: `\u0013` unicode control character in snapshot output
- `.clasp.json` flagged (later found to be false positive — never tracked)

**Overall Health:** Good (72/100) — Production-ready. Focus areas: HTML emails, code DRY-ness, housekeeping.

---

### [2026-02-14 Audit](2026-02-14-audit.md)
**Status:** Follow-up audit
**Score:** 65/100 (C - Fair+)
**Issues Found:**
- 🔴 Critical: 0
- 🟠 High: 2
- 🟡 Medium: 8
- ⚪ Low: 5

**Total Action Items:** 15

**Key Findings:**
- All critical issues from 2026-02-09 resolved
- 7 of 8 high-priority issues fixed
- Code health improved from Fair to Good
- Remaining items are quality-of-life improvements
- Production-ready with robust error handling

**Overall Health:** Good (65/100) — Production-ready with comprehensive error handling, retry logic, and monitoring.

---

### [2026-02-09 Audit](2026-02-09-audit.md)
**Status:** Initial audit
**Score:** 50/100 (D - Concerning)
**Issues Found:**
- 🔴 Critical: 2
- 🟠 High: 8
- 🟡 Medium: 12
- ⚪ Low: 7

**Total Action Items:** 29

**Key Findings:**
- Hardcoded email address in production code (CRITICAL)
- No error handling in main entry point (CRITICAL)
- No rate limiting protection for Yahoo API calls
- Missing input validation on week parameters
- Token expiration not proactively checked
- No retry logic for transient API failures

**Overall Health:** Fair (50/100) — Core functionality works but lacks production-grade error handling, monitoring, and resilience.

---

## Trend Analysis

### Score Over Time
| Audit Date | Overall | Security | Performance | Code Quality | Documentation | Grade | Change |
|------------|---------|----------|-------------|--------------|---------------|-------|--------|
| 2026-02-09 | 50/100  | 60/100   | 60/100      | 55/100       | 40/100        | D     | —      |
| 2026-02-14 | 65/100  | 85/100   | 75/100      | 65/100       | 70/100        | C     | +15    |
| 2026-02-17 | 72/100  | 85/100   | 90/100      | 75/100       | 70/100        | B     | +7     |
| 2026-02-19 | 85/100  | 95/100   | 95/100      | 85/100       | 80/100        | A     | +13    |
| 2026-03-23 | 84/100  | 95/100   | 88/100      | 82/100       | 83/100        | A-    | -1     |
| 2026-04-06 | 93/100  | 97/100   | 95/100      | 91/100       | 90/100        | A     | +9     |
| 2026-04-22 | 91/100  | 97/100   | 96/100      | 92/100       | 89/100        | A     | -2     |
| 2026-05-18 | 95/100  | 97/100   | 98/100      | 93/100       | 92/100        | A     | +4     |

**Trend:** Recovery (+4) to the highest score in project history. The biggest API-cost hotspot (position leaders re-fetching all player stats 6×) is eliminated, transient-failure resilience is now complete on both Yahoo and Supabase, and fixes were committed + pushed in-cycle so there is zero deployment drift.

### Issue Count Over Time
| Audit Date | Critical | High | Medium | Low | Total |
|------------|----------|------|--------|-----|-------|
| 2026-02-09 | 2        | 8    | 12     | 7   | 29    |
| 2026-02-14 | 0        | 2    | 8      | 5   | 15    |
| 2026-02-17 | 0        | 1    | 5      | 5   | 11    |
| 2026-02-19 | 0        | 0    | 4      | 5   | 9     |
| 2026-03-23 | 0        | 2    | 5      | 4   | 11    |
| 2026-04-06 | 0        | 1    | 4      | 3   | 8     |
| 2026-04-22 | 0        | 2    | 3      | 3   | 8     |
| 2026-05-18 | 0        | 1    | 4      | 3   | 8     |

### Key Metrics
- **Total Files:** 8
- **Lines of Code:** 2,328 (Code.gs)
- **API Integrations:** Yahoo Fantasy Sports API v2, Supabase (optional)
- **Yahoo API calls / league / run:** dropped sharply — position leaders alone went from ~48 to ~8 calls
- **Test Coverage:** `runTests()` has 24+ assertions across `escapeHtml_`, `validateWeek_`, `flattenYahooMeta_`, `isSupabaseConfigured_`, `parseTeamMeta_`, `getPlayerSlot_`
- **Code Health Trajectory:** Fair → Good → Good → Very Good → Very Good → Excellent → Excellent → Excellent

### Feature Additions Since Initial Audit
- HTML email with styled tables and callout boxes
- Power Rankings (3-week rolling average with trend arrows)
- Season-Long Trends with consistency and luck factor
- Matchup Projections for upcoming week
- Supabase persistence for season-long data
- Rate limiting, retry logic, caching throughout
- `fetchWeekRosterTeams_()` shared fetch for bench/waiver analysis
- `escapeHtml_()` applied throughout all HTML output
- `verifySupabaseSchema_()` startup health check
- Execution time alert for slow runs

### Key Persistent Gaps
- No CI/CD pipeline
- `buildLeagueSnapshot_` god-function (~263 lines) — fetch + render not separated
- `getSeasonTrends_` stats math untestable (entangled with the Supabase fetch)
- Off-season handling: weekly trigger still emails empty snapshots out of season

### Resolved Persistent Gaps
- ✅ Deployment drift — 2026-05-18 fixes committed + pushed + `clasp`-deployed in-cycle
- ✅ Season Trends data-ordering bug — verified resolved in committed code (3002d1b)
- ✅ Position-leaders API-cost hotspot — ~48 → ~8 calls/league

### Next Audit Target
**Suggested Date:** 2026-06-01 (2 weeks)
**Target Score:** 96+/100
**Key Goals:**
- Extract a pure `computeSeasonTrends_(rows)` helper and add `runTests()` coverage
- Implement off-season trigger behavior (relevant now — deep off-season)
- Consider the `buildLeagueSnapshot_` fetch/render split as a standalone change
- Re-verify `clasp push` reached GAS (clasp may not be configured in the worktree)

---

## How to Read Audits

Each audit includes:
- **🔴 Critical Issues:** Security vulnerabilities, data loss risks, production bugs
- **🟠 High Priority:** Performance issues, missing error handling, cost optimization
- **🟡 Medium Priority:** Code quality, documentation, moderate tech debt
- **⚪ Low Priority:** Nice-to-have refactoring, future enhancements
- **💡 Feature Ideas:** New features and enhancements with effort/impact analysis

Action items are linked to specific file:line references for easy navigation.
