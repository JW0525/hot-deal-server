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

// 정렬 기준이 되는 인기 점수(hotScore)를 매긴다.
//
// 왜 필요한가: 사이트마다 추천수 단위가 완전히 다르다.
// 루리웹은 200점대가 나오는데 클리앙은 최고가 한 자리 수다.
// 추천수를 그대로 비교하면 인기 딜 목록이 루리웹 독차지가 되고,
// 클리앙에서 아무리 반응이 좋아도 절대 위로 못 올라온다.
// 그래서 절대값 대신 "그 사이트 안에서 얼마나 잘나가는 글인지"로 환산한다.

/** 오름차순 정렬 후 p 위치의 값. p=0.9면 상위 10% 경계값. */
function percentile(values, p) {
  const nums = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (nums.length === 0) return 0;
  const idx = Math.ceil(p * (nums.length - 1));
  return nums[Math.min(idx, nums.length - 1)];
}

function computeHotScores(deals) {
  const bySource = new Map();
  for (const deal of deals) {
    const key = deal.source || "기타";
    if (!bySource.has(key)) bySource.set(key, []);
    bySource.get(key).push(deal);
  }

  const now = Date.now();

  for (const list of bySource.values()) {
    // 최고값 대신 상위 10% 지점을 기준으로 삼는다.
    // 어쩌다 터진 글 하나가 기준이 되면 나머지 점수가 전부 0에 붙어버린다.
    const recRef = percentile(list.map((d) => d.recommend || 0), 0.9);
    const cmRef = percentile(list.map((d) => d.commentCount || 0), 0.9);

    // 기준값 대비 비율을 0~1 사이로 눌러 담는다. x/(1+x) 곡선이라
    // 위로 갈수록 점수가 천천히 오르지만 순서는 절대 뒤섞이지 않는다.
    // (그냥 1로 잘라내면 상위 10%가 전부 동점이 돼서 줄 세우기가 안 된다)
    const squash = (value, ref) => {
      if (!(ref > 0)) return 0;
      const ratio = (value || 0) / ref;
      return ratio / (1 + ratio);
    };

    for (const deal of list) {
      const rec = squash(deal.recommend, recRef);
      const cm = squash(deal.commentCount, cmRef);

      // 추천을 더 믿되, 추천수를 잘 안 주는 사이트도 있어서 댓글도 섞는다.
      //
      // 단, 어떤 사이트는 둘 중 한쪽이 통째로 안 들어올 수 있다(크롤링 실패나 사이트 개편).
      // 그때 배점을 그냥 두면 그 사이트 전체 점수 상한이 눌려서 목록에서 통째로 밀려난다.
      // 그래서 있는 신호에만 배점을 몰아준다.
      const wRec = recRef > 0 ? 0.65 : 0;
      const wCm = cmRef > 0 ? 0.35 : 0;
      const total = wRec + wCm;
      let score = total > 0 ? (rec * wRec + cm * wCm) / total : 0;

      // 신선도: 핫딜은 시간이 지나면 가치가 떨어진다.
      // 처음 발견하고 6시간까지는 그대로, 이후 사흘에 걸쳐 서서히 깎는다.
      const seen = Date.parse(deal.firstSeenAt || deal.crawledAt || "");
      if (Number.isFinite(seen)) {
        const hours = (now - seen) / 3600000;
        const fresh = hours <= 6 ? 1 : Math.max(0.35, 1 - (hours - 6) / 66);
        score *= fresh;
      }

      // 이미 끝난 딜은 위로 올릴 이유가 없다.
      if (deal.ended) score *= 0.15;

      deal.hotScore = Math.round(score * 1000) / 1000;
    }
  }

  return deals;
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

  // 점수는 남아 있는 딜 전체를 놓고 매번 다시 계산한다.
  // 기준값(상위 10%)과 신선도가 시간에 따라 달라지기 때문이다.
  computeHotScores(merged);

  writeAll(merged);
  return merged;
}

module.exports = { readAll, writeAll, upsertDeals, computeHotScores };
