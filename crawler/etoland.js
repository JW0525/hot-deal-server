const cheerio = require("cheerio");
const {
  fetchHtml,
  extractPriceKRW,
  pickImageSrc,
  resolveUrl,
  normalizeCategory,
} = require("./utils");

const LIST_URL = "https://etoland.co.kr/b/hotdeal/list";
const BASE_URL = "https://etoland.co.kr";

// 이토랜드는 표가 아니라 li 목록이고 클래스명이 Tailwind라 의미가 없다.
// 대신 각 항목의 아래쪽 메타 줄이 " | " 로 또렷하게 구분돼 있어 그걸 쪼갠다.
//
//   가전 | 45분전 | 토스쇼핑 | 5 | 100
//   분류   시각     쇼핑몰     추천  조회
const META_KEYS = ["category", "postedLabel", "mall", "recommend", "viewCount"];

async function crawlEtoland() {
  let html;
  try {
    html = await fetchHtml(LIST_URL, { encoding: "utf-8" });
  } catch (err) {
    console.error("[etoland] 목록 요청 실패:", err.message);
    return [];
  }

  const $ = cheerio.load(html);
  const deals = [];
  const now = new Date().toISOString();
  const seen = new Set();

  $('li:has(a[href*="/b/hotdeal/view"])').each((_, li) => {
    const $li = $(li);
    // 항목을 감싸는 바깥 li까지 걸리면 같은 글이 여러 번 잡힌다. 가장 안쪽만 쓴다.
    if ($li.find("li").length > 0) return;

    const href = $li.find('a[href*="/b/hotdeal/view"]').first().attr("href");
    if (!href) return;
    const url = resolveUrl(href, BASE_URL);
    if (!url) return;

    // 주소 끝의 숫자가 글 번호다. (…-소곱창-9237034)
    const idMatch = url.match(/-(\d+)(?:[/?#]|$)/);
    if (!idMatch) return;
    const id = `etoland-${idMatch[1]}`;
    if (seen.has(id)) return;
    seen.add(id);

    const title = $li.find("b").first().text().replace(/\s+/g, " ").trim();
    if (!title || /^공지/.test(title)) return;

    // 제목 옆 "(7)" 이 댓글 수다.
    const commentText = $li.find("span.text-comment").first().text().trim();
    const commentMatch = commentText.match(/\((\d+)\)/);

    // 가격은 "68,900원" 처럼 별도 span에 들어 있다. 없으면 제목에서 찾는다.
    const priceText = $li
      .find("span")
      .filter((_, el) => /^[\d,]+원$/.test($(el).text().trim()))
      .first()
      .text();

    const metaText = $li.find("div.caption-m").last().text().replace(/\s+/g, " ").trim();
    const meta = {};
    metaText.split("|").forEach((part, i) => {
      if (META_KEYS[i]) meta[META_KEYS[i]] = part.trim();
    });

    deals.push({
      id,
      source: "이토랜드",
      title,
      price: extractPriceKRW(priceText) ?? extractPriceKRW(title),
      category: normalizeCategory(meta.category),
      author: meta.mall || null, // 글쓴이 대신 쇼핑몰 이름이 더 쓸모 있다
      url,
      commentCount: commentMatch ? Number(commentMatch[1]) : 0,
      recommend: Number((meta.recommend || "").replace(/[^\d]/g, "")) || 0,
      viewCount: Number((meta.viewCount || "").replace(/[^\d]/g, "")) || 0,
      postedLabel: meta.postedLabel || null,
      thumbnail: resolveUrl(pickImageSrc($li.find("img").first()), BASE_URL),
      ended: /\[?\s*(종료|품절|마감)\s*\]?/.test(title),
      crawledAt: now,
    });
  });

  console.log(`[etoland] ${deals.length}개 파싱 완료`);
  return deals;
}

module.exports = { crawlEtoland };
