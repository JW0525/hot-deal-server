const path = require("path");
const express = require("express");
const cors = require("cors");
const axios = require("axios");

const { readAll } = require("./db");
const { runFullCrawl, getStatus } = require("./crawler");
const { startScheduler } = require("./scheduler");

const app = express();
const PORT = process.env.PORT || 3000;

// 뽐뿌/클리앙/퀘이사존 이미지 CDN은 다른 도메인에서 걸어오는 요청(핫링크)을
// Referer 헤더로 걸러내는 경우가 많아, 브라우저가 CDN에 직접 요청하면
// 썸네일이 깨져 보일 수 있습니다. 서버가 대신 받아와서 넘겨주면 해결됩니다.
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

// 실제 사진을 못 가져왔을 때 브라우저의 "깨진 이미지" 아이콘 대신 보여줄 카드 모양 플레이스홀더.
// 프록시가 실패하더라도 이 SVG를 200으로 내려주면 <img>의 onerror가 아예 발동하지 않아서
// 화면이 깜빡이거나 깨져 보이는 일 없이 항상 깔끔하게 표시됩니다.
const PLACEHOLDER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#f5efe0"/>
      <stop offset="100%" stop-color="#ece2c9"/>
    </linearGradient>
  </defs>
  <rect width="400" height="300" fill="url(#g)"/>
  <text x="200" y="165" font-size="64" text-anchor="middle" dominant-baseline="middle">🛒</text>
</svg>`;

function sendPlaceholder(res) {
  res.setHeader("Content-Type", "image/svg+xml");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.status(200).send(PLACEHOLDER_SVG);
}

app.use(cors());
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (req, res) => {
  res.json({ ok: true, ...getStatus() });
});

// 필터/정렬은 프론트에서 처리하기 쉽도록 기본은 전체 반환, 쿼리스트링으로 옵션 제공
app.get("/api/deals", (req, res) => {
  const { source, category, q } = req.query;
  let deals = readAll();

  if (source && source !== "전체") {
    deals = deals.filter((d) => d.source === source);
  }
  if (category && category !== "전체") {
    deals = deals.filter((d) => d.category === category);
  }
  if (q) {
    const keyword = q.toLowerCase();
    deals = deals.filter((d) => d.title.toLowerCase().includes(keyword));
  }

  res.json({
    count: deals.length,
    updatedAt: getStatus().lastRunAt,
    deals,
  });
});

// 썸네일 이미지 프록시. 화이트리스트에 있는 호스트만 중계해서 오픈 프록시로 악용되는 걸 막습니다.
app.get("/api/thumb", async (req, res) => {
  const src = req.query.url;
  if (!src) return sendPlaceholder(res);

  let target;
  try {
    target = new URL(src);
  } catch {
    return sendPlaceholder(res);
  }

  const referer = findRefererFor(target.hostname);
  if (!referer) return sendPlaceholder(res);

  try {
    const response = await axios.get(target.href, {
      responseType: "arraybuffer",
      timeout: 10000,
      headers: {
        Referer: referer,
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 hotdeal-moa-thumb-proxy",
      },
    });
    const contentType = response.headers["content-type"] || "";
    if (!contentType.startsWith("image/") || response.data.length === 0) {
      return sendPlaceholder(res);
    }
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(Buffer.from(response.data));
  } catch (err) {
    sendPlaceholder(res);
  }
});

// 수동으로 즉시 크롤링을 돌리고 싶을 때 (배포 후 첫 확인용).
//
// 크롤링은 다섯 사이트를 실제로 때리는 무거운 작업이라, 공개된 주소에 그대로 열어두면
// 누군가 반복 호출하는 것만으로 무료 서버가 죽고 상대 커뮤니티에도 민폐가 된다.
// 그래서 CRAWL_TOKEN 환경변수가 있으면 그 값을 아는 요청만 받는다.
// 로컬에는 이 변수가 없으므로 예전처럼 curl 한 줄로 그냥 돌릴 수 있다.
app.post("/api/crawl-now", async (req, res) => {
  const expected = process.env.CRAWL_TOKEN;
  if (expected && req.get("x-crawl-token") !== expected) {
    return res.status(401).json({ error: "권한이 없어요" });
  }
  const result = await runFullCrawl();
  res.json(result);
});

app.listen(PORT, () => {
  console.log(`[server] http://localhost:${PORT} 에서 실행 중`);
  startScheduler();
});
