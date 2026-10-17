import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import ExcelJS from 'exceljs';
import { apartmentIdentity } from '../src/lib/apartmentIdentity';
import { apartmentSearchText } from '../src/lib/apartmentSearch';

test('identity retains only observed names, removes duplicates and current name', () => {
  assert.deepEqual(apartmentIdentity('현재', 'A1', { slug: 'old-a1', name: ' 이전 ', aliases: ['이전', '현재', '', '더이전'] }), { s: 'old-a1', an: ['더이전', '이전'] });
  assert.deepEqual(apartmentIdentity('신규 단지', 'A2'), { s: '신규-단지-a2' });
});

test('bulk transform preserves URL, accumulates aliases, and blocks missing or unpublishable records', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cjournal-identity-'));
  try {
    for (const dir of ['scripts', 'src/lib', 'src/data', 'raw']) await mkdir(join(root, dir), { recursive: true });
    for (const file of ['scripts/ingest-kapt-bulk.ts', 'scripts/publication-safety.ts', 'scripts/kapt-coordinate-validation.ts', 'src/lib/apartmentIdentity.ts']) await copyFile(resolve(file), join(root, file));
    await writeFile(join(root, 'package.json'), '{"type":"module"}');
    await symlink(resolve('node_modules'), join(root, 'node_modules'));
    await writeFile(join(root, 'src/data/apartment-coordinates.json'), '{}');
    await writeFile(join(root, 'src/data/admin-centers.json'), '{"districts":[]}');
    const source = await readFile(resolve('scripts/ingest-kapt-bulk.ts'), 'utf8');
    const headersFor = (name: string) => [...source.match(new RegExp(`rowsFromWorkbook\\(${name}, \\[([\\s\\S]*?)\\]\\)`))![1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
    const workbook = async (path: string, headers: string[], rows: Record<string, unknown>[]) => {
      const book = new ExcelJS.Workbook(); const sheet = book.addWorksheet('data');
      sheet.addRow(['fixture']); sheet.addRow(headers);
      for (const row of rows) sheet.addRow(headers.map((header) => row[header] ?? 0));
      await book.xlsx.writeFile(join(root, path), { useSharedStrings: true });
      // Put workbook metadata and strings before worksheets for ExcelJS's streaming reader.
      const ordered = spawnSync('python3', ['-c', "import sys,zipfile,io; p=sys.argv[1]; z=zipfile.ZipFile(p); entries=[(n,z.read(n)) for n in z.namelist()]; z.close(); out=zipfile.ZipFile(p,'w',zipfile.ZIP_DEFLATED); [out.writestr(n,b) for n,b in sorted(entries,key=lambda e: e[0].startswith('xl/worksheets/'))]; out.close()", join(root, path)], { encoding: 'utf8' });
      assert.equal(ordered.status, 0, ordered.stderr);
    };
    const basic = async (name: string, households = 100, missing = false) => workbook('raw/basic.xlsx', headersFor('basicPath'), missing ? [] : [{ '단지코드': 'A1', '단지명': name, '시도': '서울특별시', '시군구': '강남구', '도로명주소': '서울특별시 강남구 테스트길', '세대수': households }]);
    await workbook('raw/area.xlsx', ['단지코드', '관리비부과면적'], [{ '단지코드': 'A1', '관리비부과면적': 100 }]);
    await workbook('raw/fee.xlsx', headersFor('source.path'), [1, 2, 3, 4, 5].map((month) => ({ '단지코드': 'A1', '발생년월(YYYYMM)': `20260${month}`, '공용관리비계': 100000 })));
    await writeFile(join(root, 'raw/latest.json'), JSON.stringify({ sourceDate: '20261016', sources: Object.fromEntries(['basic', 'area', 'fee'].map((key) => [key, { path: `raw/${key}.xlsx`, fileName: `${key}.xlsx` }])) }));
    const run = () => spawnSync(process.execPath, ['--import', resolve('node_modules/tsx/dist/loader.mjs'), join(root, 'scripts/ingest-kapt-bulk.ts')], { cwd: root, encoding: 'utf8', env: { ...process.env, KAPT_BULK_MANIFEST: 'raw/latest.json', KAPT_BULK_OUTPUT: 'out', KAPT_FEE_FILES: 'raw/fee.xlsx', KAPT_INDEXNOW_CHANGESET: 'changes.json' } });
    const read = async (file: string) => JSON.parse(await readFile(join(root, 'out', file), 'utf8'));
    await basic('최초단지'); const first = run(); assert.equal(first.status, 0, first.stderr);
    const original = (await read('index.json'))[0]; assert.equal(original.s, '최초단지-a1'); assert.equal(original.an, undefined);
    await basic('두번째단지'); const renamed = run(); assert.equal(renamed.status, 0, renamed.stderr);
    await basic('현재단지'); const renamedAgain = run(); assert.equal(renamedAgain.status, 0, renamedAgain.stderr);
    const current = (await read('index.json'))[0];
    assert.equal(current.s, original.s); assert.equal(current.n, '현재단지'); assert.deepEqual(current.an, ['두번째단지', '최초단지']);
    for (const file of ['search.json', 'regions/서울.json', 'maps/서울/강남구.json']) {
      const entry = (await read(file))[0]; assert.deepEqual(entry.an, current.an);
      for (const name of ['최초단지', '두번째단지', '현재단지']) assert.ok(apartmentSearchText(entry).includes(name));
    }
    const before = await readFile(join(root, 'out/index.json'), 'utf8');
    const manifestBefore = await readFile(join(root, 'out/manifest.json'), 'utf8');
    assert.equal(run().status, 0); assert.equal(await readFile(join(root, 'out/index.json'), 'utf8'), before); assert.equal(await readFile(join(root, 'out/manifest.json'), 'utf8'), manifestBefore);
    await basic('현재단지', 0); const excluded = run(); assert.notEqual(excluded.status, 0); assert.match(excluded.stderr, /기존 공개 URL 1개/);
    assert.equal(await readFile(join(root, 'out/index.json'), 'utf8'), before);
    await basic('현재단지', 100, true); const missing = run(); assert.notEqual(missing.status, 0); assert.match(missing.stderr, /기존 공개 URL 1개/);
    assert.equal(await readFile(join(root, 'out/index.json'), 'utf8'), before);
  } finally { await rm(root, { recursive: true, force: true }); }
});
