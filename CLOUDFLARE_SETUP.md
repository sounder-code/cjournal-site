# Cloudflare 설정 체크리스트

아래 순서대로 하면 현재 프로젝트를 Cloudflare Pages + Functions로 바로 배포할 수 있습니다.

## 1) Pages 프로젝트 생성
1. Cloudflare 대시보드 > `Workers & Pages` > `Create` > `Pages` > `Connect to Git`
2. 이 저장소 선택
3. 빌드 설정 입력
- Framework preset: `Vite`
- Build command: `npm run build`
- Build output directory: `dist`
- Root directory: 비워두기(프로젝트 루트)

## 2) 환경 변수/시크릿
1. Pages 프로젝트 > `Settings` > `Environment variables`
2. `Production`/`Preview` 각각 설정
- `KAKAO_JS_KEY`: (카카오 JavaScript 키, 프론트용)
- LLM 연동 시: `OPENAI_API_KEY` 또는 `GEMINI_API_KEY` (Functions에서만 사용)

## 3) Functions 활성 확인
1. 저장소에 `functions/` 폴더가 이미 포함됨
2. 배포 후 아래 경로 확인
- `https://<pages-domain>/api/health`
- `https://<pages-domain>/api/analyze` (POST)

## 4) 도메인/보안
1. `Custom domains`에서 실제 도메인 연결
2. `SSL/TLS`에서 HTTPS 강제(`Always Use HTTPS`)
3. 필요 시 `Security` > `WAF` 기본 규칙 활성

## 5) 카카오 설정
1. 카카오 개발자 콘솔 > 앱 > 플랫폼 > Web
2. 사이트 도메인 등록
- `https://<pages-domain>`
- `https://<custom-domain>`
3. Redirect URI가 필요하면 동일 도메인 기준으로 추가

## 6) 배포 후 검증
1. 업로드 > 분석 결과 정상 노출
2. `api/health` 응답 200 확인
3. 공유 링크 복원(`?r=`) 동작 확인
4. 카카오 공유 동작 확인(허용 도메인 누락 시 실패)

## 7) 장애 시 빠른 점검
1. `Deployments` 로그에서 빌드 실패 확인
2. `Functions` 로그에서 `/api/analyze` 오류 확인
3. 카카오 공유 실패 시 도메인 등록 상태 확인
