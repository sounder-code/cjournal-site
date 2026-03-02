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

const LOW_TRUST_PATTERNS = [
  /그것이\s*알고\s*싶다/i,
  /언더커버/i,
  /미쓰홍/i,
  /드라마|예능|영화|웹툰|연예|아이돌|팬덤|컴백|방영|회차|스포일러|OST/i,
  /사주|운세|궁합|타로|점집/i,
  /사건\s*사고|범죄|체포|구속|수사|재판|폭로|논란|사망|참사/i
];

function normalizeTopic(input: string): string {
  return input
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasRepeatedAdjacentToken(input: string): boolean {
  const tokens = normalizeTopic(input).split(' ').filter(Boolean);
  for (let i = 1; i < tokens.length; i += 1) {
    if (tokens[i] === tokens[i - 1]) return true;
  }
  return false;
}

export function isUnsafeTopic(topic: string): boolean {
  const value = topic.trim();
  if (!value) return true;
  return UNSAFE_PATTERNS.some((pattern) => pattern.test(value));
}

export function isLowTrustKeyword(topic: string): boolean {
  const value = topic.trim();
  if (!value) return true;
  if (value.length < 2 || value.length > 42) return true;
  if (/^\d+$/.test(value)) return true;
  if (hasRepeatedAdjacentToken(value)) return true;
  return LOW_TRUST_PATTERNS.some((pattern) => pattern.test(value));
}

export function shouldAddDisclaimer(topic: string): boolean {
  return /(건강|법|금융|투자|세금|보험|대출)/i.test(topic);
}
