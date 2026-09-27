import type { APIRoute } from 'astro';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadApartmentManifest, loadApartmentPageData, apartmentQualityReasons } from '@/lib/apartmentBulk';

export async function getStaticPaths() {
  const [manifest, pages] = await Promise.all([loadApartmentManifest(), loadApartmentPageData()]);
  const bySlug = new Map(pages.map((page) => [page.apartment.s, page]));
  return Promise.all((manifest.districts || []).map(async (district) => {
    const items = JSON.parse(await readFile(resolve('public', district.file.replace(/^\//, '')), 'utf8'));
    return {
      params: { district: district.file.replace('/data/apartments/maps/', '').replace(/\.json$/, '') },
      props: { items: items.map((item: { s: string }) => {
        const page = bySlug.get(item.s);
        return {
          ...item,
          comparison: page?.comparisonEligible ? {
            month: page.apartment.lm, label: page.peerLabel, count: page.peerCount,
            tf: page.percentiles.total, cf: page.percentiles.common,
            rf: page.apartment.rf > 0 ? page.percentiles.reserve : null
          } : null,
          comparisonMonths: page ? page.apartment.f
            .filter((fee) => apartmentQualityReasons(page.apartment, fee).length === 0)
            .map((fee) => [fee[0], fee[1], fee[2], fee[4]]) : []
        };
      }) }
    };
  }));
}

export const GET: APIRoute = ({ props }) => new Response(JSON.stringify(props.items), {
  headers: { 'Content-Type': 'application/json; charset=utf-8' }
});
