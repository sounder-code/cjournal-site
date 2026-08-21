import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const inputPath = resolve(process.env.APARTMENT_INDEX_PATH || 'public/data/apartments/index.json');
const outputPath = resolve(process.env.APARTMENT_REDIRECT_MAP || 'docker/apartment-redirects.map');
const apartments = JSON.parse(await readFile(inputPath, 'utf8'));
const redirects = new Map();

for (const apartment of apartments) {
  if (apartment?.q !== 1) continue;
  const code = String(apartment.c || '').trim().toLowerCase();
  const slug = String(apartment.s || '').trim();
  if (!/^[a-z][a-z0-9]+$/.test(code) || !slug.endsWith(`-${code}`)) {
    throw new Error(`Invalid apartment canonical slug: ${code || '(missing)'} ${slug || '(missing)'}`);
  }
  if (redirects.has(code)) throw new Error(`Duplicate apartment code in redirect map: ${code}`);
  redirects.set(code, `/apartments/${encodeURIComponent(slug)}/`);
}

const lines = [...redirects]
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([code, path]) => `"${code}" "${path}";`);

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${lines.join('\n')}\n`);
console.log(`Apartment canonical redirect map: ${lines.length.toLocaleString('en-US')} entries`);
