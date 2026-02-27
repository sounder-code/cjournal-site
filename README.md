# Astro Static SEO Content Hub

Cloudflare Pages + GitHub Actions 기반의 정적 SEO 콘텐츠 허브입니다.

## 스택
- Astro (TypeScript)
- Node.js 20
- Markdown 콘텐츠 저장 (`src/content/posts`)
- GitHub Actions 일일 자동 생성
- OpenAI API (`OPENAI_API_KEY`)

## 로컬 실행
```bash
npm install
npm run dev
```

빌드:
```bash
npm run build
npm run preview
```

## 스크립트
- `npm run gen:keywords`: 시드 키워드 확장(`today.json` 생성)
- `npm run gen:articles`: OpenAI 기반 초안 생성 (`src/content/posts/*.md`)
- `npm run quality`: 길이/구조/금지어/중복 점검 + 상위 5개만 유지
- `npm run build:index`: 태그/최신글/연관글 인덱스 생성 및 related placeholder 채움
- `npm run sync:linclassic-monsters`: 리니지 클래식 공식 API 기준으로 몬스터/지역/아이템/드랍 데이터 JSON 생성

## 리니지 클래식 데이터 생성
공식 사이트 `https://lineageclassic.plaync.com/ko-kr/info/monster` 기준 API를 사용합니다.

실행:
```bash
npm run sync:linclassic-monsters
```

생성 파일:
- `data/linclassic/metadata.json`
- `data/linclassic/monsters.json`
- `data/linclassic/regions.json`
- `data/linclassic/items.json`
- `data/linclassic/drops.json`

## 콘텐츠 구조
- `src/content/posts/*.md`
- frontmatter 필수 필드:
  - `title`
  - `description`
  - `slug`
  - `publishedAt` (`YYYY-MM-DD`)
  - `updatedAt` (`YYYY-MM-DD`)
  - `tags` (배열)
  - `category`
  - `readingTimeMinutes`

본문 형식 규칙:
- 도입부 포함
- H2 4~6개
- FAQ 3개 Q&A
- 하단 `업데이트: YYYY-MM-DD`
- `<!-- RELATED_POSTS -->` placeholder 포함

## 환경 변수
`.env` 또는 GitHub Secrets에서 관리:
- `OPENAI_API_KEY` (필수)
- `OPENAI_MODEL` (기본: `gpt-4.1-mini`)
- `ARTICLE_COUNT` (기본: `10`)
- `GENERATION_ENABLED` (`true/false`)
- `PUBLIC_ADS_ENABLED` (`false` 기본)

## GitHub Actions
### CI (`.github/workflows/ci.yml`)
- push / PR 시 `npm ci` -> `npm run typecheck` -> `npm run build`

### Daily Generate (`.github/workflows/daily-generate.yml`)
- 매일 08:10 KST (UTC cron `10 23 * * *`)
- 순서:
  1. 키워드 생성
  2. 아티클 생성
  3. 품질 게이트
  4. 인덱스 빌드
  5. 사이트 빌드
  6. 변경 커밋/푸시
- 실패 시 `logs/`를 아티팩트로 업로드

## Cloudflare Pages 연결
1. GitHub 저장소를 Pages에 연결
2. Build command: `npm run build`
3. Build output directory: `dist`
4. Environment variables 설정:
   - `PUBLIC_ADS_ENABLED=false`
5. Production branch: `main`

Push 될 때마다 Cloudflare Pages가 자동 배포됩니다.
실배포 상세 체크리스트: `docs/astro-seo-hub-실배포-체크리스트.md`

## 광고(AdSense) 나중에 활성화
현재 레이아웃에는 `top/mid/bottom` 슬롯 placeholder만 존재하며 비활성화입니다.

활성화 절차:
1. `PUBLIC_ADS_ENABLED=true` 설정
2. `src/components/AdSense.astro`에 실제 AdSense 코드 삽입
3. CLS 영향 없는 크기 고정 유지

## 안전 정책
- 민감/위험 주제는 `scripts/policy.ts`에서 차단
- 의료/법률/금융 개인 자문 금지
- 불확실 사실은 `확실하지 않음` 사용
- 필요 시 본문에 면책 문구 포함
