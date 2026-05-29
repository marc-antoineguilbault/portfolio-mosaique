/* Service Worker — portfolio-mosaique
 *
 * Stratégie minimaliste pensée GitHub Pages :
 * - HTML (index.html) : network-first, fallback cache → bump cache buster v=NN suffit
 *   pour pousser la nouvelle version sans race condition.
 * - Assets versionnés (?v=NN sur app.js + styles.css) : cache-first, on garde toujours
 *   la dernière version fetched.
 * - Images (assets/**.avif|webp) : cache-first, immuables par nature (un design = un fichier).
 *   2e visite = instantanée.
 * - Tout le reste : passthrough réseau.
 *
 * Bump CACHE_VERSION quand le service worker change. L'activate purge les anciens caches.
 */

const CACHE_VERSION = 'v3';
const CACHE_NAME = `portfolio-${CACHE_VERSION}`;

self.addEventListener('install', (event) => {
  // Active la nouvelle version dès qu'elle est installée (pas d'attente "next tab").
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

function isImageAsset(url) {
  return /\/assets\/.*\.(avif|webp|png|jpg|jpeg|svg)$/i.test(url.pathname);
}

function isVersionedAsset(url) {
  // app.js?v=29, styles.css?v=29 → versionnés, safe à cacher fort
  return /\.(js|css)$/i.test(url.pathname) && url.search.includes('v=');
}

function isHtml(request) {
  return request.mode === 'navigate' || request.destination === 'document';
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE_NAME);
    cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // skip cross-origin

  if (isHtml(request)) {
    event.respondWith(networkFirst(request));
  } else if (isImageAsset(url) || isVersionedAsset(url)) {
    event.respondWith(cacheFirst(request));
  }
  // else : laisse passer (default fetch)
});
