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
- 주소에 `?bot`을 붙이면 자동으로 굴러간다

## 랭킹 서버 올리기 (처음 한 번)

```
cd rank && npm install
npx wrangler d1 create degul            # 나온 database_id를 wrangler.toml에 넣는다
npx wrangler d1 execute degul --remote --file schema.sql
npx wrangler deploy                     # https://degul-rank.smash-rank.workers.dev
```
게임은 localhost에서는 `http://localhost:8787`(wrangler dev), 그 밖에서는 위 주소를 쓴다. `?rank=<주소>`로 바꿔 볼 수 있다.
