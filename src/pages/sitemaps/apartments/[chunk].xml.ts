import type { APIRoute } from 'astro';
import {
  apartmentSitemapChunks,
  loadSitemapInventory,
  renderUrlSet,
  type SitemapEntry,
  xmlResponse
} from '../_shared';

interface Props {
  entries: SitemapEntry[];
}

export const getStaticPaths = async () => {
  const inventory = await loadSitemapInventory();
  return apartmentSitemapChunks(inventory.apartments).map((entries, index) => ({
    params: { chunk: String(index + 1) },
    props: { entries } satisfies Props
  }));
};

export const GET: APIRoute = ({ site, props }) => {
  const { entries } = props as Props;
  return xmlResponse(renderUrlSet(entries, site));
};
