# K-apt 일괄 데이터 파이프라인

## 운영 원칙

- 사이트 데이터의 기준은 K-apt 자료실이 매주 공개하는 정부 일괄 XLSX 파일이다.
- 현재 운영 단계에서는 공공데이터 OpenAPI를 호출하지 않는다.
- 기본정보, 면적정보, 관리비정보의 기준일이 모두 같을 때만 최신 데이터로 반영한다.
- 원본의 내용 정확성은 제공기관 기준으로 두고, 파이프라인은 파일 무결성·스키마·중복·결합률을 검증한다.

## 한 번에 갱신

```bash
npm run data:kapt
```

위 명령은 다음 순서로 실행된다.

1. K-apt 최신 게시물에서 기본정보·면적정보·관리비정보 XLSX를 내려받는다.
2. `data/kapt/raw/YYYYMMDD/`에 원본을 보관한다.
3. 세 파일을 단지코드로 결합하고 관리비부과면적으로 나눠 `원/m2` 단가를 계산한다.
4. 전국 검색용 인덱스와 시도별 상세 파일을 생성한다.

원본 파일은 용량이 크므로 Git에서 제외한다. 현재 원본 정보는 `data/kapt/raw/latest.json`에 기록된다.

## 개별 실행

```bash
npm run data:kapt:download
npm run data:kapt:bulk
npm run data:kapt:bulk:validate
```

이미 받은 원본을 다시 변환할 때는 `data:kapt:bulk`만 실행한다. 다른 원본 묶음을 사용할 때는:

```bash
KAPT_BULK_MANIFEST=data/kapt/raw/20260710/manifest.json npm run data:kapt:bulk
```

## 생성 파일

- `public/data/apartments/manifest.json`: 기준일, 최신 관리비 월, 행 수, 결합·중복 검증 결과
- `public/data/apartments/index.json`: 전국 단지 검색용 경량 인덱스
- `public/data/apartments/regions/*.json`: 시도별 단지 상세정보와 월별 관리비

시도 파일의 `f` 배열은 `manifest.json`의 `feeColumns` 순서를 따른다. 숫자 키를 사용한 이유는 전국 데이터를 브라우저로 전달할 때 파일 크기를 줄이기 위해서다.

## 배포 전 확인

```bash
npm run data:kapt:bulk
npm run data:kapt:bulk:validate
npm run typecheck
npm run build
```

`manifest.json`에서 아래 항목을 확인한다.

- `duplicateComplexes`, `duplicateFeeRows`, `areaConflicts`
- `feeRowsWithoutArea`, `feeRowsWithoutComplex`
- 직전 갱신 대비 `complexes`, `feeRows`의 비정상 급감 여부
- `sourceDate`와 `latestMonth`

전국 지도 마커에 필요한 좌표는 별도의 정부 주소 좌표 일괄 DB를 결합한다. 좌표가 준비되기 전에도 전국 단지 검색과 상세 데이터는 이 파이프라인 결과만으로 운영할 수 있다.
