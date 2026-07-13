import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

type RawRow = Record<string, unknown>;

const sourceFile = process.env.KAPT_SOURCE_FILE;
const apiUrl = process.env.KAPT_API_URL;
const apiKey = process.env.KAPT_SERVICE_KEY;

const parseCsv = (text: string): RawRow[] => {
  const rows: string[][] = [];
  let cell = '';
  let current: string[] = [];
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      current.push(cell);
      cell = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') index += 1;
      current.push(cell);
      if (current.some((item) => item.trim())) rows.push(current);
      current = [];
      cell = '';
    } else {
      cell += char;
    }
  }

  current.push(cell);
  if (current.some((item) => item.trim())) rows.push(current);

  const [headers = [], ...body] = rows;
  return body.map((row) =>
    Object.fromEntries(headers.map((header, index) => [header.trim(), row[index]?.trim() ?? '']))
  );
};

const readRows = async (): Promise<RawRow[]> => {
  if (sourceFile) {
    const absolute = resolve(sourceFile);
    const text = await readFile(absolute, 'utf8');
    if (absolute.endsWith('.json')) {
      const json = JSON.parse(text);
      const items = json.response?.body?.items?.item ?? json.items ?? json;
      return Array.isArray(items) ? items : [items];
    }
    return parseCsv(text);
  }

  if (apiUrl && apiKey) {
    const url = new URL(apiUrl);
    url.searchParams.set('serviceKey', apiKey);
    url.searchParams.set('_type', 'json');
    const response = await fetch(url);
    if (!response.ok) throw new Error(`API 요청 실패: ${response.status} ${response.statusText}`);
    const json = await response.json();
    const items = json.response?.body?.items?.item ?? json.items ?? json;
    return Array.isArray(items) ? items : [items];
  }

  throw new Error('KAPT_SOURCE_FILE 또는 KAPT_API_URL/KAPT_SERVICE_KEY가 필요합니다.');
};

const main = async () => {
  const rows = await readRows();
  const first = rows[0] ?? {};
  const keys = Object.keys(first);
  const filledCounts = new Map<string, number>();

  for (const key of keys) {
    filledCounts.set(
      key,
      rows.filter((row) => row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== '').length
    );
  }

  console.log(JSON.stringify({
    rowCount: rows.length,
    keys,
    fillRate: Object.fromEntries(keys.map((key) => [key, `${filledCounts.get(key)}/${rows.length}`])),
    sample: first
  }, null, 2));
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
