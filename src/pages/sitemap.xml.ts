import type { APIRoute } from 'astro';
import {
  apartmentSitemapChunks,
  loadSitemapInventory,
  renderSitemapIndex,
  xmlResponse
} from './sitemaps/_shared';

export const GET: APIRoute = async ({ site }) => {
  const inventory = await loadSitemapInventory();
  const apartmentMaps = apartmentSitemapChunks(inventory.apartments).map(
    (_, index) => `/sitemaps/apartments/${index + 1}.xml`
  );

  return xmlResponse(renderSitemapIndex([
    '/sitemaps/core.xml',
    '/sitemaps/regions.xml',
    ...apartmentMaps
  ], inventory.lastmod, site));
};
