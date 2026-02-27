# Astro SEO Hub 실배포 체크리스트

## 1) GitHub 저장소 준비
- 기본 브랜치: `main`
- Actions 활성화 확인
- `.github/workflows/ci.yml`, `.github/workflows/daily-generate.yml` 존재 확인

## 2) GitHub Secrets 설정
Repository Settings -> Secrets and variables -> Actions

필수:
- `OPENAI_API_KEY`

선택:
- `GENERATION_ENABLED` = `true` 또는 `false`

권장 기본값:
- 초기에 `GENERATION_ENABLED=false`로 두고 수동 실행(`workflow_dispatch`) 테스트 후 `true` 전환

## 3) GitHub Actions 동작 확인
- `CI` 워크플로: push 시 `npm ci -> typecheck -> build` 성공 확인
- `Daily Content Generate` 워크플로 수동 실행
- 실패 시 artifact의 `logs/` 다운로드 확인

스케줄:
- 매일 06:00 KST
- cron: `0 21 * * *` (UTC 기준 전일 21:00)

## 4) Cloudflare Pages 연결
Cloudflare Dashboard -> Workers & Pages -> Create -> Pages -> Connect to Git

설정값:
- Framework preset: `Astro`
- Build command: `npm run build`
- Build output directory: `dist`
- Root directory: (비움)
- Production branch: `main`

환경변수:
- `PUBLIC_ADS_ENABLED=false`

## 5) 도메인 연결
- Pages 프로젝트 -> Custom domains
- 원하는 도메인 연결 후 DNS 전파 확인
- SSL/TLS에서 HTTPS 강제(Always Use HTTPS) 활성화

## 6) 운영 점검 URL
- 홈: `/`
- 태그: `/tags/<tag>/`
- 포스트: `/posts/<slug>/`
- Sitemap: `/sitemap.xml`
- RSS: `/rss.xml`

## 7) 광고 활성화(나중)
- Cloudflare Pages env에서 `PUBLIC_ADS_ENABLED=true`
- `src/components/AdSense.astro`에 실제 AdSense 코드 삽입
- 배포 후 CLS/레이아웃 깨짐 점검

## 8) 안전 운영 가드
- 민감 주제 필터: `scripts/policy.ts`
- 금지어 필터: `src/content/keywords/forbidden.txt`
- blacklist: `src/content/keywords/blacklist.txt`
- 품질 게이트 통과 상위 5개만 유지: `scripts/quality-gate.ts`
