# fantasy-snapshot

Automated Yahoo Fantasy Football weekly snapshot generator built on Google Apps Script.

Pulls your league standings, top performers, waiver pickups, power rankings, and more — then emails you a comprehensive weekly HTML report. Optionally persists data to Supabase for season-long trend tracking.

## Features

- **League Standings** with W-L-T record, points for/against, and playoff clinch indicators
- **Weekly Power Rankings** — 3-week rolling average with up/down/stable trend arrows
- **Top 3 Highest Scoring Teams** for the week
- **Biggest Blowouts** and "Bad Beat of the Week" callout
- **Most Points Left on the Bench** analysis
- **Top Waiver Pickups** — best recent adds that were actually started
- **Position Leaders** (QB, RB, WR, TE, K, DEF) with ownership info
- **Matchup Projections** — projected scores, spread, and confidence % for upcoming week
- **Season-Long Trends** — scoring trend, consistency rating, and luck factor (optional, requires Supabase with 3+ weeks of data)
- **Multi-league support** — tracks all your Yahoo leagues automatically

## Tech Stack

- **Runtime:** Google Apps Script (V8)
- **API:** Yahoo Fantasy Sports API v2 (OAuth2)
- **Data Persistence:** Supabase (optional — enables season-long trends and historical data)
- **Delivery:** Email via `MailApp`

## Quick Start

### Prerequisites

- A Google account with access to [Google Apps Script](https://script.google.com)
- A Yahoo Fantasy Sports account with at least one NFL league
- A Yahoo Developer app (free) for OAuth credentials
- (Optional) A Supabase project for season-long data persistence

### 1. Create the Apps Script Project

1. Go to [script.google.com](https://script.google.com) and create a new project
2. Replace the default `Code.gs` content with the contents of `Code.gs` from this repo
3. Save the project

### 2. Set Script Properties

In the Apps Script IDE: **Project Settings → Script Properties**, add:

| Property | Required | Purpose |
|---|---|---|
| `YAHOO_CLIENT_ID` | Yes | Yahoo OAuth app client ID |
| `YAHOO_CLIENT_SECRET` | Yes | Yahoo OAuth app client secret |
| `YAHOO_REDIRECT_URI` | Yes | Apps Script Web App URL (set after deploying) |
| `YAHOO_LEAGUE_KEY` | Yes | Default league key (e.g. `423.l.12345`) |
| `RECIPIENT_EMAIL` | Yes | Email address to send snapshots to |
| `SUPABASE_URL` | No | Supabase project URL (enables season trends) |
| `SUPABASE_ANON_KEY` | No | Supabase anon key (enables season trends) |

The following are written automatically by the auth flow:
- `YAHOO_ACCESS_TOKEN`, `YAHOO_REFRESH_TOKEN`, `YAHOO_EXPIRES_IN`, `YAHOO_TOKEN_CREATED_AT`

### 3. Deploy as Web App

1. **Deploy → New Deployment → Web App**
2. Execute as: **Me**
3. Access: **Anyone**
4. Copy the Web App URL → paste it into the `YAHOO_REDIRECT_URI` script property

### 4. Authorize Yahoo

1. Run `startYahooAuth()` in the IDE (Run menu)
2. Copy the URL from the logs
3. Open it in a browser and complete the Yahoo OAuth flow
4. You will be redirected to your Web App URL — it will show "Yahoo authorization successful"

### 5. Test

Run `pullFantasyData()` manually in the IDE to verify the email is sent correctly.

Use `debugSnapshotToLog()` to preview the snapshot output without sending an email.

### 6. Set Up a Trigger

1. **Triggers → Add Trigger**
2. Function: `pullFantasyData`
3. Event source: **Time-driven**
4. Type: **Week timer** → Monday, 9 AM (or whenever you want it)

## Email Output

The weekly email is delivered as a styled HTML email with a plain text fallback. It includes:

- **League Standings** — color-coded table with rank, record, PF/PA, and playoff clinch star
- **Season Trends** — scoring trend (rising/stable/falling), consistency (std deviation), luck factor — shown when Supabase has 3+ weeks of data
- **Power Rankings** — 3-week rolling average with green/red trend arrows and rank change delta
- **Top 3 Highest Scoring Teams** — ranked by weekly points
- **Biggest Blowouts** — top 3 matchups by winning margin
- **Bad Beat of the Week** — closest loss highlighted in a yellow callout box
- **Most Points Left on Bench** — team with the highest bench total, highlighted in red
- **Top Waiver Pickups** — best recently added players that were actually started
- **Position Leaders** — top 3 per position (QB, RB, WR, TE, K, DEF) with ownership
- **Matchup Projections** — projected scores, spread, and color-coded confidence % for the upcoming week

## Supabase Setup (Optional)

To enable season-long trends, create a Supabase project and run:

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

ALTER TABLE weekly_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anon insert" ON weekly_snapshots
  FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "Allow anon select" ON weekly_snapshots
  FOR SELECT TO anon USING (true);
```

Then set `SUPABASE_URL` and `SUPABASE_ANON_KEY` in Script Properties. Season trends appear automatically after 3+ weeks of data.

## Deployment Checklist

- [ ] Create Apps Script project and paste `Code.gs`
- [ ] Set required Script Properties (Yahoo credentials, league key, recipient email)
- [ ] Deploy as Web App (Execute as: Me, Access: Anyone)
- [ ] Copy Web App URL to `YAHOO_REDIRECT_URI`
- [ ] Run `startYahooAuth()` and complete OAuth flow in browser
- [ ] Test `pullFantasyData()` manually
- [ ] Set up weekly time-driven trigger (Monday 9 AM recommended)
- [ ] (Optional) Set up Supabase and add credentials for season trends

## Development Workflow

After any code changes:
1. Commit and push to git
2. `clasp push` to deploy to Google Apps Script

Both destinations must stay in sync. See [CLAUDE.md](CLAUDE.md) for full technical documentation.

To use `clasp` locally:
1. `npm install -g @google/clasp`
2. `clasp login`
3. Copy `.clasp.json.example` to `.clasp.json` and set `scriptId`
4. `clasp push` to deploy

## Getting Your Yahoo League Key

Your league key is visible in the URL when browsing your league on Yahoo Fantasy Sports:
`https://football.fantasysports.yahoo.com/f1/LEAGUEID` → league key format is `{game_code}.l.{league_id}` (e.g., `423.l.12345`)

You can also run `debugAllLeaguesRaw()` in the IDE to see all league keys for your account.

## Documentation

- **[CLAUDE.md](CLAUDE.md)** — Comprehensive technical documentation for developers and AI agents
- **[Audit History](docs/audits/)** — Weekly code audits and improvement tracking

## Project Status

**Current Version:** v1.6
**Code Health:** Excellent (91/100)
**Active Development:** Yes

### Recent Audit Findings (2026-04-22)
- 🔴 0 Critical issues
- 🟠 2 High priority items (Season Trends data-ordering lag; working tree has uncommitted fix pass)
- 🟡 3 Medium priority items
- ⚪ 3 Low priority items
- See [latest audit](docs/audits/2026-04-22-audit.md) for details

## Contributing

This is a personal project, but suggestions and bug reports are welcome via GitHub Issues.

## License

MIT License
