// 아주 단순한 JSON 파일 기반 저장소.
// 규모가 작은 프로토타입이라 별도 DB 서버 없이 파일 하나로 충분합니다.
// 나중에 트래픽이 커지면 better-sqlite3나 Postgres로 바꾸면 됩니다.

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "deals.json");
const MAX_ITEMS = 1000; // 오래된 딜은 자동으로 정리
const MAX_AGE_DAYS = 7;

function ensureFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "[]", "utf-8");
}

function readAll() {
  ensureFile();
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    console.error("[db] deals.json 읽기 실패, 빈 배열로 초기화:", err.message);
    return [];
  }
}

function writeAll(deals) {
  ensureFile();
  fs.writeFileSync(DATA_FILE, JSON.stringify(deals, null, 2), "utf-8");
}

// 새로 크롤링한 딜 목록을 기존 저장소에 병합.
// url을 기준으로 중복 제거하고, 이미 있던 글이면 최신 필드(추천수, 댓글수, 종료여부 등)로 갱신.
function upsertDeals(newDeals) {
  const existing = readAll();
  const byUrl = new Map(existing.map((d) => [d.url, d]));

  for (const deal of newDeals) {
    if (!deal.url) continue;
    const prev = byUrl.get(deal.url);
    byUrl.set(deal.url, {
      ...prev,
      ...deal,
      firstSeenAt: prev ? prev.firstSeenAt : deal.crawledAt,
    });
  }

  let merged = Array.from(byUrl.values());

  // 오래된 항목 정리
  const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  merged = merged.filter((d) => {
    const t = Date.parse(d.firstSeenAt || d.crawledAt || 0);
    return Number.isNaN(t) ? true : t >= cutoff;
  });

  // 최신순 정렬 후 개수 제한
  merged.sort((a, b) => Date.parse(b.crawledAt) - Date.parse(a.crawledAt));
  if (merged.length > MAX_ITEMS) merged = merged.slice(0, MAX_ITEMS);

  writeAll(merged);
  return merged;
}

module.exports = { readAll, writeAll, upsertDeals };
