// 官网授权码（VP1-…）：内容 + 我们私钥的签名。网页里只有公钥，用浏览器自带的 Ed25519 离线验签，
// 和电脑版 LicenseCodec 同一套规则。授权码只存在这台设备的浏览器里。

const PUBLIC_KEY = 'fcomOn2CntobOZcRvSyLObOuABPfRDDUSulN/pFylWk=';
const PREFIX = 'VP1-';

function fromB64(text, url) {
  let s = url ? text.replace(/-/g, '+').replace(/_/g, '/') : text;
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** 验证授权码。成功返回 { ok: true, tier: 'pro'|'max', name, seats, serial, expires }，失败返回 { ok: false, reason } */
export async function verifyLicense(input) {
  const key = (input || '').replace(/\s+/g, '');
  if (!key.startsWith(PREFIX)) return { ok: false, reason: '这不是AI魔方提词器授权码（应该以 VP1- 开头）' };
  const parts = key.slice(PREFIX.length).split('.');
  if (parts.length !== 2) return { ok: false, reason: '授权码不完整，请整段复制' };
  let payload, signature;
  try {
    payload = fromB64(parts[0], true);
    signature = fromB64(parts[1], true);
  } catch {
    return { ok: false, reason: '授权码不完整，请整段复制' };
  }
  let valid = false;
  try {
    const pub = await crypto.subtle.importKey('raw', fromB64(PUBLIC_KEY, false), { name: 'Ed25519' }, false, ['verify']);
    valid = await crypto.subtle.verify({ name: 'Ed25519' }, pub, signature, payload);
  } catch {
    return { ok: false, reason: '这个浏览器太旧，验证不了授权码。请换最新版 Chrome、Edge 或 Safari' };
  }
  if (!valid) return { ok: false, reason: '授权码不对（签名验证没通过）' };
  let info;
  try { info = JSON.parse(new TextDecoder().decode(payload)); } catch { return { ok: false, reason: '授权码内容读不出来' }; }
  const tier = info.tier >= 2 ? 'max' : info.tier >= 1 ? 'pro' : 'free';
  const expires = info.expires ? new Date(info.expires * 1000) : null;
  if (expires && expires < new Date()) return { ok: false, reason: `授权已于 ${expires.toLocaleDateString('zh-CN')} 到期` };
  if (info.id && revokedIds().has(info.id)) return { ok: false, reason: '这个授权码已被停用，如有疑问请联系购买渠道' };
  return { ok: true, id: info.id || null, tier, name: info.name || '', seats: info.seats || 1, serial: info.serial || null, expires };
}

// ── 停用名单（和电脑 / 手机版同一份：官网 revoked.json，VR1- 前缀、同一把私钥签名） ──
// 只收比本机记着的更新的名单（防止有人拿旧名单回放、把停用的码「复活」）。

const REVOKED_KEY = 'frmzone.revocations';
const REVOKED_PREFIX = 'VR1-';

async function verifySigned(text, prefix) {
  const key = (text || '').replace(/\s+/g, '');
  if (!key.startsWith(prefix)) return null;
  const parts = key.slice(prefix.length).split('.');
  if (parts.length !== 2) return null;
  try {
    const payload = fromB64(parts[0], true), signature = fromB64(parts[1], true);
    const pub = await crypto.subtle.importKey('raw', fromB64(PUBLIC_KEY, false), { name: 'Ed25519' }, false, ['verify']);
    if (!await crypto.subtle.verify({ name: 'Ed25519' }, pub, signature, payload)) return null;
    return JSON.parse(new TextDecoder().decode(payload));
  } catch { return null; }
}

let revokedCache = new Set();

/** 本机记着的停用 id（启动时 loadRevocations 验过签才算） */
export function revokedIds() { return revokedCache; }

/** 读本机记着的名单（验签） */
export async function loadRevocations() {
  let stored = null;
  try { stored = localStorage.getItem(REVOKED_KEY); } catch { /* 存储被禁用 */ }
  const list = stored ? await verifySigned(stored, REVOKED_PREFIX) : null;
  revokedCache = new Set(list?.ids || []);
  return list;
}

/** 联网拉官网名单：签名对、而且比本机的新才收；名单变了返回 true */
export async function refreshRevocations() {
  const current = await loadRevocations();
  let signed;
  try {
    const res = await fetch(new URL('../revoked.json', location.href), { cache: 'no-store' });
    if (!res.ok) return false;
    signed = (await res.json()).signed;
  } catch { return false; }
  const incoming = await verifySigned(signed, REVOKED_PREFIX);
  if (!incoming || (current && !(incoming.issued > current.issued))) return false;
  try { localStorage.setItem(REVOKED_KEY, signed.replace(/\s+/g, '')); } catch { /* 存不下就这次用 */ }
  revokedCache = new Set(incoming.ids || []);
  return true;
}
