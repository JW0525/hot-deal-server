const cheerio = require("cheerio");
const { fetchHtml, extractPriceKRW, pickImageSrc, resolveUrl, normalizeCategory } = require("./utils");

const LIST_URL = "https://eomisae.co.kr/fs";
const BASE_URL = "https://eomisae.co.kr";

// 어미새는 카드형 레이아웃이라 정확한 클래스명 대신 링크 패턴(/fs/숫자)으로 항목을 찾고,
// 주변 텍스트에서 카테고리/날짜/통계 숫자를 정규식으로 추정합니다.
async function crawlEomisae() {
  let html;
  try {
    html = await fetchHtml(LIST_URL, { encoding: "utf-8" });
  } catch (err) {
    console.error("[eomisae] 목록 요청 실패:", err.message);
    return [];
  }

  const $ = cheerio.load(html);
  const deals = [];
  const now = new Date().toISOString();
  const seen = new Set();

  $('a[href*="/fs/"]').each((_, el) => {
    const $el = $(el);
    const href = $el.attr("href");
    if (!href) return;
    const cleanHref = href.split("?")[0];
    if (!/\/fs\/\d+$/.test(cleanHref)) return;

    const title = $el.text().trim();
    if (!title || title === "Read More") return;
    if (/게시판 이용|상품권 이벤트|이용\s*규정/.test(title)) return;

    let url;
    try {
      url = new URL(cleanHref, BASE_URL).href;
    } catch {
      return;
    }
    if (seen.has(url)) return;
    seen.add(url);

    // 제목 링크에서 3~4단계 위로 올라가 카드 하나의 텍스트 범위를 대략 확보
    let $container = $el;
    for (let i = 0; i < 4; i++) {
      if ($container.parent().length) $container = $container.parent();
    }
    const rowText = $container.text().replace(/\s+/g, " ").trim();

    const catDateMatch = rowText.match(/([가-힣A-Za-z]+),\s*(\d{2}\.\d{2}\.\d{2})/);
    const category = normalizeCategory(catDateMatch ? catDateMatch[1] : "");
    const postedLabel = catDateMatch ? catDateMatch[2] : "";

    const numsMatch = rowText.match(/(\d+)\s+(\d+)\s+(\d+)\s*$/);
    const viewCount = numsMatch ? parseInt(numsMatch[1], 10) : 0;
    const commentCount = numsMatch ? parseInt(numsMatch[2], 10) : 0;
    const recommend = numsMatch ? parseInt(numsMatch[3], 10) : 0;

    const idMatch = url.match(/\/fs\/(\d+)/);
    deals.push({
      id: `eomisae-${idMatch ? idMatch[1] : url}`,
      source: "어미새",
      title: title.replace(/^(인기글|공지|추가|광고)\)?\s*/, "").trim(),
      price: extractPriceKRW(title),
      category,
      author: "",
      url,
      commentCount,
      recommend,
      viewCount,
      postedLabel,
      thumbnail: resolveUrl(pickImageSrc($container.find("img").first()), BASE_URL),
      ended: /품절|종료/.test(title),
      crawledAt: now,
    });
  });

  console.log(`[eomisae] ${deals.length}개 파싱 완료`);
  return deals;
}

module.exports = { crawlEomisae };
