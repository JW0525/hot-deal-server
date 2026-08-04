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
const http = require("http");
const crypto = require("crypto");

const DATA_FILE = path.join(__dirname, "..", "data", "deals.json");
const THUMB_DIR_NAME = "thumbs";
const MAX_BYTES = 600 * 1024; // 이보다 크면 썸네일이 아니라 원본 사진이다. 앱에서 낭비.

/**
 * 같은 이미지가 이 개수 이상의 딜에 쓰이면 그 딜의 썸네일로 치지 않는다.
 *
 * 상품 사진은 글마다 다르다. 여러 글에 **바이트까지 똑같은 이미지**가 반복된다면
 * 그건 그 딜의 사진이 아니라 원본 사이트가 "이미지 없음" 자리에 넣어둔 그림이거나
 * 매번 같은 로고다. 앱에서는 회색 네모로 보여 목록이 지저분해진다.
 *
 * 2026-08-05 실측(썸네일 337장)에서 반복 그룹 5종 17장이 나왔고 전부 이 경우였다:
 *   · 어미새 12×11 빈 GIF 8장   · 뽐뿌 60×50 회색 3장   · 어미새 188×189 회색 2장
 *   · 이토랜드 SVG 2장(앱에서 깨져 보이던 것)   · 퀘이사존 네이버페이 로고 2장
 *
 * 2로 잡은 이유: 회색 그림이 딱 2번만 나온 경우가 있어 3으로 올리면 놓친다.
 * 진짜 상품 사진이 두 글에 겹칠 수도 있지만, 그때 잃는 건 썸네일 두 장뿐이다.
 */
const PLACEHOLDER_MIN_DEALS = 2;

const REFERER_BY_HOST = {
  ppomppu: "https://www.ppomppu.co.kr/",
  clien: "https://www.clien.net/",
  quasarzone: "https://quasarzone.com/",
  eomisae: "https://eomisae.co.kr/",
  ruliweb: "https://bbs.ruliweb.com/",
  dealbada: "https://www.dealbada.com/",
  bbasak: "https://bbasak.com/",
  etoland: "https://etoland.co.kr/",
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

    // 딜바다는 이미지 주소를 아직 http로 준다. https 모듈에 http 주소를 넣으면
    // 그냥 실패하는 게 아니라 예외를 던져서 수집 전체가 죽는다(2026-08-05에 겪음).
    const client = target.protocol === "http:" ? http : https;
    if (target.protocol !== "http:" && target.protocol !== "https:") {
      return resolve(null);
    }

    // 썸네일 한 장 때문에 수집 전체가 죽지 않도록 통째로 감싼다.
    try {
      const req = client.request(
        target,
        {
          method: "GET",
          headers: {
            Referer: refererFor(target.hostname),
            "User-Agent": USER_AGENT,
            Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
          },
          timeout: 15000,
          // GitHub Actions 러너는 IPv6가 붙어 있는데 상대 CDN의 IPv6 경로가 죽어 있으면
          // HTTP 응답도 못 받고 "연결 실패"만 난다(이토랜드에서 겪음). IPv4로 고정한다.
          family: 4,
        },
        (res) => {
          const type = res.headers["content-type"] || "";
          if (res.statusCode !== 200 || !type.startsWith("image/")) {
            res.resume();
            // 왜 실패했는지 남긴다. 사이트별로 차단 방식이 달라서 이 한 줄이 없으면
            // "썸네일이 안 나온다"는 현상만 보이고 원인을 못 찾는다.
            return resolve({ error: `${res.statusCode} ${type || "타입없음"}` });
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
    } catch {
      resolve(null);
    }
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 속도 제한에 걸린 경우라면 잠깐 쉬었다가 다시 받으면 대개 성공한다.
async function retryDownload(url) {
  await sleep(1200);
  return download(url);
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

// 웹 화면(public/)도 같이 올린다. 그래야 Pages 주소 하나가
// 사람이 보는 웹사이트이면서 동시에 미니앱이 읽는 데이터가 된다. 서버가 필요 없어진다.
function copyWebsite(siteDir) {
  const src = path.join(__dirname, "..", "public");
  let copied = 0;
  for (const name of fs.readdirSync(src)) {
    const from = path.join(src, name);
    if (!fs.statSync(from).isFile()) continue;
    fs.copyFileSync(from, path.join(siteDir, name));
    copied++;
  }
  console.log(`[site] 웹 화면 파일 ${copied}개 복사`);
}

/**
 * 여러 딜에 똑같이 쓰인 이미지를 썸네일에서 빼낸다. 판정 기준은 `PLACEHOLDER_MIN_DEALS`.
 *
 * 내용(바이트)이 같은지로만 본다. 파일 이름은 딜 id라 전부 다르므로 이름으로는 못 찾는다.
 * 찾은 딜은 `thumbnail`을 비우고 `keep`에서 빼서, 뒤따르는 정리 단계가 파일까지 지우게 한다.
 *
 * 지운 뒤 다음 회차에 같은 그림을 또 받게 되지만(크롤러가 원본 주소를 다시 준다)
 * 매 회차 여기서 다시 걸러지므로 결과는 늘 같다. 몇 장 더 받는 값으로 상태를 안 들고 간다.
 */
function dropRepeatedThumbnails(deals, thumbDir, keep) {
  const byHash = new Map(); // 이미지 해시 → 그 이미지를 쓰는 딜들

  for (const deal of deals) {
    if (!deal.thumbnail) continue;
    const name = path.basename(deal.thumbnail);
    const file = path.join(thumbDir, name);
    if (!fs.existsSync(file)) continue;

    const hash = crypto.createHash("sha1").update(fs.readFileSync(file)).digest("hex");
    if (!byHash.has(hash)) byHash.set(hash, []);
    byHash.get(hash).push({ deal, name });
  }

  let groups = 0;
  let dropped = 0;
  for (const [, users] of byHash) {
    // 같은 딜이 여러 번 들어 있어도 한 장은 남겨야 하므로 딜 id 기준으로 센다.
    const dealIds = new Set(users.map((u) => u.deal.id));
    if (dealIds.size < PLACEHOLDER_MIN_DEALS) continue;

    groups++;
    for (const { deal, name } of users) {
      deal.thumbnail = null;
      keep.delete(name);
      dropped++;
    }
    const sample = users[0].deal.source;
    console.log(`[site] 반복 이미지 제외: ${sample} 등 ${dealIds.size}개 딜이 같은 그림 사용`);
  }

  console.log(`[site] 반복 이미지 ${groups}종 ${dropped}장을 썸네일에서 제외`);
  return dropped;
}

async function build(siteDir) {
  const thumbDir = path.join(siteDir, THUMB_DIR_NAME);
  fs.mkdirSync(thumbDir, { recursive: true });
  copyWebsite(siteDir);

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

    // 한 번에 몰아치면 CDN이 속도 제한을 건다. 이토랜드는 로컬에서 50/50 성공하는데
    // Actions에서 연속으로 받자 31장이 실패했다(2026-08-05). 잠깐 쉬고, 실패하면 한 번 더.
    let got = await download(deal.thumbnail);
    if (!got || got.error) got = await retryDownload(deal.thumbnail);
    if (!got || got.error) {
      // 어떤 사이트가 왜 막히는지 한눈에 보이도록 앞쪽 몇 건만 남긴다(로그 폭주 방지).
      if (failed < 5) {
        console.log(`[site] 썸네일 실패: ${deal.source} ${got?.error || "연결 실패"} ${deal.thumbnail.slice(0, 70)}`);
      }
      // 여기서 비우면 원본 주소가 사라져 다음 회차에 다시 시도할 수 없다.
      // 대신 앱은 썸네일 없는 딜을 목록 맨 뒤로 밀기 때문에 화면이 깨지지는 않는다.
      deal.thumbnail = null;
      failed++;
      continue;
    }
    const name = base + got.ext;
    fs.writeFileSync(path.join(thumbDir, name), got.buffer);
    deal.thumbnail = `${THUMB_DIR_NAME}/${name}`;
    keep.add(name);
    fetched++;
    await sleep(120); // 상대 CDN을 몰아치지 않기 위한 최소 간격
  }

  const placeholders = dropRepeatedThumbnails(deals, thumbDir, keep);

  // 목록에서 사라진 딜의 썸네일은 지운다. 안 지우면 폴더가 계속 불어난다.
  // 바로 위에서 플레이스홀더로 판정된 파일도 keep에서 빠져 여기서 함께 지워진다.
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
