// 智能跟读：浏览器自带的语音识别听你念到哪里，在稿子里找到对应的位置。
// 对位思路和 App 一样「只往前找、允许念错几个字」：拿最近听到的十来个字，在当前位置前后一段稿子里做模糊匹配。
import { toUnits } from './markup.js';

/**
 * 在稿子里给「刚听到的字」找位置。
 * units：稿子的单位数组（每项有 .n）；pos：当前读到第几个单位；heard：刚听到的单位数组。
 * 返回 { pos: 读到的下一个单位, cost } 或 null（没把握时不动）。
 */
export function align(units, pos, heard) {
  const R = heard.slice(-12);
  const m = R.length;
  if (m < 2) return null;
  const lo = Math.max(0, pos - 30);
  const hi = Math.min(units.length, pos + 160);
  const n = hi - lo;
  if (n <= 0) return null;
  // 半全局编辑距离：稿子这边可以从任意位置开始（第 0 行全 0），找「听到的这串」在窗口里花费最小的结尾
  let prev = new Float32Array(n + 1);
  let cur = new Float32Array(n + 1);
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    const r = R[i - 1];
    for (let j = 1; j <= n; j++) {
      const same = units[lo + j - 1].n === r ? 0 : 1;
      cur[j] = Math.min(prev[j - 1] + same, prev[j] + 1, cur[j - 1] + 1);
    }
    [prev, cur] = [cur, prev];
  }
  // prev 现在是最后一行：prev[j] = 听到的整串对到稿子第 lo+j 个单位为止的最小代价
  let best = -1, bestScore = Infinity, bestCost = Infinity;
  for (let j = 1; j <= n; j++) {
    const end = lo + j;                  // 读完之后的下一个单位
    const dist = end - pos;
    // 往前一点点（正常念下去）最自然；往回跳（重念）要更有把握才认
    const penalty = dist >= 0 ? dist * 0.012 : 0.8 + (-dist) * 0.03;
    const score = prev[j] + penalty;
    if (score < bestScore) { bestScore = score; best = end; bestCost = prev[j]; }
  }
  if (best < 0) return null;
  const allowed = best >= pos ? Math.floor(m * 0.4) : Math.floor(m * 0.2);
  if (bestCost > allowed) return null;
  return { pos: best, cost: bestCost };
}

/** 浏览器语音识别：持续听，识别到字就回调；断了自动重连 */
export class Listener {
  constructor({ lang = 'zh-CN', onHeard, onState }) {
    this.lang = lang;
    this.onHeard = onHeard;
    this.onState = onState || (() => {});
    this.running = false;
    this.rec = null;
  }

  static get supported() {
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  }

  start() {
    if (this.running) return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { this.onState('unsupported'); return; }
    this.running = true;
    this.heardAny = false;
    this.netErrors = 0;
    const rec = new SR();
    rec.lang = this.lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      // 只看这一次识别里最后一句（含还没定下来的部分），取末尾的字去对位
      let text = '';
      for (let i = e.resultIndex; i < e.results.length; i++) text += e.results[i][0].transcript;
      if (!text) {
        const last = e.results[e.results.length - 1];
        text = last ? last[0].transcript : '';
      }
      const units = toUnits(text);
      if (units.length) this.onHeard(units);
      this.heardAny = true;
      this.netErrors = 0;
      this.onState('listening');
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed') {
        this.running = false;
        this.onState('denied');
      } else if (e.error === 'service-not-allowed' || (e.error === 'network' && !this.heardAny && ++this.netErrors >= 2)) {
        // 识别服务连不上：Chrome 的识别走谷歌服务器，国内一般连不上（Edge 走微软、Safari 走苹果，通常能用）
        this.running = false;
        this.onState('unreachable');
      } else if (e.error !== 'no-speech' && e.error !== 'aborted') {
        this.onState('error:' + e.error);
      }
    };
    rec.onend = () => {
      // 浏览器会隔一会儿自己停；还在提词就接着听
      if (this.running) {
        try { rec.start(); } catch { setTimeout(() => this.running && rec.start(), 300); }
      }
    };
    this.rec = rec;
    try { rec.start(); this.onState('starting'); } catch { this.onState('error'); }
  }

  stop() {
    this.running = false;
    if (this.rec) {
      try { this.rec.abort(); } catch { /* 已经停了 */ }
      this.rec = null;
    }
  }
}

/** 声控：只听有没有声音，说话就按速度走、停下就停，不识别内容 */
export class VoiceGate {
  constructor() {
    this.level = 0;
    this.gate = 0;
    this.noise = 0.01;
    this.lastLoud = 0;
    this.ctx = null;
  }

  async start() {
    if (this.ctx) return true;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      return false;
    }
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    src.connect(this.analyser);
    this.buf = new Float32Array(this.analyser.fftSize);
    return true;
  }

  /** 每帧调用：返回 0…1 的速度系数 */
  step(dt, now) {
    if (!this.analyser) return 0;
    this.analyser.getFloatTimeDomainData(this.buf);
    let sum = 0;
    for (const v of this.buf) sum += v * v;
    const rms = Math.sqrt(sum / this.buf.length);
    this.level = rms;
    // 背景噪声：只在安静时慢慢跟
    if (rms < this.noise * 2) this.noise += (rms - this.noise) * Math.min(1, dt * 0.5);
    const threshold = Math.max(0.012, this.noise * 3);
    if (rms > threshold) this.lastLoud = now;
    const speaking = now - this.lastLoud < 0.45;   // 字和字之间的短停顿不算停
    const target = speaking ? 1 : 0;
    const rate = speaking ? 6 : 2.5;
    this.gate += (target - this.gate) * Math.min(1, dt * rate);
    return this.gate;
  }

  stop() {
    if (this.stream) this.stream.getTracks().forEach(t => t.stop());
    if (this.ctx) this.ctx.close();
    this.ctx = null;
    this.analyser = null;
    this.stream = null;
  }
}

// ── 智能跟读的连续滚动（和电脑 / 手机版 KaraokePacer、ReadingRate、FollowGlide 同一套） ──
// 识别结果一顿一顿来（常卡一两秒再跳几个字）：以前画面直接追「读到的那个字」，就是走—停—走。
// 现在：先把读到哪摊成一个字一个字走、卡住时按语速往前猜几个字（句末停）；
// 再按最近几秒的语速给一个基础速度，按位置差慢慢修正，速度本身也平滑，起停都是柔的。

/** 读到哪（单位下标，带小数） */
export class FollowPacer {
  constructor(maxAhead = 4) { this.maxAhead = maxAhead; this.rate = 4; this.reset(0, 0); }
  reset(p, now) { this.shown = p; this.target = p; this.targetTime = now; this.moving = false; this.catchSpeed = 0; }
  /** t：识别到第几个单位；endsSentence(k)：第 k 个单位后面是句末 */
  step(t, now, dt, endsSentence) {
    if (t < this.target || t > this.target + 12 || t < Math.floor(this.shown) - 3) { this.reset(t, now); return t; }
    if (t > this.target) {
      const gap = now - this.targetTime;
      if (gap > 0.12 && gap < 3) this.rate = Math.min(9, Math.max(2, this.rate * 0.7 + ((t - this.target) / gap) * 0.3));
      this.target = t;
      this.targetTime = now;
      this.moving = true;
      this.catchSpeed = Math.max(this.rate, (t - this.shown) / 0.18);
    }
    let goal = this.target;
    const idle = now - this.targetTime - 0.15;
    if (this.moving && idle > 1.5) this.moving = false;
    if (this.moving && idle > 0) {
      let stop = this.target;
      while (stop - this.target < this.maxAhead) { stop++; if (endsSentence(stop - 1)) break; }
      goal = Math.min(stop, this.target + this.rate * idle);
    }
    if (this.shown < goal) {
      const speed = this.shown < this.target ? this.catchSpeed : this.rate;
      this.shown = Math.min(goal, this.shown + speed * dt);
    }
    return this.shown;
  }
}

/** 最近几秒的语速（单位 / 秒）；一段时间没往前就是 0 */
export class ReadingRate {
  constructor(win = 2.5) { this.win = win; this.reset(); }
  reset() { this.samples = []; this.lastPos = -1; this.lastMoveAt = -10; this.rate = 0; }
  feed(pos, now) {
    if (this.lastPos < 0 || pos < this.lastPos || pos > this.lastPos + 30) { this.samples = []; this.lastPos = pos; }
    if (pos > this.lastPos) { this.lastMoveAt = now; this.lastPos = pos; }
    this.samples.push([now, pos]);
    while (this.samples.length && now - this.samples[0][0] > this.win) this.samples.shift();
    const f = this.samples[0];
    if (f && now - f[0] > 0.8) this.rate = (pos - f[1]) / (now - f[0]);
    if (now - this.lastMoveAt > 1.2) this.rate = 0;
    return this.rate;
  }
}

/** 滚动位置：基础速度 + 位置差修正 + 速度平滑 */
export class FollowGlide {
  constructor() { this.gain = 1.0; this.smoothing = 0.45; this.y = 0; this.v = 0; }
  reset(y) { this.y = y; this.v = 0; }
  step(target, nominal, dt, bigJump) {
    if (dt <= 0) return this.y;
    const err = target - this.y;
    const far = Math.abs(err) > bigJump;
    let cmd = nominal + (far ? 4 : this.gain) * err;
    if (cmd < 0 && err > -bigJump) cmd = 0;   // 正常读稿不往回退
    this.v += (cmd - this.v) * Math.min(1, dt / (far ? 0.15 : this.smoothing));
    this.y += this.v * dt;
    return this.y;
  }
}
