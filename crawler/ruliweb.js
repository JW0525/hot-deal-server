const cheerio = require("cheerio");
const { fetchHtml, extractPriceKRW, pickImageSrc, resolveUrl, normalizeCategory } = require("./utils");

const LIST_URL = "https://bbs.ruliweb.com/market/board/1020";
const BASE_URL = "https://bbs.ruliweb.com";

// 루리웹 핫딜 게시판은 진짜 <table> 구조라 다른 사이트보다 파싱이 안정적입니다.
// 컬럼 순서: ID | 구분 | 제목 | 글쓴이 | 추천 | 조회 | 날짜
async function crawlRuliweb() {
  let html;
  try {
    html = await fetchHtml(LIST_URL, { encoding: "utf-8" });
  } catch (err) {
    console.error("[ruliweb] 목록 요청 실패:", err.message);
    return [];
  }

  const $ = cheerio.load(html);
  const deals = [];
  const now = new Date().toISOString();
  const seen = new Set();

  $("table tr").each((_, tr) => {
    const $tr = $(tr);
    const $titleLink = $tr
      .find('a[href*="/market/board/1020/read/"]')
      .filter((_, el) => $(el).text().trim().length > 3)
      .first();

    const href = $titleLink.attr("href");
    if (!href) return;

    let url;
    try {
      url = new URL(href, BASE_URL).href.split("?")[0];
    } catch {
      return;
    }
    if (seen.has(url)) return;

    let title = $titleLink.text().trim();
    if (!title) return;
    const ended = /종료|품절/.test(title);
    title = title.replace(/^\[?(종료|품절)\]?\s*/, "").trim();

    const tds = $tr.find("td");
    let category = "기타";
    let author = "";
    let recommend = 0;
    let viewCount = 0;
    let postedLabel = "";

    if (tds.length >= 6) {
      category = $(tds[1]).text().trim() || "기타";
      author = $(tds[3]).text().trim();
      recommend = parseInt($(tds[4]).text().trim(), 10) || 0;
      viewCount = parseInt($(tds[5]).text().replace(/,/g, "").trim(), 10) || 0;
      postedLabel = $(tds[6]).text().trim();
    }

    // 공지/운영 안내 글은 딜이 아니므로 건너뜀 (정규화 전 원본 카테고리로 판단)
    if (/공지/.test(category)) return;
    category = normalizeCategory(category);

    seen.add(url);

    const idMatch = url.match(/read\/(\d+)/);
    deals.push({
      id: `ruliweb-${idMatch ? idMatch[1] : url}`,
      source: "루리웹",
      title,
      price: extractPriceKRW(title),
      category,
      author,
      url,
      commentCount: 0,
      recommend,
      viewCount,
      postedLabel,
      thumbnail: resolveUrl(pickImageSrc($tr.find("img").first()), BASE_URL),
      ended,
      crawledAt: now,
    });
  });

  console.log(`[ruliweb] ${deals.length}개 파싱 완료`);
  return deals;
}

module.exports = { crawlRuliweb };
