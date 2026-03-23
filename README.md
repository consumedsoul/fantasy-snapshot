# fantasy-snapshot

🏈 **Automated Yahoo Fantasy Football weekly snapshot generator**

Pulls your league standings, top performers, waiver pickups, and more — then emails you a comprehensive weekly report.

## Features

- **League Standings** with playoff clinch indicators
- **Weekly Power Rankings** — 3-week rolling average with trend arrows
- **Top 3 Highest Scoring Teams** for the week
- **Biggest Blowouts** and "bad beat" of the week
- **Most Points Left on the Bench** analysis
- **Top Waiver Pickups** that were actually started
- **Position Leaders** (QB, RB, WR, TE, K, DEF) with ownership info
- **Matchup Projections** — projected scores, spread, and confidence %
- **Season-Long Trends** — scoring trends, consistency, and luck factor (requires Supabase)
- **Multi-league support** - tracks all your leagues automatically

## Tech Stack

- **Runtime:** Google Apps Script (V8)
- **API:** Yahoo Fantasy Sports API v2 (OAuth2)
- **Data Persistence:** Supabase (optional — enables season-long trends)
- **Delivery:** Email via MailApp

## Quick Start

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/fantasy-snapshot.git
   cd fantasy-snapshot
   ```

2. **Follow setup instructions** in [CLAUDE.md](CLAUDE.md)

3. **Set up OAuth** with Yahoo Fantasy Sports

4. **Deploy and schedule** weekly snapshots

## Example Output

The weekly email is delivered as a styled HTML email with:
- **League Standings** — color-coded table with rank, record, PF/PA, and playoff clinch indicators
- **Season Trends** — scoring trend, consistency, luck factor (when Supabase has 3+ weeks of data)
- **Power Rankings** — 3-week rolling average with green/red trend arrows and rank change
- **Top 3 Highest Scoring Teams** — ranked by weekly points
- **Biggest Blowouts** — winner/loser scores and margin
- **Bad Beat of the Week** — closest loss highlighted in a yellow callout
- **Most Points Left on Bench** — highlighted in a red callout
- **Top Waiver Pickups** — best recent adds that were started
- **Position Leaders** — top 3 per position (QB, RB, WR, TE, K, DEF) with ownership
- **Matchup Projections** — projected scores, spread, and color-coded confidence %

A plain text fallback is included for email clients that don't support HTML.

## Documentation

- **[CLAUDE.md](CLAUDE.md)** - Comprehensive technical documentation for developers and AI agents
- **[Audit History](docs/audits/)** - Weekly code audits and improvement tracking

## Project Status

**Current Version:** v1.4
**Code Health:** ✅ Very Good (85/100) - Production-ready with power rankings, matchup projections, and optional Supabase persistence
**Active Development:** Yes

### Recent Audit Findings (2026-02-19)
- 🔴 0 Critical issues
- 🟠 0 High priority items
- 🟡 4 Medium priority items remaining
- See [latest audit](docs/audits/2026-02-19-audit.md) for details

## Contributing

This is a personal project, but suggestions and bug reports are welcome via GitHub Issues.

## License

MIT License - See [LICENSE](LICENSE) for details

## Acknowledgments

- Yahoo Fantasy Sports API for providing the data
- Google Apps Script for the serverless runtime
