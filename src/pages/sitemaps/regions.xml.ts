import type { APIRoute } from 'astro';
import { loadSitemapInventory, renderUrlSet, xmlResponse } from './_shared';

export const GET: APIRoute = async ({ site }) => {
  const inventory = await loadSitemapInventory();
  return xmlResponse(renderUrlSet(inventory.regions, site));
};
