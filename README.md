# cjournal-site

`cjournal.kr` 전용 Astro 정적 콘텐츠 허브입니다.

## 핵심 원칙
- 이 저장소는 `cjournal.kr`만 다룹니다.
- `kuru.co.kr`, `lizard`, `snack-human`, `linclassic` 관련 코드/자산은 포함하지 않습니다.

## 로컬 실행
```bash
npm install
npm run dev
npm run build
```

## 자동 발행 워크플로우
- 파일: `.github/workflows/daily-generate.yml`
- 실행: 매일 06:00 (Asia/Seoul), 수동 실행 지원
- 동작: 키워드 생성 -> 기사 생성 -> 품질 검사 -> 인덱스 빌드 -> 커밋/푸시

## 애드센스 없이 수익화(제휴 링크)
- 기사 상세 페이지에 태그/카테고리 기반 추천 링크가 자동 노출됩니다.
- 제휴 링크 설정 파일: `src/content/monetization/offers.ts`
- `url` 값을 실제 제휴/파트너 링크로 교체하세요.
- 클릭 이벤트는 GTM `affiliate_click` 이벤트로 전송됩니다.
- 키워드 생성 시 상업의도 점수 임계값은 `MIN_COMMERCIAL_SCORE`로 조정할 수 있습니다(기본값: `2`).

## 생성 안정화 튜닝
- 기사 생성은 `ARTICLE_PROVIDER=auto`일 때 Gemini 실패 시 OpenAI로 자동 failover합니다.
- 재시도 횟수: `ARTICLE_MAX_ATTEMPTS` (기본값 `2`)
- 재시도 대기: `RETRY_BACKOFF_MS` (기본값 `1200`)
- 타임아웃: `GEMINI_TIMEOUT_MS`, `OPENAI_TIMEOUT_MS`

필수 GitHub Secrets:
- `OPENAI_API_KEY`
- `GENERATION_ENABLED` (`true`/`false`)

## 분석/광고 태그 정책
- 사이트 코드에는 GTM 컨테이너(`PUBLIC_GTM_ID`)만 삽입합니다.
- GA4 측정 태그(`G-...`)는 GTM 컨테이너 내부에서만 관리합니다.
- 중복 계측(사이트 코드 + GTM 동시 주입)을 금지합니다.

## 배포
- Cloudflare Pages: `cjournal-site` 저장소의 `main` 브랜치 연결
- 빌드 명령: `npm run build`
- 빌드 출력: `dist`
