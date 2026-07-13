# Docker 개발 및 배포

사이트는 Astro가 생성한 `dist/` 전체를 Nginx 이미지 하나로 묶는다. 서버에 개별 HTML, CSS, JavaScript 파일을 복사하지 않는다.

## 준비

로컬 Mac과 배포 서버에 Docker Engine과 Docker Compose v2가 필요하다.

```bash
docker version
docker compose version
```

현재 저장소의 `.env`, `.env.local`, `tmp/`, `logs/`는 Docker 빌드 컨텍스트에서 제외된다. K-apt 인증키는 이미지에 들어가지 않는다.

## 로컬 개발

Astro 핫리로드 환경:

```bash
npm run docker:dev
```

운영과 같은 Astro 정적 빌드 + Nginx 환경:

```bash
npm run docker:up
npm run docker:test
```

기본 주소는 각각 `http://127.0.0.1:4321`, `http://127.0.0.1:8080`이다.

## 이미지 발행

`main`의 CI가 성공하면 `.github/workflows/docker-publish.yml`이 GHCR에 두 태그를 발행한다.

- `ghcr.io/sounder-code/cjournal-site:main`: 최신 정상 빌드
- `ghcr.io/sounder-code/cjournal-site:sha-<커밋>`: 롤백 가능한 고정 빌드

저장소가 비공개이면 배포 서버에서 `read:packages` 권한 토큰으로 먼저 로그인한다.

```bash
echo "$GHCR_TOKEN" | docker login ghcr.io -u sounder-code --password-stdin
```

## 서버 배포

최신 정상 이미지를 배포:

```bash
npm run docker:deploy
```

특정 커밋 이미지를 배포하거나 롤백:

```bash
CJOURNAL_IMAGE=ghcr.io/sounder-code/cjournal-site:sha-abcdef0 npm run docker:deploy
```

배포 스크립트는 이미지를 받은 뒤 컨테이너 헬스체크를 기다리고, 주요 URL의 HTTP 상태를 검사한다. 실제 도메인 앞에는 Cloudflare 프록시 또는 Caddy/Nginx 리버스 프록시를 두고 HTTPS를 종료한다.

## 데이터 갱신 순서

K-apt 데이터는 이미지 실행 중에 변경하지 않는다.

```bash
npm run data:kapt
npm run data:kapt:validate
npm run docker:up
npm run docker:test
git add src/data/apartments.generated.ts
git commit
git push
```

푸시 이후 CI가 동일 소스와 생성 데이터를 이미지 하나로 고정한다. 로컬 검증과 운영 배포 결과가 달라지는 일을 줄일 수 있다.

