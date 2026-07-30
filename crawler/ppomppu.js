const cheerio = require("cheerio");
const { fetchHtml, extractPriceKRW, pickImageSrc, resolveUrl, normalizeCategory } = require("./utils");

const LIST_URL = "https://www.ppomppu.co.kr/zboard/zboard.php?id=ppomppu";
const BASE_URL = "https://www.ppomppu.co.kr/zboard/";

// 뽐뿌 게시판 한 줄 텍스트 예시:
// "723663 (냉동)닭가슴살 소시지 300g 6개(9,900원/무료) 26[상품/기타] 베이올레망고 26/07/30 14 - 0 7481"
// title 을 제거하고 남은 부분(meta)에서 댓글수/카테고리/작성자/날짜/추천-비추천/조회수를 정규식으로 뽑아낸다.
// 주의: 댓글수는 "[" 바로 앞에 공백 없이 붙어있다(예: "26["). 댓글이 0개면 숫자 없이 바로 "["로
// 시작하므로, digit과 "[" 사이에 \s*를 넣으면 앞쪽에 남아있는 글번호(예: "723720")를 댓글수로
// 잘못 매칭하는 버그가 생긴다. 그래서 공백 없이 바로 붙는 경우만 댓글수로 인식한다.
const META_REGEX =
  /(\d+)?\[([^[\]]{1,20})\]\s*(\S+)\s+(\d{2}\/\d{2}\/\d{2}|\d{2}:\d{2}:\d{2})\s+(?:(-?\d+)\s*-\s*(-?\d+)\s+)?(\d+)\s*$/;

async function crawlPpomppu() {
  let html;
  try {
    html = await fetchHtml(LIST_URL, { encoding: "euc-kr" });
  } catch (err) {
    console.error("[ppomppu] 목록 요청 실패:", err.message);
    return [];
  }

  const $ = cheerio.load(html);
  const rows = new Map();

  $('a[href*="view.php?id=ppomppu"]').each((_, el) => {
    const $el = $(el);
    const href = $el.attr("href");
    const text = $el.text().trim();
    if (!href || !href.includes("no=") || !text) return;

    let absUrl;
    try {
      absUrl = new URL(href, BASE_URL).href;
    } catch {
      return;
    }

    const existing = rows.get(absUrl);
    if (!existing || text.length > existing.title.length) {
      const $row = $el.closest("tr");
      const thumbnail = resolveUrl(pickImageSrc($row.find("img").first()), BASE_URL);
      rows.set(absUrl, {
        url: absUrl,
        title: text,
        rowText: $row.text().replace(/\s+/g, " ").trim(),
        thumbnail,
      });
    }
  });

  const deals = [];
  const now = new Date().toISOString();

  for (const { url, title, rowText, thumbnail } of rows.values()) {
    const meta = rowText.replace(title, " ").trim();
    const m = meta.match(META_REGEX);

    const rawCategory = m ? m[2] : "";
    // 공지/필독/안내 같은 운영글은 핫딜이 아니므로 건너뜀 (정규화 전 원본 카테고리로 판단)
    if (/공지|필독|안내/.test(rawCategory) || /^\[?(공지|필독|안내)\]?/.test(title)) continue;

    const commentCount = m && m[1] ? parseInt(m[1], 10) : 0;
    const category = normalizeCategory(rawCategory);
    const author = m ? m[3] : "";
    const postedLabel = m ? m[4] : "";
    const recommend = m && m[5] ? parseInt(m[5], 10) : 0;
    const viewCount = m && m[7] ? parseInt(m[7], 10) : 0;

    const idMatch = url.match(/no=(\d+)/);
    deals.push({
      id: `ppomppu-${idMatch ? idMatch[1] : url}`,
      source: "뽐뿌",
      title: title.replace(/^\[.*?\]\s*/, ""), // 맨 앞 [베스트] 같은 태그 제거
      price: extractPriceKRW(title),
      category,
      author,
      url,
      commentCount,
      recommend,
      viewCount,
      postedLabel,
      thumbnail,
      ended: /품절|종료/.test(title),
      crawledAt: now,
    });
  }

  console.log(`[ppomppu] ${deals.length}개 파싱 완료`);
  return deals;
}

module.exports = { crawlPpomppu };
