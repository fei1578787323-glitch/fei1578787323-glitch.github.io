// 首页主视觉轮播：每 3 秒淡入淡出，缩略卡切换；悬停、聚焦、后台标签页、减少动态效果时暂停。
const INTERVAL = 3000;
const POSTERS = [
  ['camera', '拍摄提词', 'Record with prompting', '#recording', '拍摄', 'Camera'],
  ['board', '提词板', 'Large-text prompter', 'web/', '提词板', 'Board'],
  ['notch', '刘海提词', 'Notch prompting', '#floating-notching', '刘海', 'Notch'],
  ['floating', '浮窗提词', 'Floating prompting', '#floating-notching', '浮窗', 'Float'],
  ['scrolling', '五种滚动方式', 'Five scrolling methods', 'web/', '滚动', 'Scroll'],
];
const host = document.getElementById('siteBanners');
const modes = document.getElementById('siteModes');
const pause = document.getElementById('siteBannerPause');
const en = () => document.documentElement.lang === 'en';
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const blocks = new Set();
let index = 0, timer, start;

const deck = document.createElement('div');
deck.className = 'feature-banners';
deck.setAttribute('role', 'region');
const src = (kind) => new URL(`banners-20261016/${kind}.jpg`, import.meta.url).href;
const layers = POSTERS.map(([kind, , , target], i) => {
  const link = document.createElement('a');
  link.href = target; link.className = 'feature-banner-slide';
  const image = document.createElement('img');
  image.src = src(kind); image.width = 1920; image.height = 1080; image.decoding = 'async';
  const cap = document.createElement('div'); cap.className = 'cap';
  const label = document.createElement('span'); const go = document.createElement('i'); go.textContent = '→';
  cap.append(label, go);
  link.append(image, cap); deck.append(link);
  const thumb = document.createElement('button'); thumb.type = 'button'; thumb.className = 'mode';
  const t = document.createElement('img'); t.src = src(kind); t.alt = ''; t.width = 320; t.height = 180;
  const name = document.createElement('span');
  thumb.append(t, name); thumb.onclick = () => move(i - index);
  modes.insertBefore(thumb, pause);
  return { link, thumb, label, name };
});
host.replaceChildren(deck);

function schedule() {
  clearTimeout(timer);
  if (blocks.size || document.hidden || reduced.matches) return;
  timer = setTimeout(() => move(1), INTERVAL);
}
const stage = document.querySelector('.stage');
function move(step) {
  index = ((index + step) % layers.length + layers.length) % layers.length;
  if (stage) stage.style.setProperty('--poster', `url("${src(POSTERS[index][0])}")`);
  layers.forEach(({ link, thumb }, i) => {
    link.classList.toggle('active', i === index);
    link.tabIndex = i === index ? 0 : -1;
    link.setAttribute('aria-hidden', String(i !== index));
    thumb.setAttribute('aria-pressed', String(i === index));
  });
  schedule();
}
function block(reason, on) { on ? blocks.add(reason) : blocks.delete(reason); schedule(); }
function labels() {
  const e = en(), paused = blocks.has('paused');
  layers.forEach(({ link, thumb, label, name }, i) => {
    const title = POSTERS[i][e ? 2 : 1];
    link.setAttribute('aria-label', title); label.textContent = title;
    name.textContent = POSTERS[i][e ? 5 : 4]; thumb.setAttribute('aria-label', title); thumb.title = title;
  });
  const p = e ? (paused ? 'Resume slideshow' : 'Pause slideshow') : (paused ? '继续轮播' : '暂停轮播');
  pause.title = p; pause.setAttribute('aria-label', p); pause.setAttribute('aria-pressed', String(paused));
  pause.textContent = paused ? '▶' : 'Ⅱ';
  deck.setAttribute('aria-label', e ? 'Prompter features' : '提词器功能横幅');
  deck.setAttribute('aria-roledescription', e ? 'carousel' : '轮播');
}
pause.onclick = () => { block('paused', !blocks.has('paused')); labels(); };
for (const [el, reason] of [[deck, 'poster'], [modes, 'modes']]) {
  el.addEventListener('focusin', () => block(`${reason}-focus`, true));
  el.addEventListener('focusout', (e) => { if (!el.contains(e.relatedTarget)) block(`${reason}-focus`, false); });
  el.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') block(`${reason}-hover`, true); });
  el.addEventListener('pointerleave', () => block(`${reason}-hover`, false));
}
// 触屏左右滑动换图
deck.addEventListener('pointerdown', (e) => { if (e.isPrimary && e.button === 0) { start = { id: e.pointerId, x: e.clientX, y: e.clientY }; block('touch', true); } });
let suppress = 0;
const end = (e) => {
  if (!start || start.id !== e.pointerId) return;
  const dx = e.clientX - start.x, dy = e.clientY - start.y;
  if (e.type === 'pointerup' && Math.abs(dx) >= 44 && Math.abs(dx) > Math.abs(dy) * 1.3) { suppress = performance.now() + 350; move(dx < 0 ? 1 : -1); }
  start = null; block('touch', false);
};
addEventListener('pointerup', end); addEventListener('pointercancel', end);
deck.addEventListener('click', (e) => { if (performance.now() < suppress) e.preventDefault(); });
document.addEventListener('visibilitychange', schedule);
reduced.addEventListener('change', schedule);
new IntersectionObserver((entries) => block('outside', !entries[0].isIntersecting)).observe(deck);
new MutationObserver(labels).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
labels(); move(0);

// 左侧导轨 + 顶部导航的滚动高亮
const spy = [...document.querySelectorAll('.rail a, .nav-links a[href^="#"]')];
const sections = ['features', 'shots', 'updates', 'pricing', 'suites'].map((id) => document.getElementById(id)).filter(Boolean);
const spyObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) spy.forEach((a) => a.classList.toggle('on', a.getAttribute('href') === `#${entry.target.id}`));
  });
}, { rootMargin: '-40% 0px -55% 0px' });
sections.forEach((s) => spyObserver.observe(s));

// 滚动进入视野时淡入上浮
const revealTargets = document.querySelectorAll('.bento > *, .plans > *, .grid3 > *, .shots-stage, .updates > *, .lifetime, .activate');
if (!reduced.matches && 'IntersectionObserver' in window) {
  const io = new IntersectionObserver((entries) => entries.forEach((e) => { if (e.isIntersecting) { const t = e.target; t.classList.add('in'); io.unobserve(t); setTimeout(() => t.classList.remove('reveal', 'in'), 1000); } }), { rootMargin: '0px 0px -8% 0px' });
  revealTargets.forEach((el) => { el.classList.add('reveal'); io.observe(el); });
}
