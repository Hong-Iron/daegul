-- 데굴 랭킹 (Cloudflare D1)
-- best: 이름마다 가장 높은 점수 한 줄, best_day: 날짜(KST)마다 이름별 가장 높은 점수, runs: 모든 판 기록, ipday: IP별 하루 제출 수
CREATE TABLE IF NOT EXISTS best (key TEXT PRIMARY KEY, name TEXT NOT NULL, score INTEGER NOT NULL, arrived INTEGER NOT NULL, last TEXT, at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS best_score ON best (score DESC);
CREATE TABLE IF NOT EXISTS best_day (day TEXT NOT NULL, key TEXT NOT NULL, name TEXT NOT NULL, score INTEGER NOT NULL, arrived INTEGER NOT NULL, last TEXT, at INTEGER NOT NULL, PRIMARY KEY (day, key));
CREATE INDEX IF NOT EXISTS best_day_score ON best_day (day, score DESC);
CREATE TABLE IF NOT EXISTS runs (id INTEGER PRIMARY KEY, day TEXT NOT NULL, key TEXT NOT NULL, name TEXT NOT NULL, score INTEGER NOT NULL,
  picks INTEGER NOT NULL, arrived INTEGER NOT NULL, last TEXT, secs REAL NOT NULL, dia REAL NOT NULL, at INTEGER NOT NULL, ipk TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ipday (k TEXT NOT NULL, day TEXT NOT NULL, n INTEGER NOT NULL, at REAL NOT NULL, PRIMARY KEY (k, day));
