const { crawlPpomppu } = require("./ppomppu");
const { crawlClien } = require("./clien");
const { crawlQuasarzone } = require("./quasarzone");
const { crawlEomisae } = require("./eomisae");
const { crawlRuliweb } = require("./ruliweb");
const { upsertDeals } = require("../db");
const { sleep, verifyThumbnails } = require("./utils");

let isRunning = false;
let lastRunAt = null;
let lastRunResult = null;

// 크롤링할 사이트 목록. 새 사이트를 추가하려면 여기에 한 줄만 더하면 됩니다.
const SOURCES = [
  { name: "뽐뿌", fn: crawlPpomppu },
  { name: "클리앙", fn: crawlClien },
  { name: "퀘이사존", fn: crawlQuasarzone },
  { name: "어미새", fn: crawlEomisae },
  { name: "루리웹", fn: crawlRuliweb },
];

// 사이트를 한 번에 다 때리지 않고 살짝 텀을 둬서 상대 서버 부담을 줄입니다.
async function runFullCrawl() {
  if (isRunning) {
    console.log("[crawler] 이미 실행 중이라 건너뜁니다.");
    return lastRunResult;
  }
  isRunning = true;
  const startedAt = Date.now();
  const result = { counts: {}, total: 0, errors: [] };

  try {
    for (let i = 0; i < SOURCES.length; i++) {
      const { name, fn } = SOURCES[i];
      try {
        const deals = await fn();
        // 썸네일이 실제로 열리는지 미리 확인해서, 카드에 카트 아이콘이나 깨진
        // 이미지가 뜰 만한 딜은 thumbnail을 비워서 저장한다(목록 정렬 시 맨 뒤로 밀림).
        await verifyThumbnails(deals);
        result.counts[name] = deals.length;
        upsertDeals(deals);
      } catch (err) {
        console.error(`[crawler] ${name} 크롤링 실패:`, err.message);
        result.counts[name] = 0;
        result.errors.push({ source: name, message: err.message });
      }
      if (i < SOURCES.length - 1) await sleep(1500);
    }

    result.total = Object.values(result.counts).reduce((a, b) => a + b, 0);
    result.tookMs = Date.now() - startedAt;
    lastRunAt = new Date().toISOString();
    lastRunResult = result;
    const summary = SOURCES.map((s) => `${s.name} ${result.counts[s.name] || 0}`).join(" / ");
    console.log(`[crawler] 크롤링 완료: ${summary} (총 ${result.total}건, ${result.tookMs}ms)`);
  } finally {
    isRunning = false;
  }

  return result;
}

function getStatus() {
  return { isRunning, lastRunAt, lastRunResult };
}

module.exports = { runFullCrawl, getStatus };
