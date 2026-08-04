/**
 * GitHub Pages에 올릴 폴더(site/)를 만든다.
 *
 *   node scripts/site.js import <site폴더>   지난 회차 결과 → data/deals.json (크롤러 입력)
 *   node scripts/site.js build  <site폴더>   크롤 결과 → site/deals.json + site/thumbs/*
 *
 * ── 왜 썸네일을 미리 받아두는가 (2026-08-04 실측) ──────────────────────────
 * 요청이 올 때마다 이미지를 대신 받아오는 "프록시" 방식은 이 다섯 사이트에 못 쓴다.
 *
 *   · Cloudflare Worker: 모든 외부 요청에 `Cf-Worker` 헤더가 강제로 붙는다(삭제·변경 불가).
 *     어미새·퀘이사존 CDN이 그 헤더만 보고 403을 준다.
 *   · 브라우저 직접 요청: 뽐뿌(302)·퀘이사존(403)이 외부 도메인 요청을 막는다.
 *   · GitHub Actions에서 Referer + 브라우저 User-Agent를 붙여 받기: 109/109 전부 성공.
 *
 * 그래서 수집할 때 한 번 받아 Pages에 함께 올리고, 앱은 Pages에서 받는다.
 * 요청 시점에 남의 서버를 거치지 않으니 차단당할 여지가 아예 없어진다.
 *
 * ── 왜 이전 site 폴더를 재사용하는가 ──────────────────────────────────────
 * Actions는 매번 빈 작업공간에서 시작한다. 지난 결과를 깔아두지 않으면
 * (1) 게시판 첫 페이지에서 밀려난 딜이 매시간 통째로 사라지고 firstSeenAt이 리셋되며
 * (2) 이미 받아둔 썸네일 100여 장을 매시간 다시 내려받아 상대 서버에 민폐가 된다.
 */

const fs = require("fs");
const path = require("path");
const https = require("https");

const DATA_FILE = path.join(__dirname, "..", "data", "deals.json");
const THUMB_DIR_NAME = "thumbs";
const MAX_BYTES = 600 * 1024; // 이보다 크면 썸네일이 아니라 원본 사진이다. 앱에서 낭비.

const REFERER_BY_HOST = {
  ppomppu: "https://www.ppomppu.co.kr/",
  clien: "https://www.clien.net/",
  quasarzone: "https://quasarzone.com/",
  eomisae: "https://eomisae.co.kr/",
  ruliweb: "https://bbs.ruliweb.com/",
  dealbada: "https://www.dealbada.com/",
  imgur: "https://www.dealbada.com/", // 딜바다 글쓴이들이 imgur에 올린 이미지
};

// 퀘이사존은 Referer만으로는 부족하고 브라우저 User-Agent까지 있어야 200을 준다.
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

function refererFor(hostname) {
  const key = Object.keys(REFERER_BY_HOST).find((k) => hostname.includes(k));
  return key ? REFERER_BY_HOST[key] : "";
}

function extFor(contentType) {
  if (contentType.includes("png")) return ".png";
  if (contentType.includes("gif")) return ".gif";
  if (contentType.includes("webp")) return ".webp";
  return ".jpg";
}

function download(rawUrl) {
  return new Promise((resolve) => {
    let target;
    try {
      target = new URL(rawUrl);
    } catch {
      return resolve(null);
    }
    const req = https.request(
      target,
      {
        method: "GET",
        headers: {
          Referer: refererFor(target.hostname),
          "User-Agent": USER_AGENT,
          Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        },
        timeout: 15000,
      },
      (res) => {
        const type = res.headers["content-type"] || "";
        if (res.statusCode !== 200 || !type.startsWith("image/")) {
          res.resume();
          return resolve(null);
        }
        const chunks = [];
        let size = 0;
        res.on("data", (chunk) => {
          size += chunk.length;
          if (size > MAX_BYTES) {
            req.destroy();
            return resolve(null);
          }
          chunks.push(chunk);
        });
        res.on("end", () =>
          resolve({ buffer: Buffer.concat(chunks), ext: extFor(type) }),
        );
      },
    );
    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
    req.end();
  });
}

function importFromSite(siteDir) {
  const file = path.join(siteDir, "deals.json");
  if (!fs.existsSync(file)) {
    console.log("[site] 이전 결과가 없습니다 — 이번엔 새로 시작합니다.");
    return;
  }
  const parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
  const deals = Array.isArray(parsed) ? parsed : parsed.deals || [];
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(deals), "utf-8");
  console.log(`[site] 이전 딜 ${deals.length}건을 불러왔습니다.`);
}

async function build(siteDir) {
  const thumbDir = path.join(siteDir, THUMB_DIR_NAME);
  fs.mkdirSync(thumbDir, { recursive: true });

  const deals = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
  const onDisk = new Set(fs.readdirSync(thumbDir));
  const keep = new Set();
  let reused = 0;
  let fetched = 0;
  let failed = 0;

  for (const deal of deals) {
    if (!deal.thumbnail) continue;

    // 파일 이름은 딜 id로 고정한다. 같은 딜을 매시간 다시 받지 않기 위해서다.
    const base = String(deal.id).replace(/[^a-zA-Z0-9_-]/g, "_");
    const already = [...onDisk].find((name) => name.startsWith(base + "."));
    if (already) {
      deal.thumbnail = `${THUMB_DIR_NAME}/${already}`;
      keep.add(already);
      reused++;
      continue;
    }

    // 이전 회차에서 상대 경로로 바뀌었는데 파일이 없다면(정리됐거나 유실) 다시 받을 방법이
    // 없으므로 비운다. 앱은 썸네일 없는 딜을 목록 맨 뒤로 민다.
    if (!/^https?:/.test(deal.thumbnail)) {
      deal.thumbnail = null;
      continue;
    }

    const got = await download(deal.thumbnail);
    if (!got) {
      deal.thumbnail = null;
      failed++;
      continue;
    }
    const name = base + got.ext;
    fs.writeFileSync(path.join(thumbDir, name), got.buffer);
    deal.thumbnail = `${THUMB_DIR_NAME}/${name}`;
    keep.add(name);
    fetched++;
  }

  // 목록에서 사라진 딜의 썸네일은 지운다. 안 지우면 폴더가 계속 불어난다.
  let removed = 0;
  for (const name of onDisk) {
    if (!keep.has(name)) {
      fs.unlinkSync(path.join(thumbDir, name));
      removed++;
    }
  }

  fs.writeFileSync(
    path.join(siteDir, "deals.json"),
    // 앱이 매번 내려받는 파일이라 공백 없이 저장해 용량을 줄인다.
    JSON.stringify({
      count: deals.length,
      updatedAt: new Date().toISOString(),
      deals,
    }),
    "utf-8",
  );

  console.log(
    `[site] 딜 ${deals.length}건 | 썸네일 새로 ${fetched} · 재사용 ${reused} · 실패 ${failed} · 정리 ${removed}`,
  );
}

const [, , mode, siteDir] = process.argv;
if (!mode || !siteDir) {
  console.error("사용법: node scripts/site.js <import|build> <site폴더>");
  process.exit(1);
}
if (mode === "import") importFromSite(siteDir);
else if (mode === "build") build(siteDir);
else {
  console.error(`알 수 없는 모드: ${mode}`);
  process.exit(1);
}
