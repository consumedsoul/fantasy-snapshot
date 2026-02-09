# fantasy-snapshot

🏈 **Automated Yahoo Fantasy Football weekly snapshot generator**

Pulls your league standings, top performers, waiver pickups, and more — then emails you a comprehensive weekly report.

## Features

- **League Standings** with playoff clinch indicators
- **Top 3 Highest Scoring Teams** for the week
- **Biggest Blowouts** and "bad beat" of the week
- **Most Points Left on the Bench** analysis
- **Top Waiver Pickups** that were actually started
- **Position Leaders** (QB, RB, WR, TE, K, DEF) with ownership info
- **Multi-league support** - tracks all your leagues automatically

## Tech Stack

- **Runtime:** Google Apps Script (V8)
- **API:** Yahoo Fantasy Sports API v2 (OAuth2)
- **Data Persistence:** Supabase (planned for future)
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

```
==== My Fantasy League (nfl.l.12345) ====

LEAGUE STANDINGS
1. Team Alpha (John) (8-3-0) PF: 1245 PA: 1102
2. Team Beta* (Jane) (7-4-0) PF: 1198 PA: 1156
...

WEEK 11 HIGHLIGHTS

Top 3 Highest Scoring Teams
1. Team Alpha (John) – 156.3 pts
2. Team Gamma (Bob) – 142.8 pts
3. Team Delta (Alice) – 138.5 pts

Top Waiver Pickups (Week 11)
1. Jayden Reed - 22.4 pts (Team Alpha, added Tue)
...
```

## Documentation

- **[CLAUDE.md](CLAUDE.md)** - Comprehensive technical documentation for developers and AI agents
- **[Audit History](docs/audits/)** - Weekly code audits and improvement tracking

## Project Status

**Current Version:** v1.0 (Initial release)
**Code Health:** ⚠️ Fair - Core functionality works, production hardening in progress
**Active Development:** Yes

### Recent Audit Findings (2026-02-09)
- 🔴 2 Critical issues identified
- 🟠 8 High priority improvements needed
- See [latest audit](docs/audits/2026-02-09-audit.md) for details

## Contributing

This is a personal project, but suggestions and bug reports are welcome via GitHub Issues.

## License

MIT License - See [LICENSE](LICENSE) for details

## Acknowledgments

- Yahoo Fantasy Sports API for providing the data
- Google Apps Script for the serverless runtime
