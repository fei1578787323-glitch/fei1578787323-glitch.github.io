// 外观面板：自动/浅色/深色 + 9 种强调色，选择记在浏览器里；侧栏导航随滚动高亮。
const root = document.documentElement;
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
};
const ACCENTS = [
  ['#2f7bff', '蓝', 'Blue'], ['#22c55e', '绿', 'Green'], ['#facc15', '黄', 'Yellow'], ['#fb923c', '橙', 'Orange'], ['#ef4444', '红', 'Red'],
  ['#d946ef', '紫红', 'Magenta'], ['#8b5cf6', '紫', 'Violet'], ['#22d3ee', '青', 'Cyan'], ['#ff6b57', '珊瑚', 'Coral'],
];
const swatchBox = document.getElementById('swatches');
const seg = document.getElementById('themeSeg');

function setAccent(hex) {
  root.style.setProperty('--accent', hex);
  // 黄、青等亮色上用深色字，其余用深棕黑字，保证按钮文字清晰
  const n = parseInt(hex.slice(1), 16), lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  root.style.setProperty('--on-accent', lum > 0.55 ? '#16130a' : '#ffffff');
  swatchBox.querySelectorAll('.swatch').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.c === hex)));
  store.set('zntom.accent', hex);
}
function setTheme(mode) {
  if (mode === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', mode);
  seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
  store.set('zntom.theme', mode);
}
function swatchLabels() {
  const en = root.lang === 'en';
  swatchBox.querySelectorAll('.swatch').forEach((b, i) => { const t = ACCENTS[i][en ? 2 : 1]; b.title = t; b.setAttribute('aria-label', t); });
}
ACCENTS.forEach(([c]) => {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'swatch'; b.dataset.c = c; b.style.setProperty('--c', c);
  b.onclick = () => setAccent(c);
  swatchBox.append(b);
});
seg.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setTheme(b.dataset.mode); });
new MutationObserver(swatchLabels).observe(root, { attributes: true, attributeFilter: ['lang'] });
swatchLabels();
setTheme(store.get('zntom.theme') || 'auto');
setAccent(store.get('zntom.accent') || '#ff6b57');

// 侧栏高亮
const links = [...document.querySelectorAll('.side-nav a[href^="#"]')];
const spy = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) links.forEach((a) => a.classList.toggle('on', a.getAttribute('href') === `#${entry.target.id}`));
  });
}, { rootMargin: '-35% 0px -60% 0px' });
['top', 'features', 'shots', 'updates', 'pricing', 'suites'].forEach((id) => { const s = document.getElementById(id); if (s) spy.observe(s); });
