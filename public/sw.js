// Service worker — NETWORK-FIRST.
// Sempre busca a versao mais nova enquanto o servidor estiver acessivel (no evento os
// tablets estao sempre na rede local com o servidor no ar). O cache so e usado como
// reserva se a rede cair por um instante. Assim NUNCA serve HTML/JS desatualizado.
// /api nunca e cacheado (estoque/pedidos sempre frescos).
const CACHE = 'pdv-naturaltech-v4';
const SHELL = [
  '/', '/loja.html', '/pdv', '/pdv.html', '/separacao', '/separacao.html', '/admin', '/admin.html',
  '/css/styles.css', '/js/loja.js', '/js/pdv.js', '/js/separacao.js', '/js/admin.js', '/js/cliente-form.js',
  '/manifest.webmanifest', '/icons/icon.svg', '/fonts/figtree-400.woff2', '/fonts/figtree-700.woff2', '/fonts/figtree-800.woff2', '/fonts/inter-400.woff2', '/fonts/inter-700.woff2',
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.pathname.startsWith('/api/')) return;     // network-only
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then((resp) => {
        const copy = resp.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return resp;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match('/')))
  );
});
