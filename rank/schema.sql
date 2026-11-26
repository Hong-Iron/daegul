-- 데굴 랭킹 (Cloudflare D1). 랭킹은 도시(stage)마다 따로다
-- runs.tok은 2026-11-26에 더했다(이미 있는 DB: ALTER TABLE runs ADD COLUMN tok TEXT)
-- best: 도시·이름마다 가장 높은 점수 한 줄, best_day: 날짜(KST)·도시·이름마다 가장 높은 점수, runs: 모든 판 기록, ipday: IP별 하루 제출 수
CREATE TABLE IF NOT EXISTS best (stage TEXT NOT NULL, key TEXT NOT NULL, name TEXT NOT NULL, score INTEGER NOT NULL, arrived INTEGER NOT NULL,
  clear INTEGER NOT NULL DEFAULT 0, last TEXT, at INTEGER NOT NULL, PRIMARY KEY (stage, key));
CREATE INDEX IF NOT EXISTS best_score ON best (stage, score DESC);
CREATE TABLE IF NOT EXISTS best_day (stage TEXT NOT NULL, day TEXT NOT NULL, key TEXT NOT NULL, name TEXT NOT NULL, score INTEGER NOT NULL, arrived INTEGER NOT NULL,
  clear INTEGER NOT NULL DEFAULT 0, last TEXT, at INTEGER NOT NULL, PRIMARY KEY (stage, day, key));
CREATE INDEX IF NOT EXISTS best_day_score ON best_day (stage, day, score DESC);
CREATE TABLE IF NOT EXISTS runs (id INTEGER PRIMARY KEY, stage TEXT NOT NULL, day TEXT NOT NULL, key TEXT NOT NULL, name TEXT NOT NULL, score INTEGER NOT NULL,
  picks INTEGER NOT NULL, arrived INTEGER NOT NULL, bonus INTEGER NOT NULL, clear INTEGER NOT NULL, last TEXT, secs REAL NOT NULL, dia REAL NOT NULL, at INTEGER NOT NULL, ipk TEXT NOT NULL, tok TEXT);
-- 표(/start) 하나로 기록은 한 번만
CREATE UNIQUE INDEX IF NOT EXISTS runs_tok ON runs (tok);
CREATE TABLE IF NOT EXISTS ipday (k TEXT NOT NULL, day TEXT NOT NULL, n INTEGER NOT NULL, at REAL NOT NULL, PRIMARY KEY (k, day));
