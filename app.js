/* Brewer Haikuer — static archive browser. No build step, no dependencies. */
(function () {
  'use strict';

  var API = 'https://statsapi.mlb.com/api/v1';
  var API11 = 'https://statsapi.mlb.com/api/v1.1';
  var TEAM = {
    MIL:'Milwaukee Brewers',CHC:'Chicago Cubs',STL:'St. Louis Cardinals',CIN:'Cincinnati Reds',PIT:'Pittsburgh Pirates',HOU:'Houston Astros',
    ATL:'Atlanta Braves',NYM:'New York Mets',PHI:'Philadelphia Phillies',MIA:'Miami Marlins',FLA:'Florida Marlins',WSH:'Washington Nationals',
    LAD:'Los Angeles Dodgers',SF:'San Francisco Giants',SD:'San Diego Padres',COL:'Colorado Rockies',AZ:'Arizona Diamondbacks',CWS:'Chicago White Sox',
    MIN:'Minnesota Twins',DET:'Detroit Tigers',KC:'Kansas City Royals',CLE:'Cleveland Guardians',NYY:'New York Yankees',BOS:'Boston Red Sox',
    TOR:'Toronto Blue Jays',TB:'Tampa Bay Rays',BAL:'Baltimore Orioles',LAA:'Los Angeles Angels',OAK:'Oakland Athletics',SEA:'Seattle Mariners',TEX:'Texas Rangers'
  };
  var MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  var MIL_ID = 158;

  var $ = function (id) { return document.getElementById(id); };
  var el = function (tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };

  /* ---------- data ---------- */
  var DB = null;
  var gamesByDate = {};   // date -> [game]
  var offByDate = {};     // date -> [offfield]
  var allDates = [];      // sorted unique dates that have anything
  var allHaiku = [];      // {id, date}
  var state = { date: null, focus: null };

  function ymd(y, m, d) { return y + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0'); }
  function parse(date) { var p = date.split('-'); return new Date(+p[0], +p[1] - 1, +p[2], 12); }
  function longDate(date) {
    return parse(date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  }
  function teamName(a) { return TEAM[a] || a; }
  function teamShort(a) { var n = teamName(a); return n.split(' ').slice(-1)[0] === 'Sox' || n.split(' ').slice(-1)[0] === 'Jays' ? n.split(' ').slice(-2).join(' ') : n.split(' ').slice(-1)[0]; }

  function index() {
    DB.games.forEach(function (g) {
      (gamesByDate[g.date] = gamesByDate[g.date] || []).push(g);
      g.haiku.forEach(function (h) { allHaiku.push({ id: h.id, date: g.date }); });
    });
    DB.offfield.forEach(function (o) {
      (offByDate[o.date] = offByDate[o.date] || []).push(o);
      allHaiku.push({ id: o.id, date: o.date });
    });
    var set = {};
    Object.keys(gamesByDate).concat(Object.keys(offByDate)).forEach(function (d) { set[d] = 1; });
    allDates = Object.keys(set).sort();
    for (var d in gamesByDate) gamesByDate[d].sort(function (a, b) { return a.key < b.key ? -1 : 1; });
  }

  /* ---------- routing ---------- */
  function readHash() {
    var h = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
    var m = /^(\d{4}-\d{2}-\d{2})(?:\/(\d+))?$/.exec(h);
    if (m && (gamesByDate[m[1]] || offByDate[m[1]])) return { date: m[1], focus: m[2] || null };
    return null;
  }
  function go(date, focus, opts) {
    state.date = date; state.focus = focus || null;
    var h = '#/' + date + (focus ? '/' + focus : '');
    if (location.hash !== h) { try { history.pushState(null, '', h); } catch (e) { location.hash = h; } }
    render(opts && opts.noScroll);
  }
  window.addEventListener('popstate', function () { var r = readHash(); if (r) { state.date = r.date; state.focus = r.focus; render(true); } });
  window.addEventListener('hashchange', function () { var r = readHash(); if (r && (r.date !== state.date || r.focus !== state.focus)) { state.date = r.date; state.focus = r.focus; render(true); } });

  /* ---------- calendar ---------- */
  var view = { y: 2016, m: 3 };
  function buildSelectors() {
    var ms = $('monthSel'), ys = $('yearSel');
    MONTHS.forEach(function (n, i) { var o = el('option', null, n); o.value = i; ms.appendChild(o); });
    var years = {};
    allDates.forEach(function (d) { years[d.slice(0, 4)] = 1; });
    Object.keys(years).sort().forEach(function (y) { var o = el('option', null, y); o.value = y; ys.appendChild(o); });
    ms.addEventListener('change', function () { view.m = +ms.value; drawCal(); });
    ys.addEventListener('change', function () { view.y = +ys.value; drawCal(); });
    $('prevMonth').addEventListener('click', function () { shiftMonth(-1); });
    $('nextMonth').addEventListener('click', function () { shiftMonth(1); });
  }
  function shiftMonth(n) {
    var m = view.m + n, y = view.y;
    if (m < 0) { m = 11; y--; } else if (m > 11) { m = 0; y++; }
    var minY = +allDates[0].slice(0, 4), maxY = +allDates[allDates.length - 1].slice(0, 4);
    if (y < minY || y > maxY) return;
    view.m = m; view.y = y; drawCal();
  }
  function drawCal() {
    $('monthSel').value = view.m; $('yearSel').value = view.y;
    var grid = $('calGrid'); grid.textContent = '';
    var first = new Date(view.y, view.m, 1).getDay();
    var days = new Date(view.y, view.m + 1, 0).getDate();
    for (var i = 0; i < first; i++) grid.appendChild(el('span', 'day blank'));
    for (var d = 1; d <= days; d++) {
      var date = ymd(view.y, view.m, d);
      var hasG = !!gamesByDate[date], hasO = !!offByDate[date];
      var b = el('button', 'day' + (hasG || hasO ? ' has' : '') + (hasG ? ' has-game' : '') + (hasO ? ' has-off' : '') + (state.date === date ? ' sel' : ''), String(d));
      b.type = 'button';
      if (hasG || hasO) {
        var n = (hasG ? gamesByDate[date].reduce(function (a, g) { return a + g.haiku.length; }, 0) : 0) + (hasO ? offByDate[date].length : 0);
        b.setAttribute('aria-label', longDate(date) + ': ' + n + ' haiku');
        b.dataset.date = date;
        b.addEventListener('click', onDay);
      } else { b.disabled = true; b.setAttribute('aria-label', longDate(date) + ': no haiku'); }
      grid.appendChild(b);
    }
    document.querySelectorAll('#seasonChips .chip').forEach(function (c) { c.classList.toggle('on', +c.dataset.year === view.y); });
  }
  function onDay(e) { go(e.currentTarget.dataset.date); }

  function buildSeasons() {
    var box = $('seasonChips');
    var years = {};
    allDates.forEach(function (d) { years[d.slice(0, 4)] = 1; });
    Object.keys(years).sort().forEach(function (y) {
      var c = el('button', 'chip', y); c.type = 'button'; c.dataset.year = y;
      c.addEventListener('click', function () {
        // jump to Opening Day-ish: first haiku date in that year
        var d = allDates.filter(function (x) { return x.slice(0, 4) === y; })[0];
        view.y = +y; view.m = +d.slice(5, 7) - 1; drawCal();
        go(d);
      });
      box.appendChild(c);
    });
  }

  function buildOnThisDay() {
    var now = new Date(); var md = String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
    var hits = allDates.filter(function (d) { return d.slice(5) === md; });
    if (!hits.length) return;
    $('otd').hidden = false;
    hits.forEach(function (d) {
      var c = el('button', 'chip', d.slice(0, 4)); c.type = 'button';
      c.addEventListener('click', function () { go(d); });
      $('otdList').appendChild(c);
    });
  }

  /* ---------- haiku rendering ---------- */
  var PHASE = { pre: 'Pre-game', mid: 'Mid-game', final: 'Final' };
  function haikuCard(h, opts) {
    var a = el('article', 'haiku'); a.dataset.id = h.id;
    var meta = el('div', 'haiku-head');
    meta.appendChild(el('h3', null, 'The haiku'));
    // phase label only where it tells haiku apart: off-field posts, or several haiku on one day
    var label = opts.off ? 'Off the field' : (opts.multi ? (PHASE[h.phase] || '') : '');
    if (label && !opts.off && opts.multi && h.phase === 'mid' && /^(in|after)\s/.test(h.tail || '')) label += ' · ' + h.tail;
    if (label) meta.appendChild(el('span', 'phase', label));
    a.appendChild(meta);
    var p = el('p', 'lines');
    h.lines.forEach(function (ln) { p.appendChild(ln === '' ? el('span', 'gap') : el('span', null, ln)); });
    a.appendChild(p);
    var f = el('div', 'haiku-foot');
    var t = new Date(h.ts);
    f.appendChild(el('span', null, 'Tweeted ' + t.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })));
    var link = el('a', null, 'View original on Twitter ↗');
    link.href = 'https://x.com/brewer_haikuer/status/' + h.id; link.rel = 'noopener'; link.target = '_blank';
    f.appendChild(link);
    var tags = (h.tags || []).filter(function (x) { return x[0] === '#'; }).slice(0, 4);
    if (tags.length) f.appendChild(el('span', 'tags', tags.join(' ')));
    a.appendChild(f);
    if (state.focus === h.id) a.classList.add('focus');
    return a;
  }

  /* ---------- game summary (live from MLB Stats API) ---------- */
  var cache = {};
  function getJSON(url) {
    if (cache[url]) return cache[url];
    cache[url] = fetch(url).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); });
    cache[url].catch(function () { delete cache[url]; });
    return cache[url];
  }
  var FEED_FIELDS = 'gameData,venue,name,weather,condition,temp,wind,gameInfo,attendance,gameDurationMinutes,liveData,plays,scoringPlays,allPlays,result,description,awayScore,homeScore,about,inning,halfInning,decisions,winner,loser,save,fullName,boxscore,topPerformers,player,person,type,gameScore';

  function loadGame(g) {
    var sUrl = API + '/schedule?sportId=1&teamId=' + MIL_ID + '&date=' + g.date + '&hydrate=team,linescore,venue';
    return getJSON(sUrl).then(function (s) {
      var games = [];
      (s.dates || []).forEach(function (d) { d.games.forEach(function (x) { games.push(x); }); });
      games = games.filter(function (x) { return x.status && x.status.abstractGameCode === 'F' && x.status.codedGameState !== 'D'; });
      games.sort(function (a, b) { return a.gameDate < b.gameDate ? -1 : 1; });
      var pick = games.filter(function (x) {
        var home = x.teams.home.team.id === MIL_ID, me = home ? x.teams.home : x.teams.away, op = home ? x.teams.away : x.teams.home;
        return me.score === g.rs && op.score === g.ra;
      });
      var dh = +g.key.split('-').pop();
      var game = pick.length === 1 ? pick[0] : (pick.length > 1 ? pick[Math.min(dh, pick.length) - 1] : games[Math.min(dh, games.length) - 1]);
      if (!game) throw new Error('no game');
      return getJSON(API11 + '/game/' + game.gamePk + '/feed/live?fields=' + FEED_FIELDS).then(function (feed) { return { game: game, feed: feed }; });
    });
  }

  function ordinal(n) { var s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }

  function summaryCard(g) {
    var box = el('section', 'summary'); box.setAttribute('aria-label', 'Game summary');
    var head = el('div', 'sum-head');
    head.appendChild(el('h3', null, 'The game'));
    var venue = el('span', 'venue', 'Loading details from MLB…');
    head.appendChild(venue);
    box.appendChild(head);
    var body = el('div', 'sum-body');
    var fallback = el('p', 'narr');
    fallback.textContent = 'The Brewers ' + (g.rs > g.ra ? 'beat' : 'fell to') + ' the ' + teamShort(g.opp) + ', ' + Math.max(g.rs, g.ra) + '–' + Math.min(g.rs, g.ra) + '.';
    body.appendChild(fallback);
    var sk = el('div', 'skeleton'); body.appendChild(sk);
    box.appendChild(body);

    loadGame(g).then(function (r) {
      var game = r.game, feed = r.feed;
      body.textContent = '';
      var home = game.teams.home, away = game.teams.away;
      var meHome = home.team.id === MIL_ID;
      var me = meHome ? home : away, op = meHome ? away : home;
      var gd = feed.gameData || {}, ld = feed.liveData || {};
      venue.textContent = '';

      // narrative
      var dec = ld.decisions || {};
      var won = me.score > op.score;
      var np = el('p', 'narr');
      var parts = [];
      var b1 = document.createElement('b'); b1.textContent = 'Brewers ' + (won ? 'beat' : 'fell to') + ' the ' + op.team.teamName + ' ' + Math.max(me.score, op.score) + '–' + Math.min(me.score, op.score);
      np.appendChild(b1);
      var sentence = (meHome ? ' at ' : ' on the road at ') + ((gd.venue && gd.venue.name) || (game.venue && game.venue.name) || 'the ballpark');
      var att = gd.gameInfo && gd.gameInfo.attendance;
      sentence += att ? ' in front of ' + att.toLocaleString('en-US') + ' fans' : '';
      var innings = game.linescore && game.linescore.innings ? game.linescore.innings.length : 9;
      if (innings !== 9) sentence += ', going ' + innings + ' innings';
      sentence += '.';
      if (me.leagueRecord) sentence += ' The club ' + (won ? 'improved' : 'dropped') + ' to ' + me.leagueRecord.wins + '–' + me.leagueRecord.losses + '.';
      if (game.seriesDescription && game.gameType !== 'R') sentence += ' (' + game.seriesDescription + (game.seriesGameNumber ? ', Game ' + game.seriesGameNumber : '') + ')';
      np.appendChild(document.createTextNode(sentence + ' '));
      var dl = [];
      if (dec.winner) dl.push(dec.winner.fullName + ' got the win');
      if (dec.loser) dl.push(dec.loser.fullName + ' took the loss');
      if (dec.save) dl.push(dec.save.fullName + ' earned the save');
      if (dl.length) np.appendChild(document.createTextNode(dl.join('; ').replace(/^./, function (c) { return c.toUpperCase(); }) + '.'));
      body.appendChild(np);

      // linescore
      var ls = game.linescore;
      if (ls && ls.innings && ls.innings.length) {
        var wrap = el('div', 'ls-wrap'), tbl = el('table', 'ls');
        var thead = el('tr'); thead.appendChild(el('th', null, ''));
        ls.innings.forEach(function (i) { thead.appendChild(el('th', null, String(i.num))); });
        ['R', 'H', 'E'].forEach(function (k) { thead.appendChild(el('th', null, k)); });
        tbl.appendChild(thead);
        [['away', away], ['home', home]].forEach(function (p) {
          var side = p[0], tm = p[1];
          var tr = el('tr', tm.team.id === MIL_ID ? 'me' : '');
          tr.appendChild(el('td', 't', tm.team.abbreviation || tm.team.teamName));
          ls.innings.forEach(function (i) { var v = i[side] && i[side].runs; tr.appendChild(el('td', null, v == null ? '–' : String(v))); });
          var tt = ls.teams[side];
          [tt.runs, tt.hits, tt.errors].forEach(function (v, idx) { var td = el('td', idx === 0 ? 'rhe' : null, String(v)); if (idx === 0) td.className = 'rhe'; tr.appendChild(td); });
          tbl.appendChild(tr);
        });
        wrap.appendChild(tbl); body.appendChild(wrap);
      }

      // facts
      var facts = el('div', 'facts');
      function fact(k, v) { if (!v) return; var s = el('span'); s.appendChild(el('b', null, k)); s.appendChild(document.createTextNode(v)); facts.appendChild(s); }
      fact('Place', (gd.venue && gd.venue.name) || (game.venue && game.venue.name) || '');
      if (gd.weather && gd.weather.temp) fact('Weather', gd.weather.temp + '°F, ' + (gd.weather.condition || '').toLowerCase() + (gd.weather.wind ? ', wind ' + gd.weather.wind : ''));
      if (gd.gameInfo && gd.gameInfo.gameDurationMinutes) fact('Time', Math.floor(gd.gameInfo.gameDurationMinutes / 60) + ':' + String(gd.gameInfo.gameDurationMinutes % 60).padStart(2, '0'));
      var tops = ((ld.boxscore && ld.boxscore.topPerformers) || []).slice(0, 3).map(function (t) { return t.player.person.fullName; });
      if (tops.length) fact('Top performers', tops.join(', '));
      if (facts.childNodes.length) body.appendChild(facts);

      // scoring plays
      var plays = ld.plays || {}; var sp = (plays.scoringPlays || []).map(function (i) { return plays.allPlays[i]; }).filter(Boolean);
      if (sp.length) {
        var det = el('details', 'plays'); det.appendChild(el('summary', null, 'Scoring plays (' + sp.length + ')'));
        var ol = el('ol');
        sp.forEach(function (p) {
          var li = el('li');
          var hv = p.about.halfInning === 'top' ? 'Top' : 'Bot';
          var sc = away.team.abbreviation + ' ' + p.result.awayScore + ', ' + home.team.abbreviation + ' ' + p.result.homeScore;
          li.appendChild(el('em', null, hv + ' ' + ordinal(p.about.inning) + ' · ' + sc));
          li.appendChild(document.createTextNode(p.result.description));
          ol.appendChild(li);
        });
        det.appendChild(ol); body.appendChild(det);
      }

      // links
      var links = el('div', 'sum-links');
      var a1 = el('a', null, 'MLB Gameday ↗'); a1.href = 'https://www.mlb.com/gameday/' + game.gamePk; links.appendChild(a1);
      var a2 = el('a', null, 'ESPN scoreboard ↗'); a2.href = 'https://www.espn.com/mlb/scoreboard/_/date/' + g.date.replace(/-/g, ''); links.appendChild(a2);
      [a1, a2].forEach(function (a) { a.target = '_blank'; a.rel = 'noopener'; });
      body.appendChild(links);
    }).catch(function () {
      body.textContent = '';
      var p = el('p', 'narr');
      p.textContent = 'The Brewers ' + (g.rs > g.ra ? 'beat' : 'fell to') + ' the ' + teamName(g.opp) + ', ' + Math.max(g.rs, g.ra) + '–' + Math.min(g.rs, g.ra) + '.';
      body.appendChild(p);
      body.appendChild(el('p', 'note', 'Full game details couldn’t be loaded from MLB right now.'));
      venue.textContent = '';
      var links = el('div', 'sum-links');
      var a2 = el('a', null, 'ESPN scoreboard ↗'); a2.href = 'https://www.espn.com/mlb/scoreboard/_/date/' + g.date.replace(/-/g, ''); a2.target = '_blank'; a2.rel = 'noopener';
      links.appendChild(a2); body.appendChild(links);
    });
    return box;
  }

  /* ---------- page render ---------- */
  function render(noScroll) {
    var date = state.date; if (!date) return;
    var gs = gamesByDate[date] || [], offs = offByDate[date] || [];
    $('dateTitle').textContent = longDate(date);
    var idx = allDates.indexOf(date);
    $('prevDay').disabled = idx <= 0; $('nextDay').disabled = idx >= allDates.length - 1;
    var c = $('content'); c.textContent = '';

    gs.forEach(function (g) {
      var blk = el('section', 'game-block');
      var mh = el('div', 'matchup');
      mh.appendChild(el('span', 'gno', g.post ? 'Postseason' : (g.n ? 'Game ' + g.n + ' of ' + g.year : g.year)));
      mh.appendChild(el('span', 'vs', 'Brewers vs. ' + teamShort(g.opp)));
      var won = g.rs > g.ra;
      mh.appendChild(el('span', 'badge ' + (won ? 'w' : 'l'), (won ? 'W ' : 'L ') + g.rs + '–' + g.ra));
      blk.appendChild(mh);
      g.haiku.forEach(function (h) { blk.appendChild(haikuCard(h, { date: date, multi: g.haiku.length > 1 })); });
      blk.appendChild(summaryCard(g));
      c.appendChild(blk);
    });
    if (offs.length) {
      var blk2 = el('section', 'game-block');
      if (gs.length) { var m2 = el('div', 'matchup'); m2.appendChild(el('span', 'gno', 'Also that day')); blk2.appendChild(m2); }
      offs.forEach(function (o) { blk2.appendChild(haikuCard(o, { off: true, date: date })); });
      c.appendChild(blk2);
    }
    view.y = +date.slice(0, 4); view.m = +date.slice(5, 7) - 1; drawCal();
    if (!noScroll) {
      var target = state.focus && c.querySelector('[data-id="' + state.focus + '"]');
      var node = target || $('main');
      if (window.matchMedia('(max-width:860px)').matches || target) node.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function stepDay(n) {
    var i = allDates.indexOf(state.date) + n;
    if (i >= 0 && i < allDates.length) go(allDates[i]);
  }
  function randomHaiku() {
    var pick = allHaiku[Math.floor(Math.random() * allHaiku.length)];
    go(pick.date, pick.id);
  }

  function stats() {
    var seasons = {}; allDates.forEach(function (d) { seasons[d.slice(0, 4)] = 1; });
    var items = [[allHaiku.length.toLocaleString('en-US'), 'Haiku'], [Object.keys(seasons).length, 'Seasons'], [DB.games.length.toLocaleString('en-US'), 'Games']];
    var box = $('stats');
    items.forEach(function (p) { var d = el('div'); d.appendChild(el('b', null, String(p[0]))); d.appendChild(el('span', null, p[1])); box.appendChild(d); });
  }

  /* ---------- boot ---------- */
  fetch('data/haiku.json').then(function (r) { return r.json(); }).then(function (d) {
    DB = d; index(); stats(); buildSelectors(); buildSeasons(); buildOnThisDay();
    $('random').addEventListener('click', randomHaiku);
    $('prevDay').addEventListener('click', function () { stepDay(-1); });
    $('nextDay').addEventListener('click', function () { stepDay(1); });
    document.addEventListener('keydown', function (e) {
      if (e.target && /^(SELECT|INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
      if (e.key === 'ArrowLeft') stepDay(-1); else if (e.key === 'ArrowRight') stepDay(1); else if (e.key === 'r' && !e.metaKey && !e.ctrlKey) randomHaiku();
    });
    var r = readHash();
    if (r) { state.date = r.date; state.focus = r.focus; render(true); }
    else { var p = allHaiku[Math.floor(Math.random() * allHaiku.length)]; state.date = p.date; state.focus = null; render(true); }
  }).catch(function () {
    $('dateTitle').textContent = 'Couldn’t load the archive';
    $('content').appendChild(el('p', 'empty', 'The haiku data failed to load. If you opened this file directly from disk, serve the folder over HTTP instead (for example: python3 -m http.server).'));
  });
})();
