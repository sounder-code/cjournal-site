import { createReadStream, createWriteStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { mkdir, open, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rawRoot = resolve(rootDir, process.env.KAPT_RAW_DIR || 'data/kapt/raw');
const origin = 'https://www.k-apt.go.kr';
const userAgent =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/138 Safari/537.36';

interface SourceConfig {
  kind: 'basic' | 'area' | 'fee';
  scode: string;
  entryPath: string;
}

interface DownloadedSource {
  kind: SourceConfig['kind'];
  sourceDate: string;
  boardSeq: string;
  fileName: string;
  path: string;
  bytes: number;
  sha256: string;
  downloadedAt: string;
}

const sources: SourceConfig[] = [
  {
    kind: 'basic',
    scode: '01',
    entryPath: '/web/board/goKaptBasicExcelDownload.do'
  },
  {
    kind: 'area',
    scode: '04',
    entryPath:
      '/web/board/webReference/boardView.do?seq=20&boardSecret=0&boardType=03&pageNo=1&keyword=&board_pwd=&scodeT=04'
  },
  {
    kind: 'fee',
    scode: '03',
    entryPath:
      '/web/board/webReference/boardView.do?seq=21&boardSecret=0&boardType=03&pageNo=1&keyword=&board_pwd=&scodeT=03'
  }
];

class KaptSession {
  private cookies = new Map<string, string>();

  private updateCookies(headers: Headers) {
    const values =
      typeof (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie === 'function'
        ? (headers as Headers & { getSetCookie: () => string[] }).getSetCookie()
        : [headers.get('set-cookie') || ''];

    for (const value of values) {
      const pair = value.split(';', 1)[0];
      const separator = pair.indexOf('=');
      if (separator > 0) this.cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
  }

  private cookieHeader() {
    return [...this.cookies].map(([key, value]) => `${key}=${value}`).join('; ');
  }

  async request(input: string, init: RequestInit = {}, redirects = 5): Promise<Response> {
    const url = new URL(input, origin);
    const headers = new Headers(init.headers);
    headers.set('user-agent', userAgent);
    headers.set('accept', headers.get('accept') || '*/*');
    const cookie = this.cookieHeader();
    if (cookie) headers.set('cookie', cookie);

    const response = await fetch(url, { ...init, headers, redirect: 'manual' });
    this.updateCookies(response.headers);
    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
      if (redirects <= 0) throw new Error(`리다이렉트 한도 초과: ${url}`);
      return this.request(new URL(response.headers.get('location')!, url).toString(), {
        method: 'GET',
        headers: { referer: url.toString() }
      }, redirects - 1);
    }
    return response;
  }
}

const requiredMatch = (text: string, expression: RegExp, label: string) => {
  const match = text.match(expression)?.[1];
  if (!match) throw new Error(`${label}을(를) 찾지 못했습니다.`);
  return match;
};

const downloadSource = async (config: SourceConfig): Promise<DownloadedSource> => {
  const session = new KaptSession();
  const listUrl = `${origin}/web/board/webReference/boardList.do?boardType=03&scodeT=${config.scode}`;
  const listResponse = await session.request(listUrl);
  if (!listResponse.ok) throw new Error(`${config.kind} 목록 요청 실패: ${listResponse.status}`);
  await listResponse.arrayBuffer();

  const pageResponse = await session.request(config.entryPath, {
    headers: { referer: listUrl }
  });
  if (!pageResponse.ok) throw new Error(`${config.kind} 게시물 요청 실패: ${pageResponse.status}`);
  const pageUrl = pageResponse.url || new URL(config.entryPath, origin).toString();
  const html = await pageResponse.text();
  const csrf = requiredMatch(html, /meta id="_csrf" name="_csrf" content="([^"]+)"/, 'CSRF 토큰');
  const boardSeq = requiredMatch(html, /name="seq" value="([^"]+)"/, '게시물 번호');
  const scode = requiredMatch(html, /name="scode" value="([^"]+)"/, '자료 구분');

  const fileListResponse = await session.request(
    `${origin}/web/board/webReference/fileListData.do?seq=BOARD_FILE`,
    {
      method: 'POST',
      headers: {
        accept: 'application/json, */*',
        'content-type': 'application/json;charset=UTF-8',
        referer: pageUrl,
        'x-csrf-token': csrf
      },
      body: JSON.stringify({
        boardType: '03',
        pageNo: '1',
        stype: '',
        keyword: '',
        seq: boardSeq,
        scode,
        boardPwd: '',
        _csrf: csrf
      })
    }
  );
  if (!fileListResponse.ok) throw new Error(`${config.kind} 첨부 목록 요청 실패: ${fileListResponse.status}`);
  const fileList = (await fileListResponse.json()) as {
    code: string;
    msg: string;
    data: Array<{ seq: number; fileName: string }> | null;
  };
  if (fileList.code !== 'SCC' || !fileList.data?.length) {
    throw new Error(`${config.kind} 첨부 목록 오류: ${fileList.msg}`);
  }

  const attachment = fileList.data.find((item) => item.fileName.toLowerCase().endsWith('.xlsx')) ?? fileList.data[0];
  const sourceDate = requiredMatch(attachment.fileName, /(20\d{6})/, '원본 기준일');
  const outputDir = resolve(rawRoot, sourceDate);
  const outputPath = resolve(outputDir, `${config.kind}.xlsx`);
  const temporaryPath = `${outputPath}.part`;
  await mkdir(outputDir, { recursive: true });

  const downloadUrl = `${origin}/cmm/file/BOARD/fileDownload.do?key=${attachment.seq}&fileName=${encodeURIComponent(attachment.fileName)}`;
  const downloadResponse = await session.request(downloadUrl, {
    headers: { referer: pageUrl, 'x-csrf-token': csrf }
  });
  if (!downloadResponse.ok || !downloadResponse.body) {
    throw new Error(`${config.kind} 파일 다운로드 실패: ${downloadResponse.status}`);
  }
  await pipeline(Readable.fromWeb(downloadResponse.body as never), createWriteStream(temporaryPath));
  await rename(temporaryPath, outputPath);
  const fileStat = await stat(outputPath);
  const handle = await open(outputPath, 'r');
  const signature = Buffer.alloc(4);
  await handle.read(signature, 0, signature.length, 0);
  await handle.close();
  if (fileStat.size < 100_000 || signature.subarray(0, 2).toString('ascii') !== 'PK') {
    throw new Error(`${config.kind} 파일이 정상적인 XLSX가 아닙니다.`);
  }
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(outputPath)) hash.update(chunk);

  return {
    kind: config.kind,
    sourceDate,
    boardSeq,
    fileName: attachment.fileName,
    path: relative(rootDir, outputPath),
    bytes: fileStat.size,
    sha256: hash.digest('hex'),
    downloadedAt: new Date().toISOString()
  };
};

const downloaded: DownloadedSource[] = [];
for (const source of sources) {
  const item = await downloadSource(source);
  downloaded.push(item);
  console.log(`[${item.kind}] ${item.fileName} -> ${item.path}`);
}

const sourceDates = new Set(downloaded.map((item) => item.sourceDate));
if (sourceDates.size !== 1) {
  throw new Error(`원본 기준일이 일치하지 않습니다: ${[...sourceDates].join(', ')}`);
}

const manifest = {
  version: 1,
  sourceDate: downloaded[0].sourceDate,
  downloadedAt: new Date().toISOString(),
  sources: Object.fromEntries(downloaded.map((item) => [item.kind, item]))
};
await mkdir(rawRoot, { recursive: true });
await writeFile(resolve(rawRoot, 'latest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`K-apt 일괄 원본 3종 저장 완료 (${manifest.sourceDate})`);
