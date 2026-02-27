const UNSAFE_PATTERNS = [
  /진단/i,
  /처방/i,
  /투자\s*추천/i,
  /고수익/i,
  /소송\s*전략/i,
  /불법/i,
  /해킹/i,
  /마약/i,
  /성인물/i,
  /도박/i
];

export function isUnsafeTopic(topic: string): boolean {
  const value = topic.trim();
  if (!value) return true;
  return UNSAFE_PATTERNS.some((pattern) => pattern.test(value));
}

export function shouldAddDisclaimer(topic: string): boolean {
  return /(건강|법|금융|투자|세금|보험|대출)/i.test(topic);
}
