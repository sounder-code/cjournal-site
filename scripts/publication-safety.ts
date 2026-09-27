export type PublishedPage = { c: string; s: string; q: number };

export function assertPublishedUrlsPreserved(previous: PublishedPage[], current: PublishedPage[]) {
  const next = new Map(current.filter((item) => item.q === 1).map((item) => [item.c, item.s]));
  const lost = previous.filter((item) => item.q === 1 && next.get(item.c) !== item.s);
  if (lost.length) {
    throw new Error(`기존 공개 URL ${lost.length}개가 삭제 또는 변경됩니다. 원본 누락·단지명 변경 및 리다이렉션을 검토한 뒤 진행하세요:\n${lost.slice(0, 30).map((item) => `${item.c}: /apartments/${item.s}/`).join('\n')}`);
  }
}
