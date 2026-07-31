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
    // 공지/필독/안내 같은 운영글은 핫딜이 아니므로 건너뜀 (제목만 다듬는 게 아니라 아예 제외).
    // "인기글"은 딜 자체는 진짜니까 건너뛰지 않고 제목 표시할 때만 제거한다.
    if (/^\[?(공지|필독|안내)\]?/.test(title)) return;

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

    // 어미새는 목록 상단이 표(tr), 본문이 카드(.card_el) 두 가지 형태로 섞여 나온다.
    // 예전에는 카드 텍스트 끝의 숫자 세 개를 정규식으로 추측했는데,
    // 실제로는 뒤에 "Read More"가 붙어서 매칭이 항상 실패했고 추천수가 늘 0이었다.
    const $card = $el.closest(".card_el");
    const $row = $card.length ? $card : $el.closest("tr");

    /** 아이콘(눈/말풍선/하트) 옆에 붙은 숫자를 읽는다. */
    const iconNum = (iconClass) => {
      const $icon = $row.find(`.${iconClass}`).first();
      if (!$icon.length) return 0;
      return parseInt($icon.parent().text().replace(/[^\d]/g, ""), 10) || 0;
    };

    const rawCategory = $row.find(".cate").first().text().replace(/,\s*$/, "").trim();
    const catDateMatch = rowText.match(/([가-힣A-Za-z]+),\s*(\d{2}\.\d{2}\.\d{2})/);
    const category = normalizeCategory(rawCategory || (catDateMatch ? catDateMatch[1] : ""));

    const dateMatch = $row.text().match(/\d{2}\.\d{2}\.\d{2}/);
    const postedLabel = dateMatch ? dateMatch[0] : catDateMatch ? catDateMatch[2] : "";

    const recommend = iconNum("ion-ios-heart");
    const viewCount = iconNum("ion-ios-eye");
    // 카드형은 말풍선 아이콘, 표 형태는 .tt_cm 칸에 댓글수가 있다.
    const commentCount =
      iconNum("ion-ios-chatbubble") || parseInt($row.find(".tt_cm").first().text().trim(), 10) || 0;

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
