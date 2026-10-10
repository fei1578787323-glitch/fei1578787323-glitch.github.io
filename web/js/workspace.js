export const ACCENTS = { mint: ['薄荷', '#34d9a2'], ice: ['冰蓝', '#8cdbf2'], coral: ['珊瑚', '#f2a497'], lime: ['青柠', '#cef56b'], violet: ['紫色', '#a46bff'], blue: ['蓝色', '#369af5'] };
const THEMES = ['system', 'light', 'dark', 'ice', 'graphite', 'liquid', 'luminous'];
const LAYOUTS = ['classic', 'accordion', 'dashboard'];
const KEY = 'frmzone.appearance';
const STAGES = { idea: '灵感', writing: '写稿中', ready: '待拍摄', shot: '已拍摄', edited: '已剪辑', published: '已发布' };

export function normalizeAppearance(value = {}) {
  value = value && typeof value === 'object' ? value : {};
  return { theme: THEMES.includes(value.theme) ? value.theme : 'system',
    layout: LAYOUTS.includes(value.layout) ? value.layout : 'classic',
    accent: Object.hasOwn(ACCENTS, value.accent) ? value.accent : 'mint', motion: value.motion !== false };
}

export function accentForeground(hex) {
  const channels = hex.slice(1).match(/../g).map(n => parseInt(n, 16) / 255)
    .map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
  const luminance = .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2];
  return (luminance + .05) / .05 >= 1.05 / (luminance + .05) ? '#111318' : '#ffffff';
}

export function dueToday(script, now = new Date()) {
  if (!['idea', 'writing', 'ready'].includes(script.stage) || !script.plannedDate) return false;
  const day = new Date(script.plannedDate);
  if (!Number.isFinite(day.getTime())) return false;
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return day < tomorrow;
}

export function filterScripts(scripts, filter = 'all', query = '', now = new Date()) {
  const q = query.trim().toLocaleLowerCase();
  return [...scripts].filter(s => (filter === 'all' || (filter === 'due' ? dueToday(s, now) : s.stage === filter)) &&
    (!q || (s.title + '\n' + s.body).toLocaleLowerCase().includes(q)))
    .sort((a, b) => (+b.updatedAt || 0) - (+a.updatedAt || 0) || String(a.id).localeCompare(String(b.id)));
}

function element(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function button(title, action, cls = '') {
  const b = element('button', cls, title); b.type = 'button'; b.onclick = action; return b;
}

export class HomeWorkspace {
  constructor(api) {
    this.api = api; this.root = document.getElementById('homeWorkspace'); this.filter = 'all'; this.query = ''; this.showAll = false;
    try { this.appearance = normalizeAppearance(JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { this.appearance = normalizeAppearance(); }
    this.bindAppearance(); this.apply();
    document.getElementById('btnHome').onclick = () => this.open();
    document.getElementById('btnAppearance').onclick = () => document.getElementById('appearanceDialog').showModal();
  }
  bindAppearance() {
    const change = (key, value) => {
      this.appearance = normalizeAppearance({ ...this.appearance, [key]: value });
      try { localStorage.setItem(KEY, JSON.stringify(this.appearance)); } catch { /* Session appearance still works without storage. */ }
      this.apply(); this.render();
    };
    for (const [id, key] of [['uiTheme', 'theme'], ['uiLayout', 'layout']]) {
      document.getElementById(id).value = this.appearance[key];
      document.getElementById(id).onchange = e => change(key, e.target.value);
    }
    document.getElementById('uiMotion').checked = this.appearance.motion;
    document.getElementById('uiMotion').onchange = e => change('motion', e.target.checked);
    const swatches = document.getElementById('uiAccents');
    for (const [key, [name, color]] of Object.entries(ACCENTS)) {
      const b = button('', () => change('accent', key), 'accent-swatch');
      b.style.setProperty('--swatch', color); b.dataset.accent = key; b.setAttribute('aria-label', name); b.title = name; swatches.append(b);
    }
  }
  apply() {
    const { theme, accent, motion } = this.appearance;
    const html = document.documentElement;
    html.dataset.theme = theme; html.dataset.motion = motion ? 'on' : 'off';
    html.style.setProperty('--accent', ACCENTS[accent][1]);
    html.style.setProperty('--accent-text', `color-mix(in srgb, ${ACCENTS[accent][1]} 40%, var(--text))`);
    html.style.setProperty('--on-accent', accentForeground(ACCENTS[accent][1]));
    for (const b of document.querySelectorAll('[data-accent]')) b.setAttribute('aria-pressed', String(b.dataset.accent === accent));
  }
  open() { this.setOpen(true); this.render(); }
  setOpen(open) {
    this.root.hidden = !open; document.getElementById('editor').hidden = open;
    document.body.classList.toggle('home-open', open);
    document.getElementById('btnHome').setAttribute('aria-pressed', String(open));
  }
  edit(script) { this.setOpen(false); this.api.onOpen(script.id); }
  prompt(script) { this.api.onOpen(script.id); this.api.onStart(); }
  tools() {
    const grid = element('div', 'home-tools');
    grid.append(button('新建稿件', () => { this.setOpen(false); this.api.onNew(); }, 'home-tool'),
      button('导入文件', this.api.onImport, 'home-tool'), button('台本库', this.api.onLibrary, 'home-tool'));
    return grid;
  }
  render() {
    if (this.root.hidden) return;
    const scripts = this.api.getScripts(), current = this.api.getCurrent();
    this.root.textContent = ''; this.root.dataset.layout = this.appearance.layout;
    const header = element('div', 'home-heading'); header.append(element('h1', '', '创作工作台'));
    const layout = element('select'); layout.setAttribute('aria-label', '主页布局');
    for (const [key, title] of [['classic', '经典工作台'], ['accordion', '折叠工作台'], ['dashboard', '蓝曜工作台']]) {
      const o = element('option', '', title); o.value = key; layout.append(o);
    }
    layout.value = this.appearance.layout;
    layout.onchange = () => { document.getElementById('uiLayout').value = layout.value; document.getElementById('uiLayout').dispatchEvent(new Event('change')); };
    header.append(layout); this.root.append(header);
    const stats = element('div', 'home-stats');
    for (const [title, value] of [['稿件', `${scripts.length} 篇`], ['总字数', `${scripts.reduce((n, s) => n + this.api.countWords(s.body), 0)} 字`], ['待拍摄', `${scripts.filter(s => s.stage === 'ready').length} 篇`]]) {
      const item = element('div'); item.append(element('span', '', title), element('strong', '', value)); stats.append(item);
    }
    this.root.append(stats);
    if (this.appearance.layout === 'dashboard') this.dashboard(scripts, current);
    else if (this.appearance.layout === 'accordion') this.accordion(current);
    else {
      const actions = element('div', 'home-primary-actions');
      const start = button('开始提词', () => this.prompt(current), 'home-command active'); start.disabled = !this.api.hasContent(current);
      actions.append(start, button('新建稿件', () => { this.setOpen(false); this.api.onNew(); }, 'home-command'));
      this.root.append(actions, this.tools());
      if (current) this.root.append(this.scriptCard(current, true));
    }
  }
  scriptCard(script, expanded) {
    const card = element('article', `home-script${expanded ? ' selected' : ''}`);
    const title = button(script.title.trim() || '未命名稿件', () => { this.selected = script.id; this.render(); }, 'home-script-title');
    title.setAttribute('aria-expanded', String(expanded));
    card.append(title, element('div', 'home-meta', `${STAGES[script.stage] || '未排期'} · ${this.api.countWords(script.body)} 字`));
    if (expanded) {
      card.append(element('p', 'home-preview', this.api.plainText(script.body).trim() || '空白稿件'));
      const row = element('div', 'home-script-actions');
      const start = button('开始提词', () => this.prompt(script), 'primary small'); start.disabled = !this.api.hasContent(script);
      row.append(button('编辑稿件', () => this.edit(script), 'secondary small'), start); card.append(row);
    }
    return card;
  }
  dashboard(scripts, current) {
    const columns = element('div', 'home-columns'), tasks = element('div', 'home-tasks'), rail = element('aside', 'home-rail');
    tasks.append(element('h2', '', '稿件任务'));
    const filters = element('div', 'segment'); filters.setAttribute('role', 'radiogroup'); filters.setAttribute('aria-label', '筛选稿件');
    for (const [key, title] of [['all', '全部稿件'], ['due', '今日待拍'], ['ready', '待拍摄'], ['published', '已发布']]) {
      const b = button(title, () => { this.filter = key; this.showAll = false; this.render(); });
      b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(key === this.filter)); filters.append(b);
    }
    tasks.append(filters);
    const search = element('input', 'search'); search.type = 'search'; search.placeholder = '搜索稿件'; search.value = this.query; search.setAttribute('aria-label', '搜索工作台稿件');
    search.oninput = e => {
      this.query = search.value; this.showAll = false;
      if (e?.isComposing) return;
      this.render(); const next = this.root.querySelector('[aria-label="搜索工作台稿件"]'); next.focus();
    };
    search.oncompositionend = () => search.oninput();
    tasks.append(search);
    const matching = filterScripts(scripts, this.filter, this.query), shown = this.showAll ? matching : matching.slice(0, 4);
    const active = shown.find(s => s.id === this.selected) || shown.find(s => s.id === current?.id) || shown[0];
    for (const script of shown) tasks.append(this.scriptCard(script, script.id === active?.id));
    if (!shown.length) {
      tasks.append(element('p', 'home-meta', '没有符合条件的稿件'), button('清除筛选', () => { this.query = ''; this.filter = 'all'; this.render(); }, 'link'));
    }
    if (matching.length > 4) tasks.append(button(this.showAll ? '收起稿件' : '查看全部稿件', () => { this.showAll = !this.showAll; this.render(); }, 'link'));
    const today = element('section', 'home-summary'); today.append(element('h2', '', '今日计划'));
    const due = scripts.filter(s => dueToday(s)); today.append(element('strong', '', `今天待拍 ${due.length} 篇`));
    for (const s of due.slice(0, 2)) today.append(button(s.title || '未命名稿件', () => this.edit(s), 'home-plan-link'));
    if (!due.length) today.append(element('p', 'home-meta', '今天没有待拍计划'));
    const progress = element('section', 'home-summary'); const planned = scripts.filter(s => STAGES[s.stage]);
    const published = planned.filter(s => s.stage === 'published').length;
    progress.append(element('h2', '', '创作进度'), element('p', 'home-meta', `已发布 ${published} / ${planned.length}`));
    const meter = element('progress'); meter.max = Math.max(1, planned.length); meter.value = published; meter.setAttribute('aria-label', '已发布稿件进度'); progress.append(meter);
    rail.append(today, progress, this.tools()); columns.append(tasks, rail); this.root.append(columns);
  }
  accordion(current) {
    const accordion = element('div', 'home-accordion');
    const actions = [ ['开始提词', () => this.prompt(current)], ['新建稿件', () => { this.setOpen(false); this.api.onNew(); }], ['导入文件', this.api.onImport], ['台本库', this.api.onLibrary] ];
    for (let i = 0; i < actions.length; i++) {
      const [title, action] = actions[i], open = (this.panel ?? 0) === i;
      const item = element('section', `home-fold${open ? ' expanded' : ''}`);
      const toggle = button(title, () => { this.panel = i; this.render(); }, 'home-fold-tab'); toggle.setAttribute('aria-expanded', String(open)); item.append(toggle);
      if (open) {
        item.append(element('p', 'home-preview', i === 0 ? (current?.title || '未命名稿件') : title));
        const command = button(title, action, 'primary small'); command.disabled = i === 0 && !this.api.hasContent(current); item.append(command);
      }
      accordion.append(item);
    }
    this.root.append(accordion);
  }
}
