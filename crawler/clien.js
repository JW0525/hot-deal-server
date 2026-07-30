const cheerio = require("cheerio");
const { fetchHtml, extractPriceKRW, parseCompactNumber, pickImageSrc, resolveUrl, normalizeCategory } = require("./utils");

const LIST_URL = "https://www.clien.net/service/board/jirum";
const BASE_URL = "https://www.clien.net";

// 클리앙은 리스트 아이템이 보통 div.list_item 블록으로 묶여 있습니다.
// (사이트 개편으로 클래스명이 바뀌면 아래 SELECTOR들을 브라우저 개발자도구로 확인 후 수정하면 됩니다.)
async function crawlClien() {
  let html;
  try {
    html = await fetchHtml(LIST_URL, { encoding: "utf-8" });
  } catch (err) {
    console.error("[clien] 목록 요청 실패:", err.message);
    return [];
  }

  const $ = cheerio.load(html);
  let itemEls = $("div.list_item.symph_row, div.list_item").toArray();
  if (itemEls.length === 0) {
    // 클래스명이 바뀐 경우를 대비한 폴백: 알뜰구매 게시글 링크 기준으로 컨테이너를 추정
    itemEls = $('a[href*="/service/board/jirum/"]')
      .filter((_, el) => !$(el).attr("href").includes("#"))
      .map((_, el) => $(el).closest("div").get(0))
      .toArray();
  }

  const deals = [];
  const now = new Date().toISOString();
  const seen = new Set();

  itemEls.forEach((item) => {
    const $item = $(item);
    const $titleLink = $item
      .find('a[href*="/service/board/jirum/"]')
      .filter((_, el) => !$(el).attr("href").includes("#"))
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
    seen.add(url);

    const title =
      $titleLink.find(".subject_fixed").text().trim() || $titleLink.text().trim();
    if (!title) return;

    const category = normalizeCategory(
      $item.find('a[href*="jirum?category="]').first().text().trim()
    );

    const author =
      $item.find(".nickname, .list_author").first().text().trim() || "";

    const commentText = $item
      .find('a[href*="#comment-point"]')
      .first()
      .text()
      .trim();
    const commentCount = commentText ? parseInt(commentText, 10) || 0 : 0;

    const viewText = $item.find(".list_hit, .hit").first().text().trim();
    const viewCount = parseCompactNumber(viewText);

    const rowText = $item.text().replace(/\s+/g, " ").trim();
    const ended = /품절|종료/.test(title) || /품절|종료/.test(rowText.slice(0, 20));
    const timeMatch = rowText.match(
      /(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}|\d{2}:\d{2}:\d{2}|\d{2}-\d{2})\s*$/
    );
    const postedLabel = timeMatch ? timeMatch[1] : "";

    const idMatch = url.match(/jirum\/(\d+)/);

    deals.push({
      id: `clien-${idMatch ? idMatch[1] : url}`,
      source: "클리앙",
      title,
      price: extractPriceKRW(title),
      category,
      author,
      url,
      commentCount,
      recommend: 0, // 클리앙 공감수는 마크업 변경이 잦아 기본값 0 (필요시 아래 주석 참고)
      viewCount,
      postedLabel,
      thumbnail: resolveUrl(pickImageSrc($item.find("img").first()), BASE_URL),
      ended,
      crawledAt: now,
    });
  });

  console.log(`[clien] ${deals.length}개 파싱 완료`);
  return deals;
}

module.exports = { crawlClien };
