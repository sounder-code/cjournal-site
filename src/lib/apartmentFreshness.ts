export interface RetainedPublication {
  reason: 'basic-missing' | 'fees-missing' | 'quality-failed';
  sourceDate: string;
  source: string;
  since: string;
  checkedDate: string;
}

export const sourceDateLabel = (date: string) =>
  /^\d{8}$/.test(date) ? `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}` : date;

export const retentionReason = (status: RetainedPublication) => ({
  'basic-missing': '최신 기본정보에서 단지코드가 확인되지 않습니다.',
  'fees-missing': '최신 관리비 원본에 이 단지의 관리비 내역이 없습니다.',
  'quality-failed': '최신 공개 자료가 관리비 공개 조건을 충족하지 않습니다.'
})[status.reason];

export const retentionNotice = (status: RetainedPublication) =>
  `갱신 지연 · ${sourceDateLabel(status.sourceDate)} 원본의 마지막 정상 자료를 표시합니다. ${retentionReason(status)} ${sourceDateLabel(status.checkedDate)} 원본 확인 기준이며 최신 비교·집계에서는 제외합니다.`;
