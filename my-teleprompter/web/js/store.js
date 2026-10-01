// 稿件、设置、免费额度都存在这台设备的浏览器里（localStorage），不上传。

const K_SCRIPTS = 'frmzone.scripts';
const K_CURRENT = 'frmzone.current';
const K_SETTINGS = 'frmzone.settings';
const K_QUOTA = 'frmzone.followQuota';
const K_LICENSE = 'frmzone.license';

/** 免费版智能跟读每天几分钟（和 App 的 TierLimits.freeDailyFollowMinutes 一致） */
export const FREE_FOLLOW_MINUTES = 20;

const SAMPLE = `大家好，欢迎使用AI魔方提词器网页版。

这是一段示例稿件。点下面的「开始提词」，选择智能跟读，对着电脑朗读，文字就会跟着你滚动；你停下来，它也会停下来。

【看镜头】用方括号写导演提示，不会被朗读。**重点内容**用两个星号标出。

准备好了吗？现在就把这段文字换成你自己的稿子吧。`;

function read(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 存储满了或被禁用：这次不存 */ }
}

export function uuid() {
  return (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  })).toUpperCase();
}

// ── 稿件 ──

export function loadScripts() {
  let list = read(K_SCRIPTS, null);
  if (!Array.isArray(list) || !list.length) {
    list = [{ id: uuid(), title: '欢迎使用', body: SAMPLE, updatedAt: Date.now() }];
    write(K_SCRIPTS, list);
  }
  return list;
}
export function saveScripts(list) { write(K_SCRIPTS, list); }
export function loadCurrent() { return read(K_CURRENT, null); }
export function saveCurrent(id) { write(K_CURRENT, id); }

// ── 设置 ──

export const DEFAULTS = {
  mode: 'follow',
  speed: 60,
  fontSize: 56,
  lineHeight: 1.5,
  margin: 6,
  center: false,
  dim: true,
  band: true,
  fg: '#ffffff',
  bg: '#000000',
  showLine: true,
  linePos: 0.3,
  mirrorH: false,
  mirrorV: false,
  countdown: 3,
  timer: true,
  lang: 'zh-CN',
};
export function loadSettings() {
  // 手机屏窄，默认字号小一些（一行能放十来个字）；用户调过就按用户的
  const base = { ...DEFAULTS, fontSize: window.innerWidth < 560 ? 34 : DEFAULTS.fontSize };
  return { ...base, ...read(K_SETTINGS, {}) };
}
export function saveSettings(s) { write(K_SETTINGS, s); }

// ── 免费额度：智能跟读每天 20 分钟，本地零点重置 ──

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}
export function followUsed() {
  const q = read(K_QUOTA, {});
  return q.day === today() ? q.used || 0 : 0;
}
export function consumeFollow(seconds) {
  const used = followUsed() + seconds;
  write(K_QUOTA, { day: today(), used });
  return used;
}
export function followLeft() { return Math.max(0, FREE_FOLLOW_MINUTES * 60 - followUsed()); }

// ── 免费额度：浮窗每天 20 分钟（和 App 的 TierLimits.freeDailyMinutes 一致），本地零点重置 ──

const K_FLOAT = 'frmzone.floatQuota';
export const FREE_FLOAT_MINUTES = 20;
function floatUsed() {
  const q = read(K_FLOAT, {});
  return q.day === today() ? q.used || 0 : 0;
}
export function consumeFloat(seconds) { write(K_FLOAT, { day: today(), used: floatUsed() + seconds }); }
export function floatLeft() { return Math.max(0, FREE_FLOAT_MINUTES * 60 - floatUsed()); }

// ── 授权码 ──

export function loadLicense() { return read(K_LICENSE, null); }
export function saveLicense(code) { write(K_LICENSE, code); }
export function clearLicense() { try { localStorage.removeItem(K_LICENSE); } catch { /* 忽略 */ } }

// ── 工程文件（.fpproj，和 App 同一种格式；网页只存稿件，打开时各端只取稿件） ──

function iso(ms) { return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z'); }

export function exportProject(list) {
  const project = {
    format: 'FollowPrompterProject',
    version: 1,
    savedAt: iso(Date.now()),
    platform: 'web',
    scripts: list.map(s => ({ id: s.id, title: s.title, body: s.body, updatedAt: iso(s.updatedAt || Date.now()) })),
    settings: {},
    shortcuts: {},
  };
  return JSON.stringify(project, null, 2);
}

/** 读工程文件里的稿件；不是工程文件返回 null */
export function parseProject(text) {
  try {
    const p = JSON.parse(text);
    if (p.format !== 'FollowPrompterProject' || !Array.isArray(p.scripts)) return null;
    return p.scripts.map(s => ({
      id: typeof s.id === 'string' ? s.id.toUpperCase() : uuid(),
      title: s.title || '',
      body: s.body || '',
      updatedAt: Date.parse(s.updatedAt) || Date.now(),
      folder: s.folder || '',
    }));
  } catch {
    return null;
  }
}
