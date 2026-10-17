import { hasNegativeFeeAggregate } from './kapt-fee-quality';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import ExcelJS from 'exceljs';
import { assertRetentionBudget } from './kapt-retention';
import { commonMonthComparison } from '../src/lib/commonMonthComparison';
import { apartmentIdentity } from '../src/lib/apartmentIdentity';
import { apartmentSearchText } from '../src/lib/apartmentSearch';

test('identity retains only observed names, removes duplicates and current name', () => {
  assert.deepEqual(apartmentIdentity('현재', 'A1', { slug: 'old-a1', name: ' 이전 ', aliases: ['이전', '현재', '', '더이전'] }), { s: 'old-a1', an: ['더이전', '이전'] });
  assert.deepEqual(apartmentIdentity('신규 단지', 'A2'), { s: '신규-단지-a2' });
});

test('bulk transform retains isolated losses with provenance, accumulates aliases, recovers and blocks damaged sources', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cjournal-identity-'));
  try {
    for (const dir of ['scripts', 'src/lib', 'src/data', 'raw']) await mkdir(join(root, dir), { recursive: true });
    for (const file of ['scripts/ingest-kapt-bulk.ts', 'scripts/publication-safety.ts', 'scripts/kapt-coordinate-validation.ts', 'src/lib/apartmentIdentity.ts', 'src/lib/apartmentFreshness.ts', 'scripts/kapt-retention.ts', 'scripts/kapt-fee-quality.ts']) await copyFile(resolve(file), join(root, file));
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
    const codes = Array.from({ length: 80 }, (_, index) => `A${index + 1}`);
    const basic = async (name: string, households = 100, missing = false) => workbook('raw/basic.xlsx', headersFor('basicPath'), codes.filter((code) => !missing || code !== 'A1').map((code) => ({ '단지코드': code, '단지명': code === 'A1' ? name : `정상단지${code}`, '시도': '서울특별시', '시군구': '강남구', '도로명주소': '서울특별시 강남구 테스트길', '세대수': code === 'A1' ? households : 100 })));
    await workbook('raw/area.xlsx', ['단지코드', '관리비부과면적'], codes.map((code) => ({ '단지코드': code, '관리비부과면적': 100 })));
    await workbook('raw/fee.xlsx', headersFor('source.path'), codes.flatMap((code) => [1, 2, 3, 4, 5].map((month) => ({ '단지코드': code, '발생년월(YYYYMM)': `20260${month}`, '공용관리비계': 100000 }))));
    await writeFile(join(root, 'raw/latest.json'), JSON.stringify({ sourceDate: '20261016', sources: Object.fromEntries(['basic', 'area', 'fee'].map((key) => [key, { path: `raw/${key}.xlsx`, fileName: `${key}.xlsx` }])) }));
    const run = (feeFiles = 'raw/fee.xlsx') => spawnSync(process.execPath, ['--import', resolve('node_modules/tsx/dist/loader.mjs'), join(root, 'scripts/ingest-kapt-bulk.ts')], { cwd: root, encoding: 'utf8', env: { ...process.env, KAPT_BULK_MANIFEST: 'raw/latest.json', KAPT_BULK_OUTPUT: 'out', KAPT_FEE_FILES: feeFiles, KAPT_INDEXNOW_CHANGESET: 'changes.json' } });
    const read = async (file: string) => JSON.parse(await readFile(join(root, 'out', file), 'utf8'));
    await basic('최초단지'); const first = run(); assert.equal(first.status, 0, first.stderr);
    const original = (await read('index.json')).find((entry: any) => entry.c === 'A1'); assert.equal(original.s, '최초단지-a1'); assert.equal(original.an, undefined);
    await basic('두번째단지'); const renamed = run(); assert.equal(renamed.status, 0, renamed.stderr);
    await basic('현재단지'); const renamedAgain = run(); assert.equal(renamedAgain.status, 0, renamedAgain.stderr);
    const current = (await read('index.json')).find((entry: any) => entry.c === 'A1');
    assert.equal(current.s, original.s); assert.equal(current.n, '현재단지'); assert.deepEqual(current.an, ['두번째단지', '최초단지']);
    for (const file of ['search.json', 'regions/서울.json', 'maps/서울/강남구.json']) {
      const entry = (await read(file)).find((entry: any) => entry.c === 'A1'); assert.deepEqual(entry.an, current.an);
      for (const name of ['최초단지', '두번째단지', '현재단지']) assert.ok(apartmentSearchText(entry).includes(name));
    }
    const before = await readFile(join(root, 'out/index.json'), 'utf8');
    const manifestBefore = await readFile(join(root, 'out/manifest.json'), 'utf8');
    assert.equal(run().status, 0); assert.equal(await readFile(join(root, 'out/index.json'), 'utf8'), before); assert.equal(await readFile(join(root, 'out/manifest.json'), 'utf8'), manifestBefore);
    const manifestPath = join(root, 'raw/latest.json');
    const inputManifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    inputManifest.sourceDate = '20261023';
    await writeFile(manifestPath, JSON.stringify(inputManifest));
    await basic('현재단지', 0); const excluded = run(); assert.equal(excluded.status, 0, excluded.stderr);
    const retained = (await read('index.json')).find((entry: any) => entry.c === 'A1');
    assert.equal(retained.s, original.s); assert.equal(retained.q, 1);
    assert.equal(retained.st.reason, 'quality-failed'); assert.equal(retained.st.sourceDate, '20261016');
    assert.equal(retained.st.since, '20261023'); assert.equal(retained.st.checkedDate, '20261023');
    assert.equal(retained.md, current.md); assert.deepEqual(retained.an, current.an);
    await basic(''); const invalidName = run(); assert.equal(invalidName.status, 0, invalidName.stderr);
    assert.equal((await read('index.json')).find((entry: any) => entry.c === 'A1').st.reason, 'quality-failed');
    await basic('현재단지', 100, true); const missing = run(); assert.equal(missing.status, 0, missing.stderr);
    const missingEntry = (await read('index.json')).find((entry: any) => entry.c === 'A1');
    assert.equal(missingEntry.st.reason, 'basic-missing'); assert.equal(missingEntry.st.sourceDate, '20261016');
    const retainedBefore = await readFile(join(root, 'out/index.json'), 'utf8');
    const retainedManifest = await readFile(join(root, 'out/manifest.json'), 'utf8');
    assert.equal(run().status, 0); assert.equal(await readFile(join(root, 'out/index.json'), 'utf8'), retainedBefore);
    assert.equal(await readFile(join(root, 'out/manifest.json'), 'utf8'), retainedManifest);
    inputManifest.sourceDate = '20261030';
    await writeFile(manifestPath, JSON.stringify(inputManifest));
    await basic('현재단지');
    await copyFile(join(root, 'raw/fee.xlsx'), join(root, 'raw/history.xlsx'));
    await workbook('raw/fee.xlsx', headersFor('source.path'), codes.filter((code) => code !== 'A1').flatMap((code) => [1, 2, 3, 4, 5].map((month) => ({ '단지코드': code, '발생년월(YYYYMM)': `20260${month}`, '공용관리비계': 120000 }))));
    const missingFees = run('raw/history.xlsx,raw/fee.xlsx'); assert.equal(missingFees.status, 0, missingFees.stderr);
    const feeRetained = (await read('index.json')).find((entry: any) => entry.c === 'A1');
    assert.equal(feeRetained.st.reason, 'fees-missing'); assert.equal(feeRetained.st.sourceDate, '20261016');
    assert.equal(feeRetained.st.since, '20261023'); assert.equal(feeRetained.st.checkedDate, '20261030');
    assert.equal(feeRetained.tf, current.tf);
    assert.equal((await read('index.json')).find((entry: any) => entry.c === 'A2').tf, 1200);
    const feeScenario = async (negativeMonth: number | null) => workbook('raw/fee.xlsx', headersFor('source.path'), codes.flatMap((code) => [1, 2, 3, 4, 5, 6].map((month) => ({
      '단지코드': code, '발생년월(YYYYMM)': `20260${month}`,
      '공용관리비계': code === 'A1' ? month === negativeMonth ? -10000 : 100000 : 120000,
      '개별사용료계': code === 'A1' && month === negativeMonth ? 200000 : 0
    }))));
    await feeScenario(6); const negativeLatest = run(); assert.equal(negativeLatest.status, 0, negativeLatest.stderr);
    const latestRetained = (await read('index.json')).find((entry: any) => entry.c === 'A1');
    assert.equal(latestRetained.st.reason, 'quality-failed'); assert.equal(latestRetained.st.sourceDate, '20261016');
    assert.equal(latestRetained.tf, current.tf);
    await feeScenario(5); const negativeHistory = run(); assert.equal(negativeHistory.status, 0, negativeHistory.stderr);
    const historyRetained = (await read('index.json')).find((entry: any) => entry.c === 'A1');
    assert.equal(historyRetained.st.reason, 'quality-failed'); assert.equal(historyRetained.st.since, '20261023');
    assert.equal(historyRetained.st.sourceDate, '20261016'); assert.equal(historyRetained.st.checkedDate, '20261030');
    assert.equal(historyRetained.lm, current.lm); // A newer positive month does not hide an older negative aggregate.
    const negativeBefore = await readFile(join(root, 'out/index.json'), 'utf8');
    const negativeManifest = await readFile(join(root, 'out/manifest.json'), 'utf8');
    assert.equal(run().status, 0); assert.equal(await readFile(join(root, 'out/index.json'), 'utf8'), negativeBefore);
    assert.equal(await readFile(join(root, 'out/manifest.json'), 'utf8'), negativeManifest);
    await feeScenario(null);

    await basic('복구단지'); const recovered = run(); assert.equal(recovered.status, 0, recovered.stderr);
    const recovery = (await read('index.json')).find((entry: any) => entry.c === 'A1');
    assert.equal(recovery.st, undefined); assert.equal(recovery.s, original.s); assert.ok(recovery.an.includes('현재단지'));
    const recoveredBefore = await readFile(join(root, 'out/index.json'), 'utf8');
    await workbook('raw/basic.xlsx', headersFor('basicPath'), codes.slice(2).map((code) => ({ '단지코드': code, '단지명': `정상단지${code}`, '시도': '서울특별시', '시군구': '강남구', '도로명주소': '서울특별시 강남구 테스트길', '세대수': 100 })));
    const overBudget = run(); assert.notEqual(overBudget.status, 0); assert.match(overBudget.stderr, /보존 상한/);
    assert.equal(await readFile(join(root, 'out/index.json'), 'utf8'), recoveredBefore);
    await workbook('raw/basic.xlsx', headersFor('basicPath'), []);
    const corrupt = run(); assert.notEqual(corrupt.status, 0); assert.match(corrupt.stderr, /보존 전 원본/);
    assert.equal(await readFile(join(root, 'out/index.json'), 'utf8'), recoveredBefore);

  } finally { await rm(root, { recursive: true, force: true }); }
});


test('retention budget and comparison isolation reject blanket fallback and retained comparisons', () => {
  assert.doesNotThrow(() => assertRetentionBudget(21272, 9));
  assert.throws(() => assertRetentionBudget(21272, 101));
  assert.throws(() => assertRetentionBudget(1000, 6));
  const fee: [string, number, number, number] = ['2026-08', 1000, 500, 100];
  assert.equal(commonMonthComparison([{ comparisonMonths: [fee] }, { st: {}, comparisonMonths: [fee] }]).month, null);
});


test('publication and validation share the same signed aggregate rule', () => {
  assert.equal(hasNegativeFeeAggregate(593, -196), true);
  assert.equal(hasNegativeFeeAggregate(2578, -187), true);
  assert.equal(hasNegativeFeeAggregate(-1, 100), true);
  assert.equal(hasNegativeFeeAggregate(100, 0), false);
  assert.equal(hasNegativeFeeAggregate(100, 50), false);
});
