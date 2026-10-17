export function apartmentSearchText(item: { n: string; an?: string[]; a: string; sd: string; sg: string; d: string }) {
  return `${item.n} ${(item.an || []).join(' ')} ${item.a} ${item.sd} ${item.sg} ${item.d}`.toLowerCase();
}
