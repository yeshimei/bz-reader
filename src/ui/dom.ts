/* ============================================================
 * bz-reader · DOM 小工具（ui/dom.ts）
 *
 * 只有几个最常用的：建元素、封面、滑杆、分段选择。刻意不做虚拟 DOM。
 * 图标一律用 CSS 画（和原型一致）：随 currentColor 变色，不占包体。
 * ============================================================ */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/** 百分比 → 人话（0% 不显示「0%」，显示「未读」） */
export function percentLabel(p: number): string {
  if (!p || p <= 0) return '未读';
  if (p >= 0.999) return '已读完';
  return `${Math.round(p * 100)}%`;
}

/** 时长 → 「1 小时 12 分」/「23 分钟」/「不到 1 分钟」 */
export function durationLabel(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return '不到 1 分钟';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} 分钟`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} 小时 ${rest} 分` : `${h} 小时`;
}

/**
 * 书名 → 封面色。色相由 djb2 哈希决定，同一本书永远同一个颜色。
 * 明度压到 22–31%：封面要能托住白字，又不能抢界面里唯一那个强调色。
 */
export function coverColors(seed: string): { c1: string; c2: string } {
  let h = 5381;
  for (let i = 0; i < seed.length; i++) h = ((h << 5) + h + seed.charCodeAt(i)) | 0;
  const n = h >>> 0;
  const hue = n % 360;
  const sat = 16 + ((n >> 7) % 10);
  const light = 28 + ((n >> 13) % 5);
  return { c1: `hsl(${hue} ${sat}% ${light}%)`, c2: `hsl(${hue} ${sat + 3}% ${light - 7}%)` };
}

export interface CoverOpts {
  title: string;
  author?: string;
  percent?: number;
  done?: boolean;
}

/** 生成封面：真封面图（异步到位）+ 竖排书名 + 竖排作者 + 底边 2px 进度。
 *  真图没到时显示的是哈希色块，两者叠在同一个盒子里，图一到就淡入、文字让位。 */
export function bookCover(opts: CoverOpts): HTMLElement {
  const { c1, c2 } = coverColors(opts.title);
  const box = el('div', 'bzr-cover');
  box.style.setProperty('--c1', c1);
  box.style.setProperty('--c2', c2);

  const img = el('img', 'bzr-cover-img');
  img.alt = '';
  img.decoding = 'async';
  img.loading = 'lazy';
  // 图裂了就把盒子退回色块，别留一个破图标
  img.addEventListener('error', () => {
    box.classList.remove('has-img');
    img.removeAttribute('src');
  });
  box.appendChild(img);

  box.appendChild(el('span', 'bt', opts.title));
  if (opts.author) box.appendChild(el('span', 'ba', opts.author));

  const pct = opts.percent ?? 0;
  if (opts.done || pct >= 0.999) {
    box.appendChild(el('span', 'done'));
  } else if (pct > 0) {
    const prog = el('span', 'prog');
    const fill = el('i');
    fill.style.width = `${Math.min(100, Math.round(pct * 100))}%`;
    prog.appendChild(fill);
    box.appendChild(prog);
  }
  return box;
}

/** 真封面到位后换上（image 解码完再切 class，避免闪一下半张图） */
export function setCoverImage(box: HTMLElement, url: string): void {
  const img = box.querySelector<HTMLImageElement>('img.bzr-cover-img');
  if (!img) return;
  img.addEventListener(
    'load',
    () => {
      box.classList.add('has-img');
    },
    { once: true },
  );
  img.src = url;
}

/** 线条图标：三横（目录） */
export function tocIcon(): HTMLElement {
  const box = el('span', 'bzr-i-toc');
  box.append(el('i'), el('i'), el('i'));
  return box;
}

/** 线条图标：放大镜（搜索） */
export function searchIcon(): HTMLElement {
  return el('span', 'bzr-i-search');
}

/** 书签（下沿一个 V 形缺口，用 clip-path 切，不额外占节点） */
export function bookmarkIcon(): HTMLElement {
  return el('span', 'bzr-i-mark');
}

/** 线条图标：全屏（四角括号） */
export function fullscreenIcon(): HTMLElement {
  const box = el('span', 'bzr-i-full');
  box.append(el('i'), el('i'));
  return box;
}

/**
 * 滑杆行：标签 / 轨道 / 读数。
 * 轨道用背景渐变画（--p 控制品牌色走多远），所以 -webkit-slider-runnable-track
 * 必须透明——两层都画会得到一根双色错位的轨道。
 */
export function trackRow(opts: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  format?: (v: number) => string;
  onInput: (v: number) => void;
}): { row: HTMLElement; input: HTMLInputElement; set: (v: number) => void } {
  const fmt = opts.format ?? ((v: number) => String(v));
  const row = el('div', 'bzr-track-row');
  const label = el('span', 'bzr-track-label', opts.label);
  const input = el('input', 'bzr-track-input');
  input.type = 'range';
  input.min = String(opts.min);
  input.max = String(opts.max);
  input.step = String(opts.step);
  const value = el('span', 'bzr-track-value', '');

  const paint = (v: number): void => {
    input.value = String(v);
    value.textContent = fmt(v);
    const span = opts.max - opts.min || 1;
    const p = ((v - opts.min) / span) * 100;
    input.style.setProperty('--p', `${Math.max(0, Math.min(100, p))}%`);
  };

  input.addEventListener('input', () => {
    const v = Number(input.value);
    paint(v);
    opts.onInput(v);
  });

  paint(opts.value);
  row.append(label, input, value);
  return { row, input, set: paint };
}

export interface SegOption<T extends string | number> {
  value: T;
  label: string;
}

/** 分段选择（字体 / 对齐 / 栏数）。返回容器，点一项即切换高亮并回调。 */
export function seg<T extends string | number>(
  options: SegOption<T>[],
  value: T,
  onPick: (v: T) => void,
): HTMLElement {
  const box = el('div', 'bzr-seg');
  const buttons = new Map<T, HTMLButtonElement>();
  for (const opt of options) {
    const b = el('button', opt.value === value ? 'is-on' : '', opt.label);
    b.type = 'button';
    b.addEventListener('click', () => {
      for (const [key, btn] of buttons) btn.classList.toggle('is-on', key === opt.value);
      onPick(opt.value);
    });
    buttons.set(opt.value, b);
    box.appendChild(b);
  }
  return box;
}

/** 主题色块。`on` 项套一圈品牌色描边（用 box-shadow 做，不占布局）。 */
export function swatches<T extends string>(
  options: Array<{ value: T; label: string; bg: string }>,
  value: T,
  onPick: (v: T) => void,
): HTMLElement {
  const box = el('div', 'bzr-swatches');
  const buttons: Array<{ v: T; b: HTMLButtonElement }> = [];
  for (const opt of options) {
    const b = el('button', opt.value === value ? 'is-on' : '');
    b.type = 'button';
    b.setAttribute('aria-label', opt.label);
    b.title = opt.label;
    b.style.background = opt.bg;
    b.addEventListener('click', () => {
      for (const item of buttons) item.b.classList.toggle('is-on', item.v === opt.value);
      onPick(opt.value);
    });
    buttons.push({ v: opt.value, b });
    box.appendChild(b);
  }
  return box;
}
