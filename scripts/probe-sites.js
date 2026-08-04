/**
 * 새로 넣을 핫딜 게시판 후보가 "우리가 실제로 도는 환경에서" 접근 가능한지 확인한다.
 *
 * 이걸 따로 만든 이유: 퀘이사존은 개인 PC에서는 잘 되는데 GitHub Actions에서만 403이었다.
 * 즉 내 맥에서 되는 걸 확인해봐야 소용이 없다. 반드시 Actions 안에서 돌려봐야 한다.
 * (워크플로 파일은 권한 때문에 못 고치므로, 크롤 단계에서 이 스크립트를 함께 실행해 확인한다)
 *
 *   node scripts/probe-sites.js
 */

const axios = require("axios");
const cheerio = require("cheerio");

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
  "Upgrade-Insecure-Requests": "1",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
};

const CANDIDATES = [
  { name: "딜바다", url: "https://www.dealbada.com/bbs/board.php?bo_table=deal_domestic" },
  { name: "쿨엔조이", url: "https://coolenjoy.net/bbs/jirum" },
  { name: "알구몬", url: "https://www.algumon.com/" },
  { name: "zod(조드)", url: "https://zod.kr/deal" },
  { name: "아카라이브", url: "https://arca.live/b/hotdeal" },
  { name: "에펨코리아", url: "https://www.fmkorea.com/hotdeal" },
  { name: "미니기기코리아", url: "https://mini.minigi.co.kr/" },
  { name: "퀘이사존(대조군)", url: "https://quasarzone.com/bbs/qb_saleinfo" },
];

(async () => {
  for (const c of CANDIDATES) {
    let line = `${c.name.padEnd(16)}`;
    try {
      const res = await axios.get(c.url, {
        headers: HEADERS,
        timeout: 15000,
        responseType: "text",
        validateStatus: () => true,
        maxRedirects: 3,
      });
      const body = typeof res.data === "string" ? res.data : "";
      const $ = cheerio.load(body || "");
      // 게시판이면 링크가 최소 수십 개는 나온다. 차단 페이지는 몇 개 안 된다.
      const links = $("a[href]").length;
      const won = (body.match(/원/g) || []).length; // 가격 표기가 얼마나 있나
      line += `HTTP ${res.status} | 링크 ${String(links).padStart(4)}개 | '원' ${String(won).padStart(4)}회 | ${(body.length / 1024).toFixed(0)}KB`;
    } catch (err) {
      line += `실패: ${err.code || err.message}`;
    }
    console.log(line);
    await new Promise((r) => setTimeout(r, 1200));
  }
})();
