// First-party email/phone authentication. No AI calls, cookies, localStorage or manuscript access.
export const ACCOUNT_AUTH_URL = 'https://account.zntom.com/v1/auth/';
export const ACCOUNT_SESSION_KEY = 'aicube.web.account.session.v1';
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const ID = /^[A-Za-z0-9_-]{1,128}$/;
export class AccountAuthError extends Error {
  constructor(code) { super(code); this.name = 'AccountAuthError'; this.code = code; }
}
export function normalizeEmail(value) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}
export function normalizePhone(value) {
  if (typeof value !== 'string' || value.length > 64 || /[\r\n]/.test(value)) return '';
  let number = value.normalize('NFKC').trim().replace(/[ ()-]/g, '');
  if (number.startsWith('+86')) number = number.slice(3);
  else if (number.startsWith('0086')) number = number.slice(4);
  else if (number.length === 13 && number.startsWith('86')) number = number.slice(2);
  return /^1[3-9]\d{9}$/.test(number) ? '+86' + number : '';
}
function validChallenge(value, now) {
  if (typeof value?.id !== 'string' || !ID.test(value.id) || !Number.isSafeInteger(value.expiresAt) ||
      !Number.isSafeInteger(value.retryAt) || value.expiresAt <= now || value.retryAt > value.expiresAt) {
    throw new AccountAuthError('invalidResponse');
  }
  return { id: value.id, expiresAt: value.expiresAt, retryAt: value.retryAt };
}
function validSession(value, now, allowExpired = false) {
  if (!value || typeof value.user?.id !== 'string' || !ID.test(value.user.id) ||
      typeof value.user.displayName !== 'string' || value.user.displayName.length > 254 ||
      !TOKEN.test(value.accessToken ?? '') || !TOKEN.test(value.refreshToken ?? '') ||
      !Number.isSafeInteger(value.expiresAt) || value.expiresAt <= 0 || (!allowExpired && value.expiresAt <= now)) {
    throw new AccountAuthError('invalidResponse');
  }
  return { user: { id: value.user.id, displayName: value.user.displayName },
    accessToken: value.accessToken, refreshToken: value.refreshToken, expiresAt: value.expiresAt };
}

export class AccountAuthClient {
  constructor({ fetchImpl = (...args) => globalThis.fetch(...args), now = () => Date.now() / 1000 } = {}) {
    this.fetch = fetchImpl; this.now = now;
  }
  async request(path, body) {
    const signal = AbortSignal.timeout(25000);
    let reader;
    try {
      const response = await this.fetch(ACCOUNT_AUTH_URL + path, {
        method: body === undefined ? 'GET' : 'POST', credentials: 'omit', cache: 'no-store',
        redirect: 'error', referrerPolicy: 'no-referrer', signal,
        headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
      if (path === 'session/revoke') {
        if (response.status === 204) return;
        if (response.status === 200) throw new AccountAuthError('invalidResponse');
      }
      if (response.status !== 200) throw new AccountAuthError(({ 400: 'invalidRequest', 401: 'unauthorized',
        403: 'unavailable', 410: 'expired', 422: 'invalidCode', 429: 'rateLimited' })[response.status] ?? 'unavailable');
      if (!response.body || response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json' ||
          Number(response.headers.get('content-length')) > 32768) throw new AccountAuthError('invalidResponse');
      reader = response.body.getReader();
      const chunks = []; let length = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > 32768) throw new AccountAuthError('invalidResponse');
        chunks.push(value);
      }
      const bytes = new Uint8Array(length); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
      catch { throw new AccountAuthError('invalidResponse'); }
    } catch (error) {
      if (error instanceof AccountAuthError) throw error;
      throw new AccountAuthError(signal.aborted ? 'timeout' : 'network');
    } finally {
      if (reader) { try { await reader.cancel(); } catch {} reader.releaseLock(); }
    }
  }
  async capabilities() {
    const flags = await this.request('capabilities');
    if (!flags || ['email', 'apple', 'ai'].some(key => typeof flags[key] !== 'boolean') ||
        (flags.phone !== undefined && typeof flags.phone !== 'boolean')) throw new AccountAuthError('invalidResponse');
    return { email: flags.email, phone: flags.phone === true, apple: flags.apple, ai: flags.ai };
  }
  async sendCode(email) {
    if (!normalizeEmail(email)) throw new AccountAuthError('invalidRequest');
    return validChallenge(await this.request('email/challenges', { email: normalizeEmail(email) }), this.now());
  }
  async verifyCode(email, code, challengeID) {
    if (!normalizeEmail(email) || !/^\d{6}$/.test(code) || typeof challengeID !== 'string' || !ID.test(challengeID)) throw new AccountAuthError('invalidRequest');
    return validSession(await this.request('email/session', { email: normalizeEmail(email), code, challengeID }), this.now());
  }
  async sendPhoneCode(phone) {
    if (!normalizePhone(phone)) throw new AccountAuthError('invalidRequest');
    return validChallenge(await this.request('phone/challenges', { phone: normalizePhone(phone) }), this.now());
  }
  async verifyPhoneCode(phone, code, challengeID) {
    if (!normalizePhone(phone) || !/^\d{6}$/.test(code) || typeof challengeID !== 'string' || !ID.test(challengeID)) throw new AccountAuthError('invalidRequest');
    return validSession(await this.request('phone/session', { phone: normalizePhone(phone), code, challengeID }), this.now());
  }
  async refresh(refreshToken) {
    if (!TOKEN.test(refreshToken)) throw new AccountAuthError('invalidRequest');
    return validSession(await this.request('session/refresh', { refreshToken }), this.now());
  }
  async logout(refreshToken) {
    if (!TOKEN.test(refreshToken)) throw new AccountAuthError('invalidRequest');
    await this.request('session/revoke', { refreshToken });
  }
}

// Keep one tab in charge of each rotating session. Duplicating a tab can clone sessionStorage.
// A copied tab must not replay the original tab's refresh token and revoke that session.
export function browserSessionLease(locks = globalThis.navigator?.locks) {
  return async id => {
    if (!locks?.request) throw new AccountAuthError('unsupportedBrowser');
    return new Promise((resolve, reject) => {
      locks.request('aicube-account-' + id, { ifAvailable: true }, async lock => {
        if (!lock) { resolve(null); return; }
        await new Promise(release => resolve(release));
      }).catch(() => reject(new AccountAuthError('storage')));
    });
  };
}

export class AccountLoginController {
  constructor({ client = new AccountAuthClient(), storage, now = () => Date.now() / 1000,
    acquireLease = browserSessionLease(), newID = () => crypto.randomUUID() } = {}) {
    this.client = client; this.storage = storage; this.now = now; this.acquireLease = acquireLease; this.newID = newID;
    this.state = { capabilities: null, session: null, challenge: null, method: 'email', email: '', phone: '', busy: '', error: '', message: '', restorePending: false, cleanupPending: false };
    this.listeners = new Set(); this.releaseLease = null; this.record = null; this.retryAfter = 0; this.resendAt = 0;
  }
  subscribe(listener) { this.listeners.add(listener); listener(this.state); return () => this.listeners.delete(listener); }
  update(values) { Object.assign(this.state, values); for (const listener of this.listeners) listener(this.state); }
  get signedIn() { return !!this.state.session && this.state.session.expiresAt > this.now(); }
  get resendSeconds() { return Math.max(0, Math.ceil(this.resendAt - this.now())); }
  get methodAvailable() { return this.state.capabilities?.[this.state.method] === true; }
  get hasLoginMethods() { return this.state.capabilities?.email === true || this.state.capabilities?.phone === true; }
  setMethod(method) {
    if (!['email', 'phone'].includes(method) || this.state.busy || this.record || !this.state.capabilities?.[method]) return false;
    if (method !== this.state.method) this.update({ method, challenge: null, error: '', message: '' });
    return true;
  }
  setEmail(email) {
    if (this.state.busy || this.state.session) return;
    if (normalizeEmail(email) !== this.state.email) this.update({ email: normalizeEmail(email), challenge: null, error: '', message: '' });
  }
  setPhone(phone) {
    if (this.state.busy || this.state.session) return;
    if (normalizePhone(phone) !== this.state.phone) this.update({ phone: normalizePhone(phone), challenge: null, error: '', message: '' });
  }
  writeRecord(record) {
    try { this.storage.setItem(ACCOUNT_SESSION_KEY, JSON.stringify(record)); }
    catch { throw new AccountAuthError('storage'); }
  }
  clearRecord() {
    let failed = false;
    try { this.storage.removeItem(ACCOUNT_SESSION_KEY); } catch { failed = true; }
    this.record = null; this.releaseLease?.(); this.releaseLease = null;
    this.update({ session: null, restorePending: false, cleanupPending: failed });
    if (failed) throw new AccountAuthError('cleanupStorage');
  }
  async run(label, operation) {
    if (this.state.busy) return false;
    this.update({ busy: label, error: '' });
    try { await operation(); return true; }
    catch (error) { this.update({ error: error instanceof AccountAuthError ? error.code : 'network' }); return false; }
    finally { this.update({ busy: '' }); }
  }
  async initialize() {
    if (this.state.cleanupPending) return this.retryCleanup();
    return this.run('loading', async () => {
      this.update({ capabilities: null });
      this.update({ capabilities: await this.client.capabilities() });
      if (!this.methodAvailable) {
        this.update({ ...(this.hasLoginMethods ? { method: this.state.capabilities.email ? 'email' : 'phone' } : {}), challenge: null });
      }
      if (this.state.session) return;
      if (!this.record) {
        let raw;
        try { raw = this.storage.getItem(ACCOUNT_SESSION_KEY); }
        catch { throw new AccountAuthError('storage'); }
        if (!raw) { if (!this.hasLoginMethods) this.update({ error: 'unavailable' }); return; }
        try {
          const record = JSON.parse(raw);
          if (record.version !== 1 || typeof record.leaseID !== 'string' || !ID.test(record.leaseID)) throw new Error();
          this.record = { version: 1, leaseID: record.leaseID, session: validSession(record.session, this.now(), true) };
        } catch { this.clearRecord(); this.update({ message: '保存的登录信息已失效，请重新登录。' }); return; }
      }
      if (!this.releaseLease) this.releaseLease = await this.acquireLease(this.record.leaseID);
      if (!this.releaseLease) {
        this.clearRecord(); this.update({ message: '这个账号会话正在另一个标签页使用。请在这里单独登录。' }); return;
      }
      this.update({ restorePending: true });
      await this.rotate();
    });
  }
  async sendCode(identifier, consent) {
    const method = this.state.method;
    const normalized = method === 'phone' ? normalizePhone(identifier) : normalizeEmail(identifier);
    if (!consent || !normalized || !this.methodAvailable || this.resendSeconds > 0 || this.record || this.state.cleanupPending) return false;
    return this.run('sending', async () => {
      const challenge = method === 'phone' ? await this.client.sendPhoneCode(normalized) : await this.client.sendCode(normalized);
      this.resendAt = challenge.retryAt;
      this.update({ [method]: normalized, challenge: { ...challenge, method, identifier: normalized },
        message: method === 'phone' ? '短信验证码已发送，有效期 5 分钟。' : '验证码已发送，有效期 5 分钟。收不到时请检查垃圾邮件。' });
    });
  }
  async login(code, consent) {
    const challenge = this.state.challenge;
    const method = this.state.method;
    if (!consent || !this.methodAvailable || !challenge || challenge.method !== method || challenge.identifier !== this.state[method] ||
        !/^\d{6}$/.test(code) || this.record || this.state.cleanupPending) return false;
    if (challenge.expiresAt <= this.now()) { this.update({ error: 'expired' }); return false; }
    return this.run('login', async () => {
      const leaseID = this.newID();
      const release = await this.acquireLease(leaseID);
      if (!release) throw new AccountAuthError('storage');
      let session;
      try {
        session = method === 'phone' ? await this.client.verifyPhoneCode(this.state.phone, code, challenge.id) :
          await this.client.verifyCode(this.state.email, code, challenge.id);
        const record = { version: 1, leaseID, session };
        try { this.writeRecord(record); }
        catch (error) { try { await this.client.logout(session.refreshToken); } catch {} throw error; }
        this.record = record; this.releaseLease = release;
        this.update({ session, challenge: null, restorePending: false, message: '登录成功。' });
      } finally { if (!this.record) release(); }
    });
  }
  async rotate() {
    const previous = this.record?.session;
    if (!previous) return;
    let session;
    try {
      session = await this.client.refresh(previous.refreshToken);
      if (session.user.id !== previous.user.id || session.refreshToken === previous.refreshToken || session.accessToken === previous.accessToken) {
        throw new AccountAuthError('invalidResponse');
      }
      this.writeRecord({ ...this.record, session });
      this.record.session = session;
      this.update({ session, restorePending: false, message: '登录状态已更新。' });
    } catch (error) {
      this.retryAfter = this.now() + 30;
      if (session || ['unauthorized', 'expired', 'invalidResponse', 'storage'].includes(error.code)) {
        // A received but unusable rotated token must not leave an active orphaned session.
        if (session) { try { await this.client.logout(session.refreshToken); } catch {} }
        this.clearRecord(); this.update({ session: null, restorePending: false });
      } else this.update({ restorePending: !this.signedIn });
      throw error;
    }
  }
  async refresh({ automatic = false } = {}) {
    if (!this.record || (automatic && this.retryAfter > this.now())) return false;
    return this.run('refreshing', () => this.rotate());
  }
  async tick() {
    if (this.record && this.state.session && this.state.session.expiresAt <= this.now() + 60) {
      await this.refresh({ automatic: true });
    }
  }
  async logout() {
    if (!this.record) return false;
    return this.run('logout', async () => {
      try { await this.client.logout(this.record.session.refreshToken); }
      catch (error) { throw new AccountAuthError(error.code === 'network' || error.code === 'timeout' ? 'logoutNetwork' : error.code); }
      // Server revocation is already complete. Drop memory even if browser storage removal fails.
      this.update({ message: '已退出登录。', challenge: null });
      this.clearRecord();
      this.update({ session: null, restorePending: false, challenge: null, message: '已退出登录。' });
    });
  }
  async retryCleanup() {
    if (!this.state.cleanupPending) return false;
    return this.run('cleanup', async () => {
      this.clearRecord();
      this.update({ message: '本地登录信息已清理。' });
    });
  }
  dispose() { this.releaseLease?.(); this.releaseLease = null; this.listeners.clear(); }
}
