const cheerio = require("cheerio");
const { fetchHtml, parseCompactNumber, pickImageSrc, resolveUrl, normalizeCategory } = require("./utils");

const LIST_URL = "https://quasarzone.com/bbs/qb_saleinfo";
const BASE_URL = "https://quasarzone.com";

// 퀘이사존 핫딜 게시판은 표(table) 구조로, 각 행이 [추천수 td] [본문 td] 로 되어 있습니다.
// 본문 td 안에 상태(진행중/종료/인기), 제목, 카테고리, 가격, 판매처, 작성자, 조회수, 시간이 모두 들어있어
// 텍스트를 통째로 뽑은 뒤 정규식으로 각 항목을 분리합니다.
const TAIL_REGEX = /(\S+)\s+([\d,.]+\s*k?)\s+(\d+분\s*전|\d+시간\s*전|\d{1,2}-\d{1,2}|방금\s*전)\s*$/i;

async function crawlQuasarzone() {
  let html;
  try {
    html = await fetchHtml(LIST_URL, { encoding: "utf-8" });
  } catch (err) {
    console.error("[quasarzone] 목록 요청 실패:", err.message);
    return [];
  }

  const $ = cheerio.load(html);
  const deals = [];
  const now = new Date().toISOString();
  const seen = new Set();

  $("table tr").each((_, tr) => {
    const $tr = $(tr);
    const $titleLink = $tr
      .find('a[href*="/bbs/qb_saleinfo/views/"]')
      .filter((_, el) => $(el).text().trim().length > 0)
      .last(); // 첫번째는 보통 썸네일 링크(텍스트 없음), 마지막이 제목 링크인 경우가 많음

    const href = $titleLink.attr("href");
    if (!href) return;

    let url;
    try {
      url = new URL(href, BASE_URL).href;
    } catch {
      return;
    }
    if (seen.has(url)) return;
    seen.add(url);

    let title = $titleLink.text().trim();
    if (!title) return;
    // 제목 끝에 붙는 댓글수 숫자 제거 (예: "... 외 20000mAh/45W 1")
    title = title.replace(/\s+\d+$/, "").trim();

    const rowText = $tr.text().replace(/\s+/g, " ").trim();
    const afterTitle = rowText.split($titleLink.text().trim())[1] || "";

    const catMatch = afterTitle.match(/^\s*([가-힣A-Za-z/]+)\s*가격/);
    const rawCategory = catMatch ? catMatch[1] : "";
    // 공지/필독/안내 같은 운영글은 핫딜이 아니므로 건너뜀
    if (/공지|필독|안내/.test(rawCategory) || /^\[?(공지|필독|안내)\]?/.test(title)) return;

    const category = normalizeCategory(rawCategory);

    let price = null;
    let priceCurrency = "KRW";
    const krwMatch = rowText.match(/가격\s*[₩￦]\s*([\d,]+)/);
    const usdMatch = rowText.match(/가격\s*\$\s*([\d,.]+)/);
    if (krwMatch) {
      price = parseInt(krwMatch[1].replace(/,/g, ""), 10);
    } else if (usdMatch) {
      price = parseFloat(usdMatch[1].replace(/,/g, ""));
      priceCurrency = "USD";
    }

    const firstTdText = $tr.find("td").first().text().trim();
    const recommend = parseInt(firstTdText.replace(/[^\d]/g, ""), 10) || 0;

    const tailMatch = rowText.match(TAIL_REGEX);
    const author = tailMatch ? tailMatch[1] : "";
    const viewCount = tailMatch ? parseCompactNumber(tailMatch[2]) : 0;
    const postedLabel = tailMatch ? tailMatch[3] : "";

    const idMatch = url.match(/views\/(\d+)/);
    const beforeTitleSnippet = rowText.slice(
      0,
      rowText.indexOf($titleLink.text().trim())
    );

    // 썸네일은 반드시 "본문" 칸(두번째 td)에서만 찾는다. 첫번째 td(추천수)에는
    // 인기글일 때 작은 귤 아이콘(tangerine.png)이 들어있어서, 행 전체에서 첫 이미지를
    // 찾으면 그 아이콘을 진짜 상품 사진으로 잘못 가져오는 문제가 있었다.
    const $tds = $tr.find("td");
    const $contentCell = $tds.length >= 2 ? $tds.eq(1) : $tr;
    // 실제 상품 썸네일 파일명은 대체로 "thumb_"로 시작한다. 판매처 로고(store/)나
    // 회원등급 아이콘(level/) 같은 작은 아이콘과 섞이지 않도록 우선적으로 찾는다.
    let $thumbImg = $contentCell.find('img[src*="thumb_"], img[data-src*="thumb_"]').first();
    if ($thumbImg.length === 0) $thumbImg = $contentCell.find("img").first();
    let thumbnail = resolveUrl(pickImageSrc($thumbImg), BASE_URL);
    if (thumbnail && thumbnail.includes("thumb_no_image")) thumbnail = null;

    deals.push({
      id: `quasarzone-${idMatch ? idMatch[1] : url}`,
      source: "퀘이사존",
      title,
      price,
      priceCurrency,
      category,
      author,
      url,
      commentCount: 0, // 댓글수는 제목 끝 숫자와 헷갈리기 쉬워 프로토타입에서는 생략
      recommend,
      viewCount,
      postedLabel,
      thumbnail,
      ended: /종료/.test(beforeTitleSnippet.slice(-6)),
      crawledAt: now,
    });
  });

  console.log(`[quasarzone] ${deals.length}개 파싱 완료`);
  return deals;
}

module.exports = { crawlQuasarzone };
