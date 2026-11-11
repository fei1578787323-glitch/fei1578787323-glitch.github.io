import { AccountLoginController, normalizeEmail, normalizePhone } from './account-auth.mjs';

const ERROR_MESSAGES = {
  invalidRequest: '请检查登录信息和 6 位验证码。', invalidCode: '验证码不正确，请使用最近一次收到的验证码。',
  expired: '验证码或登录信息已过期，请重新获取验证码。', unauthorized: '登录已失效，请重新登录。',
  rateLimited: '操作较频繁，请稍后再试。', unavailable: '登录服务暂时不可用，可以继续使用本地提词。',
  invalidResponse: '登录信息校验失败，请重新登录。', network: '网络连接失败，请检查网络后重试。',
  timeout: '连接超时，请稍后重试。', storage: '浏览器无法保存登录信息，请检查隐私设置后重试。',
  cleanupStorage: '当前页面已停止使用登录信息，但本地记录未能清理。请点击清理重试。',
  unsupportedBrowser: '当前浏览器不支持安全保持会话，请更新浏览器后再登录。',
  logoutNetwork: '退出尚未完成，请连接网络后再次点击退出登录。'
};

export function mountAccountUI({ document: doc = document, controller, window: win = window } = {}) {
  const actions = doc.querySelector('.topbar-actions');
  if (!actions || win.location.hash === '#talent' || doc.getElementById('btnAccount')) return;
  if (!controller) {
    let storage;
    try { storage = win.sessionStorage; } catch {}
    controller = new AccountLoginController({ storage });
  }
  const button = doc.createElement('button');
  button.id = 'btnAccount'; button.className = 'chip'; button.type = 'button';
  button.setAttribute('aria-haspopup', 'dialog'); button.textContent = '登录';
  actions.append(button);
  const dialog = doc.createElement('dialog');
  dialog.id = 'accountDialog'; dialog.className = 'account-dialog'; dialog.setAttribute('aria-labelledby', 'accountTitle');
  dialog.innerHTML = `<div class="account-header"><h2 id="accountTitle">登录与账号</h2>
    <button class="account-close" type="button" aria-label="关闭账号窗口">×</button></div>
    <p class="account-subtitle">使用邮箱验证码登录 AI魔方提词器</p>
    <div class="account-methods" role="group" aria-label="登录方式" hidden>
      <button class="account-method-phone" type="button" aria-pressed="false">手机号登录</button>
      <button class="account-method-email" type="button" aria-pressed="true">邮箱登录</button></div>
    <p class="account-method-note" hidden>手机号和邮箱登录暂为独立账号，请沿用之前的登录方式。</p>
    <p class="account-status" role="status" aria-live="polite"></p>
    <p class="account-error" role="alert" hidden></p>
    <button class="account-retry" type="button" hidden>重新连接</button>
    <section class="account-profile" hidden><p class="account-name"></p><p class="account-detail"></p>
      <div class="account-row"><button type="button" class="account-refresh">刷新登录状态</button>
      <button type="button" class="account-logout">退出登录</button></div></section>
    <form class="account-form">
      <div class="account-email-group"><label for="accountEmail">邮箱地址</label><input id="accountEmail" type="email" autocomplete="email" inputmode="email" maxlength="254" placeholder="请输入常用邮箱" required></div>
      <div class="account-phone-group" hidden><label for="accountPhone">手机号码</label><div class="account-phone-row">
        <span class="account-country-code" aria-label="中国大陆区号 +86">+86</span>
        <input id="accountPhone" type="tel" autocomplete="tel-national" inputmode="tel" maxlength="32" placeholder="请输入 11 位中国大陆手机号"></div></div>
      <label for="accountCode">6 位验证码</label><div class="account-code-row">
        <input id="accountCode" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" placeholder="输入验证码" required>
        <button class="account-send" type="button">获取验证码</button></div>
      <p class="account-delivery">邮件由 login@mail.zntom.com 发出。如未收到，请检查垃圾邮件，并使用最新一封的验证码。</p>
      <label class="account-consent"><input id="accountConsent" type="checkbox">
        <span>我已阅读并同意 <a href="https://zntom.com/terms" target="_blank" rel="noopener noreferrer">用户协议</a> 和
        <a href="https://zntom.com/privacy" target="_blank" rel="noopener noreferrer">隐私政策</a></span></label>
      <button class="account-submit" type="submit">验证码登录</button>
    </form>
    <p class="account-footnote">刷新当前标签页可恢复登录；关闭标签页后需重新登录。稿件仍保存在当前浏览器中。</p>
    <button class="account-local" type="button">继续使用本地提词</button>`;
  doc.body.append(dialog);
  const $ = selector => dialog.querySelector(selector);
  const email = $('#accountEmail'), phone = $('#accountPhone'), code = $('#accountCode'), consent = $('#accountConsent');
  const form = $('.account-form'), send = $('.account-send'), submit = $('.account-submit');
  let wasSignedIn = false;
  function render(state = controller.state) {
    const busy = !!state.busy, profile = !!state.session || state.restorePending, phoneMode = state.method === 'phone';
    button.textContent = controller.signedIn ? '我的账号' : '登录';
    $('.account-profile').hidden = !profile;
    form.hidden = profile;
    $('.account-methods').hidden = profile || !state.capabilities?.phone || !state.capabilities?.email;
    $('.account-method-note').hidden = $('.account-methods').hidden;
    $('.account-method-phone').hidden = !state.capabilities?.phone;
    $('.account-method-email').hidden = !state.capabilities?.email;
    $('.account-method-phone').disabled = busy || state.cleanupPending;
    $('.account-method-email').disabled = busy || state.cleanupPending;
    $('.account-method-phone').setAttribute('aria-pressed', String(phoneMode));
    $('.account-method-email').setAttribute('aria-pressed', String(!phoneMode));
    $('.account-email-group').hidden = phoneMode;
    $('.account-phone-group').hidden = !phoneMode;
    $('.account-subtitle').textContent = profile ? '管理 AI魔方提词器账号' : phoneMode ? '使用短信验证码登录 AI魔方提词器' : '使用邮箱验证码登录 AI魔方提词器';
    $('.account-delivery').textContent = phoneMode ? '短信验证码有效期 5 分钟。如未收到，请确认号码并检查短信拦截设置。' :
      '邮件由 login@mail.zntom.com 发出。如未收到，请检查垃圾邮件，并使用最新一封的验证码。';
    $('.account-name').textContent = state.session?.user.displayName || '正在恢复登录';
    $('.account-detail').textContent = controller.signedIn ? '账号已登录' : '需要连接服务器确认登录状态';
    $('.account-refresh').disabled = busy;
    $('.account-logout').disabled = busy;
    $('.account-logout').textContent = state.busy === 'logout' ? '正在退出…' : '退出登录';
    $('.account-error').hidden = !state.error;
    $('.account-error').textContent = ERROR_MESSAGES[state.error] || (state.error ? '操作未完成，请稍后再试。' : '');
    $('.account-status').textContent = ({ loading: '正在连接登录服务…', sending: '正在发送验证码…',
      login: '正在验证…', refreshing: '正在确认登录状态…', logout: '正在退出…', cleanup: '正在清理本地登录信息…' })[state.busy] || state.message;
    $('.account-retry').hidden = !state.cleanupPending && (!state.error || profile || controller.hasLoginMethods);
    $('.account-retry').textContent = state.cleanupPending ? '清理本地登录信息' : '重新连接';
    $('.account-retry').disabled = busy;
    email.disabled = busy || phoneMode; email.required = !phoneMode;
    phone.disabled = busy || !phoneMode; phone.required = phoneMode;
    code.disabled = busy; consent.disabled = busy;
    const validIdentifier = phoneMode ? normalizePhone(phone.value) : normalizeEmail(email.value);
    send.disabled = busy || state.cleanupPending || !controller.methodAvailable || !consent.checked || !validIdentifier || controller.resendSeconds > 0;
    send.textContent = controller.resendSeconds > 0 ? `${controller.resendSeconds} 秒后重发` : state.busy === 'sending' ? '发送中…' : state.challenge ? '重新发送' : '获取验证码';
    submit.disabled = busy || state.cleanupPending || !controller.methodAvailable || !consent.checked || !state.challenge ||
      state.challenge.expiresAt <= controller.now() || !/^\d{6}$/.test(code.value);
    submit.textContent = state.busy === 'login' ? '正在登录…' : '验证码登录';
    if (controller.signedIn && !wasSignedIn) code.value = '';
    wasSignedIn = controller.signedIn;
  }
  const unsubscribe = controller.subscribe(render);
  button.addEventListener('click', () => { dialog.showModal(); render(); });
  $('.account-close').addEventListener('click', () => dialog.close());
  $('.account-local').addEventListener('click', () => dialog.close());
  email.addEventListener('input', () => { controller.setEmail(email.value); code.value = ''; render(); });
  phone.addEventListener('input', () => { controller.setPhone(phone.value); code.value = ''; render(); });
  for (const method of ['phone', 'email']) $('.account-method-' + method).addEventListener('click', () => {
    if (controller.setMethod(method)) { code.value = ''; render(); (method === 'phone' ? phone : email).focus(); }
  });
  code.addEventListener('input', () => { code.value = code.value.replace(/\D/g, '').slice(0, 6); render(); });
  consent.addEventListener('change', () => render());
  send.addEventListener('click', async () => {
    const input = controller.state.method === 'phone' ? phone : email;
    if (!input.reportValidity()) return;
    await controller.sendCode(input.value, consent.checked); render();
  });
  form.addEventListener('submit', async event => { event.preventDefault(); await controller.login(code.value, consent.checked); render(); });
  $('.account-retry').addEventListener('click', () => controller.state.cleanupPending ? controller.retryCleanup() : controller.initialize());
  $('.account-refresh').addEventListener('click', () => controller.refresh());
  $('.account-logout').addEventListener('click', async () => { await controller.logout(); render(); });
  const timer = win.setInterval(() => { if (doc.visibilityState !== 'hidden') { void controller.tick(); render(); } }, 1000);
  const foreground = () => { if (doc.visibilityState === 'visible') { void controller.tick(); render(); } };
  doc.addEventListener('visibilitychange', foreground);
  const dispose = () => { win.clearInterval(timer); unsubscribe(); controller.dispose(); doc.removeEventListener('visibilitychange', foreground); };
  win.addEventListener('pagehide', event => { if (!event.persisted) dispose(); });
  void controller.initialize();
  return { controller, dialog, dispose };
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') mountAccountUI();
