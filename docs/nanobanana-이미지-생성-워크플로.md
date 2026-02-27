# Nano Banana 이미지 생성 워크플로 (다른 스레드 재사용용)

이 문서는 **새 스레드에서도 바로 복붙해서** 결과/메인 이미지를 생성하기 위한 고정 가이드입니다.

## 1) 원칙
- API 키는 프론트 코드에 넣지 않습니다.
- 키는 로컬 `.env.local` 또는 Codex 실행 환경에서만 사용합니다.
- 생성 이미지는 `public/result-images/`에 저장합니다.

## 2) 환경변수
`.env.local` 예시:

```bash
# A안: 커스텀 이미지 API 엔드포인트 사용
NANOBANANA_API_URL=https://<nanobanana-endpoint>
NANOBANANA_API_KEY=<secret>

# B안: Gemini API 직접 호출 (권장)
GEMINI_API_KEY=<secret>
NANO_BANANA_MODEL=gemini-2.5-flash-image

# C안: OpenAI 이미지 API 직접 호출
OPENAI_API_KEY=<secret>
OPENAI_IMAGE_MODEL=gpt-image-1
OPENAI_IMAGE_QUALITY=medium
IMAGE_PROVIDER=openai
```

## 3) 프롬프트 템플릿
- 기본 예시: `scripts/nanobanana-prompts.example.json`
- 테스트 1개(메인1 + 결과8) 템플릿: `scripts/nanobanana-prompts.test-template.json`

## 4) 실행 명령
```bash
./npmw run images:nanobanana -- scripts/nanobanana-prompts.test-template.json public/result-images
```

## 5) 파일명 규칙
- 메인: `test-<slug>-main.png`
- 결과: `test-<slug>-<resultId>.png`

예:
- `test-snack-human-main.png`
- `test-snack-human-cookie.png`

## 6) 연결 체크리스트
- 테스트 JS의 `RESULT_IMAGE_MAP` 경로가 실제 파일명과 일치하는지
- `index.html`의 기본 `og:image`, `twitter:image`가 기본 공유 이미지로 맞는지
- `./npmw run build` 통과 여부
