# 핫딜할인 (Hotdeal Sale)

국내 커뮤니티 핫딜 게시판 5곳을 1시간마다 크롤링해서 한 곳에 모아 보여주는 서비스.
쿠팡파트너스 제휴 링크로 수익화하며, 앞으로 **앱인토스(토스 미니앱)** 로 확장하려는 상태.

> 이 문서는 Claude Code가 프로젝트 맥락을 빠르게 파악하기 위한 핸드오프 문서입니다.
> 사용자(정우)는 비개발자입니다. 터미널 명령어는 복사-붙여넣기 할 수 있게 완성된 형태로 제시하고,
> 전문 용어는 풀어서 설명해 주세요.

---

## 1. 현재 상태 요약

| 항목 | 값 |
|---|---|
| 배포 주소 | https://jw0525.github.io/hotdeal-server/deals.json (GitHub Pages) |
| 옛 배포 주소 | ~~https://hotdealhunter.up.railway.app~~ — Railway 유료 전환으로 2026-08-04에 내림 |
| 호스팅 | **상시 서버 없음.** GitHub Actions(수집) + GitHub Pages(게시) |
| GitHub | `JW0525/hotdeal-server` (공개 저장소여야 Actions가 무료 무제한) |
| 런타임 | Node.js 20 이상 (**18은 크래시함 — 아래 트러블슈팅 참고**) |
| 상태 | Pages 게시 확인 완료. **워크플로 파일 push만 남음** (토큰 `workflow` 권한 필요) |

배포 흐름: 코드 수정 → `git push` → 다음 정시(매시 7분)에 Actions가 수집 → `data` 브랜치에
force push → Pages가 서빙. **`server.js`는 이제 로컬 개발 전용이다.**

### 이 구조에서 절대 건드리면 안 되는 것

- **`data` 브랜치를 손으로 고치지 말 것.** 매시간 force push로 통째로 덮어쓰므로 사라진다.
- **저장소를 비공개로 바꾸지 말 것.** Actions 무료 시간이 유한해지고 Pages도 유료 플랜이 필요해진다.
- **썸네일을 원본 주소로 되돌리지 말 것.** 요청 시점 프록시는 Cloudflare(`Cf-Worker` 헤더 차단)도
  브라우저 직접 요청(뽐뿌 302·퀘이사존 403)도 전부 막힌다. 실측 근거는 `scripts/site.js` 주석에 있다.

---

## 1-1. 뺀 것

| 뺀 것 | 언제 | 왜 |
|---|---|---|
| Railway 배포 | 2026-08-04 | 무료 크레딧이 끝나면 요금이 붙음 |
| Render 무료 플랜 (`render.yaml`) | 2026-08-04 | 계정당 무료 서비스 1개 제한. 프로젝트를 수십 개 돌릴 계획과 안 맞음 |
| Render 깨우기 워크플로 | 2026-08-04 | Render를 안 쓰게 되어 함께 제거 |
| Cloudflare Worker (`worker/`) | 2026-08-04 | 크롤링은 CPU 10ms 한도로 불가. 썸네일 프록시는 `Cf-Worker` 헤더가 어미새·퀘이사존에서 403 |
| GitHub 릴리스에 썸네일 보관 | 2026-08-04 | 릴리스 자산은 `nosniff` + `octet-stream`이라 `<img>`에서 렌더링 안 됨 |

**되살리자는 얘기가 나오면 이 표부터 읽을 것.**

---

## 2. 아키텍처

```
[크롤러 5개] --1시간마다--> [data/deals.json] --REST API--> [public/index.html]
   ↑ node-cron                  ↑ 파일 기반 저장소            ↑ 바닐라 JS SPA
```

- **프레임워크 없음.** Express + 바닐라 JS. 빌드 단계 없음.
- **DB 없음.** `data/deals.json` 파일 하나에 저장. 7일 지난 딜 자동 삭제, 최대 1000건.
- **프론트엔드는 단일 HTML 파일.** `public/index.html` 안에 HTML/CSS/JS가 전부 들어있음 (약 550줄).

### 파일 구조

```
hotdeal-server/
├── server.js           Express 앱, API 라우트, 썸네일 프록시
├── db.js               JSON 파일 저장소 (upsert/중복제거/만료정리)
├── scheduler.js        node-cron, 매시 정각 크롤링 ("0 * * * *")
├── crawler/
│   ├── index.js        5개 사이트 순차 실행 (사이트간 1.5초 대기)
│   ├── utils.js        ★ 공용 유틸 - 카테고리 정규화, 썸네일 검증 등
│   ├── ppomppu.js      뽐뿌 (EUC-KR 인코딩 주의)
│   ├── clien.js        클리앙
│   ├── quasarzone.js   퀘이사존
│   ├── eomisae.js      어미새 (자주 403 차단됨)
│   └── ruliweb.js      루리웹 (자주 403 차단됨)
└── public/
    ├── index.html      프론트엔드 전체 (단일 파일)
    ├── og-image.png    카카오톡/SNS 공유 미리보기 이미지
    ├── robots.txt
    └── sitemap.xml
```

### API

| 엔드포인트 | 설명 |
|---|---|
| `GET /api/deals` | 전체 딜 목록. `?source=` `?category=` `?q=` 필터 지원 |
| `GET /api/thumb?url=` | 썸네일 프록시 (핫링크 차단 우회용) |
| `GET /api/health` | 크롤러 상태 확인 |
| `POST /api/crawl-now` | 수동 크롤링 트리거 (공개 서비스면 인증 추가 권장) |

### 딜 데이터 구조

```js
{
  id, source, title, price, priceCurrency, category, author, url,
  commentCount, recommend, viewCount, postedLabel,
  thumbnail,        // null이면 프론트에서 목록 맨 아래로 정렬됨
  ended,            // true면 "종료된 핫딜입니다" 배지 표시
  crawledAt, firstSeenAt
}
```

---

## 3. 반드시 알아야 할 함정들

이미 한 번씩 터졌던 문제라 되돌리지 말 것.

### Node 18에서 크래시함
`axios`가 쓰는 `undici`가 Node 20+ 전용 `File` API를 참조해서 `ReferenceError: File is not defined`로 죽음.
`package.json`의 `engines.node`는 반드시 `>=20` 유지.

### 썸네일이 깨지는 문제 (3중 방어 구조)
커뮤니티 이미지 CDN들이 Referer 기반 핫링크 차단을 걸어둠. 그래서:

1. `server.js`의 `/api/thumb`가 서버에서 대신 이미지를 받아옴 (Referer 위조).
   화이트리스트(`THUMB_REFERER_BY_HOST`)에 있는 도메인만 허용 — 오픈 프록시 악용 방지.
2. **실패해도 절대 에러 상태코드를 반환하지 않음.** 항상 200 + 플레이스홀더 SVG.
   `<img>`의 onerror가 발동하면 화면이 깜빡거려서 이렇게 처리함.
3. 크롤링 시점에 `verifyThumbnails()`가 미리 이미지 접근 가능 여부를 확인하고,
   실패하면 `thumbnail = null`로 만들어 저장 → 프론트에서 목록 맨 아래로 밀림.

**중요:** 화이트리스트에 없는 도메인은 `verifyThumbnail()`에서 즉시 false 처리함.
어차피 프록시가 플레이스홀더만 내려줄 거라서, 목록 상단에 남기면 안 되기 때문.

### 뽐뿌 댓글수 정규식
`META_REGEX`에서 숫자와 `[` 사이에 공백을 허용하면 안 됨.
댓글 0개인 글은 숫자가 아예 없어서, 공백을 허용하면 앞쪽 글번호(예: 723720)를 댓글수로 잘못 인식함.

### 퀘이사존 썸네일
행 전체에서 첫 이미지를 찾으면 안 됨. 인기글은 첫 번째 `<td>`에 귤 아이콘(tangerine.png)이 있어서
그걸 상품 사진으로 착각함. 반드시 두 번째 `<td>`(본문 칸)에서만 찾고, `thumb_` 접두사를 우선함.

### 카테고리 정규화
`utils.js`의 `CATEGORY_RULES`가 사이트별 20여종 카테고리를 7개로 통합.
정규식에 `폰` 같은 한 글자를 넣으면 안 됨 — `쿠폰`의 `폰`에 걸려서 상품권이 전자기기로 분류됨.
반드시 `휴대폰|스마트폰`처럼 완전한 단어로.

현재 분류: 전자기기 / 가전·생활 / 식품 / 패션·뷰티 / 게임·취미 / 여행·기타 / 기타
프론트엔드 `CATEGORY_ORDER` 배열이 노출 순서를 결정하며, "기타"는 항상 맨 뒤.

### 퀘이사존은 GitHub Actions에서 IP로 차단됨 (2026-08-04 확인)

수집이 Actions로 옮겨간 뒤 **퀘이사존만 403**이 난다. 헤더 문제가 아니다 —
브라우저와 똑같은 헤더(Accept / Accept-Language / Sec-Fetch-* / Referer)를 갖춰도 그대로 403이고,
**같은 헤더로 개인 PC에서는 30건이 정상 수집된다.** 즉 GitHub(Azure) IP 대역이 막힌 것이다.

- **헤더를 더 손대도 안 풀린다.** 시도해봤으니 반복하지 말 것.
- 나머지 네 사이트(뽐뿌·클리앙·어미새·루리웹)는 Actions에서 정상이다.
- **VPS로 옮기면 해결될 가능성이 높다.** IP를 고를 수 있고 막히면 바꾸면 된다. 옮길 때 꼭 확인할 것.
- 무료 프록시를 끼우는 방법도 있지만, 수익이 걸린 서비스를 정체불명 중계 서버에 의존시키는 건 권하지 않는다.

### 어미새·루리웹은 자주 실패함
이 두 사이트는 크롤링 요청을 자주 403으로 차단함. 코드 문제가 아님.
크롤링이 실패해도 다른 사이트는 정상 동작하도록 사이트별로 try/catch 처리되어 있음.
사용자가 "사이트가 사라졌다"고 하면 대부분 이 차단 때문임.

---

## 4. 수익화 (쿠팡파트너스)

`public/index.html` 상단의 `COUPANG_PICKS` 배열이 전부.

```js
const COUPANG_PICKS = [
  { title: "쿠팡이 고른 오늘의 특가", url: "https://link.coupang.com/a/fODRbnudcO" },
];
const AD_INTERVAL = 8;  // 실제 딜 8개마다 광고 카드 1개 삽입
```

- 배열이 비어있으면 광고가 아예 안 뜨고 기존 UI로 폴백됨.
- 히어로 우측 패널이 쿠팡 상품 카드로 바뀜 (`initHeroPanel()`).
- **공정위 고지 문구는 법적 필수.** 2024년 12월 개정으로 작게/구석에 넣으면 과태료 대상.
  광고 카드와 히어로 카드 안에 각각 들어가 있음. 임의로 지우면 안 됨.
- 향후 개선안: 개별 딥링크 대신 **다이나믹 배너**(쿠팡이 자동으로 상품 로테이션) 사용.
  파트너스 콘솔에서 스크립트를 발급받아야 함.

---

## 5. 앞으로 할 일

### A. 앱인토스(토스 미니앱) — 사용자의 다음 목표

**핵심: 지금 코드를 옮기는 게 아니라, 완전히 새 프로젝트를 만들어야 함.**

앱인토스는 React + TypeScript 기반 자체 프레임워크를 씀. Express 서버는 그대로 두고,
미니앱은 API 클라이언트 역할만 함.

```
[GitHub Pages (deals.json + thumbs/)]  ←── 정적 파일 ──  [토스 미니앱]
   Actions가 매시간 갱신                          별도 프로젝트
```

**미니앱 프로젝트는 이미 만들어져 있음: `/Users/jeongwoo/projects/toss/hotdealhunter`**
(react-ts + TDS 템플릿. 딜 목록 화면 구현·빌드 확인 완료. 자세한 건 그 폴더의 CLAUDE.md 참고)

진행 순서:
1. ~~앱인토스 콘솔 계정 생성~~ 완료
2. **앱 등록 → `appName` 확보** ← 지금 여기. 확보하면 `granite.config.ts`의 `appName` 교체 필요
   (사업자 등록 없이도 가능. 단, 인앱 결제/정산이 필요하면 사업자 정보 필요)
3. ~~프로젝트 생성 + 딜 목록 구현~~ 완료
4. 샌드박스(테스트앱)로 실기기 테스트 → 콘솔에 검수 요청

앱인토스 MCP(`brew install ax`)는 미설치 — 이 맥에 Homebrew 자체가 없음.
없어도 `hotdealhunter/node_modules`의 TDS 타입 정의와 `docs/skills/*.md`로 개발 가능.

**서버 쪽에서 미리 해둘 것:** 미니앱에서 API를 부르려면 CORS가 열려 있어야 함.
현재 `cors()`가 전체 허용이라 일단은 동작하지만, 나중에 도메인 제한을 걸 거면 토스 도메인을 허용해야 함.

참고: https://developers-apps-in-toss.toss.im/tutorials/webview.html

### B. 트래픽 확보 (진행 중)

- [x] OG 태그, robots.txt, sitemap.xml, 네이버 소유확인 태그 추가 완료
- [ ] 네이버 서치어드바이저에서 "소유 확인" 버튼 클릭 (배포 후 사용자가 직접)
- [ ] 구글 서치 콘솔 등록
- [ ] SNS 홍보 (사용자가 직접 포스팅, Claude는 문구/이미지 제작 지원 가능)

**SEO 구조적 한계:** 현재 딜 목록은 JS로 렌더링돼서 검색엔진이 빈 페이지로 인식함.
개별 상품 검색어로는 노출이 어렵고 브랜드 검색어 위주로만 잡힘.
근본 해결하려면 서버사이드 렌더링(SSR) 필요 — 미착수.

### C. 알아둬야 할 리스크

커뮤니티 게시물을 스크래핑해서 재배포하는 구조임. 개인 프로젝트 수준에선 문제가 잘 안 되지만,
본격적으로 홍보하고 수익화하면 각 커뮤니티 이용약관 위반이나 저작권 이슈가 생길 수 있음.
사용자가 사업화를 진지하게 고민한다면 법률 자문을 권할 것. (Claude는 변호사가 아님을 명시)

---

## 6. 개발 명령어

```bash
npm install          # 의존성 설치
npm start            # 로컬 서버 (localhost:3000), 시작 즉시 1회 크롤링 후 매시 정각 반복
npm run crawl        # 서버 없이 크롤링만 1회 실행

git add . && git commit -m "메시지" && git push   # 다음 정시에 Actions가 반영
```

`node_modules`, `data/`, `package-lock.json`은 배포 시 재생성되므로 커밋 불필요.

---

## 7. 코드 스타일

- **주석은 한국어로**, "무엇을"이 아니라 "왜"를 설명할 것.
  특히 위 3번의 함정들은 주석으로 이유가 남아있음 — 지우지 말 것.
- 프론트엔드는 단일 파일 유지 (사용자가 파일 여러 개 다루는 걸 어려워함).
- 새 크롤러 추가 시: `crawler/`에 파일 만들고 `crawler/index.js`의 `SOURCES` 배열에 한 줄 추가.
  `normalizeCategory()`를 반드시 통과시킬 것. 공지사항은 원본 카테고리 기준으로 먼저 걸러낼 것.
