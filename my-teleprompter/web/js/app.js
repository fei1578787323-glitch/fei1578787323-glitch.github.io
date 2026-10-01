// AI魔方提词器网页提词器：稿件列表 + 编辑区 + 台本库 + 授权码；提词画面在 prompter.js
import * as store from './store.js';
import { countWords, estimateSeconds, formatDuration, clock, previewHTML, plainText } from './markup.js';
import { verifyLicense, loadRevocations, refreshRevocations } from './license.js';
import { Prompter, findEl } from './prompter.js';

// 提词画面放进浮窗后，它里面的元素在浮窗的 document 里
const $ = (id) => document.getElementById(id) || findEl(id);
const TALENT = location.hash === '#talent';

let scripts = store.loadScripts();
let settings = store.loadSettings();
let currentId = store.loadCurrent();
if (!scripts.some(s => s.id === currentId)) currentId = scripts[0].id;
let license = null;          // 验证过的授权码信息

const current = () => scripts.find(s => s.id === currentId);
const unlimited = () => !!license && (license.tier === 'pro' || license.tier === 'max');

// ── 提示条 ──
let toastTimer = 0;
function toast(text, ms = 2600) {
  const t = $('toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

// ── 稿件列表 ──
function renderList() {
  const q = $('search').value.trim().toLowerCase();
  const list = [...scripts]
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .filter(s => !q || s.title.toLowerCase().includes(q) || s.body.toLowerCase().includes(q));
  const ul = $('scriptList');
  ul.textContent = '';
  for (const s of list) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    if (s.id === currentId) b.setAttribute('aria-current', 'true');
    const firstLine = plainText(s.body).split('\n').map(l => l.trim()).find(Boolean) || '空白稿件';
    b.innerHTML = '<span class="t"></span><span class="p"></span><span class="m"></span>';
    b.querySelector('.t').textContent = s.title.trim() || '未命名稿件';
    b.querySelector('.p').textContent = firstLine;
    b.querySelector('.m').textContent = `${countWords(s.body)} 字 · ${new Date(s.updatedAt || Date.now()).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
    b.onclick = () => select(s.id);
    li.appendChild(b);
    ul.appendChild(li);
  }
  if (!list.length) {
    const li = document.createElement('li');
    li.className = 'note';
    li.style.padding = '12px';
    li.textContent = q ? '没有找到' : '还没有稿件';
    ul.appendChild(li);
  }
}

function select(id) {
  currentId = id;
  store.saveCurrent(id);
  const s = current();
  $('title').value = s.title;
  $('body').value = s.body;
  renderStats();
  renderList();
  document.body.classList.add('editing');
  if (duo?.connected) duoSendLoad();
}

function renderStats() {
  const s = current();
  $('stats').textContent = `${countWords(s.body)} 字 · 约 ${formatDuration(estimateSeconds(s.body))}`;
}

let saveTimer = 0;
function edited() {
  const s = current();
  s.title = $('title').value;
  s.body = $('body').value;
  s.updatedAt = Date.now();
  renderStats();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { store.saveScripts(scripts); renderList(); }, 400);
  // 双窗口：改稿同步给主持窗口
  if (duo?.connected) {
    clearTimeout(duo.editTimer);
    duo.editTimer = setTimeout(() => duo.ch.postMessage({ type: 'script', script: { ...current() } }), 500);
  }
}

function newScript(title = '', body = '') {
  const s = { id: store.uuid(), title, body, updatedAt: Date.now() };
  scripts.push(s);
  store.saveScripts(scripts);
  select(s.id);
  if (!body) $('body').focus();
  return s;
}

function deleteCurrent() {
  const s = current();
  if (!confirm(`删除「${s.title.trim() || '未命名稿件'}」？删除后找不回来。`)) return;
  scripts = scripts.filter(x => x.id !== s.id);
  if (!scripts.length) { newScript('新的稿件', ''); return; }
  store.saveScripts(scripts);
  select(scripts.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0].id);
  document.body.classList.remove('editing');
}

// ── 模式 ──
function renderMode() {
  for (const b of $('modeSeg').querySelectorAll('button')) b.setAttribute('aria-checked', b.dataset.mode === settings.mode ? 'true' : 'false');
  renderQuota();
}

function renderQuota() {
  const line = $('quotaLine');
  if (unlimited()) {
    line.textContent = license.serial ? `终身 MAX · 第 ${license.serial} 份 · 智能跟读不限时长` : `${license.tier === 'max' ? 'MAX' : 'Pro'} 已解锁 · 智能跟读不限时长`;
  } else if (settings.mode === 'follow') {
    const left = store.followLeft();
    line.textContent = left > 0 ? `免费版智能跟读今日还剩 ${clock(left)}` : '免费版今天的智能跟读已用完，可以先用匀速或声控；明天零点恢复';
  } else {
    line.textContent = '';
  }
  $('btnTier').textContent = unlimited() ? (license.serial ? '终身 MAX' : license.tier === 'max' ? 'MAX' : 'Pro') : '免费版';
}

function saveSettings(s) {
  settings = s;
  store.saveSettings(settings);
  renderMode();
  syncDrawer();
  if (duo?.connected) duo.ch.postMessage({ type: 'settings', settings: { ...settings } });
}

// ── 提词 ──
const prompter = new Prompter({
  isUnlimited: unlimited,
  onQuotaOut: () => {
    toast('免费版今天的智能跟读用完了，已改用匀速滚动');
    renderQuota();
  },
  onSettings: saveSettings,
  toast,
});

function start() {
  const s = current();
  if (!plainText(s.body).trim()) { toast('先写点稿子再开始'); $('body').focus(); return; }
  store.saveScripts(scripts);
  prompter.open(s, settings);
}

// ── 双窗口：导播台（这个窗口）+ 主持窗口（新开的窗口，放提词画面） ──
// 两个窗口是同一个网站，用 BroadcastChannel 直接传消息，不经过任何服务器。

let duo = null;

function startDuo() {
  if (!unlimited()) {
    toast('双窗口是 Pro / MAX 功能：开一个窗口给主持人看，这个窗口当导播台');
    renderTier();
    $('licenseMsg').textContent = '';
    $('tierDialog').showModal();
    return;
  }
  if (!plainText(current().body).trim()) { toast('先写点稿子再开始'); return; }
  store.saveScripts(scripts);
  if (!duo) {
    duo = { ch: new BroadcastChannel('frmzone-duo'), connected: false, paras: [], state: null };
    duo.ch.onmessage = (e) => duoMessage(e.data);
  }
  const w = window.open('./#talent', 'frmzone-talent', 'popup=yes,width=1280,height=760');
  if (!w) { toast('浏览器拦住了新窗口：请在地址栏右边允许弹出窗口，再点一次「双窗口」'); return; }
  duo.win = w;
  document.body.classList.add('duo-on');
  $('duoPanel').hidden = false;
  duoConn(duo.connected ? '主持窗口已连接' : '正在打开主持窗口…', duo.connected);
  duoSyncControls();
  // 主持窗口已经开着（再点一次）：直接把当前稿子发过去；导播台刷新过就先问一声
  if (duo.connected) duoSendLoad();
  else duo.ch.postMessage({ type: 'ping' });
}

function duoSendLoad() {
  duo.ch.postMessage({ type: 'load', script: { ...current() }, settings: { ...settings } });
}

function duoConn(text, live) {
  const el = $('duoConn');
  el.textContent = text;
  el.classList.toggle('live', !!live);
}

function duoMessage(m) {
  if (m.type === 'hello') {
    duo.connected = true;
    duoConn('主持窗口已连接', true);
    duoSendLoad();
  } else if (m.type === 'bye') {
    duo.connected = false;
    duoConn('主持窗口已关闭 · 点「双窗口」重新打开', false);
  } else if (m.type === 'state' && m.paras) {
    duo.paras = m.paras;
    duoRenderParas();
  } else if (m.type === 'state') {
    duo.state = m;
    duoRenderState();
  }
}

function duoRenderParas() {
  const ol = $('duoParas');
  ol.textContent = '';
  for (const p of duo.paras) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    const span = document.createElement('span');
    span.textContent = p.text;
    b.appendChild(span);
    if (p.cue) b.classList.add('cue');
    if (p.unit != null) b.onclick = () => duo.ch.postMessage({ type: 'cmd', cmd: 'jump', unit: p.unit });
    else b.disabled = true;
    li.appendChild(b);
    ol.appendChild(li);
  }
  duoRenderState();
}

function duoRenderState() {
  const st = duo.state;
  if (!st) return;
  $('duoTimer').textContent = clock(st.elapsed);
  $('duoBar').style.width = (st.progress * 100).toFixed(1) + '%';
  $('duoPlayIcon').innerHTML = st.playing
    ? '<path d="M8 5h3v14H8zM14 5h3v14h-3z" fill="currentColor" stroke="none"/>'
    : '<path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="none"/>';
  // 主持窗口那边改了（键盘、底栏），这边跟着显示；正在拖的滑块不动
  for (const [k, v] of [['mode', st.mode], ['speed', st.speed], ['fontSize', st.fontSize], ['mirrorH', st.mirrorH], ['mirrorV', st.mirrorV]]) settings[k] = v;
  duoSyncControls();
  let status = st.counting ? '倒计时…' : st.playing ? '播出中' : '已暂停';
  if (st.mode === 'follow' && st.playing) status += st.followState === 'listening' ? ' · 正在听' : st.followState === 'denied' ? ' · 主持窗口没有麦克风权限' : '';
  duoConn(`主持窗口已连接 · ${status}`, true);
  // 当前段：开头在读到位置之前的最后一段
  const btns = $('duoParas').querySelectorAll('button');
  let now = -1;
  duo.paras.forEach((p, i) => { if (p.unit != null && p.unit <= st.unit) now = i; });
  btns.forEach((b, i) => { b.classList.toggle('now', i === now); b.classList.toggle('read', i < now); });
  if (now >= 0 && duo.lastNow !== now) { btns[now].scrollIntoView({ block: 'nearest', behavior: 'smooth' }); duo.lastNow = now; }
}

function duoSyncControls() {
  const busy = document.activeElement;
  $('duoMode').value = settings.mode;
  if (busy !== $('duoSpeed')) $('duoSpeed').value = settings.speed;
  $('duoSpeedVal').textContent = settings.speed;
  if (busy !== $('duoFont')) $('duoFont').value = settings.fontSize;
  $('duoFontVal').textContent = settings.fontSize;
  $('duoSpeedWrap').hidden = !(settings.mode === 'auto' || settings.mode === 'voice');
  $('duoMirrorH').checked = settings.mirrorH;
  $('duoMirrorV').checked = settings.mirrorV;
}

function endDuo() {
  if (!duo) return;
  duo.ch.postMessage({ type: 'end' });
  duo.connected = false;
  $('duoPanel').hidden = true;
  document.body.classList.remove('duo-on');
}

function bindDuo() {
  $('btnDuo').onclick = startDuo;
  $('duoEnd').onclick = endDuo;
  $('duoPlay').onclick = () => duo?.ch.postMessage({ type: 'cmd', cmd: 'toggle' });
  $('duoRestart').onclick = () => duo?.ch.postMessage({ type: 'cmd', cmd: 'restart' });
  const set = (k, v) => { settings[k] = v; saveSettings(settings); duoSyncControls(); };
  $('duoMode').onchange = (e) => set('mode', e.target.value);
  $('duoSpeed').oninput = (e) => set('speed', +e.target.value);
  $('duoFont').oninput = (e) => set('fontSize', +e.target.value);
  $('duoMirrorH').onchange = (e) => set('mirrorH', e.target.checked);
  $('duoMirrorV').onchange = (e) => set('mirrorV', e.target.checked);
  // 导播台刷新 / 关掉：主持窗口不关，只提示断开，可以接着用键盘操作
  window.addEventListener('pagehide', () => duo?.ch.postMessage({ type: 'operator-gone' }));
}

/** 这个窗口是主持窗口：等导播台发稿子，照着命令播 */
function initTalent() {
  document.body.classList.add('talent');
  $('talentWait').hidden = false;
  const ch = new BroadcastChannel('frmzone-duo');
  prompter.onState = (st) => ch.postMessage({ type: 'state', ...st });
  prompter.onClose = () => window.close();
  ch.onmessage = (e) => {
    const m = e.data;
    if (m.type === 'ping') { ch.postMessage({ type: 'hello' }); return; }
    if (m.type === 'operator-gone') { prompter.isOpen ? prompter.toast('导播台断开了：这边可以接着用键盘操作；导播台再点「双窗口」就能连回来') : ($('talentMsg').textContent = '导播台断开了：请在导播台那个窗口点「双窗口」'); return; }
    if (m.type === 'load') {
      $('talentWait').hidden = true;
      const modeChanged = prompter.isOpen && m.settings.mode !== settings.mode;
      Object.assign(settings, m.settings);
      if (prompter.isOpen) {
        prompter.replaceScript(m.script);
        if (modeChanged) prompter.setMode(settings.mode);
        prompter.update(settings);
      } else {
        prompter.open(m.script, settings);
      }
    } else if (!prompter.isOpen) {
      if (m.type === 'end') window.close();
    } else if (m.type === 'script') {
      prompter.replaceScript(m.script);
    } else if (m.type === 'settings') {
      if (m.settings.mode !== settings.mode) prompter.setMode(m.settings.mode);
      Object.assign(settings, m.settings);
      prompter.update(settings);
    } else if (m.type === 'cmd') {
      if (m.cmd === 'toggle') prompter.toggle();
      else if (m.cmd === 'restart') prompter.restart();
      else if (m.cmd === 'jump') prompter.jumpTo(m.unit);
      prompter.poke();
    } else if (m.type === 'end') {
      window.close();
    }
  };
  ch.postMessage({ type: 'hello' });
  window.addEventListener('pagehide', () => ch.postMessage({ type: 'bye' }));
  // 导播台先开、主持窗口刷新过：过一会儿还没收到稿子就提示
  setTimeout(() => { if (!prompter.isOpen) $('talentMsg').textContent = '还没收到稿子：请在导播台那个窗口点「双窗口」'; }, 2500);
}

// ── 提词设置抽屉 ──
function syncDrawer() {
  $('sLine').value = settings.lineHeight;
  $('sMargin').value = settings.margin;
  $('sCenter').checked = settings.center;
  $('sDim').checked = settings.dim;
  $('sBand').checked = settings.band;
  $('sShowLine').checked = settings.showLine;
  $('sLinePos').value = settings.linePos;
  $('sFlipV').checked = settings.mirrorV;
  $('sCountdown').value = String(settings.countdown);
  $('sTimer').checked = settings.timer;
  $('sLang').value = settings.lang;
  for (const b of $('sColors').querySelectorAll('button')) {
    b.setAttribute('aria-pressed', b.dataset.fg === settings.fg && b.dataset.bg === settings.bg ? 'true' : 'false');
  }
}

function bindDrawer() {
  const set = (key, value) => {
    settings[key] = value;
    store.saveSettings(settings);
    if (prompter.isOpen) prompter.update(settings);
    syncDrawer();
  };
  $('sLine').oninput = (e) => set('lineHeight', +e.target.value);
  $('sMargin').oninput = (e) => set('margin', +e.target.value);
  $('sCenter').onchange = (e) => set('center', e.target.checked);
  $('sDim').onchange = (e) => set('dim', e.target.checked);
  $('sBand').onchange = (e) => set('band', e.target.checked);
  $('sShowLine').onchange = (e) => set('showLine', e.target.checked);
  $('sLinePos').oninput = (e) => set('linePos', +e.target.value);
  $('sFlipV').onchange = (e) => set('mirrorV', e.target.checked);
  $('sCountdown').onchange = (e) => set('countdown', +e.target.value);
  $('sTimer').onchange = (e) => set('timer', e.target.checked);
  $('sLang').onchange = (e) => set('lang', e.target.value);
  for (const b of $('sColors').querySelectorAll('button')) {
    b.onclick = () => { settings.fg = b.dataset.fg; set('bg', b.dataset.bg); };
  }
}

// ── 台本库 ──
let library = null;
let libCat = '推荐';
let libSelected = null;

async function openLibrary() {
  const dlg = $('libraryDialog');
  if (!library) {
    // 第一次打开要下载 200 多篇台本（约 200 KB）：先提示一下，别让人以为没点上
    toast('正在加载台本库…');
    try {
      library = await (await fetch('library.json')).json();
    } catch {
      toast('台本库加载失败，请检查网络');
      return;
    }
    const row = $('libCats');
    for (const c of library.categories) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = c;
      b.onclick = () => { libCat = c; renderLibrary(); };
      row.appendChild(b);
    }
  }
  renderLibrary();
  dlg.showModal();
}

function renderLibrary() {
  for (const b of $('libCats').querySelectorAll('button')) b.setAttribute('aria-pressed', b.textContent === libCat ? 'true' : 'false');
  const q = $('libSearch').value.trim();
  const items = library.templates.filter(t => (libCat === '推荐' || t.category === libCat) && (!q || t.title.includes(q) || t.body.includes(q)));
  const ul = $('libList');
  ul.textContent = '';
  for (const t of items) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = '<span class="t"></span><span class="m"></span>';
    b.querySelector('.t').textContent = t.title;
    b.querySelector('.m').textContent = `${t.category} · ${countWords(t.body)} 字 · 约 ${formatDuration(estimateSeconds(t.body))}`;
    if (libSelected === t.id) b.setAttribute('aria-current', 'true');
    b.onclick = () => { libSelected = t.id; showTemplate(t); renderLibrary(); };
    li.appendChild(b);
    ul.appendChild(li);
  }
  if (!libSelected && items[0] && window.innerWidth > 760) { libSelected = items[0].id; showTemplate(items[0]); renderLibrary(); }
}

function showTemplate(t) {
  const box = $('libPreview');
  box.innerHTML = `<button class="link back-lib" type="button">‹ 返回列表</button><h3></h3><div class="m"></div><div class="txt"></div>`;
  box.querySelector('h3').textContent = t.title;
  box.querySelector('.m').textContent = `${t.category} · ${countWords(t.body)} 字 · 约 ${formatDuration(estimateSeconds(t.body))}`;
  box.querySelector('.txt').innerHTML = previewHTML(t.body);
  const use = document.createElement('button');
  use.type = 'button';
  use.className = 'primary small use';
  use.textContent = '用这篇';
  use.onclick = () => {
    newScript(t.title, t.body);
    $('libraryDialog').close();
    toast(`已加到稿件：${t.title}`);
  };
  box.appendChild(use);
  box.querySelector('.back-lib').onclick = () => $('libraryDialog').classList.remove('previewing');
  $('libraryDialog').classList.add('previewing');
}

// ── 导入 / 导出 ──
async function importFiles(files) {
  let added = 0;
  for (const f of files) {
    const text = await f.text();
    const project = /\.(fpproj|json)$/i.test(f.name) ? store.parseProject(text) : null;
    if (project) {
      const folder = f.name.replace(/\.[^.]+$/, '');
      for (const s of project) {
        if (scripts.some(x => x.id === s.id)) s.id = store.uuid();
        scripts.push({ ...s, updatedAt: Date.now() });
        added++;
      }
      toast(`已从工程「${folder}」加入 ${project.length} 篇稿件`);
    } else if (/\.(txt|md|markdown)$/i.test(f.name) || f.type.startsWith('text/')) {
      scripts.push({ id: store.uuid(), title: f.name.replace(/\.[^.]+$/, ''), body: text, updatedAt: Date.now() });
      added++;
    } else {
      toast(`「${f.name}」不是文本或工程文件：网页版只能导入 TXT、Markdown 和 .fpproj 工程`);
    }
  }
  if (added) {
    store.saveScripts(scripts);
    select(scripts[scripts.length - 1].id);
  }
}

function exportAll() {
  const blob = new Blob([store.exportProject(scripts)], { type: 'application/json' });
  const a = document.createElement('a');
  const d = new Date();
  a.href = URL.createObjectURL(blob);
  a.download = `AI魔方提词器稿件 ${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}.fpproj`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast('已存成工程文件：手机和电脑版AI魔方提词器都能打开');
}

// ── 版本 / 授权码 ──
function renderTier() {
  $('tierStatus').textContent = unlimited()
    ? (license.serial ? `终身 MAX · 第 ${license.serial} 份${license.name ? ' · ' + license.name : ''}` : `${license.tier === 'max' ? 'MAX' : 'Pro'} 已解锁${license.name ? ' · ' + license.name : ''}`)
    : `免费版 · 智能跟读今日还剩 ${clock(store.followLeft())}`;
  $('btnLicenseClear').hidden = !license;
}

async function applyLicense(code, quiet) {
  const r = await verifyLicense(code);
  if (!r.ok) {
    if (!quiet) $('licenseMsg').textContent = r.reason;
    // 启动时 / 收到新停用名单后复查没过（过期、被停用）：回到免费版
    else if (license) { license = null; renderTier(); renderQuota(); }
    return false;
  }
  license = r;
  store.saveLicense(code.trim());
  if (!quiet) {
    $('licenseMsg').textContent = '解锁成功';
    toast('已解锁：智能跟读不限时长');
  }
  renderTier();
  renderQuota();
  return true;
}

// ── 滑块填色：Chrome / Safari 的滑块轨道画不出「已经拖过的那段」，按数值算个比例给样式用（--fill）；
// 程序里改了数值不会触发 input 事件，所以再每 0.3 秒对一遍（就十来个滑块，不费事）
function paintRangeFill(el) {
  const min = +el.min || 0, max = +el.max || 100, v = +el.value;
  el.style.setProperty('--fill', ((v - min) / Math.max(1e-9, max - min) * 100).toFixed(1) + '%');
}
function watchRanges() {
  const all = () => [...document.querySelectorAll('input[type=range]')];
  for (const el of all()) el.addEventListener('input', () => paintRangeFill(el));
  setInterval(() => all().forEach(paintRangeFill), 300);
  all().forEach(paintRangeFill);
}

// ── 启动 ──
function init() {
  watchRanges();
  $('search').oninput = renderList;
  $('btnNew').onclick = () => newScript();
  $('btnBack').onclick = () => document.body.classList.remove('editing');
  $('btnDelete').onclick = deleteCurrent;
  $('title').oninput = edited;
  $('body').oninput = edited;
  $('btnStart').onclick = start;
  for (const b of $('modeSeg').querySelectorAll('button')) {
    b.onclick = () => { settings.mode = b.dataset.mode; saveSettings(settings); };
  }
  $('btnLibrary').onclick = openLibrary;
  $('libSearch').oninput = () => renderLibrary();
  $('btnImport').onclick = () => $('fileInput').click();
  $('fileInput').onchange = (e) => { importFiles([...e.target.files]); e.target.value = ''; };
  $('btnExport').onclick = exportAll;
  $('btnTier').onclick = () => { renderTier(); $('licenseMsg').textContent = ''; $('tierDialog').showModal(); };
  $('btnLicense').onclick = () => applyLicense($('licenseInput').value, false);
  $('btnLicenseClear').onclick = () => { license = null; store.clearLicense(); renderTier(); renderQuota(); $('licenseInput').value = ''; };
  for (const d of document.querySelectorAll('dialog')) {
    d.querySelector('[data-close]').onclick = () => d.close();
    d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
  }
  // 拖文件进窗口导入
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => { e.preventDefault(); if (e.dataTransfer.files.length) importFiles([...e.dataTransfer.files]); });
  // ⌘/Ctrl + Enter 开始提词
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !prompter.isOpen) { e.preventDefault(); start(); }
  });

  bindDrawer();
  syncDrawer();
  bindDuo();
  if (TALENT) { initTalent(); return; }
  select(currentId);
  if (window.innerWidth <= 760) document.body.classList.remove('editing');
  renderMode();
  const saved = store.loadLicense();
  if (saved) {
    // 先用本机记着的停用名单验一遍，再联网拉最新的（只有本机有授权码时才拉，和电脑 / 手机版一样）
    loadRevocations().then(() => applyLicense(saved, true)).then(() => refreshRevocations()).then((changed) => {
      if (changed) applyLicense(saved, true).then(() => { if (!license) toast('这台设备上的授权码已被停用，已回到免费版', 5000); });
    });
  }

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
