import type { APIRoute } from 'astro';
import adminCenters from '@/data/admin-centers.json';
import { loadApartmentManifest } from '@/lib/apartmentBulk';

export const GET: APIRoute = async () => {
  const manifest = await loadApartmentManifest();
  return new Response(JSON.stringify({
    indexUrl: manifest.index,
    searchUrl: typeof manifest.search === 'string' ? manifest.search : manifest.search?.file || manifest.index,
    regions: manifest.regions,
    districts: manifest.districts || [],
    metrics: [
      { key: 'tf', label: '총 관리비', shortLabel: '총액' },
      { key: 'cf', label: '공용관리비', shortLabel: '공용' },
      { key: 'rf', label: '장기수선충당금', shortLabel: '충당금' }
    ],
    adminCenters
  }), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=300, stale-while-revalidate=86400'
    }
  });
};
