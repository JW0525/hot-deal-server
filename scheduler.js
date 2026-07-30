const cron = require("node-cron");
const { runFullCrawl } = require("./crawler");

// 매시 정각에 크롤링 (요청하신 "1시간마다" 주기)
const CRON_EXPRESSION = "0 * * * *";

function startScheduler() {
  console.log("[scheduler] 서버 시작 직후 1회 크롤링을 실행합니다...");
  runFullCrawl().catch((err) => console.error("[scheduler] 초기 크롤링 실패:", err));

  cron.schedule(CRON_EXPRESSION, () => {
    console.log("[scheduler] 정기 크롤링 시작 (매시 정각)");
    runFullCrawl().catch((err) => console.error("[scheduler] 정기 크롤링 실패:", err));
  });

  console.log(`[scheduler] 크론 등록 완료: "${CRON_EXPRESSION}" (1시간마다)`);
}

module.exports = { startScheduler };
