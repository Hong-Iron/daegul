// 데굴 랭킹 서버 (Cloudflare Worker + D1)
// 랭킹은 도시(stage)마다 따로다.
//   POST /run    {stage, name, score, picks, arrived, bonus, clear, last, dia, secs} -> {ok, rank, today, best} 또는 {ok: false, why}
//   GET  /board?stage=...&scope=all|today -> {rows: [{name, score, arrived, last, clear}]}   (30초 캐시)
//   GET  /me?stage=...&name=...&scope=all|today -> {rank, score, arrived, last} 또는 {rank: null}
// 이름은 게임과 같은 규칙(site/names.js)으로 다시 거른다. 점수는 판의 내용과 맞는지 본다:
//   점수 = 붙인 개수 + 도착 수 × 100 + 보너스(도전 성공 300씩, 도시 클리어 1000) / 도착은 한 판에 7곳까지, 시간에 맞아야 한다 / 붙인 개수는 1초에 500개까지
//   코스 순서는 판마다 무작위라 마지막 도착 학교는 게임이 보내고, 서버는 그 이름이 코스에 있는지만 본다
//   IP 하나는 5초에 한 번, 하루 300판까지. 진짜 IP는 cf-connecting-ip(Cloudflare가 붙이고 브라우저가 꾸밀 수 없다)만 쓴다
import { checkName, nameKey } from '../../site/names.js';
import course from '../../site/course/index.json';

const LABELS = new Set(course.map((c) => c.label)), STAGES = new Set(course.map((c) => c.stage)), PER_RUN = 7, CAMPUSES = course.length;
const PICKS_PER_SEC = 500, MIN_GAP = 5, IP_DAY = 300, BOARD_TTL = 30, TOP = 50;
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

export function checkRun(body) {
  const nm = checkName(body?.name);
  if (!nm.ok) return { ok: false, why: nm.why };
  const stage = String(body.stage ?? '');
  if (!STAGES.has(stage)) return { ok: false, why: 'stage' };
  const bonus = int(body.bonus), clear = body.clear === true;
  if (bonus < 0 || bonus % 100 || bonus > (PER_RUN - 1) * 300 + (clear ? 1000 : 0) || (clear && bonus < 1000)) return { ok: false, why: 'bonus' };
  const score = int(body.score), picks = int(body.picks), arrived = int(body.arrived), secs = Number(body.secs), dia = Number(body.dia);
  if (!(secs >= 3 && secs <= 6 * 3600)) return { ok: false, why: 'time' };
  if (picks < 0 || picks > secs * PICKS_PER_SEC) return { ok: false, why: 'picks' };
  if (arrived < 0 || arrived > PER_RUN || arrived > secs / 2 + 1 || (clear && arrived < PER_RUN)) return { ok: false, why: 'arrived' };
  const last = arrived > 0 ? String(body.last ?? '') : null;
  if (arrived > 0 && !LABELS.has(last)) return { ok: false, why: 'last' };
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
  const day = kstDay(nowMs), now = nowMs / 1000, k = await hash(`${ip}|${day}`);
  const row = await env.DB.prepare('SELECT n, at FROM ipday WHERE k = ?1 AND day = ?2').bind(k, day).first();
  if (row && (row.n >= IP_DAY || now - row.at < MIN_GAP)) return { ok: false, why: 'too often' };
  const at = Math.floor(now);
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO ipday (k, day, n, at) VALUES (?1, ?2, 1, ?3)
      ON CONFLICT (k, day) DO UPDATE SET n = n + 1, at = ?3`).bind(k, day, now),
    env.DB.prepare(`INSERT INTO runs (stage, day, key, name, score, picks, arrived, bonus, clear, last, secs, dia, at, ipk)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`)
      .bind(r.stage, day, r.key, r.name, r.score, r.picks, r.arrived, r.bonus, r.clear, r.last, r.secs, r.dia, at, k),
    env.DB.prepare(`INSERT INTO best (stage, key, name, score, arrived, clear, last, at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
      ON CONFLICT (stage, key) DO UPDATE SET name = excluded.name, score = excluded.score, arrived = excluded.arrived, clear = excluded.clear, last = excluded.last, at = excluded.at
      WHERE excluded.score > best.score`).bind(r.stage, r.key, r.name, r.score, r.arrived, r.clear, r.last, at),
    env.DB.prepare(`INSERT INTO best_day (stage, day, key, name, score, arrived, clear, last, at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
      ON CONFLICT (stage, day, key) DO UPDATE SET name = excluded.name, score = excluded.score, arrived = excluded.arrived, clear = excluded.clear, last = excluded.last, at = excluded.at
      WHERE excluded.score > best_day.score`).bind(r.stage, day, r.key, r.name, r.score, r.arrived, r.clear, r.last, at),
  ]);
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
    if (url.pathname === '/run' && req.method === 'POST') {
      let body = null;
      try { body = await req.json(); } catch { return reply({ ok: false, why: 'bad json' }, 400); }
      const r = await addRun(env, body, req.headers.get('cf-connecting-ip'));
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
