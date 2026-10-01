// 稿件标记：和 App 一致——【方括号】/ [方括号] 是导演提示（不朗读、智能跟读跳过、不算字数），
// **两个星号** 是重点，行首 # 是段落标题，/ 和 // 是停顿。

const CUE_RE = /【[^】\n]*】|\[[^\]\n]*\]/g;
const INLINE_RE = /(【[^】\n]*】|\[[^\]\n]*\]|\*\*[^*\n]+\*\*|\/\/|(?:^|\s)\/(?=\s|$))/g;
const HEADING_RE = /^#{1,3}\s+/;

/** 一个字是不是按「一个字一个单位」算的文字（汉字、假名、韩文） */
export function isCJK(ch) {
  const c = ch.codePointAt(0);
  return (c >= 0x3400 && c <= 0x9fff) || (c >= 0xf900 && c <= 0xfaff) || (c >= 0x3040 && c <= 0x30ff)
    || (c >= 0xac00 && c <= 0xd7af) || (c >= 0x20000 && c <= 0x2fa1f);
}
const WORD_RE = /[A-Za-z0-9À-ɏ']/;

/** 要念的纯文字：去掉导演提示、段落标题、标记符号 */
export function plainText(body) {
  return body.split('\n')
    .filter(l => !HEADING_RE.test(l))
    .map(l => l.replace(CUE_RE, '').replace(/\*\*/g, '').replace(/\/\//g, ' ').replace(/(^|\s)\/(?=\s|$)/g, ' '))
    .join('\n');
}

/** 把一段文字切成对位用的单位：汉字一个字一个，拉丁文一个词一个（小写） */
export function toUnits(text) {
  const out = [];
  let word = '';
  for (const ch of text) {
    if (isCJK(ch)) {
      if (word) { out.push(word.toLowerCase()); word = ''; }
      out.push(ch);
    } else if (WORD_RE.test(ch)) {
      word += ch;
    } else if (word) {
      out.push(word.toLowerCase()); word = '';
    }
  }
  if (word) out.push(word.toLowerCase());
  return out;
}

/** 字数：中文按字、英文按词 */
export function countWords(body) { return toUnits(plainText(body)).length; }

/** 预计时长（秒）：中文口播约每秒 4 个字，英文约每秒 2.5 个词 */
export function estimateSeconds(body) {
  const units = toUnits(plainText(body));
  const latin = units.filter(u => u.length > 1 || /[a-z0-9]/.test(u)).length;
  const cjk = units.length - latin;
  return Math.round(cjk / 4 + latin / 2.5);
}

export function formatDuration(sec) {
  sec = Math.max(0, Math.round(sec));
  const m = Math.floor(sec / 60), s = sec % 60;
  return m > 0 ? `${m} 分 ${s} 秒` : `${s} 秒`;
}

export function clock(sec) {
  sec = Math.max(0, Math.floor(sec));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

/** 把稿件画进提词画面（每行一个 <p>） */
export function renderScript(body, container) {
  container.textContent = '';
  const top = document.createElement('div');
  top.className = 'pad-top';
  container.appendChild(top);
  for (const raw of body.replace(/\r\n?/g, '\n').split('\n')) {
    const p = document.createElement('p');
    if (!raw.trim()) {
      p.className = 'gap';
    } else if (HEADING_RE.test(raw)) {
      p.className = 'hd';
      p.textContent = raw.replace(HEADING_RE, '');
    } else {
      let last = 0;
      for (const m of raw.matchAll(INLINE_RE)) {
        if (m.index > last) p.append(raw.slice(last, m.index));
        const tok = m[0];
        if (tok.startsWith('**')) {
          const s = document.createElement('strong');
          s.textContent = tok.slice(2, -2);
          p.append(s);
        } else if (tok.startsWith('【') || tok.startsWith('[')) {
          const s = document.createElement('span');
          s.className = 'cue';
          s.textContent = tok;
          p.append(s);
        } else {
          const s = document.createElement('span');
          s.className = 'pause';
          s.textContent = tok;
          p.append(s);
        }
        last = m.index + tok.length;
      }
      if (last < raw.length) p.append(raw.slice(last));
    }
    container.appendChild(p);
  }
  const bottom = document.createElement('div');
  bottom.className = 'pad-bottom';
  container.appendChild(bottom);
}

/** 从画好的提词画面里建「单位 → 文字位置」的索引（跳过导演提示、段落标题、停顿符号） */
export function indexUnits(container) {
  const units = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      const el = n.parentElement;
      if (el.closest('.cue, .hd, .pause')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let node;
  while ((node = walker.nextNode())) {
    const text = node.data;
    const line = node.parentElement.closest('p');
    let i = 0;
    while (i < text.length) {
      const ch = String.fromCodePoint(text.codePointAt(i));
      const w = ch.length;
      if (isCJK(ch)) {
        units.push({ n: ch, node, off: i, len: w, line });
        i += w;
      } else if (WORD_RE.test(ch)) {
        let j = i;
        while (j < text.length && WORD_RE.test(text[j])) j++;
        units.push({ n: text.slice(i, j).toLowerCase(), node, off: i, len: j - i, line });
        i = j;
      } else {
        i += w;
      }
    }
  }
  return units;
}

/** 预览用：把稿件转成带颜色的 HTML（台本库预览） */
export function previewHTML(body) {
  const esc = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  return esc(body)
    .replace(/【[^】\n]*】|\[[^\]\n]*\]/g, m => `<span class="cue">${m}</span>`)
    .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
}
