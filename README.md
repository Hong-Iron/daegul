# 데굴

플레이: https://hong-iron.github.io/daegul/ (main에 push하면 `.github/workflows/pages.yml`이 `site/`를 올린다)

전국 대학 캠퍼스 337곳을 판마다 무작위 순서로 내리막에 이어 붙이고, 공을 굴려 물건과 건물 블록을 붙이며 내려가는 모바일 3D 웹게임. 멈추면 끝. 페이지를 열면 바로 굴러가고, 결과 화면에서 이름을 정해 랭킹에 올린다.

- `site/index.html` — 게임 전체(three.js 0.160, CDN)
- `site/names.js` — 랭킹 이름 규칙과 비속어 거르기(게임과 랭킹 서버가 같이 쓴다)
- `rank/` — 랭킹 서버(Cloudflare Worker + D1). `npm test`로 로컬 확인, 올리는 법은 아래
- `site/course/index.json` — 캠퍼스 목록(위도순, 게임이 판마다 섞는다), `site/course/<CODE>.json` — 캠퍼스별 건물·도로·나무
  (OSM © OpenStreetMap contributors, ODbL). 앞쪽 캠퍼스만 불러오고 지나간 캠퍼스는 지운다.
- `tools/build_course.py <hub schools.json> <campus.json 폴더>` — SMASH 저장소들의 data/campus.json에서 코스 데이터를 만든다
- `site/campus.json` — 이전 한 캠퍼스(중앙대) 버전이 쓰던 데이터

## 로컬 실행

```
python3 -m http.server 8770 --directory site
```

## 테스트 손잡이 (`window.__degul`)

- `await start()`, `await sim(sec)` — 그리지 않고 게임 논리만 돌려 점수·지름·도착 수를 기록 (`bot(true)`와 함께)
- `snap()` — 한 장 그리기, `bench(n)` — 프레임당 ms와 삼각형 수
- `cards()`, `card(i)`, `finish()`, `S.pulseLog`(점수칸이 커진 점수들)
- `content()` — 불러온 캠퍼스마다 처음 놓인 물건·건물 블록 수. 랭킹 서버의 `rank/src/content.json`(도시별 붙인 개수 상한)이 이걸로 잰 값이다:
  캠퍼스마다 `start(<CODE>)`로 첫 캠퍼스로 불러 가장 큰 값을 적는다. 물건 배치를 바꾸면 다시 잰다
- 주소에 `?bot`을 붙이면 자동으로 굴러간다

## 랭킹 서버 (`rank/`, 2026-11-26부터 운영)

https://degul-rank.smash-rank.workers.dev — Cloudflare Worker `degul-rank` + D1 `degul`. main에 push해도 올라가지 않으니 서버를 고치면 `npx wrangler deploy`.

- 판이 시작할 때 게임이 `POST /start`로 표를 받고, 끝나면 그 표와 함께 기록을 보낸다. 표는 `TOKEN_KEY` 비밀값으로 서명하고, 한 번만 쓸 수 있으며,
  판의 시간은 표를 받은 뒤 실제로 흐른 시간보다 길 수 없다(그래서 `sim()`으로 돌린 판은 올라가지 않는다)
- 점수 검사: 보너스는 도전 300점 단위(도착한 곳 수까지)와 클리어 1000점, 마지막 도착은 그 도시의 학교(7곳이면 보스),
  붙인 개수는 평균 1초 250개와 지나온 캠퍼스의 물건 수(`src/content.json`) 이내. 규칙은 `src/index.js` 맨 위에 있다
- 확인: `cd rank && npm test` (workerd에 올려 실제 요청으로 33가지를 본다)

처음부터 다시 만들 때:
```
cd rank && npm install
npx wrangler d1 create degul            # 나온 database_id를 wrangler.toml에 넣는다
npx wrangler d1 execute degul --remote --file schema.sql
openssl rand -hex 32 | npx wrangler secret put TOKEN_KEY
npx wrangler deploy
```
게임은 localhost에서는 `http://localhost:8787`(`npx wrangler dev --var TOKEN_KEY:아무값`), 그 밖에서는 위 주소를 쓴다. `?rank=<주소>`로 바꿔 볼 수 있다.
