# 데굴

중앙대학교 서울캠퍼스에서 공을 굴려 물건을 붙이며 키우는 모바일 3D 웹게임. 첫 버전(MVP).

- `site/index.html` — 게임 전체(three.js 0.160, CDN)
- `site/campus.json` — 캠퍼스 지도 데이터(SMASH-CAU와 같은 형식, OSM © OpenStreetMap contributors, ODbL)

## 로컬 실행

```
python3 -m http.server 8770 --directory site
```

## 테스트 손잡이 (`window.__degul`)

- `sim(sec)` — 그리지 않고 게임 논리만 돌려 지름 변화를 기록 (`bot(true)`와 함께)
- `snap()` — 한 장 그리기, `bench(n)` — 프레임당 ms와 삼각형 수
- `cards()`, `card(i)`, `finish()`, `counts()`
- 주소에 `?bot`을 붙이면 자동으로 굴러간다
