import { defineConfig } from 'astro/config';

const site = (process.env.PUBLIC_SITE_URL || 'https://cjournal.kr').replace(/\/+$/, '');

export default defineConfig({
  site,
  output: 'static'
});
