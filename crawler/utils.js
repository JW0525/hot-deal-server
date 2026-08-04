const axios = require("axios");
const iconv = require("iconv-lite");

// 브라우저가 실제로 보내는 헤더 묶음.
//
// 왜 이렇게까지 갖추는가 (2026-08-04):
// 예전엔 User-Agent 하나만, 그것도 끝에 `hotdeal-moa-prototype`을 붙여 보냈다.
// 내 PC에서는 통했지만 GitHub Actions에서 돌리자 퀘이사존이 403으로 막았다.
// 방화벽이 "헤더가 빈약하고 정체불명 문자열이 붙은 요청"을 봇으로 판정하기 때문이다.
// 요청 자체는 예전과 똑같이 사이트당 1시간에 1번, 사이트 간 1.5초 간격을 지킨다.
const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
  "Upgrade-Insecure-Requests": "1",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
};

// 사이트별로 인코딩이 달라서(뽐뿌는 EUC-KR) arraybuffer로 받은 뒤 직접 디코딩합니다.
async function fetchHtml(url, { encoding = "utf-8", timeout = 10000, headers } = {}) {
  const res = await axios.get(url, {
    headers: { ...DEFAULT_HEADERS, ...headers },
    responseType: "arraybuffer",
    timeout,
  });
  const buf = Buffer.from(res.data);
  return encoding === "utf-8" ? buf.toString("utf-8") : iconv.decode(buf, encoding);
}

// 텍스트에서 "9,900원" / "￦9,900" / "$ 15.38" 같은 가격 표현을 찾아 원화 기준 정수로 변환.
// 달러(USD)는 원화 변환 없이 대략적인 참고용으로만 표시(convert=false 옵션으로 원문 유지 가능).
function extractPriceKRW(text) {
  if (!text) return null;
  const krwMatch = text.match(/[￦₩]?\s*([\d,]{2,})\s*원/);
  if (krwMatch) {
    const n = parseInt(krwMatch[1].replace(/,/g, ""), 10);
    if (!Number.isNaN(n)) return n;
  }
  const krwSymbol = text.match(/[￦₩]\s*([\d,]{2,})/);
  if (krwSymbol) {
    const n = parseInt(krwSymbol[1].replace(/,/g, ""), 10);
    if (!Number.isNaN(n)) return n;
  }
  return null;
}

function extractUsd(text) {
  if (!text) return null;
  const m = text.match(/\$\s*([\d,.]+)/);
  if (!m) return null;
  const n = parseFloat(m[1].replace(/,/g, ""));
  return Number.isNaN(n) ? null : n;
}

// "1.5k" / "3.4k" 같은 축약 조회수 표기를 숫자로 변환
function parseCompactNumber(text) {
  if (!text) return 0;
  const t = text.trim().toLowerCase();
  const m = t.match(/^([\d.]+)\s*k$/);
  if (m) return Math.round(parseFloat(m[1]) * 1000);
  const n = parseInt(t.replace(/[^\d]/g, ""), 10);
  return Number.isNaN(n) ? 0 : n;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 많은 사이트가 이미지를 지연 로딩(lazy-load)해서 실제 주소를 src가 아니라
// data-src / data-original 같은 속성에 숨겨둡니다. src만 보면 로딩 아이콘이나
// 빈 이미지를 잘못 가져오게 되므로 여러 후보를 순서대로 확인합니다.
function pickImageSrc($img) {
  if (!$img || $img.length === 0) return null;
  const candidates = [
    $img.attr("data-src"),
    $img.attr("data-original"),
    $img.attr("data-lazy-src"),
    $img.attr("data-echo"),
    $img.attr("src"),
  ].filter(Boolean);

  const valid = candidates.find((c) => !/blank|lazyload|noimage|1x1|spacer|data:image/i.test(c));
  return valid || candidates[0] || null;
}

// 상대경로("//cdn.xxx/img.jpg")나 절대경로를 baseUrl 기준으로 완전한 URL로 정리
function resolveUrl(src, baseUrl) {
  if (!src) return null;
  try {
    return new URL(src, baseUrl).href;
  } catch {
    return null;
  }
}

// server.js의 THUMB_REFERER_BY_HOST와 동일한 목록. 크롤링 단계에서 썸네일이
// 실제로 열리는지 미리 확인할 때도 같은 Referer가 필요해서 여기 한 번 더 둔다.
const THUMB_REFERER_BY_HOST = {
  "cdn2.ppomppu.co.kr": "https://www.ppomppu.co.kr/",
  "ppomppu.co.kr": "https://www.ppomppu.co.kr/",
  "edgio.clien.net": "https://www.clien.net/",
  "clien.net": "https://www.clien.net/",
  "img2.quasarzone.com": "https://quasarzone.com/",
  "quasarzone.com": "https://quasarzone.com/",
  "img.eomisae.co.kr": "https://eomisae.co.kr/",
  "eomisae.co.kr": "https://eomisae.co.kr/",
  "img.ruliweb.com": "https://bbs.ruliweb.com/",
  "i2.ruliweb.com": "https://bbs.ruliweb.com/",
  "ruliweb.com": "https://bbs.ruliweb.com/",
};

function findRefererFor(hostname) {
  const entry = Object.entries(THUMB_REFERER_BY_HOST).find(
    ([host]) => hostname === host || hostname.endsWith("." + host)
  );
  return entry ? entry[1] : null;
}

// 썸네일 하나가 실제로 로드 가능한지 가볍게 확인한다 (HEAD 우선, 막히면 소량 GET).
// 카드에 카트 아이콘이나 깨진 이미지가 뜨는 걸 막기 위해, 크롤링 시점에 미리
// 걸러내서 안 열리는 이미지는 아예 thumbnail을 비워버린다.
async function verifyThumbnail(url, timeout = 3500) {
  if (!url) return false;
  let hostname;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return false;
  }
  const referer = findRefererFor(hostname);
  // 화이트리스트에 없는 도메인은 실제 이미지 자체는 열려도, 브라우저가 보게 되는
  // /api/thumb 프록시는 화이트리스트에 없으면 무조건 플레이스홀더(카트 아이콘)를 내려준다.
  // 그러니 여기서도 미리 실패로 처리해서 카드가 목록 상단에 남지 않게 한다.
  if (!referer) return false;
  const headers = {
    "User-Agent": DEFAULT_HEADERS["User-Agent"],
    Referer: referer,
  };

  try {
    const res = await axios.head(url, { timeout, headers, validateStatus: (s) => s < 400 });
    const type = res.headers["content-type"] || "";
    if (type.startsWith("image/")) return true;
  } catch {
    // HEAD가 막히는 CDN이 많아서 실패하면 바로 GET으로 재시도
  }

  try {
    const res = await axios.get(url, {
      timeout,
      headers: { ...headers, Range: "bytes=0-2048" },
      responseType: "arraybuffer",
      validateStatus: (s) => s < 400,
    });
    const type = res.headers["content-type"] || "";
    return type.startsWith("image/") && res.data && res.data.length > 0;
  } catch {
    return false;
  }
}

// 여러 딜의 썸네일을 동시에 몇 개씩(concurrency) 나눠서 검증하고,
// 실패한 항목은 thumbnail을 null로 바꿔서 돌려준다.
async function verifyThumbnails(deals, concurrency = 6) {
  const targets = deals.filter((d) => d.thumbnail);
  let cursor = 0;

  async function worker() {
    while (cursor < targets.length) {
      const deal = targets[cursor++];
      const ok = await verifyThumbnail(deal.thumbnail);
      if (!ok) deal.thumbnail = null;
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, targets.length) }, worker);
  await Promise.all(workers);
  return deals;
}

// 5개 사이트가 저마다 다른 카테고리 이름을 쓰고 있어서(20종 이상), 필터가 너무
// 복잡해지지 않도록 공통된 큰 갈래로 정리한다. 새 패턴이 필요하면 여기에 추가.
const CATEGORY_RULES = [
  // '디지털'은 딜바다가 쓰는 분류명이다. 없으면 노트북·이어폰이 전부 '기타'로 빠진다.
  { match: /PC|하드웨어|컴퓨터|노트북|모바일|휴대폰|스마트폰|A\/V|디지털/i, label: "전자기기" },
  { match: /가전|TV|인테리어|생활용품|가구/i, label: "가전/생활" },
  { match: /식품|음식|건강/i, label: "식품" },
  { match: /패션|의류|잡화|화장품|뷰티/i, label: "패션/뷰티" },
  { match: /게임|SW|소프트웨어|VR|취미/i, label: "게임/취미" },
  { match: /여행|도서|공동구매|해외구매|육아|레저/i, label: "여행/기타" },
];

function normalizeCategory(raw) {
  if (!raw) return "기타";
  const hit = CATEGORY_RULES.find((rule) => rule.match.test(raw));
  return hit ? hit.label : "기타";
}

module.exports = {
  fetchHtml,
  extractPriceKRW,
  extractUsd,
  parseCompactNumber,
  sleep,
  pickImageSrc,
  resolveUrl,
  verifyThumbnail,
  verifyThumbnails,
  normalizeCategory,
};
