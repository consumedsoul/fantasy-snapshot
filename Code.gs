function getConfig_() {
  var props = PropertiesService.getScriptProperties();
  return {
    yahooClientId: props.getProperty('YAHOO_CLIENT_ID'),
    yahooClientSecret: props.getProperty('YAHOO_CLIENT_SECRET'),
    supabaseUrl: props.getProperty('SUPABASE_URL'),
    supabaseAnonKey: props.getProperty('SUPABASE_ANON_KEY'),
    recipientEmail: props.getProperty('RECIPIENT_EMAIL')
  };
}

function getRecipientEmail_() {
  var email = PropertiesService.getScriptProperties().getProperty('RECIPIENT_EMAIL');
  if (!email) {
    throw new Error('[getRecipientEmail_] Missing RECIPIENT_EMAIL script property.');
  }
  return email;
}

// Supabase integration for season-long trend tracking.
// Used by persistWeeklySnapshot_() and getSeasonTrends_().
// Requires SUPABASE_URL and SUPABASE_ANON_KEY script properties.
function supabaseRequest_(path, method, payload) {
  var cfg = getConfig_();
  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
    throw new Error('[supabaseRequest_] Supabase configuration missing. Check SUPABASE_URL and SUPABASE_ANON_KEY script properties.');
  }

  var url = cfg.supabaseUrl.replace(/\/$/, '') + path;
  var options = {
    method: method || 'get',
    headers: {
      'apikey': cfg.supabaseAnonKey,
      'Authorization': 'Bearer ' + cfg.supabaseAnonKey,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    },
    muteHttpExceptions: true
  };

  if (payload !== undefined && payload !== null) {
    options.payload = JSON.stringify(payload);
  }

  var response = retryWithBackoff_(function() {
    return UrlFetchApp.fetch(url, options);
  });

  var status = response.getResponseCode();
  var body = response.getContentText();

  if (status < 200 || status >= 300) {
    throw new Error('[supabaseRequest_] HTTP ' + status + ': ' + body);
  }

  return body ? JSON.parse(body) : null;
}

/**
 * Checks if Supabase credentials are configured in Script Properties.
 * @returns {boolean}
 */
function isSupabaseConfigured_() {
  var cfg = getConfig_();
  return !!(cfg.supabaseUrl && cfg.supabaseAnonKey);
}

/**
 * Persists weekly snapshot data to Supabase for season-long trend tracking.
 * Uses upsert (ON CONFLICT DO UPDATE) for idempotency on re-runs.
 *
 * @param {string} leagueKey - The league key
 * @param {number} completedWeek - The completed week number
 * @param {Array<Object>} standings - Standings rows from getLeagueStandings_()
 * @param {Object} [weeklyScoreMap] - Map of team_name -> weekly_score
 */
function persistWeeklySnapshot_(leagueKey, completedWeek, standings, weeklyScoreMap) {
  if (!isSupabaseConfigured_()) {
    return;
  }

  validateWeek_(completedWeek, 'persistWeeklySnapshot_');

  if (!standings || !standings.length) {
    Logger.log('[persistWeeklySnapshot_] No standings data to persist.');
    return;
  }

  weeklyScoreMap = weeklyScoreMap || {};

  var rows = standings.map(function (s) {
    return {
      league_id: leagueKey,
      team_id: s.team_id,
      team_name: s.team_name,
      manager_name: s.manager_name || '',
      week: completedWeek,
      rank: s.rank,
      wins: s.wins,
      losses: s.losses,
      ties: s.ties,
      points_for: s.points_for,
      points_against: s.points_against,
      weekly_score: weeklyScoreMap[s.team_name] || null,
      snapshot_at: new Date().toISOString()
    };
  });

  try {
    var cfg = getConfig_();
    var url = cfg.supabaseUrl.replace(/\/$/, '') + '/rest/v1/weekly_snapshots';
    var options = {
      method: 'post',
      headers: {
        'apikey': cfg.supabaseAnonKey,
        'Authorization': 'Bearer ' + cfg.supabaseAnonKey,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates,return=representation'
      },
      payload: JSON.stringify(rows),
      muteHttpExceptions: true
    };

    var response = retryWithBackoff_(function () {
      return UrlFetchApp.fetch(url, options);
    });

    var status = response.getResponseCode();
    if (status < 200 || status >= 300) {
      Logger.log('[persistWeeklySnapshot_] Supabase upsert failed: HTTP ' + status + ': ' + response.getContentText());
    } else {
      Logger.log('[persistWeeklySnapshot_] Persisted ' + rows.length + ' rows for ' + leagueKey + ' week ' + completedWeek);
    }
  } catch (err) {
    Logger.log('[persistWeeklySnapshot_] Error: ' + err.message);
  }
}

/**
 * Fetches all weekly snapshots for a league from Supabase and calculates trends.
 * Requires 3+ weeks of data. Returns null if Supabase not configured or insufficient data.
 *
 * @param {string} leagueKey - The league key
 * @returns {Array<{team_name: string, scoring_trend: string, avg_weekly_score: number,
 *   std_dev: number, consistency_rating: string, expected_wins: number,
 *   actual_wins: number, luck_factor: number}>|null}
 */
function getSeasonTrends_(leagueKey) {
  if (!isSupabaseConfigured_()) {
    return null;
  }

  leagueKey = leagueKey || getLeagueKey_();

  try {
    var data = supabaseRequest_(
      '/rest/v1/weekly_snapshots?league_id=eq.' + encodeURIComponent(leagueKey) + '&order=week.asc',
      'get'
    );

    if (!data || !data.length) {
      return null;
    }

    // Need at least 3 weeks of data for meaningful trends
    var weeks = {};
    data.forEach(function (row) { weeks[row.week] = true; });
    if (Object.keys(weeks).length < 3) {
      return null;
    }

    // Group by team
    var teamData = {};
    data.forEach(function (row) {
      if (!teamData[row.team_name]) {
        teamData[row.team_name] = {
          team_name: row.team_name,
          manager_name: row.manager_name || '',
          scores: [],
          wins: 0,
          losses: 0
        };
      }
      if (row.weekly_score !== null && row.weekly_score !== undefined) {
        teamData[row.team_name].scores.push(Number(row.weekly_score));
      }
      teamData[row.team_name].wins = row.wins || 0;
      teamData[row.team_name].losses = row.losses || 0;
    });

    // Calculate league median for luck factor
    var allScores = [];
    data.forEach(function (row) {
      if (row.weekly_score !== null) {
        allScores.push(Number(row.weekly_score));
      }
    });
    var leagueMedian = 0;
    if (allScores.length) {
      allScores.sort(function (a, b) { return a - b; });
      var mid = Math.floor(allScores.length / 2);
      leagueMedian = allScores.length % 2 !== 0 ? allScores[mid] : (allScores[mid - 1] + allScores[mid]) / 2;
    }

    // Calculate trends per team
    var trends = [];
    Object.keys(teamData).forEach(function (teamName) {
      var td = teamData[teamName];
      if (td.scores.length < 2) {
        return;
      }

      var sum = 0;
      td.scores.forEach(function (s) { sum += s; });
      var avg = sum / td.scores.length;

      var sqDiffSum = 0;
      td.scores.forEach(function (s) { sqDiffSum += Math.pow(s - avg, 2); });
      var stdDev = Math.sqrt(sqDiffSum / td.scores.length);

      // Scoring trend: compare second half to first half
      var halfIdx = Math.floor(td.scores.length / 2);
      var firstHalf = td.scores.slice(0, halfIdx);
      var secondHalf = td.scores.slice(halfIdx);
      var firstAvg = 0, secondAvg = 0;
      firstHalf.forEach(function (s) { firstAvg += s; });
      firstAvg = firstHalf.length ? firstAvg / firstHalf.length : 0;
      secondHalf.forEach(function (s) { secondAvg += s; });
      secondAvg = secondHalf.length ? secondAvg / secondHalf.length : 0;

      var trendDiff = secondAvg - firstAvg;
      var scoringTrend = Math.abs(trendDiff) < 5 ? 'stable' : (trendDiff > 0 ? 'rising' : 'falling');

      // Expected wins: weeks where score > league median
      var expectedWins = 0;
      td.scores.forEach(function (s) {
        if (s > leagueMedian) { expectedWins++; }
      });

      var luckFactor = td.wins - expectedWins;
      var consistencyRating = stdDev < 12 ? 'High' : (stdDev < 20 ? 'Medium' : 'Low');

      trends.push({
        team_name: td.team_name,
        manager_name: td.manager_name,
        scoring_trend: scoringTrend,
        avg_weekly_score: avg,
        std_dev: stdDev,
        consistency_rating: consistencyRating,
        expected_wins: expectedWins,
        actual_wins: td.wins,
        luck_factor: luckFactor
      });
    });

    trends.sort(function (a, b) { return b.avg_weekly_score - a.avg_weekly_score; });
    return trends;

  } catch (err) {
    Logger.log('[getSeasonTrends_] Error: ' + err.message);
    return null;
  }
}

function getLeagueKey_() {
  var key = PropertiesService.getScriptProperties().getProperty('YAHOO_LEAGUE_KEY');
  if (!key) {
    throw new Error('[getLeagueKey_] Missing YAHOO_LEAGUE_KEY script property.');
  }
  return key;
}

/**
 * Fetches all NFL fantasy leagues for the authenticated Yahoo user.
 *
 * Yahoo API response shape:
 *   { fantasy_content: { users: { "0": { user: [
 *       {...userMeta},
 *       { games: { count: N, "0": { game: [
 *           [{...gameMeta}],
 *           { leagues: { count: N, "0": { league: [
 *               [{league_key: "...", name: "..."}, ...]
 *           ]} }}
 *       ]} }}
 *   ] } } } }
 *
 * @returns {Array<{league_key: string, name: string}>}
 */
function getAllLeagues_() {
  var data = yahooApiRequest_('/users;use_login=1/games;game_keys=nfl/leagues', {});
  var fantasyContent = data && data.fantasy_content;
  var users = fantasyContent && fantasyContent.users;
  if (!users || !users['0'] || !users['0'].user) {
    throw new Error('Unexpected users/games/leagues response structure from Yahoo.');
  }

  var userArr = users['0'].user;
  var gamesContainer = userArr[1] && userArr[1].games;
  if (!gamesContainer || typeof gamesContainer.count === 'undefined') {
    throw new Error('Unexpected games container in users/games/leagues response.');
  }

  var gameCount = gamesContainer.count;
  var leagues = [];

  for (var i = 0; i < gameCount; i++) {
    var gameWrapper = gamesContainer[String(i)];
    if (!gameWrapper || !gameWrapper.game) {
      continue;
    }

    var game = gameWrapper.game;
    var leaguesContainer = null;

    for (var gIdx = 0; gIdx < game.length; gIdx++) {
      var gEntry = game[gIdx];
      if (gEntry && gEntry.leagues) {
        leaguesContainer = gEntry.leagues;
        break;
      }
    }

    if (!leaguesContainer || typeof leaguesContainer.count === 'undefined') {
      continue;
    }

    var leagueCount = leaguesContainer.count;
    for (var j = 0; j < leagueCount; j++) {
      var lWrapper = leaguesContainer[String(j)];
      if (!lWrapper || !lWrapper.league) {
        continue;
      }

      var leagueArr = lWrapper.league;
      var meta = flattenYahooMeta_(leagueArr[0]);

      if (meta.league_key && meta.name) {
        leagues.push({
          league_key: String(meta.league_key),
          name: String(meta.name)
        });
      }
    }
  }

  return leagues;
}

/**
 * Debug helper: logs raw Yahoo API response for all leagues
 *
 * Use this to inspect the full API response structure when debugging
 * parsing issues.
 *
 * @public
 */
function debugAllLeaguesRaw() {
  var data = yahooApiRequest_('/users;use_login=1/games;game_keys=nfl/leagues', {});
  Logger.log(JSON.stringify(data, null, 2));
}

/**
 * Fetches league standings with W-L-T record, points for/against, and playoff clinch status.
 *
 * Yahoo API response shape:
 *   { fantasy_content: { league: [
 *       {...leagueMeta},
 *       { standings: [{ teams: { count: N, "0": { team: [
 *           [{name: "...", team_id: "...", managers: [...], clinched_playoffs: 1}, ...],
 *           { team_points: { total: "123.4" } },
 *           { team_standings: { rank: "1", outcome_totals: {wins:"8",losses:"3",ties:"0"},
 *             points_for: "1245.6", points_against: "1102.3" } }
 *       ]} } }] }
 *   ] } }
 *
 * @param {string} [leagueKey] - League key (defaults to YAHOO_LEAGUE_KEY property)
 * @returns {Array<Object>} Sorted standings rows
 */
function getLeagueStandings_(leagueKey) {
  leagueKey = leagueKey || getLeagueKey_();
  var data = yahooApiRequest_('/league/' + leagueKey + '/standings', {});

  var fantasyContent = data && data.fantasy_content;
  var leagueArr = fantasyContent && fantasyContent.league;
  if (!leagueArr || !leagueArr[1] || !leagueArr[1].standings) {
    throw new Error('Unexpected standings response structure from Yahoo.');
  }

  var teamsContainer = leagueArr[1].standings[0].teams;
  var teamCount = teamsContainer.count;
  var rows = [];

  for (var i = 0; i < teamCount; i++) {
    var teamWrapper = teamsContainer[String(i)];
    if (!teamWrapper || !teamWrapper.team) {
      continue;
    }

    var team = teamWrapper.team;
    var meta = flattenYahooMeta_(team[0]);

    var teamId = meta.team_id;
    var teamName = meta.name;

    var managerName = '';
    if (meta.managers && meta.managers[0]) {
      var m = meta.managers[0].manager || meta.managers[0];
      managerName = m.nickname || m.manager_nickname || '';
    }

    var teamPoints = team[1] && team[1].team_points;
    var standings = team[2] && team[2].team_standings;
    var outcomes = standings && standings.outcome_totals ? standings.outcome_totals : {};
    var rank = standings && standings.rank ? parseInt(standings.rank, 10) : (i + 1);
    var clinchedMeta = meta.clinched_playoffs;
    var clinched = (clinchedMeta === 1 || clinchedMeta === '1' || clinchedMeta === true);

    rows.push({
      league_id: leagueKey,
      team_id: String(teamId),
      team_name: String(teamName),
      manager_name: managerName,
      rank: rank,
      clinched_playoffs: clinched,
      wins: parseInt(outcomes.wins || '0', 10),
      losses: parseInt(outcomes.losses || '0', 10),
      ties: parseInt(outcomes.ties || '0', 10),
      points_for: (standings && standings.points_for) ? Number(standings.points_for) : (teamPoints && teamPoints.total ? Number(teamPoints.total) : null),
      points_against: (standings && standings.points_against != null) ? Number(standings.points_against) : null,
      snapshot_at: new Date().toISOString()
    });
  }

  if (rows.length === 0) {
    Logger.log('No standings rows parsed from Yahoo response.');
    return [];
  }

  rows.sort(function (a, b) { return a.rank - b.rank; });

  return rows;
}

function getCurrentWeek_(leagueKey) {
  leagueKey = leagueKey || getLeagueKey_();
  var data = yahooApiRequest_('/league/' + leagueKey, {});
  var fantasyContent = data && data.fantasy_content;
  var leagueArr = fantasyContent && fantasyContent.league;
  if (!leagueArr || !leagueArr[0]) {
    throw new Error('Unable to determine current week from league resource.');
  }

  var meta = leagueArr[0];
  return parseInt(meta.current_week || meta.matchup_week, 10);
}

/**
 * Fetches the scoreboard for a given week and returns matchups sorted by margin (closest first).
 *
 * Yahoo API response shape:
 *   { fantasy_content: { league: [
 *       {...leagueMeta},
 *       { scoreboard: [{ matchups: { count: N, "0": { matchup: [
 *           { teams: { "0": { team: [
 *               [{name: "...", managers: [...]}, ...],
 *               { team_projected_points: { total: "120.5" }, team_points: { total: "118.2" } }
 *           ]}, "1": {...} } }
 *       ]} } }] }
 *   ] } }
 *
 * @param {number} week - NFL week number (1-18)
 * @returns {Array<Object>} Matchups sorted by margin ascending
 */
function getWeekMatchups_(week, leagueKey) {
  validateWeek_(week, 'getWeekMatchups_');
  leagueKey = leagueKey || getLeagueKey_();
  var data = yahooApiRequest_('/league/' + leagueKey + '/scoreboard;week=' + week, {});
  var fantasyContent = data && data.fantasy_content;
  var leagueArr = fantasyContent && fantasyContent.league;
  if (!leagueArr || !leagueArr[1] || !leagueArr[1].scoreboard) {
    throw new Error('Unexpected scoreboard response structure from Yahoo.');
  }

  var scoreboard = leagueArr[1].scoreboard[0];
  var matchupsContainer = scoreboard.matchups;
  var matchupCount = matchupsContainer.count;
  var results = [];

  for (var i = 0; i < matchupCount; i++) {
    var mWrapper = matchupsContainer[String(i)];
    if (!mWrapper || !mWrapper.matchup || !mWrapper.matchup[0]) {
      continue;
    }

    var matchup = mWrapper.matchup[0];
    var teamsContainer = matchup.teams;
    if (!teamsContainer) {
      continue;
    }

    var teamAWrapper = teamsContainer['0'];
    var teamBWrapper = teamsContainer['1'];
    if (!teamAWrapper || !teamBWrapper) {
      continue;
    }

    var a = parseTeamMeta_(teamAWrapper, 'team_projected_points');
    var b = parseTeamMeta_(teamBWrapper, 'team_projected_points');

    if (!a.team_name || !b.team_name) {
      continue;
    }

    var favored, underdog;
    if (a.points >= b.points) {
      favored = a;
      underdog = b;
    } else {
      favored = b;
      underdog = a;
    }

    var totalPoints = favored.points + underdog.points;
    var favoredPct = totalPoints > 0 ? Math.round((favored.points / totalPoints) * 100) : 50;
    var margin = Math.abs(favored.points - underdog.points);

    results.push({
      week: week,
      favored: favored,
      underdog: underdog,
      favored_percent: favoredPct,
      margin: margin
    });
  }

  results.sort(function (a, b) {
    if (a.margin === b.margin) {
      return b.favored_percent - a.favored_percent;
    }
    return a.margin - b.margin;
  });

  return results;
}

function getWeekTeamHighlights_(week, leagueKey) {
  validateWeek_(week, 'getWeekTeamHighlights_');
  leagueKey = leagueKey || getLeagueKey_();
  var data = yahooApiRequest_('/league/' + leagueKey + '/scoreboard;week=' + week, {});
  var fantasyContent = data && data.fantasy_content;
  var leagueArr = fantasyContent && fantasyContent.league;
  if (!leagueArr || !leagueArr[1] || !leagueArr[1].scoreboard) {
    throw new Error('Unexpected scoreboard response structure from Yahoo.');
  }

  var scoreboard = leagueArr[1].scoreboard[0];
  var matchupsContainer = scoreboard.matchups;
  var matchupCount = matchupsContainer.count;

  var teams = [];
  var blowouts = [];
  var badBeat = null;

  for (var i = 0; i < matchupCount; i++) {
    var mWrapper = matchupsContainer[String(i)];
    if (!mWrapper || !mWrapper.matchup || !mWrapper.matchup[0]) {
      continue;
    }

    var matchup = mWrapper.matchup[0];
    var teamsContainer = matchup.teams;
    if (!teamsContainer) {
      continue;
    }

    var teamAWrapper = teamsContainer['0'];
    var teamBWrapper = teamsContainer['1'];
    if (!teamAWrapper || !teamBWrapper) {
      continue;
    }

    var a = parseTeamMeta_(teamAWrapper);
    var b = parseTeamMeta_(teamBWrapper);

    teams.push(a);
    teams.push(b);

    var winner, loser;
    if (a.points >= b.points) {
      winner = a;
      loser = b;
    } else {
      winner = b;
      loser = a;
    }

    var margin = Math.abs(winner.points - loser.points);
    blowouts.push({
      winner: winner,
      loser: loser,
      margin: margin
    });

    if (!badBeat || margin < badBeat.margin) {
      badBeat = {
        winner: winner,
        loser: loser,
        margin: margin
      };
    }
  }

  teams.sort(function (x, y) { return y.points - x.points; });
  blowouts.sort(function (x, y) { return y.margin - x.margin; });

  return {
    topTeams: teams.slice(0, 3),
    blowouts: blowouts.slice(0, 3),
    badBeat: badBeat
  };
}

/**
 * Fetches all team scores for a given week from the scoreboard.
 *
 * @param {number} week - NFL week number (1-18)
 * @param {string} [leagueKey] - League key (defaults to YAHOO_LEAGUE_KEY property)
 * @returns {Array<{team_name: string, manager_name: string, points: number}>}
 */
function getWeekTeamScores_(week, leagueKey) {
  validateWeek_(week, 'getWeekTeamScores_');
  leagueKey = leagueKey || getLeagueKey_();
  var data = yahooApiRequest_('/league/' + leagueKey + '/scoreboard;week=' + week, {});
  var fantasyContent = data && data.fantasy_content;
  var leagueArr = fantasyContent && fantasyContent.league;
  if (!leagueArr || !leagueArr[1] || !leagueArr[1].scoreboard) {
    throw new Error('[getWeekTeamScores_] Unexpected scoreboard response structure from Yahoo.');
  }

  var scoreboard = leagueArr[1].scoreboard[0];
  var matchupsContainer = scoreboard.matchups;
  var matchupCount = matchupsContainer.count;
  var teams = [];

  for (var i = 0; i < matchupCount; i++) {
    var mWrapper = matchupsContainer[String(i)];
    if (!mWrapper || !mWrapper.matchup || !mWrapper.matchup[0]) {
      continue;
    }

    var matchup = mWrapper.matchup[0];
    var teamsContainer = matchup.teams;
    if (!teamsContainer) {
      continue;
    }

    var teamAWrapper = teamsContainer['0'];
    var teamBWrapper = teamsContainer['1'];
    if (teamAWrapper) {
      teams.push(parseTeamMeta_(teamAWrapper));
    }
    if (teamBWrapper) {
      teams.push(parseTeamMeta_(teamBWrapper));
    }
  }

  teams.sort(function (a, b) { return b.points - a.points; });
  return teams;
}

/**
 * Calculates power rankings based on rolling 3-week average points scored.
 *
 * @param {number} completedWeek - The most recently completed week
 * @param {string} [leagueKey] - League key
 * @returns {Array<{team_name: string, manager_name: string, avg_points: number,
 *   this_week_points: number, current_rank: number, prev_rank: number|null, trend: string}>}
 */
function getWeeklyPowerRankings_(completedWeek, leagueKey) {
  validateWeek_(completedWeek, 'getWeeklyPowerRankings_');
  leagueKey = leagueKey || getLeagueKey_();

  var POWER_RANKING_WINDOW = 3;
  var startWeek = Math.max(MIN_WEEK, completedWeek - POWER_RANKING_WINDOW + 1);
  var weeksToFetch = [];
  for (var w = startWeek; w <= completedWeek; w++) {
    weeksToFetch.push(w);
  }

  // Fetch scores for each week in the window
  var scoresByTeam = {};

  for (var i = 0; i < weeksToFetch.length; i++) {
    var weekScores = getWeekTeamScores_(weeksToFetch[i], leagueKey);
    if (i < weeksToFetch.length - 1) {
      Utilities.sleep(RATE_LIMIT_DELAY_MS);
    }

    weekScores.forEach(function (t) {
      if (!scoresByTeam[t.team_name]) {
        scoresByTeam[t.team_name] = { total: 0, count: 0, weeks: {}, manager_name: t.manager_name };
      }
      scoresByTeam[t.team_name].total += t.points;
      scoresByTeam[t.team_name].count += 1;
      scoresByTeam[t.team_name].weeks[weeksToFetch[i]] = t.points;
    });
  }

  // Calculate averages and current ranking
  var rankings = [];
  Object.keys(scoresByTeam).forEach(function (teamName) {
    var d = scoresByTeam[teamName];
    rankings.push({
      team_name: teamName,
      manager_name: d.manager_name,
      avg_points: d.count > 0 ? d.total / d.count : 0,
      this_week_points: d.weeks[completedWeek] || 0,
      current_rank: 0,
      prev_rank: null,
      trend: 'stable'
    });
  });

  rankings.sort(function (a, b) { return b.avg_points - a.avg_points; });
  rankings.forEach(function (r, idx) { r.current_rank = idx + 1; });

  // Calculate previous week's ranking for trend comparison
  if (completedWeek >= 2) {
    var prevStartWeek = Math.max(MIN_WEEK, completedWeek - POWER_RANKING_WINDOW);
    var prevEndWeek = completedWeek - 1;
    var prevRankings = [];
    Object.keys(scoresByTeam).forEach(function (teamName) {
      var d = scoresByTeam[teamName];
      var prevTotal = 0;
      var prevCount = 0;
      for (var pw = prevStartWeek; pw <= prevEndWeek; pw++) {
        if (d.weeks[pw] !== undefined) {
          prevTotal += d.weeks[pw];
          prevCount++;
        }
      }
      if (prevCount > 0) {
        prevRankings.push({ team_name: teamName, avg_points: prevTotal / prevCount });
      }
    });

    prevRankings.sort(function (a, b) { return b.avg_points - a.avg_points; });
    var prevRankMap = {};
    prevRankings.forEach(function (r, idx) { prevRankMap[r.team_name] = idx + 1; });

    rankings.forEach(function (r) {
      if (prevRankMap[r.team_name]) {
        r.prev_rank = prevRankMap[r.team_name];
        if (r.current_rank < r.prev_rank) {
          r.trend = 'up';
        } else if (r.current_rank > r.prev_rank) {
          r.trend = 'down';
        } else {
          r.trend = 'stable';
        }
      }
    });
  }

  return rankings;
}

function getWeekPointsMapForPlayerKeys_(week, playerKeys, leagueKey) {
  validateWeek_(week, 'getWeekPointsMapForPlayerKeys_');
  leagueKey = leagueKey || getLeagueKey_();
  var map = {};
  if (!playerKeys || !playerKeys.length) {
    return map;
  }

  var chunkSize = YAHOO_API_BATCH_SIZE;
  for (var i = 0; i < playerKeys.length; i += chunkSize) {
    var chunk = playerKeys.slice(i, i + chunkSize);
    var path = '/league/' + leagueKey + '/players;player_keys=' + chunk.join(',') + '/stats;type=week;week=' + week;
    var data = yahooApiRequest_(path, {});
    var fantasyContent = data && data.fantasy_content;
    var leagueArr = fantasyContent && fantasyContent.league;
    if (!leagueArr || !leagueArr[1] || !leagueArr[1].players) {
      continue;
    }

    // Add delay between batches to respect rate limits
    if (i + chunkSize < playerKeys.length) {
      Utilities.sleep(RATE_LIMIT_DELAY_MS);
    }

    var playersContainer = leagueArr[1].players;
    var playerCount = playersContainer.count;

    for (var j = 0; j < playerCount; j++) {
      var pWrapper = playersContainer[String(j)];
      if (!pWrapper || !pWrapper.player) {
        continue;
      }

      var p = pWrapper.player;
      var meta = flattenYahooMeta_(p[0]);
      var points = 0;

      for (var k = 1; k < p.length; k++) {
        var entry = p[k];
        if (entry && typeof entry === 'object' && entry.player_points && entry.player_points.total !== undefined) {
          points = Number(entry.player_points.total);
        }
      }

      var playerKey = meta.player_key;
      if (playerKey && !isNaN(points)) {
        map[playerKey] = points;
      }
    }
  }

  return map;
}

function getWeekBenchSummary_(week, leagueKey) {
  validateWeek_(week, 'getWeekBenchSummary_');
  leagueKey = leagueKey || getLeagueKey_();
  var data = yahooApiRequest_('/league/' + leagueKey + '/teams;week=' + week + ';out=roster', {});
  var fantasyContent = data && data.fantasy_content;
  var leagueArr = fantasyContent && fantasyContent.league;
  if (!leagueArr || !leagueArr[1] || !leagueArr[1].teams) {
    throw new Error('Unexpected teams/roster response structure from Yahoo for bench summary.');
  }

  var teamsContainer = leagueArr[1].teams;
  var teamCount = teamsContainer.count;

  var benchByTeam = [];
  var benchKeySet = {};

  for (var i = 0; i < teamCount; i++) {
    var tWrapper = teamsContainer[String(i)];
    if (!tWrapper || !tWrapper.team) {
      continue;
    }

    var team = tWrapper.team;
    var meta = flattenYahooMeta_(team[0]);

    var teamName = meta.name;
    if (!teamName) {
      continue;
    }

    var rosterWrapper = team[1] && team[1].roster;
    if (!rosterWrapper || !rosterWrapper['0'] || !rosterWrapper['0'].players) {
      continue;
    }

    var playersContainer = rosterWrapper['0'].players;
    var playerCount = playersContainer.count;
    var benchPlayers = [];

    for (var j = 0; j < playerCount; j++) {
      var pWrapper = playersContainer[String(j)];
      if (!pWrapper || !pWrapper.player) {
        continue;
      }

      var p = pWrapper.player;
      var pMeta = flattenYahooMeta_(p[0]);

      var playerKey = pMeta.player_key;
      var playerName = pMeta.name && pMeta.name.full ? pMeta.name.full : '';
      if (!playerKey || !playerName) {
        continue;
      }

      var slot = getPlayerSlot_(p);

      if (slot === 'BN') {
        benchPlayers.push({
          key: playerKey,
          name: playerName
        });
        benchKeySet[playerKey] = true;
      }
    }

    if (benchPlayers.length) {
      benchByTeam.push({
        team_name: teamName,
        bench: benchPlayers
      });
    }
  }

  var allBenchKeys = Object.keys(benchKeySet);
  if (!allBenchKeys.length) {
    return null;
  }

  var pointsMap = getWeekPointsMapForPlayerKeys_(week, allBenchKeys, leagueKey);

  var best = null;

  benchByTeam.forEach(function (t) {
    var total = 0;
    var benchWithPoints = [];

    t.bench.forEach(function (bp) {
      var pts = pointsMap[bp.key] || 0;
      if (pts <= 0) {
        return;
      }
      total += pts;
      benchWithPoints.push({
        name: bp.name,
        points: pts
      });
    });

    if (!benchWithPoints.length) {
      return;
    }

    benchWithPoints.sort(function (a, b) { return b.points - a.points; });

    if (!best || total > best.totalPoints) {
      best = {
        team_name: t.team_name,
        totalPoints: total,
        topBench: benchWithPoints
      };
    }
  });

  return best;
}

function getWeekStartedPlayerKeys_(week, leagueKey) {
  validateWeek_(week, 'getWeekStartedPlayerKeys_');
  leagueKey = leagueKey || getLeagueKey_();
  var data = yahooApiRequest_('/league/' + leagueKey + '/teams;week=' + week + ';out=roster', {});
  var fantasyContent = data && data.fantasy_content;
  var leagueArr = fantasyContent && fantasyContent.league;
  if (!leagueArr || !leagueArr[1] || !leagueArr[1].teams) {
    throw new Error('Unexpected teams/roster response structure from Yahoo for started players.');
  }

  var teamsContainer = leagueArr[1].teams;
  var teamCount = teamsContainer.count;
  var started = {};

  for (var i = 0; i < teamCount; i++) {
    var tWrapper = teamsContainer[String(i)];
    if (!tWrapper || !tWrapper.team) {
      continue;
    }

    var team = tWrapper.team;
    var rosterWrapper = team[1] && team[1].roster;
    if (!rosterWrapper || !rosterWrapper['0'] || !rosterWrapper['0'].players) {
      continue;
    }

    var playersContainer = rosterWrapper['0'].players;
    var playerCount = playersContainer.count;

    for (var j = 0; j < playerCount; j++) {
      var pWrapper = playersContainer[String(j)];
      if (!pWrapper || !pWrapper.player) {
        continue;
      }

      var p = pWrapper.player;
      var pMeta = flattenYahooMeta_(p[0]);

      var playerKey = pMeta.player_key;
      if (!playerKey) {
        continue;
      }

      var slot = getPlayerSlot_(p);

      if (slot && slot !== 'BN') {
        started[playerKey] = true;
      }
    }
  }

  return started;
}

function getTopPlayersForWeekAndPosition_(week, position, limit, ownerMap, leagueKey) {
  validateWeek_(week, 'getTopPlayersForWeekAndPosition_');
  leagueKey = leagueKey || getLeagueKey_();
  var playerKeys = Object.keys(ownerMap || {});
  if (!playerKeys.length) {
    return [];
  }

  var rows = [];
  var chunkSize = YAHOO_API_BATCH_SIZE;

  for (var i = 0; i < playerKeys.length; i += chunkSize) {
    var chunk = playerKeys.slice(i, i + chunkSize);
    var path = '/league/' + leagueKey + '/players;player_keys=' + chunk.join(',') + '/stats;type=week;week=' + week;
    var data = yahooApiRequest_(path, {});
    var fantasyContent = data && data.fantasy_content;
    var leagueArr = fantasyContent && fantasyContent.league;
    if (!leagueArr || !leagueArr[1] || !leagueArr[1].players) {
      continue;
    }

    var playersContainer = leagueArr[1].players;
    var playerCount = playersContainer.count;

    for (var j = 0; j < playerCount; j++) {
      var pWrapper = playersContainer[String(j)];
      if (!pWrapper || !pWrapper.player) {
        continue;
      }

      var p = pWrapper.player;
      var meta = flattenYahooMeta_(p[0]);
      var name = (meta.name && meta.name.full) ? meta.name.full : '';
      var displayPosition = meta.display_position || '';
      var points = 0;

      for (var k = 1; k < p.length; k++) {
        var entry = p[k];
        if (!entry || typeof entry !== 'object') {
          continue;
        }
        if (entry.name && entry.name.full && !name) {
          name = entry.name.full;
        }
        if (entry.display_position && !displayPosition) {
          displayPosition = entry.display_position;
        }
        if (entry.player_points && entry.player_points.total !== undefined) {
          points = Number(entry.player_points.total);
        }
      }

      var playerKey = meta.player_key;

      if (!playerKey || displayPosition !== position || !name || points === 0) {
        continue;
      }

      var ownerLabel = ownerMap[playerKey] || 'FA';

      rows.push({
        name: name,
        position: displayPosition,
        owner: ownerLabel,
        points: points
      });
    }

    // Add delay between batches to respect rate limits
    if (i + chunkSize < playerKeys.length) {
      Utilities.sleep(RATE_LIMIT_DELAY_MS);
    }
  }

  rows.sort(function (a, b) { return b.points - a.points; });
  return rows.slice(0, limit || 3);
}

function getPlayerOwnerMap_(leagueKey) {
  leagueKey = leagueKey || getLeagueKey_();

  // Check cache first
  var cache = CacheService.getScriptCache();
  var cacheKey = 'ownerMap_' + leagueKey;
  var cached = cache.get(cacheKey);

  if (cached) {
    Logger.log('[getPlayerOwnerMap_] Using cached owner map for ' + leagueKey);
    return JSON.parse(cached);
  }

  var data = yahooApiRequest_('/league/' + leagueKey + '/teams;out=roster', {});
  var fantasyContent = data && data.fantasy_content;
  var leagueArr = fantasyContent && fantasyContent.league;
  if (!leagueArr || !leagueArr[1] || !leagueArr[1].teams) {
    throw new Error('Unexpected teams/roster response structure from Yahoo.');
  }

  var teamsContainer = leagueArr[1].teams;
  var teamCount = teamsContainer.count;
  var ownerMap = {};

  for (var i = 0; i < teamCount; i++) {
    var tWrapper = teamsContainer[String(i)];
    if (!tWrapper || !tWrapper.team) {
      continue;
    }

    var team = tWrapper.team;
    var meta = flattenYahooMeta_(team[0]);

    var teamName = meta.name;
    if (!teamName) {
      continue;
    }

    var rosterWrapper = team[1] && team[1].roster;
    if (!rosterWrapper || !rosterWrapper['0'] || !rosterWrapper['0'].players) {
      continue;
    }

    var playersContainer = rosterWrapper['0'].players;
    var playerCount = playersContainer.count;

    for (var j = 0; j < playerCount; j++) {
      var pWrapper = playersContainer[String(j)];
      if (!pWrapper || !pWrapper.player) {
        continue;
      }

      var p = pWrapper.player;
      var pMeta = flattenYahooMeta_(p[0]);

      var playerKey = pMeta.player_key;
      if (playerKey) {
        ownerMap[playerKey] = teamName;
      }
    }
  }

  // Cache for 10 minutes (600 seconds)
  cache.put(cacheKey, JSON.stringify(ownerMap), 600);

  return ownerMap;
}

function getTopWaiverPickupsForWeek_(week, limit, leagueKey) {
  validateWeek_(week, 'getTopWaiverPickupsForWeek_');
  leagueKey = leagueKey || getLeagueKey_();
  var data = yahooApiRequest_('/league/' + leagueKey + '/transactions', {});
  var fantasyContent = data && data.fantasy_content;
  var leagueArr = fantasyContent && fantasyContent.league;
  if (!leagueArr || !leagueArr[1] || !leagueArr[1].transactions) {
    return [];
  }

  var txContainer = leagueArr[1].transactions;
  var txCount = txContainer.count;
  if (!txCount) {
    return [];
  }

  var nowSec = Math.floor(Date.now() / 1000);
  var windowSec = WAIVER_PICKUP_WINDOW_SEC;
  var startSec = nowSec - windowSec;
  var endSec = nowSec;

  var additions = [];

  for (var i = 0; i < txCount; i++) {
    var txWrapper = txContainer[String(i)];
    if (!txWrapper || !txWrapper.transaction) {
      continue;
    }

    var txArr = txWrapper.transaction;
    var meta = txArr[0];
    var txPlayers = txArr[1] && txArr[1].players;
    if (!meta || !txPlayers || meta.status !== 'successful') {
      continue;
    }

    if (meta.type !== 'add' && meta.type !== 'add/drop') {
      continue;
    }

    var ts = parseInt(meta.timestamp || '0', 10);
    if (!ts || ts < startSec || ts > endSec) {
      continue;
    }

    var pCount = txPlayers.count;
    for (var j = 0; j < pCount; j++) {
      var pWrapper = txPlayers[String(j)];
      if (!pWrapper || !pWrapper.player) {
        continue;
      }

      var p = pWrapper.player;
      var pMeta = flattenYahooMeta_(p[0]);

      var playerKey = pMeta.player_key;
      var playerName = pMeta.name && pMeta.name.full ? pMeta.name.full : '';
      if (!playerKey || !playerName) {
        continue;
      }

      var txDataEntry = null;
      for (var k = 0; k < p.length; k++) {
        var entry = p[k];
        if (!entry || !entry.transaction_data) {
          continue;
        }

        var td = entry.transaction_data;
        if (Array.isArray(td)) {
          td.forEach(function (t) {
            if (t && t.type === 'add' && t.destination_type === 'team') {
              txDataEntry = t;
            }
          });
        } else if (td.type === 'add' && td.destination_type === 'team') {
          txDataEntry = td;
        }
      }

      if (!txDataEntry) {
        continue;
      }

      additions.push({
        player_key: playerKey,
        player_name: playerName,
        team_key: txDataEntry.destination_team_key,
        team_name: txDataEntry.destination_team_name,
        timestamp: ts
      });
    }
  }

  if (!additions.length) {
    return [];
  }

  var startedKeys = getWeekStartedPlayerKeys_(week, leagueKey);
  var startedAdds = [];
  var keysForPoints = [];

  additions.forEach(function (a) {
    if (startedKeys[a.player_key]) {
      startedAdds.push(a);
      keysForPoints.push(a.player_key);
    }
  });

  if (!startedAdds.length) {
    return [];
  }

  var pointsMap = getWeekPointsMapForPlayerKeys_(week, keysForPoints, leagueKey);
  var tz = Session.getScriptTimeZone();

  var rows = [];
  startedAdds.forEach(function (a) {
    var pts = pointsMap[a.player_key] || 0;
    if (pts <= 0) {
      return;
    }
    var day = Utilities.formatDate(new Date(a.timestamp * 1000), tz, 'EEE');
    rows.push({
      player_name: a.player_name,
      team_name: a.team_name,
      points: pts,
      addedDay: day
    });
  });

  if (!rows.length) {
    return [];
  }

  rows.sort(function (a, b) { return b.points - a.points; });
  return rows.slice(0, limit || 3);
}

function buildLeagueSnapshot_(league) {
  var leagueKey = league.league_key;
  var leagueName = league.name;

  var rows = getLeagueStandings_(leagueKey);
  if (!rows || !rows.length) {
    return '<p>No standings data to display for ' + leagueName + ' (' + leagueKey + ').</p>';
  }

  var h = [];
  var ts = 'style="border-collapse:collapse;width:100%;font-family:Arial,sans-serif;font-size:14px;"';
  var thStyle = 'style="border:1px solid #ddd;padding:6px 10px;background:#2c3e50;color:#fff;text-align:left;"';
  var tdStyle = 'style="border:1px solid #ddd;padding:5px 10px;"';
  var sectionTitle = 'style="color:#2c3e50;margin:16px 0 8px 0;font-size:16px;"';

  h.push('<h2 style="color:#2c3e50;border-bottom:2px solid #3498db;padding-bottom:6px;">' + leagueName + '</h2>');

  // Standings table
  h.push('<h3 ' + sectionTitle + '>League Standings</h3>');
  h.push('<table ' + ts + '>');
  h.push('<tr><th ' + thStyle + '>#</th><th ' + thStyle + '>Team</th><th ' + thStyle + '>Manager</th><th ' + thStyle + '>Record</th><th ' + thStyle + '>PF</th><th ' + thStyle + '>PA</th></tr>');

  rows.forEach(function (r, idx) {
    var pf = r.points_for != null ? Math.round(r.points_for) : 0;
    var pa = r.points_against != null ? Math.round(r.points_against) : 0;
    var record = r.wins + '-' + r.losses + '-' + r.ties;
    var star = r.clinched_playoffs ? ' &#9733;' : '';
    var rowBg = idx % 2 === 0 ? '' : ' style="background:#f9f9f9;"';

    h.push('<tr' + rowBg + '>');
    h.push('<td ' + tdStyle + '>' + r.rank + '</td>');
    h.push('<td ' + tdStyle + '><strong>' + r.team_name + star + '</strong></td>');
    h.push('<td ' + tdStyle + '>' + (r.manager_name || '') + '</td>');
    h.push('<td ' + tdStyle + '>' + record + '</td>');
    h.push('<td ' + tdStyle + '>' + pf + '</td>');
    h.push('<td ' + tdStyle + '>' + pa + '</td>');
    h.push('</tr>');
  });
  h.push('</table>');

  // Season-Long Trends (requires Supabase with 3+ weeks of data)
  try {
    var seasonTrends = getSeasonTrends_(leagueKey);
    if (seasonTrends && seasonTrends.length) {
      h.push('<h3 ' + sectionTitle + '>Season Trends</h3>');
      h.push('<table ' + ts + '>');
      h.push('<tr><th ' + thStyle + '>Team</th><th ' + thStyle + '>Trend</th><th ' + thStyle + '>Avg Score</th><th ' + thStyle + '>Consistency</th><th ' + thStyle + '>Luck</th></tr>');
      seasonTrends.forEach(function (t, idx) {
        var rowBg = idx % 2 === 0 ? '' : ' style="background:#f9f9f9;"';
        var trendIcon = t.scoring_trend === 'rising' ? '<span style="color:#27ae60;">&#9650; Rising</span>'
                      : t.scoring_trend === 'falling' ? '<span style="color:#e74c3c;">&#9660; Falling</span>'
                      : '<span style="color:#999;">&mdash; Stable</span>';
        var luckLabel = t.luck_factor > 0 ? '<span style="color:#27ae60;">+' + t.luck_factor + ' Lucky</span>'
                      : t.luck_factor < 0 ? '<span style="color:#e74c3c;">' + t.luck_factor + ' Unlucky</span>'
                      : '<span style="color:#999;">Even</span>';
        h.push('<tr' + rowBg + '>');
        h.push('<td ' + tdStyle + '><strong>' + t.team_name + '</strong></td>');
        h.push('<td ' + tdStyle + '>' + trendIcon + '</td>');
        h.push('<td ' + tdStyle + '>' + t.avg_weekly_score.toFixed(1) + '</td>');
        h.push('<td ' + tdStyle + '>' + t.consistency_rating + ' (' + t.std_dev.toFixed(1) + ')</td>');
        h.push('<td ' + tdStyle + '>' + luckLabel + '</td>');
        h.push('</tr>');
      });
      h.push('</table>');
      h.push('<p style="font-size:11px;color:#888;margin:4px 0;">Luck = actual wins minus expected wins (weeks scoring above league median). Consistency = std deviation of weekly scores.</p>');
    }
  } catch (trendErr) {
    Logger.log('[buildLeagueSnapshot_] Season trends failed: ' + trendErr.message);
  }

  var completedWeek = null;

  try {
    var currentWeek = getCurrentWeek_(leagueKey);

    if (currentWeek < 2) {
      Logger.log('[buildLeagueSnapshot_] Season has not yet started for ' + leagueName + ' (current week: ' + currentWeek + '). Skipping weekly highlights.');
      h.push('<p><em>Season has not yet started. Check back after Week 1.</em></p>');
      return h.join('');
    }

    completedWeek = currentWeek - 1;

    h.push('<h3 ' + sectionTitle + '>Week ' + completedWeek + ' Highlights</h3>');

    // Power Rankings
    try {
      var powerRankings = getWeeklyPowerRankings_(completedWeek, leagueKey);
      if (powerRankings && powerRankings.length) {
        var windowSize = Math.min(3, completedWeek);
        h.push('<h4 style="margin:12px 0 4px 0;color:#555;">Power Rankings (Last ' + windowSize + ' Week' + (windowSize > 1 ? 's' : '') + ' Avg)</h4>');
        h.push('<table ' + ts + '>');
        h.push('<tr><th ' + thStyle + '>#</th><th ' + thStyle + '>Trend</th><th ' + thStyle + '>Team</th><th ' + thStyle + '>' + windowSize + '-Wk Avg</th><th ' + thStyle + '>Wk ' + completedWeek + '</th></tr>');
        powerRankings.forEach(function (r, idx) {
          var rowBg = idx % 2 === 0 ? '' : ' style="background:#f9f9f9;"';
          var trendArrow = r.trend === 'up' ? '<span style="color:#27ae60;">&#9650;</span>'
                         : r.trend === 'down' ? '<span style="color:#e74c3c;">&#9660;</span>'
                         : '<span style="color:#999;">&mdash;</span>';
          var trendDetail = '';
          if (r.prev_rank !== null && r.prev_rank !== r.current_rank) {
            var diff = Math.abs(r.prev_rank - r.current_rank);
            trendDetail = ' <span style="font-size:11px;color:#888;">(' + (r.trend === 'up' ? '+' : '-') + diff + ')</span>';
          }
          var owner = r.manager_name ? ' (' + r.manager_name + ')' : '';
          h.push('<tr' + rowBg + '>');
          h.push('<td ' + tdStyle + '>' + r.current_rank + '</td>');
          h.push('<td ' + tdStyle + ' style="text-align:center;">' + trendArrow + trendDetail + '</td>');
          h.push('<td ' + tdStyle + '><strong>' + r.team_name + '</strong>' + owner + '</td>');
          h.push('<td ' + tdStyle + '>' + r.avg_points.toFixed(1) + '</td>');
          h.push('<td ' + tdStyle + '>' + r.this_week_points.toFixed(1) + '</td>');
          h.push('</tr>');
        });
        h.push('</table>');
      }
    } catch (prErr) {
      Logger.log('[buildLeagueSnapshot_] Power rankings failed: ' + prErr.message);
    }

    var highlights = getWeekTeamHighlights_(completedWeek, leagueKey);
    var ownerMap = getPlayerOwnerMap_(leagueKey);

    // Top 3 Highest Scoring Teams
    if (highlights.topTeams && highlights.topTeams.length) {
      h.push('<h4 style="margin:12px 0 4px 0;color:#555;">Top 3 Highest Scoring Teams</h4>');
      h.push('<table ' + ts + '>');
      h.push('<tr><th ' + thStyle + '>#</th><th ' + thStyle + '>Team</th><th ' + thStyle + '>Points</th></tr>');
      highlights.topTeams.forEach(function (t, idx) {
        var owner = t.manager_name ? ' (' + t.manager_name + ')' : '';
        var rowBg = idx % 2 === 0 ? '' : ' style="background:#f9f9f9;"';
        h.push('<tr' + rowBg + '><td ' + tdStyle + '>' + (idx + 1) + '</td><td ' + tdStyle + '><strong>' + t.team_name + '</strong>' + owner + '</td><td ' + tdStyle + '>' + t.points.toFixed(1) + '</td></tr>');
      });
      h.push('</table>');
    }

    // Blowouts
    if (highlights.blowouts && highlights.blowouts.length) {
      h.push('<h4 style="margin:12px 0 4px 0;color:#555;">Top 3 Biggest Blowouts</h4>');
      h.push('<table ' + ts + '>');
      h.push('<tr><th ' + thStyle + '>#</th><th ' + thStyle + '>Winner</th><th ' + thStyle + '>Score</th><th ' + thStyle + '>Loser</th><th ' + thStyle + '>Margin</th></tr>');
      highlights.blowouts.forEach(function (m, idx) {
        var rowBg = idx % 2 === 0 ? '' : ' style="background:#f9f9f9;"';
        h.push('<tr' + rowBg + '><td ' + tdStyle + '>' + (idx + 1) + '</td><td ' + tdStyle + '>' + m.winner.team_name + '</td><td ' + tdStyle + '>' + m.winner.points.toFixed(1) + ' - ' + m.loser.points.toFixed(1) + '</td><td ' + tdStyle + '>' + m.loser.team_name + '</td><td ' + tdStyle + '>+' + m.margin.toFixed(1) + '</td></tr>');
      });
      h.push('</table>');
    }

    // Bad Beat
    if (highlights.badBeat) {
      var bb = highlights.badBeat;
      h.push('<h4 style="margin:12px 0 4px 0;color:#555;">Bad Beat of the Week</h4>');
      h.push('<p style="margin:4px 0;padding:8px 12px;background:#fff3cd;border-left:4px solid #ffc107;font-size:14px;">' +
        '<strong>' + bb.loser.team_name + '</strong> lost to <strong>' + bb.winner.team_name + '</strong> ' +
        bb.loser.points.toFixed(1) + ' to ' + bb.winner.points.toFixed(1) + ' (-' + bb.margin.toFixed(1) + ')</p>');
    }

    // Bench Points
    var benchSummary = getWeekBenchSummary_(completedWeek, leagueKey);
    if (benchSummary) {
      h.push('<h4 style="margin:12px 0 4px 0;color:#555;">Most Points Left on the Bench</h4>');
      var detail = '';
      if (benchSummary.topBench && benchSummary.topBench.length) {
        detail = benchSummary.topBench.map(function (bp) {
          return bp.name + ' ' + bp.points.toFixed(1);
        }).join(', ');
      }
      h.push('<p style="margin:4px 0;padding:8px 12px;background:#f8d7da;border-left:4px solid #dc3545;font-size:14px;">' +
        '<strong>' + benchSummary.team_name + '</strong> &mdash; ' + benchSummary.totalPoints.toFixed(1) + ' pts on bench' +
        (detail ? ' (' + detail + ')' : '') + '</p>');
    }

    // Waiver Pickups
    var waiverPickups = getTopWaiverPickupsForWeek_(completedWeek, 3, leagueKey);
    if (waiverPickups && waiverPickups.length) {
      h.push('<h4 style="margin:12px 0 4px 0;color:#555;">Top Waiver Pickups (Week ' + completedWeek + ')</h4>');
      h.push('<table ' + ts + '>');
      h.push('<tr><th ' + thStyle + '>#</th><th ' + thStyle + '>Player</th><th ' + thStyle + '>Points</th><th ' + thStyle + '>Team</th><th ' + thStyle + '>Added</th></tr>');
      waiverPickups.forEach(function (w, idx) {
        var rowBg = idx % 2 === 0 ? '' : ' style="background:#f9f9f9;"';
        h.push('<tr' + rowBg + '><td ' + tdStyle + '>' + (idx + 1) + '</td><td ' + tdStyle + '>' + w.player_name + '</td><td ' + tdStyle + '>' + w.points.toFixed(1) + '</td><td ' + tdStyle + '>' + w.team_name + '</td><td ' + tdStyle + '>' + (w.addedDay || '') + '</td></tr>');
      });
      h.push('</table>');
    }

    // Position Leaders
    var positions = ['QB', 'WR', 'RB', 'TE', 'K', 'DEF'];
    positions.forEach(function (pos) {
      var topPlayers = getTopPlayersForWeekAndPosition_(completedWeek, pos, 3, ownerMap, leagueKey);
      if (!topPlayers || !topPlayers.length) {
        return;
      }

      h.push('<h4 style="margin:12px 0 4px 0;color:#555;">Top 3 ' + pos + ' (Week ' + completedWeek + ')</h4>');
      h.push('<table ' + ts + '>');
      h.push('<tr><th ' + thStyle + '>#</th><th ' + thStyle + '>Player</th><th ' + thStyle + '>Points</th><th ' + thStyle + '>Owner</th></tr>');
      topPlayers.forEach(function (p, idx) {
        var owner = p.owner && p.owner !== 'FA' ? p.owner : 'FA';
        var rowBg = idx % 2 === 0 ? '' : ' style="background:#f9f9f9;"';
        h.push('<tr' + rowBg + '><td ' + tdStyle + '>' + (idx + 1) + '</td><td ' + tdStyle + '>' + p.name + '</td><td ' + tdStyle + '>' + p.points.toFixed(1) + '</td><td ' + tdStyle + '>' + owner + '</td></tr>');
      });
      h.push('</table>');
    });

    // Matchup Projections (upcoming week)
    try {
      var projections = getWeekMatchups_(currentWeek, leagueKey);
      if (projections && projections.length) {
        h.push('<h3 ' + sectionTitle + '>Week ' + currentWeek + ' Matchup Projections</h3>');
        h.push('<table ' + ts + '>');
        h.push('<tr><th ' + thStyle + '>Matchup</th><th ' + thStyle + '>Projected</th><th ' + thStyle + '>Spread</th><th ' + thStyle + '>Confidence</th></tr>');
        projections.forEach(function (m, idx) {
          var rowBg = idx % 2 === 0 ? '' : ' style="background:#f9f9f9;"';
          var confColor = m.favored_percent >= 65 ? '#27ae60' : (m.favored_percent >= 55 ? '#f39c12' : '#e74c3c');
          h.push('<tr' + rowBg + '>');
          h.push('<td ' + tdStyle + '><strong>' + m.favored.team_name + '</strong> vs ' + m.underdog.team_name + '</td>');
          h.push('<td ' + tdStyle + '>' + m.favored.points.toFixed(1) + ' - ' + m.underdog.points.toFixed(1) + '</td>');
          h.push('<td ' + tdStyle + '>-' + m.margin.toFixed(1) + '</td>');
          h.push('<td ' + tdStyle + '><span style="color:' + confColor + ';font-weight:bold;">' + m.favored_percent + '%</span></td>');
          h.push('</tr>');
        });
        h.push('</table>');
      }
    } catch (projErr) {
      Logger.log('[buildLeagueSnapshot_] Matchup projections failed: ' + projErr.message);
    }

  } catch (err) {
    h.push('<p style="color:#dc3545;"><strong>Error:</strong> ' + err.message + '</p>');
  }

  return h.join('');
}

// Global constants
var API_CALL_COUNT = 0;
var MIN_WEEK = 1;
var MAX_WEEK = 18;
var YAHOO_API_BATCH_SIZE = 25; // Yahoo API player batch limit
var WAIVER_PICKUP_WINDOW_DAYS = 7; // How far back to look for pickups
var WAIVER_PICKUP_WINDOW_SEC = WAIVER_PICKUP_WINDOW_DAYS * 24 * 60 * 60;
var TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000; // Refresh token 5 min before expiry
var RATE_LIMIT_DELAY_MS = 200; // Delay between API batches

/**
 * Flattens Yahoo's array-of-single-key-objects into a plain object.
 *
 * Yahoo Fantasy API returns metadata as arrays like:
 *   [ { "name": "Team A" }, { "team_id": "1" }, { "managers": [...] } ]
 * This helper collapses them into: { name: "Team A", team_id: "1", managers: [...] }
 *
 * If the input is already a plain object (some endpoints), copies keys directly.
 */
function flattenYahooMeta_(arr) {
  var meta = {};
  if (Array.isArray(arr)) {
    arr.forEach(function (entry) {
      var keys = Object.keys(entry || {});
      if (keys.length === 1) {
        meta[keys[0]] = entry[keys[0]];
      } else if (keys.length > 1) {
        Logger.log('[flattenYahooMeta_] Unexpected multi-key entry (' + keys.length + ' keys): ' + keys.join(', '));
        keys.forEach(function (k) { meta[k] = entry[k]; });
      }
    });
  } else if (arr && typeof arr === 'object') {
    Object.keys(arr).forEach(function (k) {
      meta[k] = arr[k];
    });
  }
  return meta;
}

/**
 * Parses a team wrapper from Yahoo scoreboard into { team_name, manager_name, points }.
 *
 * @param {Object} teamWrapper - Yahoo team wrapper object from scoreboard
 * @param {string} [pointsField] - Which points field to read (default: 'team_points').
 *   Use 'team_projected_points' for matchup projections.
 */
function parseTeamMeta_(teamWrapper, pointsField) {
  var t = teamWrapper.team;
  var meta = flattenYahooMeta_(t[0]);

  var teamName = meta.name;
  var managerName = '';
  if (meta.managers && meta.managers[0]) {
    var mm = meta.managers[0].manager || meta.managers[0];
    managerName = mm.nickname || mm.manager_nickname || '';
  }

  var pointsData;
  if (pointsField) {
    pointsData = t[1] && (t[1][pointsField] || t[1].team_points);
  } else {
    pointsData = t[1] && t[1].team_points;
  }
  var total = pointsData && pointsData.total ? Number(pointsData.total) : 0;

  return {
    team_name: teamName,
    manager_name: managerName,
    points: total
  };
}

/**
 * Extracts the selected roster position slot from a Yahoo player array.
 * Returns the position string (e.g. 'QB', 'BN', 'WR') or null if not found.
 */
function getPlayerSlot_(playerArr) {
  for (var k = 0; k < playerArr.length; k++) {
    var entry = playerArr[k];
    if (!entry || !entry.selected_position) {
      continue;
    }
    var sp = entry.selected_position;
    if (Array.isArray(sp)) {
      for (var n = 0; n < sp.length; n++) {
        if (sp[n] && sp[n].position) {
          return sp[n].position;
        }
      }
    }
  }
  return null;
}

function validateWeek_(week, functionName) {
  if (!week || isNaN(week) || week < MIN_WEEK || week > MAX_WEEK) {
    throw new Error('[' + functionName + '] Invalid week parameter: ' + week + '. Must be between ' + MIN_WEEK + ' and ' + MAX_WEEK + '.');
  }
}

function retryWithBackoff_(fn, maxRetries) {
  maxRetries = maxRetries || 3;
  var retries = 0;

  while (retries < maxRetries) {
    try {
      return fn();
    } catch (err) {
      retries++;
      if (retries >= maxRetries) {
        throw err;
      }

      var backoffMs = Math.pow(2, retries) * 1000;
      Logger.log('[retryWithBackoff_] Retry ' + retries + '/' + maxRetries + ' after error: ' + err.message + '. Waiting ' + backoffMs + 'ms...');
      Utilities.sleep(backoffMs);
    }
  }
}

/**
 * Debug helper: generates snapshot and logs to console instead of emailing
 *
 * Use this for development/testing to avoid email spam.
 * Logs the full snapshot output and performance metrics.
 *
 * @public
 */
function debugSnapshotToLog() {
  var startTime = Date.now();
  API_CALL_COUNT = 0;

  try {
    var leagues = getAllLeagues_();
    if (!leagues || !leagues.length) {
      Logger.log('[debugSnapshotToLog] No leagues found for this Yahoo account.');
      return;
    }

    var sections = [];
    var completedWeek = null;

    for (var i = 0; i < leagues.length; i++) {
      try {
        var snapshot = buildLeagueSnapshot_(leagues[i]);
        sections.push(snapshot);

        if (completedWeek === null) {
          var cw = getCurrentWeek_(leagues[i].league_key);
          completedWeek = Math.max(1, cw - 1);
        }
      } catch (err) {
        Logger.log('[debugSnapshotToLog] Failed to build snapshot for league ' + leagues[i].name + ': ' + err.message);
        sections.push('<h2>' + leagues[i].name + ' (' + leagues[i].league_key + ')</h2><p>Error: ' + err.message + '</p>');
      }
    }

    var output = sections.join('\n\n');
    Logger.log('=== SNAPSHOT OUTPUT ===\n' + output);

    var endTime = Date.now();
    var durationSec = ((endTime - startTime) / 1000).toFixed(2);
    Logger.log('[debugSnapshotToLog] Completed in ' + durationSec + 's. Total API calls: ' + API_CALL_COUNT);

  } catch (err) {
    Logger.log('[debugSnapshotToLog] Error: ' + err.message);
    Logger.log('[debugSnapshotToLog] Stack trace: ' + err.stack);
  }
}

/**
 * Main entry point: fetches all leagues, builds weekly snapshots, and emails the result
 *
 * This function is designed to be run manually or on a time-driven trigger.
 * It handles errors gracefully and sends email notifications on failure.
 *
 * Required Script Properties:
 * - YAHOO_ACCESS_TOKEN, YAHOO_REFRESH_TOKEN, YAHOO_CLIENT_ID, YAHOO_CLIENT_SECRET
 * - RECIPIENT_EMAIL
 *
 * @public
 */
function pullFantasyData() {
  var startTime = Date.now();
  var endTime;
  var durationSec;
  API_CALL_COUNT = 0;

  try {
    var leagues = getAllLeagues_();
    if (!leagues || !leagues.length) {
      Logger.log('No leagues found for this Yahoo account.');
      sendNotificationEmail_('Yahoo Fantasy Snapshot - No Leagues', 'No leagues found for this Yahoo account.');
      return;
    }

    var sections = [];
    var completedWeek = null;
    var failedLeagues = [];

    for (var i = 0; i < leagues.length; i++) {
      try {
        var snapshot = buildLeagueSnapshot_(leagues[i]);
        sections.push(snapshot);

        if (completedWeek === null) {
          var cw = getCurrentWeek_(leagues[i].league_key);
          completedWeek = Math.max(1, cw - 1);
        }

        // Persist to Supabase (non-blocking, errors logged but not thrown)
        if (completedWeek !== null && isSupabaseConfigured_()) {
          try {
            var standingsForPersist = getLeagueStandings_(leagues[i].league_key);
            var weekScores = getWeekTeamScores_(completedWeek, leagues[i].league_key);
            var weeklyScoreMap = {};
            weekScores.forEach(function (t) { weeklyScoreMap[t.team_name] = t.points; });
            persistWeeklySnapshot_(leagues[i].league_key, completedWeek, standingsForPersist, weeklyScoreMap);
          } catch (persistErr) {
            Logger.log('[pullFantasyData] Supabase persistence failed for ' + leagues[i].name + ': ' + persistErr.message);
          }
        }
      } catch (err) {
        Logger.log('[pullFantasyData] Failed to build snapshot for league ' + leagues[i].name + ': ' + err.message);
        failedLeagues.push(leagues[i].name + ': ' + err.message);
        sections.push('<h2 style="color:#dc3545;">' + leagues[i].name + ' (' + leagues[i].league_key + ')</h2><p>Error: ' + err.message + '</p>');
      }
    }

    var htmlBody = '<html><body style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto;padding:16px;">';
    htmlBody += sections.join('<hr style="border:none;border-top:2px solid #eee;margin:24px 0;">');

    if (failedLeagues.length > 0) {
      htmlBody += '<hr style="border:none;border-top:2px solid #dc3545;margin:24px 0;">';
      htmlBody += '<h3 style="color:#dc3545;">Errors</h3>';
      htmlBody += '<ul>';
      failedLeagues.forEach(function (msg) {
        htmlBody += '<li>' + msg + '</li>';
      });
      htmlBody += '</ul>';
    }

    htmlBody += '</body></html>';

    Logger.log('[pullFantasyData] Snapshot generated (' + sections.length + ' leagues).');

    var subject = 'Yahoo Fantasy Snapshot';
    if (completedWeek !== null) {
      subject += ' - Week ' + completedWeek;
    }

    endTime = Date.now();
    durationSec = ((endTime - startTime) / 1000).toFixed(2);
    Logger.log('[pullFantasyData] Snapshot generation completed in ' + durationSec + 's. Total API calls: ' + API_CALL_COUNT);

    sendSnapshotEmail_(subject, htmlBody);

  } catch (err) {
    endTime = Date.now();
    durationSec = ((endTime - startTime) / 1000).toFixed(2);
    Logger.log('[pullFantasyData] Critical error after ' + durationSec + 's and ' + API_CALL_COUNT + ' API calls: ' + err.message);
    Logger.log('[pullFantasyData] Stack trace: ' + err.stack);

    var errorMessage = 'Failed to generate fantasy snapshot.\n\n' +
                       'Error: ' + err.message + '\n' +
                       'Duration: ' + durationSec + 's\n' +
                       'API Calls: ' + API_CALL_COUNT + '\n\n' +
                       'Check the Apps Script logs for details:\n' +
                       'https://script.google.com/';

    sendNotificationEmail_('Fantasy Snapshot Error', errorMessage);
  }
}

function sendSnapshotEmail_(subject, htmlBody) {
  var recipientEmail = getRecipientEmail_();
  var quotaRemaining = MailApp.getRemainingDailyQuota();

  if (quotaRemaining <= 0) {
    Logger.log('[sendSnapshotEmail_] Email quota exhausted (' + quotaRemaining + ' remaining). Cannot send snapshot.');
    throw new Error('[sendSnapshotEmail_] Email quota exhausted (' + quotaRemaining + ' remaining). Snapshot not sent.');
  }

  Logger.log('[sendSnapshotEmail_] Sending email to ' + recipientEmail + '. Remaining daily quota: ' + quotaRemaining);

  // Convert HTML to readable plain text fallback
  var plainText = htmlBody
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<hr[^>]*>/gi, '\n---\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<li[^>]*>/gi, '  - ')
    .replace(/<[^>]*>/g, '')
    .replace(/&mdash;/g, '—')
    .replace(/&#9733;/g, '*')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  MailApp.sendEmail({
    to: recipientEmail,
    subject: subject,
    body: plainText,
    htmlBody: htmlBody
  });
}

function sendNotificationEmail_(subject, body) {
  try {
    var recipientEmail = getRecipientEmail_();
    var quotaRemaining = MailApp.getRemainingDailyQuota();

    if (quotaRemaining <= 0) {
      Logger.log('[sendNotificationEmail_] Email quota exhausted. Cannot send notification.');
      return;
    }

    MailApp.sendEmail(recipientEmail, subject, body);
  } catch (mailErr) {
    Logger.log('[sendNotificationEmail_] Failed to send notification email: ' + mailErr.message);
  }
}

function getYahooAuthUrl_() {
  var cfg = getConfig_();
  var redirectUri = PropertiesService.getScriptProperties().getProperty('YAHOO_REDIRECT_URI');
  if (!cfg.yahooClientId || !cfg.yahooClientSecret) {
    throw new Error('Yahoo client configuration missing. Check YAHOO_CLIENT_ID and YAHOO_CLIENT_SECRET script properties.');
  }
  if (!redirectUri) {
    throw new Error('Missing YAHOO_REDIRECT_URI script property. Set this to your Apps Script Web App URL.');
  }

  var params = {
    client_id: cfg.yahooClientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    language: 'en-us',
    scope: 'fspt-r'
  };

  var query = Object.keys(params)
    .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); })
    .join('&');

  return 'https://api.login.yahoo.com/oauth2/request_auth?' + query;
}

/**
 * Initiates Yahoo OAuth flow (run once in IDE to authorize)
 *
 * Logs the authorization URL to the console. Copy and paste this URL
 * into a browser to complete the OAuth handshake.
 *
 * @public
 * @returns {string} The Yahoo authorization URL
 */
function startYahooAuth() {
  var url = getYahooAuthUrl_();
  Logger.log('Open this URL in a browser to authorize Yahoo: ' + url);
  return url;
}

/**
 * OAuth callback handler (Web App endpoint)
 *
 * This function is called automatically by Yahoo after the user authorizes
 * the app. It exchanges the authorization code for access and refresh tokens.
 *
 * @public
 * @param {Object} e - Event parameter with query string params
 * @returns {HtmlOutput} Success or error message
 */
function doGet(e) {
  e = e || { parameter: {} };
  var params = e.parameter || {};

  if (params.code) {
    var cfg = getConfig_();
    var redirectUri = PropertiesService.getScriptProperties().getProperty('YAHOO_REDIRECT_URI');
    var tokenUrl = 'https://api.login.yahoo.com/oauth2/get_token';

    var payload = {
      grant_type: 'authorization_code',
      code: params.code,
      redirect_uri: redirectUri
    };

    var formBody = Object.keys(payload)
      .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(payload[k]); })
      .join('&');

    var options = {
      method: 'post',
      payload: formBody,
      headers: {
        Authorization: 'Basic ' + Utilities.base64Encode(cfg.yahooClientId + ':' + cfg.yahooClientSecret),
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      muteHttpExceptions: true
    };

    var response = UrlFetchApp.fetch(tokenUrl, options);
    var status = response.getResponseCode();
    var body = response.getContentText();

    if (status < 200 || status >= 300) {
      Logger.log('Yahoo token exchange failed: ' + status + ' ' + body);
      return HtmlService.createHtmlOutput('Yahoo authorization failed. Check the script logs.');
    }

    var token = JSON.parse(body);
    var props = PropertiesService.getScriptProperties();
    props.setProperty('YAHOO_ACCESS_TOKEN', token.access_token);
    if (token.refresh_token) {
      props.setProperty('YAHOO_REFRESH_TOKEN', token.refresh_token);
    }
    if (token.expires_in) {
      props.setProperty('YAHOO_EXPIRES_IN', String(token.expires_in));
      props.setProperty('YAHOO_TOKEN_CREATED_AT', String(Date.now()));
    }

    return HtmlService.createHtmlOutput('Yahoo authorization successful. You can close this tab.');
  }

  return HtmlService.createHtmlOutput('Yahoo Fantasy Snapshot Web App');
}

function getYahooAccessToken_() {
  var props = PropertiesService.getScriptProperties();
  var accessToken = props.getProperty('YAHOO_ACCESS_TOKEN');
  if (!accessToken) {
    throw new Error('[getYahooAccessToken_] No Yahoo access token stored. Run startYahooAuth() and complete the OAuth flow.');
  }

  // Check if token is expired or expiring soon based on stored metadata
  var expiresIn = parseInt(props.getProperty('YAHOO_EXPIRES_IN') || '0', 10);
  var createdAt = parseInt(props.getProperty('YAHOO_TOKEN_CREATED_AT') || '0', 10);

  if (expiresIn > 0 && createdAt > 0) {
    var expiresAt = createdAt + (expiresIn * 1000);
    var now = Date.now();
    var bufferMs = TOKEN_REFRESH_BUFFER_MS;

    if (now >= (expiresAt - bufferMs)) {
      Logger.log('[getYahooAccessToken_] Access token expired or expiring soon. Refreshing proactively.');
      refreshYahooAccessToken_();
      accessToken = props.getProperty('YAHOO_ACCESS_TOKEN');
    }
  }

  return accessToken;
}

function yahooApiRequest_(resourcePath, queryParams) {
  API_CALL_COUNT++;

  var accessToken = getYahooAccessToken_();
  var baseUrl = 'https://fantasysports.yahooapis.com/fantasy/v2';
  var url = baseUrl + resourcePath;

  var params = queryParams || {};
  params.format = params.format || 'json';

  var qs = Object.keys(params)
    .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); })
    .join('&');

  if (qs) {
    url += '?' + qs;
  }

  function doRequest(token) {
    var options = {
      method: 'get',
      headers: {
        Authorization: 'Bearer ' + token,
        Accept: 'application/json'
      },
      muteHttpExceptions: true
    };

    var response = retryWithBackoff_(function() {
      return UrlFetchApp.fetch(url, options);
    });

    return {
      status: response.getResponseCode(),
      body: response.getContentText()
    };
  }

  var first = doRequest(accessToken);

  if (first.status === 401 && first.body && first.body.indexOf('token_expired') !== -1) {
    Logger.log('[yahooApiRequest_] Token expired, refreshing...');
    refreshYahooAccessToken_();
    accessToken = getYahooAccessToken_();
    first = doRequest(accessToken);
  }

  if (first.status < 200 || first.status >= 300) {
    throw new Error('[yahooApiRequest_] HTTP ' + first.status + ': ' + first.body);
  }

  return first.body ? JSON.parse(first.body) : null;
}

function refreshYahooAccessToken_() {
  var props = PropertiesService.getScriptProperties();
  var refreshToken = props.getProperty('YAHOO_REFRESH_TOKEN');
  if (!refreshToken) {
    throw new Error('No Yahoo refresh token stored. Run startYahooAuth() again.');
  }

  var cfg = getConfig_();
  var tokenUrl = 'https://api.login.yahoo.com/oauth2/get_token';

  var payload = {
    grant_type: 'refresh_token',
    refresh_token: refreshToken
  };

  var formBody = Object.keys(payload)
    .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(payload[k]); })
    .join('&');

  var options = {
    method: 'post',
    payload: formBody,
    headers: {
      Authorization: 'Basic ' + Utilities.base64Encode(cfg.yahooClientId + ':' + cfg.yahooClientSecret),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    muteHttpExceptions: true
  };

  var response = UrlFetchApp.fetch(tokenUrl, options);
  var status = response.getResponseCode();
  var body = response.getContentText();

  if (status < 200 || status >= 300) {
    throw new Error('Yahoo token refresh failed: ' + status + ' ' + body);
  }

  var token = JSON.parse(body);
  props.setProperty('YAHOO_ACCESS_TOKEN', token.access_token);
  if (token.refresh_token) {
    props.setProperty('YAHOO_REFRESH_TOKEN', token.refresh_token);
  }
  if (token.expires_in) {
    props.setProperty('YAHOO_EXPIRES_IN', String(token.expires_in));
    props.setProperty('YAHOO_TOKEN_CREATED_AT', String(Date.now()));
  }
}
