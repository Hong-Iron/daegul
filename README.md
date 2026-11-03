# 데굴

전국 대학 캠퍼스 337곳을 북쪽(경동대 설악)부터 남쪽(제주대 아라)까지 내리막으로 이어 붙이고, 공을 굴려 물건과 건물 블록을 붙이며 내려가는 모바일 3D 웹게임. 멈추면 끝.

- `site/index.html` — 게임 전체(three.js 0.160, CDN)
- `site/course/index.json` — 북→남으로 정렬한 캠퍼스 목록, `site/course/<CODE>.json` — 캠퍼스별 건물·도로·나무
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
