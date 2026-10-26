/* Brewer Haikuer Worker
 *   POST /api/submit                       public: submit a haiku (Turnstile + rate limited), stored as "pending"
 *   GET  /api/config                       public: non-secret settings for the form (Turnstile site key)
 *   GET  /api/approved                     public: approved submissions, merged into the archive by the browser
 *   GET  /api/admin/submissions?status=    admin only
 *   GET  /api/admin/games?date=            admin only: Brewers games on a date, from the MLB Stats API
 *   POST /api/admin/submissions/:id        admin only: {action: approve|reject|pending, lines, name, date, game}
 *   GET  /admin                            admin only: the review page
 * Everything else is static files served by the assets binding.
 * Admin routes require a valid Cloudflare Access JWT (verified here, so a missing Access policy fails closed).
 */

const MLB = 'https://statsapi.mlb.com/api/v1';
const MIL_ID = 158;
const MIN_DATE = '2009-01-01';
const MAX_LINE = 100;
const RATE_LIMIT = 5;          // submissions per IP-hash per hour
const MAX_PENDING = 500;       // hard stop so a flood can't fill the database

const json = (obj, status = 200, headers = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    try {
      if (path === '/api/config' && request.method === 'GET') {
        return json({ turnstileSiteKey: env.TURNSTILE_SITE_KEY || '' }, 200, { 'cache-control': 'public, max-age=300' });
      }
      if (path === '/api/submit' && request.method === 'POST') return await submit(request, env);
      if (path === '/api/approved' && request.method === 'GET') return await approved(env);

      if (path === '/admin' || path === '/admin.html' || path.startsWith('/api/admin/')) {
        const who = await adminIdentity(request, env);
        if (!who.ok) return json({ error: who.error }, who.status);
        if (path === '/admin' || path === '/admin.html') {
          return env.ASSETS.fetch(new Request(new URL('/admin', url), request));
        }
        if (path === '/api/admin/submissions' && request.method === 'GET') return await adminList(url, env);
        if (path === '/api/admin/games' && request.method === 'GET') return await adminGames(url);
        const m = /^\/api\/admin\/submissions\/(\d+)$/.exec(path);
        if (m && request.method === 'POST') {
          if (!sameOrigin(request)) return json({ error: 'bad origin' }, 403);
          return await adminUpdate(Number(m[1]), request, env, who.email);
        }
        return json({ error: 'not found' }, 404);
      }
      if (path.startsWith('/api/')) return json({ error: 'not found' }, 404);
      return env.ASSETS.fetch(request);
    } catch (err) {
      console.error('worker error', err && err.stack || err);
      return json({ error: 'server error' }, 500);
    }
  },
};

/* ---------- helpers ---------- */
function sameOrigin(request) {
  const o = request.headers.get('origin');
  if (!o) return false;
  try { return new URL(o).host === new URL(request.url).host; } catch { return false; }
}
function clean(s, max) {
  return String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
function validDate(d) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const t = Date.parse(d + 'T12:00:00Z');
  if (Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== d) return false;
  return d >= MIN_DATE && t <= Date.now() + 36 * 3600 * 1000;
}
async function sha256hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function readJson(request, maxBytes = 8192) {
  const text = await request.text();
  if (text.length > maxBytes) throw new HttpError(413, 'too large');
  try { return JSON.parse(text); } catch { throw new HttpError(400, 'bad json'); }
}
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

export function validateHaiku(body) {
  const lines = Array.isArray(body.lines) ? body.lines.map((l) => clean(l, MAX_LINE)) : [];
  if (lines.length !== 3 || lines.some((l) => !l)) return { error: 'Please fill in all three lines.' };
  if (lines.join('').length < 6) return { error: 'That looks too short.' };
  if (/https?:\/\/|www\./i.test(lines.join(' '))) return { error: 'Please leave links out of the haiku.' };
  const date = clean(body.date, 10);
  if (!validDate(date)) return { error: 'Please choose a valid game date (2009 or later, not in the future).' };
  return { lines, date, name: clean(body.name, 50), note: clean(body.note, 500) };
}

/* ---------- public: submit ---------- */
async function submit(request, env) {
  if (!sameOrigin(request)) return json({ error: 'bad origin' }, 403);
  let body;
  try { body = await readJson(request); } catch (e) { return json({ error: e.message }, e.status || 400); }

  // honeypot: bots fill the hidden field. Pretend success.
  if (body.website) return json({ ok: true });

  if (!env.TURNSTILE_SECRET) return json({ error: 'Submissions are not open yet.' }, 503);
  const ip = request.headers.get('cf-connecting-ip') || '';
  const ts = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: String(body.token || ''), remoteip: ip }),
  }).then((r) => r.json()).catch(() => null);
  if (!ts || !ts.success) return json({ error: 'Spam check failed. Please reload and try again.' }, 400);

  const v = validateHaiku(body);
  if (v.error) return json({ error: v.error }, 400);

  const ipHash = await sha256hex((env.IP_SALT || 'brewer') + '|' + ip);
  const hourAgo = new Date(Date.now() - 3600 * 1000).toISOString();
  const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM submissions WHERE ip_hash = ? AND created_at > ?').bind(ipHash, hourAgo).first();
  if (recent && recent.n >= RATE_LIMIT) return json({ error: 'Too many submissions from you just now. Please try again later.' }, 429);
  const pending = await env.DB.prepare("SELECT COUNT(*) AS n FROM submissions WHERE status = 'pending'").first();
  if (pending && pending.n >= MAX_PENDING) return json({ error: 'The review queue is full right now. Please try again later.' }, 503);

  const linesJson = JSON.stringify(v.lines);
  const dupe = await env.DB.prepare("SELECT id FROM submissions WHERE lines = ? AND status IN ('pending','approved') LIMIT 1").bind(linesJson).first();
  if (!dupe) {
    await env.DB.prepare('INSERT INTO submissions (created_at, lines, name, date, note, ip_hash) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(new Date().toISOString(), linesJson, v.name || null, v.date, v.note || null, ipHash).run();
  }
  return json({ ok: true });
}

/* ---------- public: approved feed ---------- */
async function approved(env) {
  const { results } = await env.DB.prepare("SELECT id, lines, name, date, game, published_at FROM submissions WHERE status = 'approved' ORDER BY date, id").all();
  const items = results.map((r) => ({
    id: 's' + r.id, date: r.date, lines: JSON.parse(r.lines), name: r.name || '', ts: r.published_at,
    game: r.game ? JSON.parse(r.game) : null,
  }));
  return json({ items }, 200, { 'cache-control': 'public, max-age=60' });
}

/* ---------- admin: auth via Cloudflare Access ---------- */
let certCache = { at: 0, keys: null };
const b64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), (c) => c.charCodeAt(0));

async function adminIdentity(request, env) {
  // local development only: set DEV_ADMIN_EMAIL in .dev.vars (never as a production variable)
  if (env.DEV_ADMIN_EMAIL) return { ok: true, email: env.DEV_ADMIN_EMAIL };
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return { ok: false, status: 503, error: 'Admin is not configured (set ACCESS_TEAM_DOMAIN and ACCESS_AUD).' };
  const token = request.headers.get('cf-access-jwt-assertion');
  if (!token) return { ok: false, status: 403, error: 'Sign-in required.' };
  try {
    const [h, p, s] = token.split('.');
    const header = JSON.parse(new TextDecoder().decode(b64u(h)));
    const payload = JSON.parse(new TextDecoder().decode(b64u(p)));
    if (header.alg !== 'RS256') throw new Error('alg');
    if (!certCache.keys || Date.now() - certCache.at > 3600e3) {
      const r = await fetch(`https://${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`);
      certCache = { at: Date.now(), keys: (await r.json()).keys };
    }
    const jwk = certCache.keys.find((k) => k.kid === header.kid);
    if (!jwk) throw new Error('kid');
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64u(s), new TextEncoder().encode(h + '.' + p));
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!ok || !aud.includes(env.ACCESS_AUD) || payload.iss !== 'https://' + env.ACCESS_TEAM_DOMAIN || payload.exp * 1000 < Date.now()) throw new Error('claims');
    return { ok: true, email: payload.email || 'admin' };
  } catch (e) {
    return { ok: false, status: 403, error: 'Sign-in required.' };
  }
}

/* ---------- admin: queue ---------- */
async function adminList(url, env) {
  const status = ['pending', 'approved', 'rejected'].includes(url.searchParams.get('status')) ? url.searchParams.get('status') : 'pending';
  const counts = {};
  for (const r of (await env.DB.prepare('SELECT status, COUNT(*) AS n FROM submissions GROUP BY status').all()).results) counts[r.status] = r.n;
  const order = status === 'pending' ? 'created_at ASC' : 'reviewed_at DESC';
  const { results } = await env.DB.prepare(`SELECT id, created_at, status, lines, name, date, note, game, reviewed_at, reviewed_by FROM submissions WHERE status = ? ORDER BY ${order} LIMIT 200`).bind(status).all();
  return json({ counts, items: results.map((r) => ({ ...r, lines: JSON.parse(r.lines), game: r.game ? JSON.parse(r.game) : null })) });
}

async function adminGames(url) {
  const date = url.searchParams.get('date') || '';
  if (!validDate(date)) return json({ error: 'bad date' }, 400);
  try { return json({ games: await lookupGames(date) }); }
  catch (e) { return json({ games: [], error: 'Could not reach the MLB Stats API.' }); }
}

async function adminUpdate(id, request, env, who) {
  let body;
  try { body = await readJson(request); } catch (e) { return json({ error: e.message }, e.status || 400); }
  const row = await env.DB.prepare('SELECT id FROM submissions WHERE id = ?').bind(id).first();
  if (!row) return json({ error: 'not found' }, 404);
  const now = new Date().toISOString();

  if (body.action === 'reject') {
    await env.DB.prepare("UPDATE submissions SET status='rejected', reviewed_at=?, reviewed_by=?, published_at=NULL WHERE id=?").bind(now, who, id).run();
    return json({ ok: true });
  }
  if (body.action === 'pending') {
    await env.DB.prepare("UPDATE submissions SET status='pending', reviewed_at=NULL, reviewed_by=NULL, published_at=NULL WHERE id=?").bind(id).run();
    return json({ ok: true });
  }
  if (body.action === 'approve') {
    const v = validateHaiku(body);   // admin may fix typos or the date before approving
    if (v.error) return json({ error: v.error }, 400);
    const game = body.game ? sanitizeGame(body.game) : null;
    if (body.game && !game) return json({ error: 'bad game' }, 400);
    await env.DB.prepare("UPDATE submissions SET status='approved', lines=?, name=?, date=?, game=?, reviewed_at=?, reviewed_by=?, published_at=? WHERE id=?")
      .bind(JSON.stringify(v.lines), v.name || null, v.date, game ? JSON.stringify(game) : null, now, who, now, id).run();
    return json({ ok: true });
  }
  return json({ error: 'bad action' }, 400);
}

function sanitizeGame(g) {
  const opp = String(g.opp || '').toUpperCase();
  const int = (x) => (Number.isInteger(x) && x >= 0 && x < 1000 ? x : null);
  if (!/^[A-Z]{2,4}$/.test(opp) || int(g.rs) === null || int(g.ra) === null || !Number.isInteger(g.year)) return null;
  return { pk: Number.isInteger(g.pk) ? g.pk : null, opp, rs: g.rs, ra: g.ra, n: int(g.n), post: !!g.post, year: g.year };
}

/* ---------- MLB schedule lookup ---------- */
export function parseGames(schedule) {
  const out = [];
  for (const d of schedule.dates || []) for (const g of d.games || []) {
    if (!g.status || g.status.abstractGameCode !== 'F' || g.status.codedGameState === 'D') continue;
    if (!['R', 'F', 'D', 'L', 'W'].includes(g.gameType)) continue;
    const home = g.teams.home, away = g.teams.away;
    const mil = home.team.id === MIL_ID ? home : away, opp = mil === home ? away : home;
    out.push({
      pk: g.gamePk, date: g.officialDate || d.date, time: g.gameDate, type: g.gameType,
      opp: opp.team.abbreviation || '', oppName: opp.team.name || '', rs: mil.score, ra: opp.score,
      post: g.gameType !== 'R', year: Number((g.officialDate || d.date).slice(0, 4)), n: null,
    });
  }
  return out;
}
async function lookupGames(date) {
  const get = (u) => fetch(u, { headers: { accept: 'application/json' } }).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); });
  const games = parseGames(await get(`${MLB}/schedule?sportId=1&teamId=${MIL_ID}&date=${date}&hydrate=team`));
  const year = date.slice(0, 4);
  if (games.some((g) => !g.post)) {
    try {
      const season = parseGames(await get(`${MLB}/schedule?sportId=1&teamId=${MIL_ID}&gameType=R&startDate=${year}-01-01&endDate=${date}&hydrate=team`))
        .sort((a, b) => (a.time < b.time ? -1 : 1));
      for (const g of games) if (!g.post) { const i = season.findIndex((s) => s.pk === g.pk); g.n = i >= 0 ? i + 1 : null; }
    } catch { /* game number is optional */ }
  }
  return games;
}
