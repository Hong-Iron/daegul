// Worker를 Cloudflare와 같은 실행기(workerd)에 올려 실제 요청으로 확인한다. 데이터베이스는 매번 임시 폴더에 새로 만든다
// usage: node test/worker_test.mjs   -> 모두 맞으면 ALL CHECKS PASSED
import { unstable_startWorker, getPlatformProxy } from 'wrangler';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url);
const statements = (sql) => sql.split(/;\s*\n/).map((s) => s.replace(/--.*$/gm, '').trim()).filter(Boolean);
const config = new URL('wrangler.toml', root).pathname;
const persist = mkdtempSync(join(tmpdir(), 'degul-rank-test-'));
const proxy = await getPlatformProxy({ configPath: config, persist: { path: join(persist, 'v3') } });
const db = proxy.env.DB;
for (const s of statements(readFileSync(new URL('schema.sql', root), 'utf8'))) await db.prepare(s).run();
const w = await unstable_startWorker({ config, dev: { persist, server: { port: 0 }, inspector: false, watch: false, logLevel: 'error' } });
await w.ready;

let ok = true;
const check = (name, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want); ok &&= good;
  console.log(good ? 'OK  ' : 'FAIL', name, JSON.stringify(got), good ? '' : `(want ${JSON.stringify(want)})`);
};
const run = async (body, ip = '1.1.1.1') => {
  const r = await w.fetch('http://rank.test/run', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip }, body: JSON.stringify(body) });
  return [r.status, await r.json()];
};
const get = async (path) => (await w.fetch(`http://rank.test${path}`)).json();
const good = (name, picks, arrived, secs = 120, last = '한림대') => ({ name, score: picks + arrived * 100, picks, arrived, last, secs, dia: 12.3 });

const opt = await w.fetch('http://rank.test/run', { method: 'OPTIONS' });
check('preflight 204 + CORS', [opt.status, opt.headers.get('access-control-allow-origin')], [204, '*']);
let [st, r] = await run(good('홍철', 500, 5));
check('first run', [st, r.ok, r.rank, r.today, r.best], [200, true, 1, 1, 1000]);
[st, r] = await run(good('씨1발', 10, 1), '2.2.2.2');
check('bad name refused', [st, r.ok, r.why], [400, false, '쓸 수 없는 이름이에요']);
[st, r] = await run({ ...good('김민수', 10, 1), score: 999999 }, '2.2.2.2');
check('score must equal picks + arrived x 100', [st, r.why], [400, 'score']);
[st, r] = await run(good('김민수', 10, 300, 60), '2.2.2.2');
check('too many campuses for the time', [st, r.why], [400, 'arrived']);
[st, r] = await run(good('김민수', 60 * 600, 3, 60), '2.2.2.2');
check('too many picks for the time', [st, r.why], [400, 'picks']);
[st, r] = await run(good('김민수', 300, 3), '3.3.3.3');
check('second player ranks 2nd', [st, r.rank], [200, 2]);
[st, r] = await run(good('김민수', 100, 1), '3.3.3.3');
check('same IP within 5 s refused', [st, r.why], [400, 'too often']);
[st, r] = await run(good('홍 철', 100, 1), '4.4.4.4');
check('lower score keeps the best (space ignored in the name key)', [st, r.best], [200, 1000]);
[st, r] = await run(good('HongIron', 2000, 12), '5.5.5.5');
check('higher score takes 1st', [st, r.rank], [200, 1]);
const b = await get('/board?scope=all');
check('board order with the last campus reached', b.rows.map((x) => [x.name, x.score, x.last]), [['HongIron', 3200, '한림대'], ['홍철', 1000, '한림대'], ['김민수', 600, '한림대']]);
check('today board', (await get('/board?scope=today')).rows.length, 3);
check('me', await get(`/me?name=${encodeURIComponent('홍철')}&scope=all`), { rank: 2, score: 1000, arrived: 5, last: '한림대' });
[st, r] = await run(good('없는학교', 10, 1, 120, '가짜대학'), '6.6.6.6');
check('unknown campus label refused', [st, r.why], [400, 'last']);
check('me unknown', await get('/me?name=nobody&scope=all'), { rank: null });
check('runs kept', await db.prepare('SELECT COUNT(*) AS n FROM runs').first('n'), 4);

await w.dispose(); await proxy.dispose();
console.log(ok ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED');
process.exit(ok ? 0 : 1);
