const cheerio = require("cheerio");
const {
  fetchHtml,
  extractPriceKRW,
  pickImageSrc,
  resolveUrl,
  normalizeCategory,
} = require("./utils");

const LIST_URL = "https://www.dealbada.com/bbs/board.php?bo_table=deal_domestic";
const BASE_URL = "https://www.dealbada.com";

// 딜바다 국내핫딜 게시판은 그누보드 표 구조라 칸이 명확하게 나뉘어 있다.
// 다른 사이트처럼 한 덩어리 텍스트를 정규식으로 쪼갤 필요가 없어 파싱이 가장 안정적이다.
//
//   td.td_cate    분류 (식품/건강, 디지털 …)
//   td.td_img     썸네일
//   td.td_subject 제목 (+ "댓글N개")
//   td.td_date    날짜 또는 시각
//   td.td_num     조회수
//   td.td_num_g   "추천 / 비추천"  예: "775 / 1"
// 한 페이지에 15줄뿐이라 다른 사이트(20~30건)와 균형이 안 맞는다.
// 2페이지까지만 받아 30건 안팎으로 맞춘다. 사이에 텀을 둬서 상대 서버 부담을 줄인다.
const PAGES = 2;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function crawlDealbada() {
  const deals = [];
  const now = new Date().toISOString();
  const seen = new Set();

  for (let page = 1; page <= PAGES; page++) {
    let html;
    try {
      html = await fetchHtml(`${LIST_URL}&page=${page}`, { encoding: "utf-8" });
    } catch (err) {
      console.error(`[dealbada] ${page}페이지 요청 실패:`, err.message);
      // 1페이지가 실패하면 건질 게 없지만, 2페이지 실패는 1페이지 결과라도 살린다.
      break;
    }
    parsePage(html, deals, seen, now);
    if (page < PAGES) await sleep(1500);
  }

  console.log(`[dealbada] ${deals.length}개 파싱 완료`);
  return deals;
}

function parsePage(html, deals, seen, now) {
  const $ = cheerio.load(html);

  $("#bo_list tr").each((_, tr) => {
    const $tr = $(tr);

    // 맨 위 공지글은 핫딜이 아니라 게시판 안내다. 번호 칸이 "공지"로 나온다.
    const numText = $tr.find("td.td_num").first().text().trim();
    if (!numText || numText === "공지") return;

    const $link = $tr.find('a[href*="wr_id="]').first();
    const href = $link.attr("href");
    if (!href) return;

    const url = resolveUrl(href, BASE_URL);
    if (!url) return;

    const idMatch = url.match(/wr_id=(\d+)/);
    if (!idMatch) return;
    const id = `dealbada-${idMatch[1]}`;
    if (seen.has(id)) return;
    seen.add(id);

    // 제목 칸에는 "댓글12개"가 붙어 나온다. 댓글 수를 떼어내고 제목만 남긴다.
    const subjectText = $tr.find("td.td_subject").text().replace(/\s+/g, " ").trim();
    const commentMatch = subjectText.match(/댓글\s*(\d+)\s*개/);
    const commentCount = commentMatch ? Number(commentMatch[1]) : 0;
    const title = subjectText.replace(/댓글\s*\d+\s*개\s*$/, "").trim();
    if (!title) return;

    // "775 / 1" 앞쪽이 추천수다.
    const recommendText = $tr.find("td.td_num_g").first().text().trim();
    const recommend = Number((recommendText.split("/")[0] || "").replace(/[^\d]/g, "")) || 0;

    const viewCount = Number($tr.find("td.td_num").last().text().replace(/[^\d]/g, "")) || 0;

    // 종료된 딜은 제목에 [종료]를 달아둔다. 다른 사이트와 같은 규칙으로 맞춘다.
    const ended = /\[?\s*(종료|품절|마감)\s*\]?/.test(title);

    deals.push({
      id,
      source: "딜바다",
      title,
      price: extractPriceKRW(title),
      category: normalizeCategory($tr.find("td.td_cate").text().trim()),
      author: $tr.find("td.td_name").text().replace(/\s+/g, " ").trim().split(" ")[0] || null,
      url,
      commentCount,
      recommend,
      viewCount,
      postedLabel: $tr.find("td.td_date").text().trim() || null,
      thumbnail: resolveUrl(pickImageSrc($tr.find("td.td_img img").first()), BASE_URL),
      ended,
      crawledAt: now,
    });
  });
}

module.exports = { crawlDealbada };
