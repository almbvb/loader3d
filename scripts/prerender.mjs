// After `vite build`: puts the landing page into dist/index.html as real HTML for search engines and
// link previews (the browser hydrates it), keeps the empty SPA shell as dist/app.html for every other
// route (deploy/Caddyfile), and writes robots.txt and sitemap.xml.
//
// SITE_URL (https://loader.example.com, optional) makes canonical, Open Graph and sitemap URLs absolute;
// without it there is no canonical link and no sitemap (they need absolute URLs).

import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'vite';

const SITE_URL = (process.env.SITE_URL ?? '').trim().replace(/\/+$/, '');
if (SITE_URL && !/^https?:\/\/[^/\s]+$/.test(SITE_URL)) {
  console.error(`SITE_URL must look like https://loader.example.com, got "${SITE_URL}"`);
  process.exit(1);
}

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
let code = 0;
try {
  const { renderLanding, structuredData } = await server.ssrLoadModule('/src/prerender.tsx');
  const template = readFileSync('dist/index.html', 'utf8');
  if (!template.includes('<div id="root"></div>')) throw new Error('dist/index.html has no empty #root');
  writeFileSync('dist/app.html', template);

  const json = (data) => JSON.stringify(data).replace(/</g, '\\u003c');
  const head = [
    '<link rel="preload" as="image" href="/landing/hero.webp" fetchpriority="high" />',
    ...structuredData(SITE_URL).map((d) => `<script type="application/ld+json">${json(d)}</script>`),
  ];
  let html = template;
  if (SITE_URL) {
    head.push(`<link rel="canonical" href="${SITE_URL}/" />`, `<meta property="og:url" content="${SITE_URL}/" />`);
    html = html.replace('content="/landing/og.jpg"', `content="${SITE_URL}/landing/og.jpg"`);
  }
  html = html
    .replace('</head>', `    ${head.join('\n    ')}\n  </head>`)
    .replace('<div id="root"></div>', `<div id="root">${renderLanding()}</div>`);
  writeFileSync('dist/index.html', html);

  const robots = ['User-agent: *', 'Allow: /', 'Disallow: /plans', 'Disallow: /account', 'Disallow: /admin', 'Disallow: /api/'];
  if (SITE_URL) robots.push('', `Sitemap: ${SITE_URL}/sitemap.xml`);
  writeFileSync('dist/robots.txt', `${robots.join('\n')}\n`);
  if (SITE_URL) {
    const urls = ['/', '/register'].map((path) => `  <url><loc>${SITE_URL}${path}</loc></url>`);
    writeFileSync(
      'dist/sitemap.xml',
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`,
    );
  }
  console.log(`prerendered dist/index.html (${Math.round(html.length / 1024)} kB)${SITE_URL ? ` for ${SITE_URL}` : ''}`);
} catch (error) {
  console.error(error);
  code = 1;
} finally {
  await server.close();
}
// Modules of the app keep handles open (BroadcastChannel of the auth store): do not wait for them.
process.exit(code);
