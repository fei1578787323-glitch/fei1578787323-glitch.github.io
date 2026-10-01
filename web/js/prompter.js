// 提词画面：滚动用 translate3d 按小数像素平移（不取整，才丝滑），每帧 requestAnimationFrame 推进。
// 四种模式：智能跟读（语音识别对位）、匀速、声控（有声音才走）、手动（滚轮 / 拖动 / 方向键）。
import { renderScript, indexUnits, clock, estimateSeconds } from './markup.js';
import { align, Listener, VoiceGate, FollowPacer, ReadingRate, FollowGlide } from './follow.js';
import * as store from './store.js';

const MODE_NAMES = { follow: '智能跟读', auto: '匀速滚动', voice: '声控滚动', manual: '手动' };
// 工具条上模式名前面的小图标（和电脑版一样：跟读是声波、匀速是向下箭头、声控是麦克风、手动是手）
const MODE_ICONS = {
  follow: '<path d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4"/>',
  auto: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v9M8.5 13l3.5 3.5 3.5-3.5"/>',
  voice: '<rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5"/>',
  manual: '<path d="M8 13V6.5a1.5 1.5 0 0 1 3 0V12M11 11V5a1.5 1.5 0 0 1 3 0v6M14 11V6.5a1.5 1.5 0 0 1 3 0V14a6 6 0 0 1-6 6h-.5A5.5 5.5 0 0 1 6 16.5L4.6 13a1.4 1.4 0 0 1 2.4-1.3L8 13"/>',
};
// 提词画面可能被搬进浮窗（画中画窗口的另一个 document），找元素时两边都找
let DOC = document;
const $ = (id) => DOC.getElementById(id) || document.getElementById(id);
export const findEl = $;
/** 浏览器支持把网页内容放进始终置顶的浮窗（目前是电脑版 Chrome / Edge） */
export const PIP_SUPPORTED = 'documentPictureInPicture' in window;
/** 手机、平板这类没有实体键盘的设备：提示里不说「空格」 */
const TOUCH = window.matchMedia?.('(pointer: coarse)').matches ?? false;

export class Prompter {
  constructor({ isUnlimited, onQuotaOut, onSettings, toast, onState, onClose }) {
    this.isUnlimited = isUnlimited;
    this.onQuotaOut = onQuotaOut;
    this.onSettings = onSettings;
    this.toast = toast;
    /** 双窗口时主持窗口把进度报给导播窗口 */
    this.onState = onState || null;
    this.onClose = onClose || null;
    /** 当前所在的窗口：平时是本页，浮窗打开后是浮窗 */
    this.win = window;
    this.pipWin = null;
    this.fontScale = 1;
    this.floatCarry = 0;
    this.stateAt = 0;
    this.el = $('prompter');
    this.stage = $('stage');
    this.content = $('content');
    this.playing = false;
    this.offset = 0;
    this.pos = 0;
    this.elapsed = 0;
    this.raf = 0;
    this.listener = null;
    this.gate = null;
    this.quotaCarry = 0;
    this.followState = '';
    this.idleTimer = 0;
    this.wakeLock = null;
    this.bind();
  }

  // ── 打开 / 关闭 ──

  open(script, settings) {
    this.script = script;
    this.s = settings;
    this.el.hidden = false;
    document.body.style.overflow = 'hidden';
    $('pTitle').textContent = script.title || '未命名稿件';
    renderScript(script.body, this.content);
    this.units = indexUnits(this.content);
    this.buildSentences();
    this.estimate = estimateSeconds(script.body);
    this.elapsed = 0;
    this.pos = 0;
    this.started = false;
    this.applySettings();
    this.layout();
    this.offset = this.startOffset;
    this.paint();
    this.syncControls();
    this.poke();
    this.observeResize();
    this.loop();
    this.sendParas();
  }

  observeResize() {
    this.ro?.disconnect();
    this.ro = new this.win.ResizeObserver(() => this.relayout());
    this.ro.observe(this.stage);
  }

  close() {
    if (this.pipWin) { this.closingAll = true; this.pipWin.close(); }
    this.pause();
    this.win.cancelAnimationFrame(this.raf);
    this.ro?.disconnect();
    this.el.hidden = true;
    $('drawer').hidden = true;
    document.body.style.overflow = '';
    if (document.fullscreenElement) document.exitFullscreen?.();
    this.clearHighlight();
    this.onClose?.();
  }

  get isOpen() { return !this.el.hidden; }

  // ── 设置 ──

  applySettings() {
    const s = this.s, st = this.el.style;
    st.setProperty('--p-size', s.fontSize * this.fontScale + 'px');
    st.setProperty('--p-line', s.lineHeight);
    st.setProperty('--p-margin', s.margin + 'vw');
    st.setProperty('--p-align', s.center ? 'center' : 'left');
    st.setProperty('--p-fg', s.fg);
    st.setProperty('--p-bg', s.bg);
    st.setProperty('--p-linepos', s.linePos);
    this.el.classList.toggle('mirror-h', s.mirrorH);
    this.el.classList.toggle('mirror-v', s.mirrorV);
    $('readingLine').hidden = !s.showLine;
    $('pTimer').hidden = !s.timer;
    this.lastBandKey = null;
    if (!s.dim) {
      this.clearHighlight();
      this.content.querySelectorAll('p.read').forEach(p => p.classList.remove('read'));
    }
  }

  /** 设置改了（字号、行距…）：重新排版，保持读到的位置 */
  update(settings) {
    const keepUnit = this.unitAtReadingLine();
    this.s = settings;
    this.applySettings();
    this.layout();
    if (this.s.mode === 'follow') this.offset = this.targetFor(this.pos);
    else if (keepUnit != null) this.offset = this.targetFor(keepUnit);
    this.clamp();
    this.lastDimKey = null;
    this.paint();
    this.syncControls();
  }

  relayout() {
    if (!this.isOpen) return;
    const keep = this.s.mode === 'follow' ? this.pos : this.unitAtReadingLine();
    this.layout();
    if (keep != null) this.offset = this.targetFor(keep);
    this.clamp();
    this.paint();
  }

  layout() {
    this.layoutRev = (this.layoutRev || 0) + 1;
    const h = this.stage.clientHeight;
    this.readingY = h * this.s.linePos;
    this.lineH = this.s.fontSize * this.fontScale * this.s.lineHeight;
    this.content.querySelector('.pad-top').style.height = h + 'px';
    this.content.querySelector('.pad-bottom').style.height = h + 'px';
    const lines = [...this.content.querySelectorAll('p:not(.gap)')];
    this.lines = lines;
    const first = lines[0], last = lines[lines.length - 1];
    this.startOffset = first ? first.offsetTop + this.lineH / 2 - this.readingY : 0;
    this.endOffset = last ? last.offsetTop + last.offsetHeight - this.lineH / 2 - this.readingY : 0;
  }

  // ── 位置换算 ──

  /** 某个单位（字）中心在内容里的高度（不受镜像影响） */
  unitCenter(i) {
    const u = this.units[Math.max(0, Math.min(this.units.length - 1, i))];
    if (!u) return this.startOffset + this.readingY;
    const r = this.el.ownerDocument.createRange();
    r.setStart(u.node, u.off);
    r.setEnd(u.node, u.off + u.len);
    const rr = r.getBoundingClientRect(), lr = u.line.getBoundingClientRect();
    // 上下镜像时整块倒过来，行内的相对位置要反着算
    const rel = this.s.mirrorV ? (lr.bottom - rr.bottom) : (rr.top - lr.top);
    return u.line.offsetTop + rel + rr.height / 2;
  }

  targetFor(i) {
    // 同一个字、同一次排版只量一次（跟读时每帧都要用）
    const key = i + '|' + this.layoutRev;
    if (this.targetKey !== key) { this.targetKey = key; this.targetVal = this.unitCenter(i) - this.readingY; }
    return this.targetVal;
  }

  // ── 智能跟读连续滚动（见 follow.js 的 FollowPacer / FollowGlide） ──

  /** 第 i 个单位中心对准阅读线时的滚动位置（同一次排版缓存） */
  centerOffset(i) {
    if (this.centerRev !== this.layoutRev) { this.centerRev = this.layoutRev; this.centers = new Map(); }
    let v = this.centers.get(i);
    if (v === undefined) { v = this.unitCenter(i) - this.readingY; this.centers.set(i, v); }
    return v;
  }

  /** 第 i 个单位所在的那一行（屏幕上的一行，不是段落）：起止、锚点（行中间）、这行在阅读线上时的滚动位置 */
  visualLine(i) {
    const n = this.units.length;
    const y = this.centerOffset(i);
    const same = (k) => Math.abs(this.centerOffset(k) - y) < Math.max(2, this.lineH * 0.3);
    let s = i, e = i + 1;
    while (s > 0 && same(s - 1)) s--;
    while (e < n && same(e)) e++;
    return { start: s, end: e, anchor: (s + e) / 2, y };
  }

  /** 读到第 p 个单位（带小数）→ 滚动位置：每行中间那个字时这一行正好在阅读线上，两行之间按字数插值 */
  glideY(p) {
    const n = this.units.length;
    const here = this.visualLine(Math.max(0, Math.min(n - 1, Math.floor(p))));
    if (p >= here.anchor) {
      if (here.end >= n) return here.y;
      const next = this.visualLine(here.end);
      const t = (p - here.anchor) / Math.max(0.5, next.anchor - here.anchor);
      return here.y + Math.min(1, Math.max(0, t)) * (next.y - here.y);
    }
    if (here.start <= 0) return here.y;
    const prev = this.visualLine(here.start - 1);
    const t = (p - prev.anchor) / Math.max(0.5, here.anchor - prev.anchor);
    return prev.y + Math.min(1, Math.max(0, t)) * (here.y - prev.y);
  }

  /** 第 k 个单位后面是不是句末（句号、问号、感叹号、换段） */
  endsSentence(k) {
    const u = this.units[k], v = this.units[k + 1];
    if (!u || !v) return true;
    if (u.line !== v.line) return true;
    const gap = u.node === v.node ? u.node.data.slice(u.off + u.len, v.off)
      : u.node.data.slice(u.off + u.len) + v.node.data.slice(0, v.off);
    return /[。！？!?…]/.test(gap);
  }

  followGlideStep(dt, now) {
    const n = this.units.length;
    if (!this.glide) { this.glide = new FollowGlide(); this.pacer = new FollowPacer(); this.rateMeter = new ReadingRate(); this.glide.reset(this.offset); }
    // 滚动位置被别处改了（拖动、点字跳转、改字号）：从当前位置重新起步
    if (Math.abs(this.offset - this.glide.y) > 0.5) { this.glide.reset(this.offset); this.rateMeter.reset(); this.pacer.reset(this.pos, now); }
    let target, nominal = 0;
    if (!n || this.pos >= n) target = this.endOffset;
    else {
      const p = this.pacer.step(this.pos, now, dt, (k) => this.endsSentence(k));
      target = this.glideY(p);
      const perUnit = (this.glideY(Math.min(n - 1, p + 2)) - target) / 2;
      nominal = this.rateMeter.feed(this.pos, now) * Math.max(0, perUnit);
    }
    this.offset = Math.min(this.endOffset, this.glide.step(target, nominal, dt, this.lineH * 2.5));
    this.glide.y = this.offset;
  }

  /** 阅读线上现在是第几个字（按行找，够用） */
  unitAtReadingLine() {
    if (!this.units?.length) return null;
    const y = this.offset + this.readingY;
    let best = 0;
    for (let i = 0; i < this.units.length; i++) {
      const line = this.units[i].line;
      if (line.offsetTop + line.offsetHeight < y) best = i + 1;
      else break;
    }
    return Math.min(best, this.units.length - 1);
  }

  clamp() {
    this.offset = Math.max(this.startOffset, Math.min(this.endOffset, this.offset));
  }

  // ── 播放 ──

  toggle() { this.playing ? this.pause() : this.play(); }

  async play() {
    if (this.playing || this.counting) return;
    if (this.s.mode === 'follow' && !this.isUnlimited() && store.followLeft() <= 0) {
      this.onQuotaOut();
      this.setMode('auto');
    }
    if (this.offset >= this.endOffset - 1 && this.s.mode !== 'manual') this.restart();
    if (!this.started && this.s.countdown > 0) {
      this.counting = true;
      const cd = $('countdown');
      cd.hidden = false;
      for (let n = this.s.countdown; n > 0; n--) {
        cd.textContent = n;
        await new Promise(r => setTimeout(r, 1000));
        if (!this.isOpen) { cd.hidden = true; this.counting = false; return; }
      }
      cd.hidden = true;
      this.counting = false;
    }
    this.started = true;
    this.playing = true;
    this.startInputs();
    this.requestWakeLock();
    this.syncControls();
    this.poke();
  }

  pause() {
    this.playing = false;
    this.stopInputs();
    this.releaseWakeLock();
    this.syncControls();
    this.poke();
  }

  restart() {
    this.pos = 0;
    this.offset = this.startOffset;
    this.elapsed = 0;
    this.started = false;
    this.lastDimKey = null;
    this.paint();
  }

  setMode(mode) {
    const wasPlaying = this.playing;
    if (wasPlaying) this.stopInputs();
    if (mode === 'follow') this.pos = this.unitAtReadingLine() ?? 0;
    this.s.mode = mode;
    this.onSettings(this.s);
    if (wasPlaying) this.startInputs();
    this.lastDimKey = null;
    this.syncControls();
  }

  async startInputs() {
    if (this.s.mode === 'follow') {
      if (!Listener.supported) {
        this.followState = 'unsupported';
        this.toast('这个浏览器不支持语音识别，请用 Chrome、Edge 或 Safari；已改用匀速滚动');
        this.setMode('auto');
        return;
      }
      this.listener = new Listener({
        lang: this.s.lang,
        onHeard: (heard) => this.heard(heard),
        onState: (st) => {
          this.followState = st;
          if (st === 'denied') {
            this.toast('没有麦克风权限：请在浏览器地址栏旁边允许使用麦克风');
            this.pause();
          } else if (st === 'unreachable') {
            // 连不上识别服务：不让画面干等着，先改用声控滚动（说话就走、停下就停，不用联网）
            const edge = /Edg\//.test(navigator.userAgent), safari = /Safari\//.test(navigator.userAgent) && !/Chrome\//.test(navigator.userAgent);
            this.toast(edge || safari
              ? '语音识别服务连不上，请检查网络；已先改用声控滚动'
              : '这个浏览器的语音识别连不上（国内用 Chrome 常见），智能跟读请换 Edge 或 Safari 打开；已先改用声控滚动', 7000);
            this.setMode('voice');
          }
          this.syncStatus();
        },
      });
      this.listener.start();
    } else if (this.s.mode === 'voice') {
      this.gate = new VoiceGate();
      const ok = await this.gate.start();
      if (!ok) {
        this.toast('没有麦克风权限，声控用不了：请在浏览器里允许使用麦克风');
        this.gate = null;
        this.pause();
      }
    }
  }

  stopInputs() {
    this.listener?.stop();
    this.listener = null;
    this.gate?.stop();
    this.gate = null;
    this.followState = '';
  }

  /** 听到了一串字：在稿子里找位置 */
  heard(units) {
    if (!this.playing || this.s.mode !== 'follow') return;
    const hit = align(this.units, this.pos, units);
    if (hit && hit.pos !== this.pos) {
      this.pos = Math.min(hit.pos, this.units.length);
    }
  }

  // ── 每一帧 ──

  loop() {
    // 用画面所在窗口的 requestAnimationFrame：放进浮窗后本页被挡住也照样每帧推进
    this.win.cancelAnimationFrame(this.raf);
    const win = this.win;
    let last = performance.now();
    const frame = (now) => {
      if (win !== this.win) return;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      this.tick(dt, now / 1000);
      this.raf = win.requestAnimationFrame(frame);
    };
    this.raf = win.requestAnimationFrame(frame);
  }

  tick(dt, now) {
    if (!this.isOpen) return;
    const mode = this.s.mode;
    const pxPerSec = this.s.speed * (this.s.fontSize / 56) * 1.2;
    if (this.playing) {
      this.elapsed += dt;
      if (mode === 'auto') {
        this.offset += pxPerSec * dt;
      } else if (mode === 'voice' && this.gate) {
        this.offset += pxPerSec * this.gate.step(dt, now) * dt;
      } else if (mode === 'follow') {
        this.followGlideStep(dt, now);
        if (!this.isUnlimited()) {
          this.quotaCarry += dt;
          if (this.quotaCarry >= 1) {
            store.consumeFollow(Math.floor(this.quotaCarry));
            this.quotaCarry -= Math.floor(this.quotaCarry);
            if (store.followLeft() <= 0) {
              this.setMode('auto');
              this.onQuotaOut();
            }
          }
        }
      }
      // 免费版浮窗每天 20 分钟：播放中才算
      if (this.pipWin && !this.isUnlimited()) {
        this.floatCarry += dt;
        if (this.floatCarry >= 1) {
          store.consumeFloat(Math.floor(this.floatCarry));
          this.floatCarry -= Math.floor(this.floatCarry);
          if (store.floatLeft() <= 0) {
            this.toast('免费版今天的浮窗时间用完了，已放回网页里；明天零点恢复');
            this.pipWin.close();
          }
        }
      }
      if (mode !== 'manual' && mode !== 'follow' && this.offset >= this.endOffset) {
        this.offset = this.endOffset;
        this.pause();
        this.toast('已到结尾，按 R 从头开始');
      }
    }
    this.clamp();
    this.paint();
    if (this.onState && now - this.stateAt > 0.2) { this.stateAt = now; this.onState(this.snapshot()); }
  }

  /** 给导播窗口看的进度 */
  snapshot() {
    return {
      playing: this.playing, counting: !!this.counting, elapsed: this.elapsed, estimate: this.estimate,
      mode: this.s.mode, speed: this.s.speed, fontSize: this.s.fontSize, mirrorH: this.s.mirrorH, mirrorV: this.s.mirrorV,
      followState: this.followState, unit: this.s.mode === 'follow' ? this.pos : this.unitAtReadingLine(),
      progress: Math.max(0, Math.min(1, (this.offset - this.startOffset) / Math.max(1, this.endOffset - this.startOffset))),
    };
  }

  /** 每一段的开头是第几个字，导播窗口点段落跳过去用 */
  sendParas() {
    if (!this.onState) return;
    const first = new Map();
    this.units.forEach((u, i) => { if (!first.has(u.line)) first.set(u.line, i); });
    const paras = [];
    for (const p of this.lines) {
      const text = p.textContent.trim();
      if (text) paras.push({ text, unit: first.get(p) ?? null, cue: !first.has(p) });
    }
    this.onState({ paras });
  }

  /** 跳到第几个字（放到阅读线上） */
  jumpTo(unit) {
    const i = Math.max(0, Math.min(this.units.length - 1, unit));
    this.pos = i;
    this.offset = this.targetFor(i);
    this.clamp();
    this.lastDimKey = null;
    this.paint();
  }

  /** 播出中改稿：换成新稿子，尽量停在原来读到的字附近 */
  replaceScript(script) {
    const keep = this.s.mode === 'follow' ? this.pos : this.unitAtReadingLine();
    this.script = script;
    $('pTitle').textContent = script.title || '未命名稿件';
    renderScript(script.body, this.content);
    this.units = indexUnits(this.content);
    this.buildSentences();
    this.estimate = estimateSeconds(script.body);
    this.layout();
    this.pos = Math.min(keep ?? 0, this.units.length);
    this.offset = this.targetFor(this.pos);
    this.clamp();
    this.lastDimKey = null;
    this.paint();
    this.sendParas();
  }

  // ── 高亮（浮窗里要用浮窗那个 document 的高亮表） ──

  get highlights() { return this.win.CSS?.highlights && this.win.Highlight ? this.win.CSS.highlights : null; }
  clearHighlight() { this.highlights?.delete('read'); }
  setHighlight(a, b) {
    const r = this.el.ownerDocument.createRange();
    r.setStart(a.node, a.off);
    r.setEnd(b.node, b.off + b.len);
    this.highlights.set('read', new this.win.Highlight(r));
  }

  paint() {
    this.content.style.transform = `translate3d(0, ${(-this.offset).toFixed(2)}px, 0)`;
    const span = Math.max(1, this.endOffset - this.startOffset);
    const pct = Math.round(Math.max(0, Math.min(1, (this.offset - this.startOffset) / span)) * 100) + '%';
    if (this.lastPct !== pct) { this.lastPct = pct; $('pPct').textContent = pct; }
    if (this.s.timer) {
      // 和电脑版计时器一样：已读多久 · 预计还剩多久（超了变橙）
      const left = this.estimate - this.elapsed;
      const html = `<span><small>已读</small>${clock(this.elapsed)}</span><span class="${left < 0 ? 'over' : ''}"><small>${left < 0 ? '超出' : '还剩'}</small>${clock(Math.abs(left))}</span>`;
      if (this.lastTimer !== html) { this.lastTimer = html; $('pTimer').innerHTML = html; }
    }
    this.paintBands();
    this.paintDim();
  }

  // ── 当前句色带（和电脑版一样：每行一条圆角条贴着字；超过 3 行只标正在读的这行和下面两行；
  //    智能跟读时只铺读过的部分，一个字一个字往前推） ──

  /** 按句号、问号、感叹号、换段把单位分成句子：sentStart[i] = 第 i 个单位所在句子的第一个单位 */
  buildSentences() {
    const n = this.units.length;
    this.sentStart = new Int32Array(n);
    this.sentEnd = new Int32Array(n);
    let s = 0;
    for (let i = 0; i < n; i++) {
      this.sentStart[i] = s;
      if (this.endsSentence(i)) { for (let k = s; k <= i; k++) this.sentEnd[k] = i + 1; s = i + 1; }
    }
    this.bandPacer = new FollowPacer(2);
    this.lastBandKey = null;
  }

  /** 第 k 个单位后面有逗号、顿号这类小停顿（色带往前猜时在这儿停） */
  endsClause(k) {
    const u = this.units[k], v = this.units[k + 1];
    if (!u || !v || u.line !== v.line) return true;
    const gap = u.node === v.node ? u.node.data.slice(u.off + u.len, v.off)
      : u.node.data.slice(u.off + u.len) + v.node.data.slice(0, v.off);
    return /[，、；：,;:。！？!?…]/.test(gap);
  }

  /** 阅读线上是第几个单位（按字的位置二分） */
  unitOnReadingLine() {
    const y = this.offset + this.readingY;
    let lo = 0, hi = this.units.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.centerOffset(mid) + this.readingY < y - this.lineH * 0.5) lo = mid + 1; else hi = mid;
    }
    return Math.min(lo, this.units.length - 1);
  }

  /** 这一次要标的范围 [a, b)（单位下标）；没有就是 null */
  bandRange(now) {
    const n = this.units.length;
    if (!this.s.band || !n || this.counting) return null;
    const follow = this.s.mode === 'follow';
    const at = follow ? Math.min(this.pos, n - 1) : this.unitOnReadingLine();
    let a = this.sentStart[at], b = this.sentEnd[at] || n;
    // 超过 3 行：从正在读的这一行开始标 3 行
    const first = this.visualLine(a), last = this.visualLine(b - 1);
    if (Math.round((last.y - first.y) / Math.max(1, this.lineH)) >= 3) {
      const cur = this.visualLine(at);
      a = Math.max(a, cur.start);
      let line = cur;
      for (let k = 0; k < 2 && line.end < b; k++) line = this.visualLine(line.end);
      b = Math.min(b, line.end);
    }
    if (follow) {
      // 只铺读过的部分：识别结果摊成逐字（最多先走 2 个字，碰到逗号停）
      const shown = Math.floor(this.bandPacer.step(Math.min(this.pos, n), now, this.bandDt || 0, (k) => this.endsClause(k)));
      b = Math.min(b, shown);
      if (b <= a) return { a, b: a, follow };
    }
    return { a, b, follow };
  }

  paintBands(now = performance.now() / 1000) {
    if (!this.bandsEl || this.bandsEl.parentNode !== this.content) {
      this.bandsEl = this.el.ownerDocument.createElement('div');
      this.bandsEl.className = 'bands';
      this.content.prepend(this.bandsEl);
      this.lastBandKey = null;
    }
    this.bandDt = this.lastBandAt ? Math.min(0.1, now - this.lastBandAt) : 0;
    this.lastBandAt = now;
    const r = this.bandRange(now);
    const key = r ? `${r.a}|${r.b}|${r.follow}|${this.layoutRev}|${this.s.mirrorH}|${this.s.mirrorV}` : 'none';
    if (key === this.lastBandKey) return;
    this.lastBandKey = key;
    this.bandStart = r ? r.a : null;
    this.bandsEl.classList.toggle('deep', !!r?.follow);
    this.bandsEl.replaceChildren();
    if (!r || r.b <= r.a) return;
    // 句末的标点也带上（「自然。」的句号在色带里）
    const u0 = this.units[r.a], u1 = this.units[r.b - 1];
    let endOff = u1.off + u1.len;
    const tail = u1.node.data.slice(endOff).match(/^[^\S\n]*[，、；：,;:。！？!?…”」』）)]*/);
    if (tail && (!r.follow || r.b >= (this.sentEnd[r.b - 1] || 0))) endOff += tail[0].length;
    const range = this.el.ownerDocument.createRange();
    range.setStart(u0.node, u0.off);
    range.setEnd(u1.node, endOff);
    // 同一行的小矩形并成一条
    const lines = [];
    for (const q of range.getClientRects()) {
      if (q.width < 1) continue;
      const mid = (q.top + q.bottom) / 2;
      const l = lines.find(x => Math.abs(x.mid - mid) < this.lineH * 0.4);
      if (l) { l.left = Math.min(l.left, q.left); l.right = Math.max(l.right, q.right); l.top = Math.min(l.top, q.top); l.bottom = Math.max(l.bottom, q.bottom); }
      else lines.push({ mid, left: q.left, right: q.right, top: q.top, bottom: q.bottom });
    }
    const box = this.content.getBoundingClientRect();
    const pt = this.s.fontSize * this.fontScale;
    const padX = pt * 0.14, padY = pt * 0.08, gap = Math.max(1, pt * 0.05);
    for (const l of lines) {
      // 换成内容自己的坐标（镜像时整块翻过来，要反着量）
      const x = this.s.mirrorH ? box.right - l.right : l.left - box.left;
      const y = this.s.mirrorV ? box.bottom - l.bottom : l.top - box.top;
      const h = l.bottom - l.top;
      // 字框上下各多一点，但不出这一行（行距小时上下两条留缝）
      const extra = Math.max(0, Math.min(padY, (this.lineH - h) / 2 - gap));
      const i = this.el.ownerDocument.createElement('i');
      i.style.cssText = `left:${(x - padX).toFixed(1)}px;top:${(y - extra).toFixed(1)}px;width:${(l.right - l.left + padX * 2).toFixed(1)}px;height:${(h + extra * 2).toFixed(1)}px;border-radius:${(pt * 0.2).toFixed(1)}px`;
      this.bandsEl.appendChild(i);
    }
  }

  /** 已读变暗：跟读按字（浏览器支持高亮时），其他模式按行 */
  paintDim() {
    if (!this.s.dim || !this.units.length) return;
    if (this.s.mode === 'follow' && this.highlights) {
      // 色带开着时当前句不变暗：读过的字留在色带里，变灰就像被擦掉了
      const upto = this.s.band && this.bandStart != null ? Math.min(this.pos, this.bandStart) : this.pos;
      if (this.lastDimKey === 'f' + upto) return;
      this.lastDimKey = 'f' + upto;
      this.content.querySelectorAll('p.read').forEach(p => p.classList.remove('read'));
      if (upto <= 0) { this.clearHighlight(); return; }
      this.setHighlight(this.units[0], this.units[Math.min(upto, this.units.length) - 1]);
      return;
    }
    // 其他模式：整行走过阅读线半行后变暗
    const y = this.offset + this.readingY - this.lineH * 0.5;
    const key = 'l' + Math.round(y / 8) + '|' + this.layoutRev;
    if (this.lastDimKey === key) return;
    this.lastDimKey = key;
    if (this.highlights) {
      this.content.querySelectorAll('p.read').forEach(p => p.classList.remove('read'));
      // 字的位置从上到下递增，二分找有几个字已经过线
      let lo = 0, hi = this.units.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (this.unitCenter(mid) < y) lo = mid + 1; else hi = mid;
      }
      if (lo <= 0) { this.clearHighlight(); return; }
      this.setHighlight(this.units[0], this.units[lo - 1]);
      return;
    }
    for (const p of this.lines) p.classList.toggle('read', p.offsetTop + p.offsetHeight < y);
  }

  // ── 控件 ──

  syncControls() {
    const s = this.s;
    $('pMode').value = s.mode;
    $('pSpeed').value = s.speed;
    $('pSpeedVal').textContent = s.speed;
    $('pFont').value = s.fontSize;
    $('pFontVal').textContent = s.fontSize;
    $('speedWrap').hidden = !(s.mode === 'auto' || s.mode === 'voice');
    $('pMirror').classList.toggle('on', s.mirrorH);
    $('pTimerBtn').classList.toggle('on', !!s.timer);
    $('pPlay').classList.toggle('on', this.playing);
    $('pPip').classList.toggle('on', !!this.pipWin);
    $('pMeter').hidden = s.mode !== 'follow';
    $('modeIcon').innerHTML = MODE_ICONS[s.mode] || MODE_ICONS.follow;
    $('playIcon').innerHTML = this.playing
      ? '<path d="M8 5h3v14H8zM14 5h3v14h-3z" fill="currentColor" stroke="none"/>'
      : '<path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="none"/>';
    this.syncStatus();
  }

  syncStatus() {
    const s = this.s;
    $('pMeter').classList.toggle('live', s.mode === 'follow' && this.playing && (this.followState === 'listening' || this.followState === 'starting'));
    let text = '';
    if (s.mode === 'follow') {
      if (this.followState === 'listening' || this.followState === 'starting') text += ' · 正在听';
      else if (this.followState === 'denied') text += ' · 没有麦克风权限';
      if (!this.isUnlimited()) text += ` · 今日还剩 ${clock(store.followLeft())}`;
    }
    if (this.pipWin && !this.isUnlimited()) text += ` · 浮窗今日还剩 ${clock(store.floatLeft())}`;
    if (!this.playing) text += TOUCH ? ' · 已暂停（点 ▶ 开始）' : ' · 已暂停（空格开始）';
    $('pStatus').textContent = text.replace(/^ · /, '');
  }

  /** 有操作时显示控件，播放中 3 秒不动就藏起来 */
  poke() {
    this.el.classList.remove('idle');
    clearTimeout(this.idleTimer);
    if (this.playing) this.idleTimer = setTimeout(() => this.el.classList.add('idle'), 3000);
  }

  nudge(dy) {
    this.offset += dy;
    this.clamp();
    if (this.s.mode === 'follow') this.pos = this.unitAtReadingLine() ?? this.pos;
    this.paint();
  }

  // ── 事件 ──

  bind() {
    $('pClose').onclick = () => this.close();
    $('pPlay').onclick = () => this.toggle();
    $('pRestart').onclick = () => { this.restart(); this.poke(); };
    $('pMode').onchange = (e) => { this.setMode(e.target.value); e.target.blur(); };
    $('pSpeed').oninput = (e) => { this.s.speed = +e.target.value; $('pSpeedVal').textContent = this.s.speed; this.onSettings(this.s); };
    $('pFont').oninput = (e) => { this.s.fontSize = +e.target.value; this.onSettings(this.s); this.update(this.s); };
    // 松手后把焦点还给画面，空格、Esc 这些快捷键接着能用
    for (const id of ['pSpeed', 'pFont']) $(id).addEventListener('change', (e) => e.target.blur());
    $('pMirror').onclick = () => { this.s.mirrorH = !this.s.mirrorH; this.onSettings(this.s); this.update(this.s); };
    $('pTimerBtn').onclick = () => { this.s.timer = !this.s.timer; this.onSettings(this.s); this.update(this.s); this.lastTimer = null; };
    $('pFull').onclick = () => this.fullscreen();
    // iPhone 的 Safari 不让网页全屏：不给这个按钮
    $('pFull').hidden = !(document.fullscreenEnabled || document.webkitFullscreenEnabled);
    $('pPip').hidden = !PIP_SUPPORTED;
    $('pPip').onclick = () => this.togglePip();
    $('pSettings').onclick = () => { $('drawer').hidden = !$('drawer').hidden; };
    $('drawerClose').onclick = () => { $('drawer').hidden = true; };

    this.el.addEventListener('pointermove', () => this.poke());
    this.stage.addEventListener('wheel', (e) => { e.preventDefault(); this.nudge(e.deltaY); this.poke(); }, { passive: false });
    // 手指 / 鼠标拖动画面
    let dragY = null;
    this.stage.addEventListener('pointerdown', (e) => { dragY = e.clientY; this.stage.setPointerCapture(e.pointerId); this.poke(); });
    this.stage.addEventListener('pointermove', (e) => {
      if (dragY == null) return;
      const dy = dragY - e.clientY;
      dragY = e.clientY;
      this.nudge(this.s.mirrorV ? -dy : dy);
    });
    const end = () => { dragY = null; };
    this.stage.addEventListener('pointerup', end);
    this.stage.addEventListener('pointercancel', end);

    this.onKey = (e) => {
      if (!this.isOpen) return;
      // 打字的地方不抢键；底栏的下拉框、滑块用完就还给快捷键（方向键留给滑块自己）
      const t = e.target instanceof Element ? e.target : null;
      if (t?.closest('textarea, input[type=text], input[type=search], input:not([type]), [contenteditable]')) return;
      if (t?.matches('input[type=range], select') && e.key.startsWith('Arrow')) return;
      if (t?.matches('select') && (e.key === ' ' || e.key === 'Enter')) { t.blur(); }
      const k = e.key;
      if (k === ' ' || k === 'Enter') { e.preventDefault(); this.toggle(); }
      else if (k === 'Escape') { if (!$('drawer').hidden) $('drawer').hidden = true; else this.close(); }
      else if (k === 'ArrowUp' || k === 'ArrowDown') {
        e.preventDefault();
        const dir = k === 'ArrowDown' ? 1 : -1;
        if (this.s.mode === 'auto' || this.s.mode === 'voice') {
          this.s.speed = Math.max(10, Math.min(300, this.s.speed + dir * 5));
          this.onSettings(this.s);
          this.syncControls();
          this.toast(`速度 ${this.s.speed}`);
        } else {
          this.nudge(dir * this.lineH);
        }
      } else if (k === 'PageDown' || k === 'PageUp') {
        e.preventDefault();
        this.nudge((k === 'PageDown' ? 1 : -1) * this.stage.clientHeight * 0.7);
      } else if (k === 'r' || k === 'R') { this.restart(); }
      else if (k === 'm' || k === 'M') { $('pMirror').click(); }
      else if (k === 'f' || k === 'F') { this.fullscreen(); }
      else if ((k === 'p' || k === 'P') && PIP_SUPPORTED) { this.togglePip(); }
      else if (k === '=' || k === '+' || k === '-') {
        this.s.fontSize = Math.max(24, Math.min(140, this.s.fontSize + (k === '-' ? -4 : 4)));
        this.onSettings(this.s);
        this.update(this.s);
      }
      this.poke();
    };
    document.addEventListener('keydown', this.onKey);

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.playing) this.requestWakeLock();
    });
  }

  // ── 浮窗：整个提词画面搬进一个始终在最上层的小窗，盖在会议、直播软件上面照样提词 ──

  async togglePip() {
    if (this.pipWin) { this.pipWin.close(); return; }
    if (!PIP_SUPPORTED) return;
    if (!this.isUnlimited() && store.floatLeft() <= 0) {
      this.toast('免费版今天的浮窗时间用完了（每天 20 分钟），明天零点恢复；Pro / MAX 不限');
      return;
    }
    let w;
    try {
      w = await documentPictureInPicture.requestWindow({ width: 560, height: 320 });
    } catch {
      this.toast('浏览器没让打开浮窗，请再点一次');
      return;
    }
    // 样式表搬过去
    for (const link of document.querySelectorAll('link[rel=stylesheet]')) {
      const l = w.document.createElement('link');
      l.rel = 'stylesheet';
      l.href = link.href;
      w.document.head.appendChild(l);
    }
    w.document.title = 'AI魔方提词器浮窗';
    w.document.body.classList.add('pip');
    this.placeholder = document.createComment('prompter');
    this.el.before(this.placeholder);
    w.document.body.appendChild(this.el);
    this.pipWin = w;
    this.switchWindow(w, 0.55);
    $('pFull').hidden = true;
    w.document.addEventListener('keydown', this.onKey);
    w.addEventListener('pointermove', () => this.poke());
    w.addEventListener('pagehide', () => {
      // 浮窗关了：画面放回网页里
      this.placeholder.replaceWith(this.el);
      this.pipWin = null;
      this.switchWindow(window, 1);
      $('pFull').hidden = !(document.fullscreenEnabled || document.webkitFullscreenEnabled);
      if (this.closingAll) { this.closingAll = false; return; }
      this.syncControls();
    });
    this.toast(this.isUnlimited() ? '已放进浮窗：可以切到别的软件，浮窗一直在最上面' : `已放进浮窗：免费版每天 20 分钟，今天还剩 ${clock(store.floatLeft())}`);
    this.syncControls();
  }

  switchWindow(win, scale) {
    this.clearHighlight();
    this.win = win;
    DOC = win.document;
    this.fontScale = scale;
    if (!this.isOpen) return;
    this.applySettings();
    this.observeResize();
    this.relayout();
    this.lastDimKey = null;
    this.paint();
    this.loop();
  }

  fullscreen() {
    if (this.pipWin) return;
    if (document.fullscreenElement) document.exitFullscreen?.();
    else (this.el.requestFullscreen || this.el.webkitRequestFullscreen)?.call(this.el);
  }

  async requestWakeLock() {
    try { this.wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* 不支持就算了 */ }
  }

  releaseWakeLock() {
    try { this.wakeLock?.release(); } catch { /* 忽略 */ }
    this.wakeLock = null;
  }
}
