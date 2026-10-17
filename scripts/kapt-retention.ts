/** Limit recovery to small, isolated losses; never mask a damaged bulk source. */
export function assertRetentionBudget(previousPublished: number, retained: number) {
  const limit = Math.min(100, Math.max(1, Math.floor(previousPublished * 0.005)));
  if (retained > limit) throw new Error(`K-apt 보존 중단: 갱신 지연 ${retained}개가 보존 상한 ${limit}개를 초과했습니다.`);
}
