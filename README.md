# 핫딜헌터 서버

뽐뿌 / 퀘이사존 / 클리앙(알뜰구매) / 어미새 / 루리웹(핫딜예판) 핫딜 게시판을 1시간마다
자동으로 수집해서 검색·필터·정렬로 비교해볼 수 있는 웹사이트입니다.

## 구조

```
hotdeal-server/
  server.js        Express 서버 (정적 파일 서빙 + API + 썸네일 프록시)
  scheduler.js      매시 정각 크롤링 스케줄러 (node-cron)
  db.js             JSON 파일 기반 저장소 (data/deals.json)
  crawler/
    ppomppu.js       뽐뿌 파서
    clien.js         클리앙 파서
    quasarzone.js    퀘이사존 파서
    eomisae.js       어미새 파서
    ruliweb.js       루리웹 핫딜예판 파서
    index.js         전체 사이트 순차 크롤링 + 저장 (SOURCES 배열에 사이트 추가/삭제)
  public/index.html  프론트엔드 (API에서 데이터를 받아 렌더링)
```

새 사이트를 더 추가하고 싶으면 `crawler/`에 파서 파일을 하나 만들고
`crawler/index.js`의 `SOURCES` 배열에 한 줄만 추가하면 됩니다.

## 로컬에서 실행하기

```bash
cd hotdeal-server
npm install
npm start
```

브라우저에서 http://localhost:3000 접속. 서버가 켜지면 곧바로 1회 크롤링을 실행하고,
이후 매시 정각(0 * * * *)에 자동으로 다시 수집합니다.

수동으로 즉시 한 번 더 돌려보고 싶다면:

```bash
curl -X POST http://localhost:3000/api/crawl-now
```

## API

- `GET /api/deals?source=뽐뿌&category=전자기기&q=노트북` — 딜 목록 (쿼리는 전부 선택)
- `GET /api/health` — 서버/크롤러 상태 확인
- `POST /api/crawl-now` — 즉시 크롤링 실행 (공개 배포 시에는 삭제하거나 인증 추가 권장)

## Railway에 배포하기

1. https://railway.app 가입 후 로그인
2. "New Project" → "Deploy from GitHub repo" (또는 "Empty Project" 후 로컬 폴더를 GitHub에 올려서 연결)
   - GitHub이 익숙하지 않다면: 이 `hotdeal-server` 폴더를 그대로 새 GitHub 저장소로 push한 뒤 Railway에서 그 저장소를 선택하면 됩니다.
3. Railway가 `package.json`을 자동으로 인식해서 `npm install` → `npm start`로 빌드/실행합니다. 별도 설정 불필요.
4. 배포가 끝나면 Settings → Networking에서 "Generate Domain"을 눌러 공개 URL을 받습니다.
5. 배포 후 `https://내도메인.up.railway.app/api/health`로 접속해서 크롤링이 잘 도는지 확인하세요.

무료 크레딧 한도 내에서는 카드 등록 없이 사용 가능합니다. 상시 켜두는 서버라 요금이 궁금하면
Railway 대시보드의 Usage 탭에서 실시간으로 확인할 수 있습니다.

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
