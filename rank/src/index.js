// 데굴 랭킹 서버 (Cloudflare Worker + D1)
// 랭킹은 도시(stage)마다 따로다.
//   POST /start  {stage} -> {tok}   판이 시작할 때 받는 표. 기록은 이 표가 있어야 받고, 표 하나로 한 번만 받는다
//   POST /run    {tok, stage, name, score, picks, arrived, bonus, clear, last, dia, secs} -> {ok, rank, today, best} 또는 {ok: false, why}
//   GET  /board?stage=...&scope=all|today -> {rows: [{name, score, arrived, last, clear}]}   (30초 캐시)
//   GET  /me?stage=...&name=...&scope=all|today -> {rank, score, arrived, last} 또는 {rank: null}
// 이름은 게임과 같은 규칙(site/names.js)으로 다시 거른다. 점수는 판의 내용과 맞는지 본다:
//   점수 = 붙인 개수 + 도착 수 × 100 + 보너스(도전 성공 300씩, 도착한 곳 수까지 최대 6번 + 도시 클리어 1000)
//   시간: 판의 시간(secs)은 표를 받은 뒤 실제로 흐른 시간보다 길 수 없다 / 도착은 한 판에 7곳까지, 시간에 맞아야 한다
//   마지막 도착 학교는 그 도시의 학교여야 하고, 7곳 도착이면 그 도시의 보스 캠퍼스, 아니면 보스가 아닌 곳이다
//   붙인 개수: 평균 1초에 PICKS_PER_SEC개까지, 그리고 지나온 캠퍼스들에 실제로 놓인 물건·건물 블록 수(content.json)를 넘을 수 없다
//   IP 하나는 5초에 한 번, 하루 300판까지. 진짜 IP는 cf-connecting-ip(Cloudflare가 붙이고 브라우저가 꾸밀 수 없다)만 쓴다
// 표는 TOKEN_KEY 비밀값으로 서명한다(npx wrangler secret put TOKEN_KEY). 없으면 기록을 받지 않는다
import { checkName, nameKey } from '../../site/names.js';
import course from '../../site/course/index.json';
// campus code -> things on it right after it loads (props + building blocks), measured in the game with __degul.content()
import CONTENT from './content.json';

const STAGES = new Set(course.map((c) => c.stage)), PER_RUN = 7, CAMPUSES = course.length;
const MIN_GAP = 5, IP_DAY = 300, BOARD_TTL = 30, TOP = 50, MAX_SECS = 6 * 3600;
// bots on the measured course average up to ~100 picks a second over a whole run (10-second bursts up to ~260)
const PICKS_PER_SEC = 250, PICKS_SLACK = 500;
// a ticket is good for the longest run plus a while on the result screen; the clocks may differ by a few seconds
const TOK_LIFE = MAX_SECS + 3600, CLOCK_SLACK = 10;
// per city: the campus labels, the boss label, and how much its campuses hold (biggest first)
const CITY = {};
for (const c of course) {
  const s = (CITY[c.stage] ??= { labels: new Set(), boss: null, sizes: [], bossSize: 0 });
  s.labels.add(c.label);
  const n = CONTENT[c.code] ?? 25000;
  if (c.boss) { s.boss = c.label; s.bossSize = n; } else s.sizes.push(n);
}
for (const s of Object.values(CITY)) s.sizes.sort((a, b) => b - a);
// the most a run can have picked up after `arrived` campuses: the biggest campuses of the city it could have rolled
// through (plus the boss once it got there), 20% over, with room for the challenge lots (~200 things each),
// the hoardings and the chunks a crash knocks loose
export function maxPicks(stage, arrived) {
  const s = CITY[stage];
  let n = 0;
  for (let i = 0; i < Math.min(arrived, PER_RUN - 1); i++) n += s.sizes[i] ?? 0;
  if (arrived >= PER_RUN) n += s.bossSize;
  return Math.ceil(n * 1.2) + 2000;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Max-Age': '86400',
};
const kstDay = (ms = Date.now()) => new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 10);
const int = (v) => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : -1);
const reply = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json', ...extra } });

async function hash(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// the ticket: "<stage>.<ms when given>.<nonce>.<hmac-sha256 of the rest>"
const enc = new TextEncoder();
const toHex = (bytes) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
const hmacKey = (env) => crypto.subtle.importKey('raw', enc.encode(env.TOKEN_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
export async function makeToken(env, stage, nowMs = Date.now()) {
  const body = `${stage}.${nowMs}.${toHex(crypto.getRandomValues(new Uint8Array(8)))}`;
  return `${body}.${toHex(await crypto.subtle.sign('HMAC', await hmacKey(env), enc.encode(body)))}`;
}
async function readToken(env, tok) {
  const m = /^([a-z]+)\.(\d{13})\.([0-9a-f]{16})\.([0-9a-f]{64})$/.exec(typeof tok === 'string' ? tok : '');
  if (!m) return null;
  const sig = new Uint8Array(m[4].match(/../g).map((h) => parseInt(h, 16)));
  const good = await crypto.subtle.verify('HMAC', await hmacKey(env), sig, enc.encode(`${m[1]}.${m[2]}.${m[3]}`));
  return good ? { stage: m[1], t0: Number(m[2]) } : null;
}

// everything that can be checked from the record alone
export function checkRun(body) {
  const nm = checkName(body?.name);
  if (!nm.ok) return { ok: false, why: nm.why };
  const stage = String(body.stage ?? '');
  if (!STAGES.has(stage)) return { ok: false, why: 'stage' };
  const city = CITY[stage];
  const score = int(body.score), picks = int(body.picks), arrived = int(body.arrived), bonus = int(body.bonus), clear = body.clear === true;
  const secs = Number(body.secs), dia = Number(body.dia);
  if (!(secs >= 3 && secs <= MAX_SECS)) return { ok: false, why: 'time' };
  if (arrived < 0 || arrived > PER_RUN || arrived > secs / 2 + 1 || (clear && arrived < PER_RUN)) return { ok: false, why: 'arrived' };
  // 300 for each challenge won (one lies after each campus but the boss, and it is won at the latest on arriving at the
  // next campus), 1,000 for the clear
  const won = (bonus - (clear ? 1000 : 0)) / 300;
  if (!Number.isInteger(won) || won < 0 || won > Math.min(PER_RUN - 1, arrived)) return { ok: false, why: 'bonus' };
  const last = arrived > 0 ? String(body.last ?? '') : null;
  if (arrived > 0 && (!city.labels.has(last) || (arrived === PER_RUN) !== (last === city.boss))) return { ok: false, why: 'last' };
  if (picks < 0 || picks > secs * PICKS_PER_SEC + PICKS_SLACK || picks > maxPicks(stage, arrived)) return { ok: false, why: 'picks' };
  if (score !== picks + arrived * 100 + bonus) return { ok: false, why: 'score' };
  if (!(dia >= 0.5 && dia <= 500)) return { ok: false, why: 'dia' };
  return { ok: true, stage, name: nm.name, key: nameKey(nm.name), score, picks, arrived, bonus, clear: clear ? 1 : 0, last, secs, dia };
}

// where a score would stand among everyone else's best (your own better runs don't push you down)
async function rankOf(env, stage, scope, day, score, key) {
  const q = scope === 'today'
    ? env.DB.prepare('SELECT COUNT(*) AS n FROM best_day WHERE stage = ?1 AND day = ?2 AND score > ?3 AND key != ?4').bind(stage, day, score, key)
    : env.DB.prepare('SELECT COUNT(*) AS n FROM best WHERE stage = ?1 AND score > ?2 AND key != ?3').bind(stage, score, key);
  return (await q.first('n')) + 1;
}

export async function addRun(env, body, ip, nowMs = Date.now()) {
  const r = checkRun(body);
  if (!r.ok) return r;
  if (!ip) return { ok: false, why: 'no ip' };
  if (!env.TOKEN_KEY) return { ok: false, why: 'no key' };
  // the ticket: signed by us, for this city, and the run can't have lasted longer than the time since it was given
  const t = await readToken(env, body.tok);
  if (!t || t.stage !== r.stage) return { ok: false, why: 'ticket' };
  const age = (nowMs - t.t0) / 1000;
  if (age > TOK_LIFE || age < -CLOCK_SLACK) return { ok: false, why: 'ticket' };
  if (r.secs > age + CLOCK_SLACK) return { ok: false, why: 'time' };
  if (await env.DB.prepare('SELECT 1 AS x FROM runs WHERE tok = ?1').bind(body.tok).first('x')) return { ok: false, why: 'used' };
  const day = kstDay(nowMs), now = nowMs / 1000, k = await hash(`${ip}|${day}`);
  const row = await env.DB.prepare('SELECT n, at FROM ipday WHERE k = ?1 AND day = ?2').bind(k, day).first();
  if (row && (row.n >= IP_DAY || now - row.at < MIN_GAP)) return { ok: false, why: 'too often' };
  const at = Math.floor(now);
  try {
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO ipday (k, day, n, at) VALUES (?1, ?2, 1, ?3)
        ON CONFLICT (k, day) DO UPDATE SET n = n + 1, at = ?3`).bind(k, day, now),
      env.DB.prepare(`INSERT INTO runs (stage, day, key, name, score, picks, arrived, bonus, clear, last, secs, dia, at, ipk, tok)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)`)
        .bind(r.stage, day, r.key, r.name, r.score, r.picks, r.arrived, r.bonus, r.clear, r.last, r.secs, r.dia, at, k, body.tok),
      env.DB.prepare(`INSERT INTO best (stage, key, name, score, arrived, clear, last, at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
        ON CONFLICT (stage, key) DO UPDATE SET name = excluded.name, score = excluded.score, arrived = excluded.arrived, clear = excluded.clear, last = excluded.last, at = excluded.at
        WHERE excluded.score > best.score`).bind(r.stage, r.key, r.name, r.score, r.arrived, r.clear, r.last, at),
      env.DB.prepare(`INSERT INTO best_day (stage, day, key, name, score, arrived, clear, last, at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
        ON CONFLICT (stage, day, key) DO UPDATE SET name = excluded.name, score = excluded.score, arrived = excluded.arrived, clear = excluded.clear, last = excluded.last, at = excluded.at
        WHERE excluded.score > best_day.score`).bind(r.stage, day, r.key, r.name, r.score, r.arrived, r.clear, r.last, at),
    ]);
  } catch (e) {
    // two posts with the same ticket at once: the unique index on runs.tok lets only one in
    if (/UNIQUE/i.test(String(e?.message))) return { ok: false, why: 'used' };
    throw e;
  }
  const best = await env.DB.prepare('SELECT score FROM best WHERE stage = ?1 AND key = ?2').bind(r.stage, r.key).first('score');
  return { ok: true, rank: await rankOf(env, r.stage, 'all', day, r.score, r.key), today: await rankOf(env, r.stage, 'today', day, r.score, r.key), best };
}

export async function board(env, stage, scope, nowMs = Date.now()) {
  const q = scope === 'today'
    ? env.DB.prepare('SELECT name, score, arrived, clear, last FROM best_day WHERE stage = ?1 AND day = ?2 ORDER BY score DESC, at ASC LIMIT ?3').bind(stage, kstDay(nowMs), TOP)
    : env.DB.prepare('SELECT name, score, arrived, clear, last FROM best WHERE stage = ?1 ORDER BY score DESC, at ASC LIMIT ?2').bind(stage, TOP);
  return { rows: (await q.all()).results };
}

export async function me(env, stage, name, scope, nowMs = Date.now()) {
  const day = kstDay(nowMs), key = nameKey(name);
  const row = scope === 'today'
    ? await env.DB.prepare('SELECT score, arrived, last FROM best_day WHERE stage = ?1 AND day = ?2 AND key = ?3').bind(stage, day, key).first()
    : await env.DB.prepare('SELECT score, arrived, last FROM best WHERE stage = ?1 AND key = ?2').bind(stage, key).first();
  if (!row) return { rank: null };
  return { rank: await rankOf(env, stage, scope, day, row.score, key), score: row.score, arrived: row.arrived, last: row.last };
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url), scope = url.searchParams.get('scope') === 'today' ? 'today' : 'all';
    const stage = STAGES.has(url.searchParams.get('stage')) ? url.searchParams.get('stage') : 'seoul';
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (url.pathname === '/start' && req.method === 'POST') {
      let body = null;
      try { body = await req.json(); } catch { return reply({ ok: false, why: 'bad json' }, 400); }
      if (!STAGES.has(body?.stage)) return reply({ ok: false, why: 'stage' }, 400);
      if (!env.TOKEN_KEY) return reply({ ok: false, why: 'no key' }, 503);
      return reply({ ok: true, tok: await makeToken(env, body.stage) }, 200, { 'Cache-Control': 'no-store' });
    }
    if (url.pathname === '/run' && req.method === 'POST') {
      let body = null;
      try { body = await req.json(); } catch { return reply({ ok: false, why: 'bad json' }, 400); }
      const r = await addRun(env, body, req.headers.get('cf-connecting-ip'));
      // a new record: drop this city's cached boards so the player sees it right away
      if (r.ok) await Promise.all(['all', 'today'].map((s) => caches.default.delete(new Request(`${url.origin}/board?stage=${body.stage}&scope=${s}`, { method: 'GET' }))));
      return reply(r, r.ok ? 200 : 400);
    }
    if (url.pathname === '/board' && req.method === 'GET') {
      // the list stays in Cloudflare's cache for 30 seconds, so many open pages read the database rarely
      const cache = caches.default, key = new Request(`${url.origin}/board?stage=${stage}&scope=${scope}`, { method: 'GET' });
      let res = await cache.match(key);
      if (!res) {
        res = reply(await board(env, stage, scope), 200, { 'Cache-Control': `public, max-age=${BOARD_TTL}` });
        ctx.waitUntil(cache.put(key, res.clone()));
      }
      return res;
    }
    if (url.pathname === '/me' && req.method === 'GET') return reply(await me(env, stage, url.searchParams.get('name') || '', scope));
    if (url.pathname === '/' || url.pathname === '/health') return reply({ ok: true, day: kstDay(), campuses: CAMPUSES });
    return reply({ error: 'not found' }, 404);
  },
  // every day at 04:10 KST: forget per-IP rows older than yesterday
  async scheduled(event, env) {
    await env.DB.prepare('DELETE FROM ipday WHERE day < ?1').bind(kstDay(Date.now() - 86400000)).run();
  },
};
