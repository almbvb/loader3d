import { StrictMode } from 'react';
import { renderToString } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StaticRouter } from 'react-router';
import { Shell } from './Shell';
import { TIERS, TIERS_ENABLED } from './lib/tiers';
import { FAQ } from './pages/LandingPage';

/** Loaded by scripts/prerender.mjs (through Vite's SSR loader) after `vite build`. */

/** The landing page as the browser renders it at `/` before the session is known (hydrated by main.tsx). */
export function renderLanding(): string {
  return renderToString(
    <StrictMode>
      <QueryClientProvider client={new QueryClient()}>
        <StaticRouter location="/">
          <Shell />
        </StaticRouter>
      </QueryClientProvider>
    </StrictMode>,
  );
}

/** schema.org data for search engines: the product with its prices and the FAQ shown on the page. */
export function structuredData(siteUrl: string): object[] {
  const prices = TIERS.flatMap((t) => (t.price ? [t.price.monthly] : []));
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'Loader3D',
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web',
      inLanguage: 'ru',
      ...(siteUrl ? { url: `${siteUrl}/`, image: `${siteUrl}/landing/og.jpg` } : {}),
      description:
        '3D-планировщик загрузки фуры и контейнера: раскладка паллет с физикой, LDM, вес и центр тяжести, автозагрузка и PDF-схема погрузки.',
      ...(TIERS_ENABLED && {
        offers: {
          '@type': 'AggregateOffer',
          priceCurrency: 'RUB',
          lowPrice: Math.min(...prices),
          highPrice: Math.max(...prices),
          offerCount: TIERS.length,
        },
      }),
    },
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: FAQ.map((f) => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a },
      })),
    },
  ];
}
