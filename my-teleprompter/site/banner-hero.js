import { BANNERS, HomeFeatureBanners } from '../web/js/home-banners.js?v=20261016-banner';

const host = document.getElementById('siteBanners');
const dots = document.getElementById('siteBannerDots');
const previous = document.getElementById('siteBannerPrevious');
const next = document.getElementById('siteBannerNext');
const pause = document.getElementById('siteBannerPause');
const controls = document.querySelector('.site-banner-controls');
const english = () => document.documentElement.lang === 'en';
const titles = ['Prompting modes', 'Floating prompting', 'Notch prompting', 'Large-text prompter', 'Record with prompting'];
const targets = { modes: 'web/', board: 'web/', floating: '#floating-notching', notch: '#floating-notching', camera: '#recording' };

const buttons = BANNERS.map(([, title], i) => {
  const button = document.createElement('button'); button.type = 'button';
  button.onclick = () => deck.move(i - deck.index);
  dots.append(button); return button;
});
const deck = new HomeFeatureBanners(kind => { location.href = new URL(targets[kind], location.href).href; }, {
  includeQuote: false,
  onChange: index => buttons.forEach((button, i) => button.setAttribute('aria-pressed', String(i === index))),
});
host.replaceChildren(deck.node);
previous.onclick = () => deck.move(-1);
next.onclick = () => deck.move(1);
pause.onclick = () => {
  deck.block('paused', !deck.blocks.has('paused')); updateLabels();
};
controls.addEventListener('focusin', () => deck.block('controls-focus', true));
controls.addEventListener('focusout', e => { if (!controls.contains(e.relatedTarget)) deck.block('controls-focus', false); });
controls.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') deck.block('controls-hover', true); });
controls.addEventListener('pointerleave', () => deck.block('controls-hover', false));
function updateLabels() {
  const en = english(), paused = deck.blocks.has('paused');
  for (const [button, title] of [[previous, en ? 'Previous banner' : '上一张'], [next, en ? 'Next banner' : '下一张'],
    [pause, en ? (paused ? 'Resume slideshow' : 'Pause slideshow') : (paused ? '继续轮播' : '暂停轮播')]]) {
    button.title = title; button.setAttribute('aria-label', title);
  }
  pause.setAttribute('aria-pressed', String(paused));
  pause.firstElementChild.textContent = paused ? '\u25b6' : '\u2161';
  deck.node.setAttribute('aria-label', en ? 'Prompter features' : '提词器功能横幅');
  deck.node.setAttribute('aria-roledescription', en ? 'carousel' : '轮播');
  buttons.forEach((button, i) => button.setAttribute('aria-label', en ? titles[i] : BANNERS[i][1]));
  deck.layers.forEach((layer, i) => layer.button.setAttribute('aria-label', en ? titles[i] : BANNERS[i][1]));
}
function updateTheme() {
  deck.setAppearance({ theme: 'system', motion: true }, '#9b6bf2');
}
updateTheme(); updateLabels(); deck.setOpen(true);
new MutationObserver(updateLabels).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
