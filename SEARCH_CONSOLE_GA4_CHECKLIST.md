# Search Console + GA4 체크리스트 (kuru.co.kr)

## 1) Search Console 등록
1. Search Console에서 속성 추가: `https://kuru.co.kr`
2. 권장 인증: URL 접두어 속성 + HTML 태그
3. 인증 메타 태그를 받으면 `index.html`의 `<head>`에 바로 추가
4. 사이트맵 제출: `https://kuru.co.kr/sitemap.xml`
5. URL 검사로 인덱싱 요청:
   - `https://kuru.co.kr/`
   - `https://kuru.co.kr/lizard-face-match/`
   - `https://kuru.co.kr/about.html`
   - `https://kuru.co.kr/privacy.html`
   - `https://kuru.co.kr/terms.html`
   - `https://kuru.co.kr/contact.html`

## 2) GA4 측정 ID 설정
1. GA4 측정 ID 확인(`G-`로 시작)
2. `config.js`의 `GA_MEASUREMENT_ID` 값 입력
3. 배포 후 실시간 보고서에서 이벤트 수신 확인

## 3) 현재 퍼널 이벤트 규격
- `landing_view`: 페이지 유입
  - 파라미터: `page_type`, `test_id`, `from_shared(테스트 페이지만)`
- `start_test`: 테스트 시작(이름 2글자 통과 시점)
  - 파라미터: `test_id`, `user_name_len`
- `analyze_success`: 분석 성공
  - 파라미터: `source(api/local)`, `lizard_name`
- `share_click`: 공유 클릭
  - 파라미터: `test_id`, `channel(web/copy/kakao/insta)`, `lizard_name`
