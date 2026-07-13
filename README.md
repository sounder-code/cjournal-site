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

## Docker 로컬 환경

운영 배포와 동일한 정적 빌드/Nginx 조합은 아래 명령으로 실행합니다.

```bash
npm run docker:up
npm run docker:test
```

- 접속: `http://127.0.0.1:8080`
- 로그: `npm run docker:logs`
- 종료: `npm run docker:down`
- 포트 변경: `CJOURNAL_PORT=8081 npm run docker:up`

소스 수정 즉시 반영되는 Astro 개발 컨테이너는 별도 Compose 파일을 사용합니다.

```bash
npm run docker:dev
```

- 접속: `http://127.0.0.1:4321`
- 종료: `npm run docker:dev:down`
- 포트 변경: `CJOURNAL_DEV_PORT=4336 npm run docker:dev`

`.env`, `.env.local`, `tmp/`, `logs/`는 Docker 이미지에 포함되지 않습니다. K-apt 수집은 호스트에서 실행해 `src/data/apartments.generated.ts`를 만든 뒤 이미지를 빌드합니다.

## 자동 발행 워크플로우
- 파일: `.github/workflows/daily-generate.yml`
- 실행: 매일 06:00 (Asia/Seoul), 수동 실행 지원
- 동작: 키워드 생성 -> 기사 생성 -> 품질 검사 -> 인덱스 빌드 -> 커밋/푸시
- 현재 워크플로우는 `self-hosted` 러너(`macOS/ARM64/cjournal` 라벨)에서 실행됩니다.

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

## 로컬 FLUX 이미지 생성
- 이미지 스크립트는 `IMAGE_PROVIDER=flux-local` 또는 `IMAGE_PROVIDER=auto`에서 로컬 FLUX API를 우선 시도합니다.
- 필수 설정:
  - `FLUX_LOCAL_API_URL`: 로컬 이미지 API 주소
  - (선택) `FLUX_LOCAL_API_KEY`
  - (선택) `FLUX_LOCAL_MODEL` (기본 `flux.2`)
- 지원 형식:
  - Stable Diffusion WebUI `.../sdapi/v1/txt2img`
  - OpenAI 호환 이미지 생성 엔드포인트
- 주의: GitHub Actions(호스티드 러너)는 사용자 PC의 로컬 FLUX에 접근할 수 없습니다. 자동 배치에서 FLUX를 쓰려면 self-hosted runner 또는 외부 공개 API가 필요합니다.

## Self-hosted Runner 설정(맥)
1. GitHub 저장소 `Settings -> Actions -> Runners -> New self-hosted runner`에서 등록 토큰을 발급합니다.
2. 아래 스크립트를 실행합니다.
```bash
bash scripts/setup-gh-runner-macos.sh sounder-code/cjournal-site <RUNNER_TOKEN>
```
3. 저장소 `Settings -> Secrets and variables -> Actions`에서 아래 값을 설정합니다.
- `Variables`
  - `FLUX_LOCAL_API_URL` (예: `http://127.0.0.1:7860/sdapi/v1/txt2img`)
  - `FLUX_LOCAL_MODEL` (예: `flux.2`)
- `Secrets` (선택)
  - `FLUX_LOCAL_API_KEY`

필수 GitHub Secrets:
- `OPENAI_API_KEY`
- `GENERATION_ENABLED` (`true`/`false`)

## 분석/광고 태그 정책
- 사이트 코드에는 GTM 컨테이너(`PUBLIC_GTM_ID`)와 GA4 측정 태그(`PUBLIC_GA_ID`)를 삽입합니다.
- 기본 GA4 측정 ID는 `G-SE44ENS3KV`입니다.
- GTM은 제휴 클릭 등 이벤트 확장용으로 유지하고, 기본 페이지뷰는 GA4 직접 태그로 보냅니다.

## 배포
- `main` 브랜치가 CI를 통과하면 GitHub Actions가 `ghcr.io/sounder-code/cjournal-site:main` 이미지를 발행합니다.
- Docker 서버에서는 `compose.prod.yaml`로 이미지 전체를 교체합니다.

```bash
docker compose -f compose.prod.yaml pull
docker compose -f compose.prod.yaml up -d
```

- 기존 Cloudflare Pages 연결은 전환이 끝날 때까지 유지합니다.
- 실제 도메인 전환 전에는 Docker 서버의 헬스체크와 `npm run docker:test -- http://서버주소`를 먼저 통과시킵니다.
- 전체 개발·발행·롤백 절차는 [`docs/docker-deployment.md`](docs/docker-deployment.md)를 참고합니다.
