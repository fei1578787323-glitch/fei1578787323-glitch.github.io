// 离线可用：第一次打开后把页面文件缓存下来，没网也能打开提词（智能跟读要联网识别除外）。
// 改了网页文件发布时把 VERSION 加一，旧缓存会被换掉。
const VERSION = 'frmzone-web-20261016-banner-7';
const FILES = ['./', 'index.html', 'styles.css', 'styles.css?v=20261016-banner', 'manifest.webmanifest', 'library.json',
  'js/app.js', 'js/store.js', 'js/markup.js', 'js/follow.js', 'js/follow-scroll.js', 'js/prompter.js', 'js/license.js', 'js/workspace.js', 'js/home-banners.js',
  'assets/daily-quotes.json', 'icons/brand-logo.png', 'assets/banners/modes.jpg', 'assets/banners/floating.jpg',
  'assets/banners/notch.jpg', 'assets/banners/board.jpg', 'assets/banners/camera.jpg',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-32.png',
  'icons/icon-192.png?v=20261011-plain', 'icons/icon-512.png?v=20261011-plain',
  'icons/apple-touch-icon.png?v=20261011-plain', 'icons/favicon-32.png?v=20261011-plain'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES.map(path => new Request(path, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('frmzone-web-') && k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// 先用网上最新的，断网时用缓存
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(r => {
    const copy = r.clone();
    caches.open(VERSION).then(c => c.put(e.request, copy));
    return r;
  }).catch(() => caches.match(e.request)));
});
