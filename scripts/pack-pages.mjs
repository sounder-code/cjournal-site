import { readdir, readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';

// Only the Pages build needs packing. Docker and local previews keep every HTML file.
if (process.env.CF_PAGES !== '1') process.exit(0);
const root = resolve('dist');
const files = await readdir(root, { recursive: true, withFileTypes: true });
const originalCount = files.filter((entry) => entry.isFile()).length;
const target = 19500; // Leave room below the 20,000 asset limit.
const groupSize = 8;
const needed = Math.max(0, Math.ceil((originalCount - target) / (1 - 1 / groupSize)));
const apartments = JSON.parse(await readFile('public/data/apartments/index.json', 'utf8'))
  .filter((entry) => entry.q === 1).sort((a, b) => a.c.localeCompare(b.c)).slice(0, needed);
const manifest = {};
await mkdir(join(root, 'report-packs'), { recursive: true });
let packed = 0;
let groups = 0;
for (let offset = 0; offset < apartments.length; offset += groupSize) {
  const entries = apartments.slice(offset, offset + groupSize);
  const group = String(groups++);
  const reports = {};
  for (const entry of entries) reports[entry.c.toLowerCase()] = await readFile(join(root, 'apartments', entry.s, 'index.html'), 'utf8');
  const output = join(root, 'report-packs', `${group}.json`);
  await writeFile(output, JSON.stringify(reports));
  const verified = JSON.parse(await readFile(output, 'utf8'));
  for (const entry of entries) {
    const code = entry.c.toLowerCase();
    if (verified[code] !== reports[code] || !verified[code].includes('<h1')) throw new Error(`Invalid packed report: ${code}`);
    manifest[code] = group;
  }
  // Remove only generated HTML after its exact contents have been verified in the pack.
  for (const entry of entries) {
    await unlink(join(root, 'apartments', entry.s, 'index.html'));
    packed++;
  }
}
await writeFile('functions/generated-apartment-packs.js', `export default ${JSON.stringify(manifest)};\n`);
const count = originalCount - packed + groups;
if (count > target) throw new Error(`Pages asset budget exceeded: ${count}`);
console.log(`Pages: ${originalCount} → ${count} assets; ${packed} reports preserved byte-for-byte in ${groups} packs.`);
await import('./test-pages-packs.mjs');
