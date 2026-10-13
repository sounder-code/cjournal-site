type FeePoint = readonly [string, number, ...number[]];

export const hasPriorCalendarMonth = (fees: readonly FeePoint[]) => {
  if (fees.length < 2) return false;
  const index = (month: string) => Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7));
  return index(fees.at(-1)![0]) - index(fees.at(-2)![0]) === 1;
};

export const previousFeeCopy = (fees: readonly FeePoint[]) => {
  if (!hasPriorCalendarMonth(fees)) return '전월 자료가 없어 전월 증감은 비교하지 않습니다.';
  const delta = fees.at(-1)![1] - fees.at(-2)![1];
  return delta === 0
    ? '전월과 비교해 변동이 없습니다.'
    : `전월과 비교하면 ㎡당 ${Math.abs(delta).toLocaleString('ko-KR')}원 ${delta > 0 ? '올랐습니다' : '내렸습니다'}.`;
};

export const apartmentReportDescription = (
  name: string,
  fees: readonly FeePoint[],
  comparisonEligible: boolean,
  peerLabel: string
) => {
  const latest = fees.at(-1)!;
  const history = fees.length > 1 ? `공개된 ${fees.length}개월 추이, ` : '';
  const comparison = comparisonEligible ? `${peerLabel} 비교, ` : '';
  return `${name} ${latest[0]} 관리비는 ㎡당 ${latest[1].toLocaleString('ko-KR')}원입니다. ${history}${comparison}공용관리비·장기수선충당금을 확인하세요.`;
};
