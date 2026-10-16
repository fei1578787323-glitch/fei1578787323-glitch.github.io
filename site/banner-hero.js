const BANNER_INTERVAL = 3000;
const POSTERS = [
  ['camera', '拍摄提词', 'Record with prompting', '#recording'],
  ['board', '提词板', 'Large-text prompter', 'web/'],
  ['notch', '刘海提词', 'Notch prompting', '#floating-notching'],
  ['floating', '浮窗提词', 'Floating prompting', '#floating-notching'],
  ['scrolling', '五种滚动方式', 'Five scrolling methods', 'web/'],
];
const host = document.getElementById('siteBanners');
const dots = document.getElementById('siteBannerDots');
const previous = document.getElementById('siteBannerPrevious');
const next = document.getElementById('siteBannerNext');
const pause = document.getElementById('siteBannerPause');
const controls = document.querySelector('.site-banner-controls');
const english = () => document.documentElement.lang === 'en';
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const blocks = new Set();
let index = 0, timer, pointer, suppressClickUntil = 0;
const deck = document.createElement('div');
deck.className = 'feature-banners';
deck.setAttribute('role', 'region');
const layers = POSTERS.map(([kind, , , target], i) => {
  const link = document.createElement('a');
  link.href = target; link.className = 'feature-banner-slide';
  const image = document.createElement('img');
  image.src = new URL(`banners-20261016/${kind}.jpg`, import.meta.url).href;
  image.width = 1920; image.height = 1080; image.decoding = 'async';
  image.addEventListener('load', schedule);
  link.append(image); deck.append(link);
  const button = document.createElement('button'); button.type = 'button';
  button.onclick = () => move(i - index);
  dots.append(button);
  return { link, image, button };
});
host.replaceChildren(deck);
function schedule() {
  clearTimeout(timer);
  if (blocks.size || document.hidden || reduced.matches) return;
  const active = layers[index].image;
  const upcoming = layers[(index + 1) % layers.length].image;
  if (active.complete && active.naturalWidth && upcoming.complete && upcoming.naturalWidth) {
    timer = setTimeout(() => move(1), BANNER_INTERVAL);
  }
}
function move(step) {
  index = ((index + step) % layers.length + layers.length) % layers.length;
  layers.forEach(({ link, button }, i) => {
    link.classList.toggle('active', i === index);
    link.tabIndex = i === index ? 0 : -1;
    link.setAttribute('aria-hidden', String(i !== index));
    button.setAttribute('aria-pressed', String(i === index));
  });
  schedule();
}
function block(reason, value) { value ? blocks.add(reason) : blocks.delete(reason); schedule(); }
function updateLabels() {
  const en = english(), paused = blocks.has('paused');
  for (const [button, title] of [[previous, en ? 'Previous banner' : '上一张'], [next, en ? 'Next banner' : '下一张'],
    [pause, en ? (paused ? 'Resume slideshow' : 'Pause slideshow') : (paused ? '继续轮播' : '暂停轮播')]]) {
    button.title = title; button.setAttribute('aria-label', title);
  }
  pause.setAttribute('aria-pressed', String(paused));
  pause.firstElementChild.textContent = paused ? '\u25b6' : '\u2161';
  deck.setAttribute('aria-label', en ? 'Prompter features' : '提词器功能横幅');
  deck.setAttribute('aria-roledescription', en ? 'carousel' : '轮播');
  controls.setAttribute('aria-label', en ? 'Banner controls' : '功能横幅切换');
  layers.forEach(({ link, image, button }, i) => {
    const title = POSTERS[i][en ? 2 : 1];
    link.setAttribute('aria-label', title); image.alt = title; button.setAttribute('aria-label', title);
  });
}
previous.onclick = () => move(-1);
next.onclick = () => move(1);
pause.onclick = () => { block('paused', !blocks.has('paused')); updateLabels(); };
for (const [element, reason] of [[deck, 'poster'], [controls, 'controls']]) {
  element.addEventListener('focusin', () => block(`${reason}-focus`, true));
  element.addEventListener('focusout', e => { if (!element.contains(e.relatedTarget)) block(`${reason}-focus`, false); });
  element.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') block(`${reason}-hover`, true); });
  element.addEventListener('pointerleave', () => block(`${reason}-hover`, false));
}
deck.addEventListener('pointerdown', e => {
  if (!e.isPrimary || e.button !== 0) return;
  pointer = { id: e.pointerId, x: e.clientX, y: e.clientY }; block('touch', true);
});
function finishPointer(e) {
  if (!pointer || pointer.id !== e.pointerId) return;
  const dx = e.clientX - pointer.x, dy = e.clientY - pointer.y;
  if (e.type === 'pointerup' && Math.abs(dx) >= 44 && Math.abs(dx) > Math.abs(dy) * 1.3) {
    suppressClickUntil = performance.now() + 350; move(dx < 0 ? 1 : -1);
  }
  pointer = null; block('touch', false);
}
window.addEventListener('pointerup', finishPointer);
window.addEventListener('pointercancel', finishPointer);
deck.addEventListener('click', e => { if (performance.now() < suppressClickUntil) e.preventDefault(); });
document.addEventListener('visibilitychange', schedule);
reduced.addEventListener('change', schedule);
window.addEventListener('blur', () => { pointer = null; block('touch', false); });
new IntersectionObserver(entries => block('outside', !entries[0].isIntersecting)).observe(deck);
new MutationObserver(updateLabels).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
updateLabels(); move(0);
