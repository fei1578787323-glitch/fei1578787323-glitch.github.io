import { FollowGlide } from './follow.js';

export class FollowScrollMotion {
  constructor() { this.continuous = new FollowGlide(); this.reset(0); }
  reset(y) {
    this.y = y; this.v = 0; this.configuration = null; this.lastRead = 0; this.lastGrowth = -Infinity;
    this.groupStart = 0; this.baseY = y; this.bias = 0; this.goal = y; this.from = y; this.elapsed = 0;
    this.relocating = false; this.needsBaseline = true; this.continuous.reset(y);
  }
  flexibleGoal(read, here, length, lineAt) {
    if (here.end >= length) return here.y;
    const span = Math.max(1, here.contentEnd - here.start), fraction = (read - here.start) / span;
    const begin = Math.min(.72, Math.max(0, (span - 2) / span));
    const t = Math.min(1, Math.max(0, (fraction - begin) / (1 - begin)));
    return here.y + (lineAt(here.end).y - here.y) * t * t * (3 - 2 * t);
  }
  setGoal(value) {
    if (Math.abs(value - this.goal) <= .0001) return;
    this.goal = value; this.from = this.y; this.elapsed = 0;
  }
  step(target, nominal, dt, bigJump, { style, lines, read, now, speaking, following = true, length, lineAt }) {
    if (!length || !Number.isFinite(target) || !Number.isFinite(now)) { this.v = 0; return this.y; }
    dt = Math.min(.1, Math.max(0, dt)); read = Math.min(length, Math.max(0, read));
    style = ['smooth', 'step', 'flexible'].includes(style) ? style : 'smooth';
    const count = Math.min(3, Math.max(1, Math.round(lines) || 1)), key = `${style}-${count}`;
    const here = lineAt(Math.min(length - 1, Math.max(0, read - 1)));
    if (this.needsBaseline) { this.lastRead = read; this.needsBaseline = false; }
    const previous = this.lastRead;
    if (read !== this.lastRead) { this.lastGrowth = now; this.lastRead = read; }
    if (this.configuration !== key) {
      this.configuration = key; this.groupStart = here.start; this.baseY = this.y;
      this.bias = this.y - (style === 'flexible' ? this.flexibleGoal(read, here, length, lineAt) : here.y);
      this.goal = this.from = this.y; this.elapsed = 0; this.v = 0; this.continuous.reset(this.y); return this.y;
    }
    const age = now - this.lastGrowth;
    if (!following || age >= 2 || (!speaking && age >= .25) || dt <= 0) { this.v = 0; this.continuous.reset(this.y); return this.y; }
    const before = this.y;
    if (style === 'smooth') {
      const value = this.continuous.step(target, nominal, dt, bigJump);
      this.y = target >= before ? Math.min(target, value) : (target < before - bigJump ? value : before);
      if (this.y !== value) this.continuous.reset(this.y);
    } else if (style === 'step') {
      if (read < previous - 3) { this.groupStart = here.start; this.baseY = here.y + this.bias; this.setGoal(this.baseY); }
      let iterations = 0;
      while (this.groupStart < length && iterations++ < 512) {
        const first = lineAt(this.groupStart); let last = first;
        for (let i = 1; i < count && last.end < length; i++) {
          const next = lineAt(last.end); if (next.end <= last.end) break; last = next;
        }
        if (read < last.contentEnd) break;
        this.baseY += (last.end < length ? lineAt(last.end).y : last.y) - first.y;
        this.groupStart = Math.max(last.end, this.groupStart + 1); this.setGoal(this.baseY);
      }
      this.elapsed = Math.min(.28, this.elapsed + dt);
      const t = this.elapsed / .28; this.y = this.from + (this.goal - this.from) * t * t * (3 - 2 * t);
    } else {
      if (read < previous - 3) this.relocating = true;
      const destination = this.flexibleGoal(read, here, length, lineAt) + this.bias, error = destination - this.y;
      if (error >= 0 || this.relocating) {
        this.y += error * (1 - Math.exp(-dt / .12));
        if (Math.abs(destination - this.y) < .05) { this.y = destination; this.relocating = false; }
      }
    }
    this.v = (this.y - before) / dt; return this.y;
  }
}
