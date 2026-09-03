# 핫딜할인 서버

뽐뿌 / 클리앙(알뜰구매) / 어미새 / 루리웹(핫딜예판) / 딜바다 / 빠삭 / 이토랜드 핫딜 게시판을 하루 두 번
자동으로 수집해서 검색·필터·정렬로 비교해볼 수 있는 웹사이트입니다.

## 구조

```
hot-deal-server/
  server.js        Express 서버 — **로컬 개발용** (정적 파일 서빙 + API + 썸네일 프록시)
  scheduler.js      매시 정각 크롤링 스케줄러 (node-cron) — 로컬에서만 씀
  db.js             JSON 파일 기반 저장소 (data/deals.json)
  scripts/site.js   배포용 폴더 만들기 (딜 목록 + 썸네일 사본) — GitHub Actions가 씀
  .github/workflows/crawl.yml  하루 두 번 수집 → Cloudflare Pages 게시
  crawler/
    ppomppu.js       뽐뿌 파서
    clien.js         클리앙 파서
    dealbada.js      딜바다 파서
    bbasak.js        빠삭 파서
    etoland.js       이토랜드 파서
    eomisae.js       어미새 파서
    ruliweb.js       루리웹 핫딜예판 파서
    index.js         전체 사이트 순차 크롤링 + 저장 (SOURCES 배열에 사이트 추가/삭제)
  public/index.html  프론트엔드 (API에서 데이터를 받아 렌더링)
```

새 사이트를 더 추가하고 싶으면 `crawler/`에 파서 파일을 하나 만들고
`crawler/index.js`의 `SOURCES` 배열에 한 줄만 추가하면 됩니다.

## 로컬에서 실행하기

```bash
cd hot-deal-server
npm install
npm start
```

브라우저에서 http://localhost:3000 접속. 서버가 켜지면 곧바로 1회 크롤링을 실행하고,
이후 하루 두 번(`7 11,23 * * *` UTC = 한국 저녁 8시 7분·아침 8시 7분)에 자동으로 다시 수집합니다.

수동으로 즉시 한 번 더 돌려보고 싶다면:

```bash
curl -X POST http://localhost:3000/api/crawl-now
```

## API

- `GET /api/deals?source=뽐뿌&category=전자기기&q=노트북` — 딜 목록 (쿼리는 전부 선택)
- `GET /api/health` — 서버/크롤러 상태 확인
- `POST /api/crawl-now` — 즉시 크롤링 실행. `CRAWL_TOKEN` 환경변수가 설정된 곳(=배포 서버)에서는
  `x-crawl-token` 헤더에 같은 값을 넣어야 합니다. 로컬에는 변수가 없으므로 그냥 호출하면 됩니다.

## 배포 — 서버가 없습니다 (무료)

**상시 켜두는 서버를 쓰지 않습니다.** GitHub Actions가 하루 두 번 수집해서 결과를
**Cloudflare Pages**에 올려두고, 미니앱은 그 정적 파일을 받아갑니다.

⚠️ **GitHub Pages 가 아닙니다.** GitHub Pages 는 약관상 상업적 이용이 막혀 있어
Cloudflare Pages 로 옮겼습니다(2026-08 확인). 게시 주소는 `hot-deal-eoo.pages.dev` 입니다.

```
GitHub Actions (하루 두 번 11:07·23:07 UTC, 공개 저장소는 무료·무제한)
  └ 크롤링 → 썸네일까지 내려받아 site/ 폴더 구성
      └ data 브랜치에 force push
           └ Cloudflare Pages 가 그대로 서빙 (CDN·CORS 허용·잠들지 않음)
                └ https://hot-deal-eoo.pages.dev/deals.json
                   https://hot-deal-eoo.pages.dev/thumbs/*.jpg
```

이 저장소의 `server.js`(Express)는 **이제 로컬 개발용입니다.** 크롤러를 고치면서
바로 확인할 때 씁니다. 배포본은 이 서버를 쓰지 않습니다.

### 왜 서버를 안 쓰나

| 시도한 것 | 왜 안 되나 |
|---|---|
| Railway | 무료 크레딧이 끝나면 요금이 붙음 |
| Render 무료 | 계정당 무료 서비스 1개 · 15분이면 잠들어 주기 크롤링도 멈춤 |
| Cloudflare Worker에서 크롤링 | 무료 플랜은 요청당 CPU 10ms. HTML 파싱은 그 수십 배가 듦 |
| Cloudflare Worker에서 썸네일 프록시 | **Worker의 외부 요청에는 `Cf-Worker` 헤더가 강제로 붙는데(삭제 불가) 어미새·퀘이사존 CDN이 이걸 403으로 막음** |
| 브라우저가 이미지 직접 요청 | 뽐뿌(302)·퀘이사존(403)이 외부 도메인 요청을 차단 |

남은 방법이 **수집할 때 썸네일까지 미리 받아두는 것**이었고, 실측 결과
GitHub Actions에서 Referer + 브라우저 User-Agent를 붙이면 109/109 전부 성공했습니다(평균 26KB).

### 처음 한 번만 하는 설정

1. 저장소 **Settings → Pages → Source**를 `Deploy from a branch` / 브랜치 `data` / 폴더 `/`로 지정
   (이미 켜져 있습니다. `gh api repos/OWNER/REPO/pages`로 확인 가능)
2. 워크플로 파일(`.github/workflows/crawl.yml`)을 올리려면 토큰에 `workflow` 권한이 필요합니다.
   ```
   gh auth refresh -s workflow
   ```
3. 올린 뒤 저장소 **Actions 탭 → crawl → Run workflow**로 한 번 돌려보세요.

### 확인하는 법

```bash
curl -s https://hot-deal-eoo.pages.dev/deals.json | head -c 200
```

`updatedAt`이 1시간 이내면 정상입니다.

### 비용과 한도

전부 무료이고 카드 등록도 필요 없습니다. 공개 저장소라 Actions 사용 시간이 무제한이고,
Pages는 월 100GB 전송·시간당 10회 빌드까지 허용됩니다(우리는 시간당 1회).
**프로젝트를 수십 개로 늘려도 저장소마다 따로 적용되므로 서로 한도를 잡아먹지 않습니다.**

## 크롤러가 데이터를 잘 못 가져올 때

이 저장소의 프로토타입 환경에는 뽐뿌·퀘이사존·클리앙·어미새·루리웹으로 나가는 네트워크가
막혀 있어서 실제 배포 전에는 크롤러를 직접 실행해볼 수 없었습니다. 각 사이트의 실제 페이지
구조는 분석해서 반영했지만, 사이트 개편으로 HTML 구조가 바뀌면 파싱이 깨질 수 있습니다.
특히 어미새는 정확한 CSS 클래스 대신 링크 패턴 + 정규식으로 항목을 추정하는 방식이라
다른 사이트보다 필드 정확도가 다소 떨어질 수 있습니다.

배포 후 `/api/deals` 응답에서 특정 사이트만 0건이거나 필드가 비어있다면:

1. 서버 로그에서 `[뽐뿌|clien|quasarzone|eomisae|ruliweb] 크롤링 실패` 메시지를 확인
2. 해당 사이트를 브라우저에서 열고 개발자도구(F12)로 게시글 목록의 HTML 구조 확인
3. `crawler/해당사이트.js`의 선택자(selector)나 정규식을 실제 구조에 맞게 수정

## 크롤링 시 유의사항

- 다섯 사이트 모두 커뮤니티 게시판이며 이용약관에 자동 수집·재배포 관련 조항이 있을 수 있습니다.
  개인용 프로토타입 단계를 넘어 여러 사람이 쓰는 서비스로 키울 계획이라면, 각 사이트의
  이용약관을 한 번 확인해보는 걸 권장합니다.
- 현재 크롤링 주기는 1시간에 1번, 사이트당 요청 1회, 사이트 간 1.5초 텀을 두도록 설정되어
  상대 서버에 부담을 주지 않는 수준입니다. 주기를 더 짧게 바꾸고 싶다면 `scheduler.js`의
  `CRON_EXPRESSION`을 수정하면 됩니다.
- 각 카드는 원문 링크(`url`)로 연결되며, 실제 구매/재고 확인은 원문 사이트에서 이뤄지도록
  설계했습니다.
