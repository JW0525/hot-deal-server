const cheerio = require("cheerio");
const {
  fetchHtml,
  extractPriceKRW,
  pickImageSrc,
  resolveUrl,
  normalizeCategory,
} = require("./utils");

const LIST_URL = "https://bbasak.com/bbs/board.php?bo_table=bbasak1";
const BASE_URL = "https://bbasak.com";

// 빠삭도 딜바다처럼 그누보드 표 구조라 칸이 명확히 나뉜다.
//   td0 번호 / td1 분류 / td2 글쓴이 / td3 썸네일 / td4 제목 / td5 시각 / td6 추천 / td7 조회
async function crawlBbasak() {
  let html;
  try {
    html = await fetchHtml(LIST_URL, { encoding: "utf-8" });
  } catch (err) {
    console.error("[bbasak] 목록 요청 실패:", err.message);
    return [];
  }

  const $ = cheerio.load(html);
  const deals = [];
  const now = new Date().toISOString();
  const seen = new Set();

  $("tbody tr").each((_, tr) => {
    const $tr = $(tr);
    const tds = $tr.find("td");
    if (tds.length < 8) return;

    // 공지글은 번호 칸이 숫자가 아니다.
    if (!/^\d+$/.test(tds.eq(0).text().trim())) return;

    const href = $tr.find('a[href*="wr_id="]').first().attr("href");
    if (!href) return;
    // 링크가 https://bbasak.com:443/... 형태로 나온다. URL이 기본 포트를 정리해 준다.
    const url = resolveUrl(href, BASE_URL);
    if (!url) return;

    const idMatch = url.match(/wr_id=(\d+)/);
    if (!idMatch) return;
    const id = `bbasak-${idMatch[1]}`;
    if (seen.has(id)) return;
    seen.add(id);

    const title = tds.eq(4).text().replace(/\s+/g, " ").trim();
    if (!title) return;

    deals.push({
      id,
      source: "빠삭",
      title,
      price: extractPriceKRW(title),
      category: normalizeCategory(tds.eq(1).text().trim()),
      author: tds.eq(2).text().replace(/\s+/g, " ").trim() || null,
      url,
      commentCount: 0, // 목록에 댓글 수가 없다. 상세를 열어야 나오는데 그러면 요청이 30배가 된다.
      recommend: Number(tds.eq(6).text().replace(/[^\d]/g, "")) || 0,
      viewCount: Number(tds.eq(7).text().replace(/[^\d]/g, "")) || 0,
      postedLabel: tds.eq(5).text().trim() || null,
      thumbnail: resolveUrl(pickImageSrc(tds.eq(3).find("img").first()), BASE_URL),
      ended: /\[?\s*(종료|품절|마감)\s*\]?/.test(title),
      crawledAt: now,
    });
  });

  console.log(`[bbasak] ${deals.length}개 파싱 완료`);
  return deals;
}

module.exports = { crawlBbasak };
