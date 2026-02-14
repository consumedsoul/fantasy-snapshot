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

function getLeagueKey_() {
  var key = PropertiesService.getScriptProperties().getProperty('YAHOO_LEAGUE_KEY');
  if (!key) {
    throw new Error('[getLeagueKey_] Missing YAHOO_LEAGUE_KEY script property.');
  }
  return key;
}

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
      var metaArray = leagueArr[0];
      var meta = {};

      if (Array.isArray(metaArray)) {
        // Structure like other league resources: array of single-key objects
        metaArray.forEach(function (entry) {
          var keys = Object.keys(entry || {});
          if (keys.length === 1) {
            meta[keys[0]] = entry[keys[0]];
          }
        });
      } else if (metaArray && typeof metaArray === 'object') {
        // In this endpoint league[0] is already a flat object with league_key, name, etc.
        Object.keys(metaArray).forEach(function (k) {
          meta[k] = metaArray[k];
        });
      }

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
    var metaArray = team[0]; // array of single-key objects with team_id, name, managers, clinched_playoffs, etc.
    var meta = {};
    if (Array.isArray(metaArray)) {
      metaArray.forEach(function (entry) {
        var keys = Object.keys(entry || {});
        if (keys.length === 1) {
          meta[keys[0]] = entry[keys[0]];
        }
      });
    }

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

function getWeekMatchups_(week) {
  validateWeek_(week, 'getWeekMatchups_');
  var leagueKey = getLeagueKey_();
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

    function parseTeam(teamWrapper) {
      var t = teamWrapper.team;
      var metaArray = t[0];
      var meta = {};
      if (Array.isArray(metaArray)) {
        metaArray.forEach(function (entry) {
          var keys = Object.keys(entry || {});
          if (keys.length === 1) {
            meta[keys[0]] = entry[keys[0]];
          }
        });
      }

      var teamName = meta.name;
      var managerName = '';
      if (meta.managers && meta.managers[0]) {
        var mm = meta.managers[0].manager || meta.managers[0];
        managerName = mm.nickname || mm.manager_nickname || '';
      }

      // Prefer projected points if available; fall back to actual points.
      var pointsData = t[1] && (t[1].team_projected_points || t[1].team_points || t[1].team_points_total);
      var total = pointsData && pointsData.total ? Number(pointsData.total) : 0;

      return {
        team_name: teamName,
        manager_name: managerName,
        points: total
      };
    }

    var a = parseTeam(teamAWrapper);
    var b = parseTeam(teamBWrapper);

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

    function parseTeamScore(teamWrapper) {
      var t = teamWrapper.team;
      var metaArray = t[0];
      var meta = {};
      if (Array.isArray(metaArray)) {
        metaArray.forEach(function (entry) {
          var keys = Object.keys(entry || {});
          if (keys.length === 1) {
            meta[keys[0]] = entry[keys[0]];
          }
        });
      }

      var teamName = meta.name;
      var managerName = '';
      if (meta.managers && meta.managers[0]) {
        var mm = meta.managers[0].manager || meta.managers[0];
        managerName = mm.nickname || mm.manager_nickname || '';
      }

      var pointsData = t[1] && t[1].team_points;
      var total = pointsData && pointsData.total ? Number(pointsData.total) : 0;

      return {
        team_name: teamName,
        manager_name: managerName,
        points: total
      };
    }

    var a = parseTeamScore(teamAWrapper);
    var b = parseTeamScore(teamBWrapper);

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
      var meta = {};
      var points = 0;

      for (var k = 0; k < p.length; k++) {
        var entry = p[k];
        if (!entry) {
          continue;
        }

        if (Array.isArray(entry)) {
          entry.forEach(function (e) {
            var keys = Object.keys(e || {});
            if (keys.length === 1) {
              meta[keys[0]] = e[keys[0]];
            }
          });
          continue;
        }

        if (typeof entry !== 'object') {
          continue;
        }

        if (entry.player_points && entry.player_points.total !== undefined) {
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
    var metaArray = team[0];
    var meta = {};
    if (Array.isArray(metaArray)) {
      metaArray.forEach(function (entry) {
        var keys = Object.keys(entry || {});
        if (keys.length === 1) {
          meta[keys[0]] = entry[keys[0]];
        }
      });
    }

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
      var pMetaArray = p[0];
      var pMeta = {};
      if (Array.isArray(pMetaArray)) {
        pMetaArray.forEach(function (entry2) {
          var keys2 = Object.keys(entry2 || {});
          if (keys2.length === 1) {
            pMeta[keys2[0]] = entry2[keys2[0]];
          }
        });
      }

      var playerKey = pMeta.player_key;
      var playerName = pMeta.name && pMeta.name.full ? pMeta.name.full : '';
      if (!playerKey || !playerName) {
        continue;
      }

      var slot = null;
      for (var k = 0; k < p.length; k++) {
        var entry = p[k];
        if (!entry || !entry.selected_position) {
          continue;
        }

        var sp = entry.selected_position;
        if (Array.isArray(sp)) {
          for (var n = 0; n < sp.length; n++) {
            var spEntry = sp[n];
            if (spEntry && spEntry.position) {
              slot = spEntry.position;
            }
          }
        }
      }

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
      var pMetaArray = p[0];
      var pMeta = {};
      if (Array.isArray(pMetaArray)) {
        pMetaArray.forEach(function (entry2) {
          var keys2 = Object.keys(entry2 || {});
          if (keys2.length === 1) {
            pMeta[keys2[0]] = entry2[keys2[0]];
          }
        });
      }

      var playerKey = pMeta.player_key;
      if (!playerKey) {
        continue;
      }

      var slot = null;
      for (var k = 0; k < p.length; k++) {
        var entry = p[k];
        if (!entry || !entry.selected_position) {
          continue;
        }

        var sp = entry.selected_position;
        if (Array.isArray(sp)) {
          for (var n = 0; n < sp.length; n++) {
            var spEntry = sp[n];
            if (spEntry && spEntry.position) {
              slot = spEntry.position;
            }
          }
        }
      }

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
      var meta = {};
      var name = '';
      var displayPosition = '';
      var points = 0;

      for (var k = 0; k < p.length; k++) {
        var entry = p[k];
        if (!entry) {
          continue;
        }

        if (Array.isArray(entry)) {
          entry.forEach(function (e) {
            var keys = Object.keys(e || {});
            if (keys.length === 1) {
              meta[keys[0]] = e[keys[0]];
            }
          });
          continue;
        }

        if (typeof entry !== 'object') {
          continue;
        }

        if (entry.name && entry.name.full) {
          name = entry.name.full;
        }
        if (entry.display_position) {
          displayPosition = entry.display_position;
        }
        if (entry.player_points && entry.player_points.total !== undefined) {
          points = Number(entry.player_points.total);
        }
      }

      var playerKey = meta.player_key;

      if (!name && meta.name && meta.name.full) {
        name = meta.name.full;
      }
      if (!displayPosition && meta.display_position) {
        displayPosition = meta.display_position;
      }

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
    var metaArray = team[0];
    var meta = {};
    if (Array.isArray(metaArray)) {
      metaArray.forEach(function (entry) {
        var keys = Object.keys(entry || {});
        if (keys.length === 1) {
          meta[keys[0]] = entry[keys[0]];
        }
      });
    }

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
      var pMetaArray = p[0];
      var pMeta = {};
      if (Array.isArray(pMetaArray)) {
        pMetaArray.forEach(function (entry2) {
          var keys2 = Object.keys(entry2 || {});
          if (keys2.length === 1) {
            pMeta[keys2[0]] = entry2[keys2[0]];
          }
        });
      }

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
      var pMetaArray = p[0];
      var pMeta = {};
      if (Array.isArray(pMetaArray)) {
        pMetaArray.forEach(function (entry2) {
          var keys2 = Object.keys(entry2 || {});
          if (keys2.length === 1) {
            pMeta[keys2[0]] = entry2[keys2[0]];
          }
        });
      }

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
    return 'No standings data to display for ' + leagueName + ' (' + leagueKey + ').';
  }

  var lines = [];
  lines.push('==== ' + leagueName + ' (' + leagueKey + ') ====');
  lines.push('');

  var standingsLines = [];

  rows.forEach(function (r) {
    var pf = r.points_for != null ? Math.round(r.points_for) : 0;
    var pa = r.points_against != null ? Math.round(r.points_against) : 0;
    var record = r.wins + '-' + r.losses + '-' + r.ties;
    var star = r.clinched_playoffs ? '*' : '';
    var manager = r.manager_name ? ' (' + r.manager_name + ')' : '';

    var line = r.rank + '. ' + r.team_name + star + manager + ' (' + record + ') PF: ' + pf + ' PA: ' + pa;
    standingsLines.push(line);
  });

  var leagueHeader = 'LEAGUE STANDINGS';

  lines.push(leagueHeader);
  Array.prototype.push.apply(lines, standingsLines);

  var completedWeek = null;

  try {
    var currentWeek = getCurrentWeek_(leagueKey);

    // Check if season has started (need at least week 2 for a completed week)
    if (currentWeek < 2) {
      Logger.log('[buildLeagueSnapshot_] Season has not yet started for ' + leagueName + ' (current week: ' + currentWeek + '). Skipping weekly highlights.');
      lines.push('');
      lines.push('Season has not yet started. Check back after Week 1.');
      return lines.join('\n');
    }

    completedWeek = currentWeek - 1;

    lines.push('');
    lines.push('WEEK ' + completedWeek + ' HIGHLIGHTS');
    lines.push('');

    var highlights = getWeekTeamHighlights_(completedWeek, leagueKey);
    var ownerMap = getPlayerOwnerMap_(leagueKey);

    if (highlights.topTeams && highlights.topTeams.length) {
      lines.push('Top 3 Highest Scoring Teams');
      highlights.topTeams.forEach(function (t, idx) {
        var owner = t.manager_name ? ' (' + t.manager_name + ')' : '';
        var line = (idx + 1) + '. ' + t.team_name + owner + ' \u0013 ' + t.points.toFixed(1) + ' pts';
        lines.push(line);
      });
    }

    if (highlights.blowouts && highlights.blowouts.length) {
      lines.push('');
      lines.push('Top 3 Biggest Blowouts');
      highlights.blowouts.forEach(function (m, idx) {
        var line = (idx + 1) + '. ' + m.winner.team_name + ' def. ' + m.loser.team_name + ' ' + m.winner.points.toFixed(1) + ' to ' + m.loser.points.toFixed(1) + ' (+' + m.margin.toFixed(1) + ')';
        lines.push(line);
      });
    }

    if (highlights.badBeat) {
      lines.push('');
      lines.push('Bad Beat of the Week');
      var bb = highlights.badBeat;
      var bbLine = bb.loser.team_name + ' lost to ' + bb.winner.team_name + ' ' + bb.loser.points.toFixed(1) + ' to ' + bb.winner.points.toFixed(1) + ' (-' + bb.margin.toFixed(1) + ')';
      lines.push(bbLine);
    }

    var benchSummary = getWeekBenchSummary_(completedWeek, leagueKey);
    if (benchSummary) {
      lines.push('');
      lines.push('Most Points Left on the Bench');

      var benchLine = benchSummary.team_name + ' - ' + benchSummary.totalPoints.toFixed(1) + ' pts on bench';
      if (benchSummary.topBench && benchSummary.topBench.length) {
        var detail = benchSummary.topBench.map(function (bp) {
          return bp.name + ' ' + bp.points.toFixed(1);
        }).join(', ');
        benchLine += ' (' + detail + ')';
      }
      lines.push(benchLine);
    }

    var waiverPickups = getTopWaiverPickupsForWeek_(completedWeek, 3, leagueKey);
    if (waiverPickups && waiverPickups.length) {
      lines.push('');
      lines.push('Top Waiver Pickups (Week ' + completedWeek + ')');

      waiverPickups.forEach(function (w, idx) {
        var addedInfo = w.addedDay ? ', added ' + w.addedDay : '';
        var line = (idx + 1) + '. ' + w.player_name + ' - ' + w.points.toFixed(1) + ' pts (' + w.team_name + addedInfo + ')';
        lines.push(line);
      });
    }

    var positions = ['QB', 'WR', 'RB', 'TE', 'K', 'DEF'];
    positions.forEach(function (pos) {
      var topPlayers = getTopPlayersForWeekAndPosition_(completedWeek, pos, 3, ownerMap, leagueKey);
      if (!topPlayers || !topPlayers.length) {
        return;
      }

      lines.push('');
      lines.push('Top 3 ' + pos + ' Performances (Week ' + completedWeek + ')');

      topPlayers.forEach(function (p, idx) {
        var owner = p.owner && p.owner !== 'FA' ? ' (' + p.owner + ')' : ' (FA)';
        var line = (idx + 1) + '. ' + p.name + ' \u0013 ' + p.points.toFixed(1) + ' pts' + owner;
        lines.push(line);
      });
    });
  } catch (err) {
    lines.push('');
    lines.push('Error fetching matchups for ' + leagueName + ': ' + err.message);
  }

  return lines.join('\n');
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
        sections.push('==== ' + leagues[i].name + ' (' + leagues[i].league_key + ') ====\n\nError: ' + err.message);
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
      } catch (err) {
        Logger.log('[pullFantasyData] Failed to build snapshot for league ' + leagues[i].name + ': ' + err.message);
        failedLeagues.push(leagues[i].name + ': ' + err.message);
        sections.push('==== ' + leagues[i].name + ' (' + leagues[i].league_key + ') ====\n\nError: ' + err.message);
      }
    }

    var output = sections.join('\n\n');

    if (failedLeagues.length > 0) {
      output += '\n\n========================================\n';
      output += 'ERRORS:\n';
      output += failedLeagues.join('\n');
    }

    Logger.log(output);

    var subject = 'Yahoo Fantasy Snapshot';
    if (completedWeek !== null) {
      subject += ' - Week ' + completedWeek;
    }

    var endTime = Date.now();
    var durationSec = ((endTime - startTime) / 1000).toFixed(2);
    Logger.log('[pullFantasyData] Snapshot generation completed in ' + durationSec + 's. Total API calls: ' + API_CALL_COUNT);

    sendSnapshotEmail_(subject, output);

  } catch (err) {
    var endTime = Date.now();
    var durationSec = ((endTime - startTime) / 1000).toFixed(2);
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

function sendSnapshotEmail_(subject, body) {
  var recipientEmail = getRecipientEmail_();
  var quotaRemaining = MailApp.getRemainingDailyQuota();

  if (quotaRemaining <= 0) {
    Logger.log('[sendSnapshotEmail_] Email quota exhausted (' + quotaRemaining + ' remaining). Cannot send snapshot.');
    throw new Error('[sendSnapshotEmail_] Email quota exhausted (' + quotaRemaining + ' remaining). Snapshot not sent.');
  }

  Logger.log('[sendSnapshotEmail_] Sending email to ' + recipientEmail + '. Remaining daily quota: ' + quotaRemaining);
  MailApp.sendEmail(recipientEmail, subject, body);
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
