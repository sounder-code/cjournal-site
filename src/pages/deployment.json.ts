import type { APIRoute } from 'astro';

export const prerender = true;

export const GET: APIRoute = () => new Response(JSON.stringify({
  commit: process.env.CF_PAGES_COMMIT_SHA || process.env.GITHUB_SHA || 'local'
}), {
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  }
});
