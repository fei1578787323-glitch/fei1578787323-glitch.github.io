export const BANNER_INTERVAL = 3000;
export const BANNERS = [
  ['modes', '选择提词模式'], ['floating', '开启浮窗提词'], ['notch', '开启刘海提词'],
  ['board', '进入提词板'], ['camera', '开始拍摄'],
];
export function nextBanner(index, step = 1) { return ((index + step) % BANNERS.length + BANNERS.length) % BANNERS.length; }
export function swipeStep(x, y) { return Math.abs(x) >= 44 && Math.abs(x) > Math.abs(y) * 1.3 ? (x < 0 ? 1 : -1) : 0; }
export function dailyQuote(quotes, date = new Date()) {
  if (!quotes.length) return { category: '成长', text: '让好的内容被看见。' };
  const day = Math.floor((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - Date.UTC(date.getFullYear(), 0, 1)) / 86400000);
  return quotes[day % quotes.length];
}
export function themePixel(r, g, b, accent) {
  const hi = Math.max(r, g, b), lo = Math.min(r, g, b), chroma = hi - lo;
  if (hi <= .48 || chroma <= .07 || r <= g || g < b * .9 || chroma / hi >= .76 || (g - b) / chroma >= .22) return [r, g, b];
  const strength = Math.min(1, (chroma - .07) / .12) * Math.min(1, (hi - .48) / .15);
  const high = Math.max(...accent), low = Math.min(...accent), range = high - low, light = (hi + lo) / 2;
  const amplitude = Math.min(range, .9) * (1 - Math.abs(2 * light - 1)), base = light - amplitude / 2;
  return [r, g, b].map((v, i) => v + ((range > .001 ? base + amplitude * (accent[i] - low) / range : light) - v) * strength);
}
const PHOTO = { notch: [[.44, .39, .53, .53]], camera: [[.47, .28, .32, .65]], floating: [[.71, .40, .28, .51]] };
const EXTRA = {
  modes: [[.35, .14, .63, .79]], floating: [[.50, .27, .24, .06], [.78, .14, .21, .25]],
  notch: [[.55, .32, .31, .05], [.72, .10, .26, .19]],
  board: [[.47, .35, .35, .12], [.66, .68, .06, .11], [.84, .28, .15, .25]], camera: [[.81, .30, .18, .37]],
};
const COMMON = [[.045, .16, .37, .19], [.055, .35, .065, .46], [.05, .79, .28, .13]];
const GRAPHICS = Object.fromEntries(Object.entries(EXTRA).map(([kind, regions]) => [kind, [...COMMON, ...regions]]));
const contains = (rect, x, y) => x >= rect[0] && x <= rect[0] + rect[2] && y >= rect[1] && y <= rect[1] + rect[3];
export function themedPoint(kind, x, y) {
  return !PHOTO[kind]?.some(r => contains(r, x, y)) && (GRAPHICS[kind] || []).some(r => contains(r, x, y));
}

export class HomeFeatureBanners {
  constructor(onOpen) {
    this.index = 0; this.motion = true; this.visible = false; this.ready = false; this.blocks = new Set(); this.layers = [];
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)');
    this.growth = document.createElement('div'); this.growth.className = 'daily-growth';
    this.setQuote(dailyQuote([]));
    fetch('assets/daily-quotes.json').then(r => { if (!r.ok) throw new Error('quotes'); return r.json(); })
      .then(quotes => this.setQuote(dailyQuote(quotes))).catch(() => {});
    this.node = document.createElement('section'); this.node.className = 'feature-banners';
    this.node.setAttribute('aria-label', '功能横幅'); this.node.setAttribute('aria-roledescription', '轮播');
    for (const [kind, title] of BANNERS) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'feature-banner-slide';
      button.dataset.banner = kind; button.setAttribute('aria-label', title);
      const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 675; canvas.setAttribute('aria-hidden', 'true');
      const fallback = document.createElement('span'); fallback.className = 'feature-banner-fallback'; fallback.textContent = title;
      button.append(canvas, fallback);
      button.onclick = e => { if (!this.dragged || e.detail === 0) onOpen(kind); };
      this.node.append(button);
      const image = new Image();
      const layer = { kind, button, canvas, image, fallback }; this.layers.push(layer);
      image.onload = () => {
        const c = canvas.getContext('2d'); c.drawImage(image, 0, 0, canvas.width, canvas.height);
        layer.pixels = c.getImageData(0, 0, canvas.width, canvas.height);
        layer.ink = [];
        const { width, height, data } = layer.pixels;
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4;
          if (data[i] > data[i + 1] && themedPoint(kind, x / width, y / height)) layer.ink.push(i);
        }
        this.paint(layer);
        fallback.hidden = true;
        this.ready = this.layers.every(l => l.pixels || l.failed); this.schedule();
      };
      image.onerror = () => { layer.failed = true; this.ready = this.layers.every(l => l.pixels || l.failed); this.schedule(); };
      image.src = `assets/banners/${kind}.jpg`;
    }
    this.updateSelection();
    this.node.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') this.block('hover', true); });
    this.node.addEventListener('pointerleave', () => this.block('hover', false));
    this.node.addEventListener('focusin', () => this.block('focus', true));
    this.node.addEventListener('focusout', e => { if (!this.node.contains(e.relatedTarget)) this.block('focus', false); });
    this.node.addEventListener('pointerdown', e => { this.pointer = [e.clientX, e.clientY]; this.dragged = false; this.block('touch', true); });
    this.node.addEventListener('pointermove', e => { if (this.pointer && Math.hypot(e.clientX - this.pointer[0], e.clientY - this.pointer[1]) > 10) this.dragged = true; });
    window.addEventListener('pointerup', e => {
      if (!this.pointer) return;
      const step = swipeStep(e.clientX - this.pointer[0], e.clientY - this.pointer[1]);
      if (step && this.dragged) this.move(step);
      this.pointer = null; this.block('touch', false);
    });
    window.addEventListener('pointercancel', () => { this.pointer = null; this.block('touch', false); });
    this.node.addEventListener('keydown', e => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault(); this.move(e.key === 'ArrowLeft' ? -1 : 1); this.layers[this.index].button.focus();
      }
      if (e.key === ' ') { e.preventDefault(); this.block('paused', !this.blocks.has('paused')); }
    });
    document.addEventListener('visibilitychange', () => this.schedule());
    this.reduced.addEventListener('change', () => this.schedule());
    this.observer = new IntersectionObserver(entries => this.block('outside', !entries[0].isIntersecting));
    this.observer.observe(this.node);
    this.workflowObserver = new MutationObserver(() => this.schedule());
    this.workflowObserver.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open', 'hidden'] });
  }
  setQuote(quote) {
    this.growth.textContent = '';
    const badge = document.createElement('span'); badge.textContent = `今日 · ${quote.category}`;
    const text = document.createElement('p'); text.textContent = quote.text; this.growth.append(badge, text);
  }
  setOpen(open) {
    this.visible = open;
    if (!open) { for (const reason of ['hover', 'focus', 'touch']) this.blocks.delete(reason); this.pointer = null; }
    this.schedule();
  }
  setAppearance({ motion }, color) {
    this.motion = motion;
    if (this.color !== color) { this.color = color; for (const layer of this.layers) this.paint(layer); }
    this.schedule();
  }
  paint(layer) {
    if (!layer.pixels || !this.color) return;
    const accent = this.color.slice(1).match(/../g).map(v => parseInt(v, 16) / 255);
    const { width, height, data } = layer.pixels;
    const output = new ImageData(new Uint8ClampedArray(data), width, height);
    for (const i of layer.ink) {
      const mapped = themePixel(data[i] / 255, data[i + 1] / 255, data[i + 2] / 255, accent);
      for (let c = 0; c < 3; c++) output.data[i + c] = Math.round(mapped[c] * 255);
    }
    layer.canvas.getContext('2d').putImageData(output, 0, 0);
  }
  updateSelection() {
    this.node.dataset.current = BANNERS[this.index][0];
    this.layers.forEach((layer, i) => {
      const active = i === this.index;
      layer.button.classList.toggle('active', active); layer.button.tabIndex = active ? 0 : -1;
      layer.button.setAttribute('aria-hidden', String(!active)); layer.button.inert = !active;
    });
  }
  move(step) { this.index = nextBanner(this.index, step); this.updateSelection(); this.schedule(); }
  block(reason, blocked) { blocked ? this.blocks.add(reason) : this.blocks.delete(reason); this.schedule(); }
  schedule() {
    clearTimeout(this.timer);
    if (this.node && !this.node.contains(document.activeElement)) this.blocks.delete('focus');
    if (!this.visible || !this.ready || !this.motion || this.reduced.matches || this.blocks.size || document.hidden ||
        document.querySelector('dialog[open]') || document.getElementById('prompter')?.hidden === false) return;
    this.timer = setTimeout(() => this.move(1), BANNER_INTERVAL);
  }
}
