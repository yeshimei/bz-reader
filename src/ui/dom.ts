/* bz-reader · DOM 小工具（ui/dom.ts）
 * 只有几个最常用的：建元素、设属性、清空、按钮、分段选择。刻意不做虚拟 DOM。 */

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

export function setAttrs(node: HTMLElement, attrs: Record<string, string | undefined>): void {
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined) node.removeAttribute(k);
    else node.setAttribute(k, v);
  }
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

export function iconButton(label: string, icon: string, cls = ''): HTMLButtonElement {
  const b = el('button', `bzr-icon-btn ${cls}`.trim());
  b.type = 'button';
  b.setAttribute('aria-label', label);
  b.title = label;
  b.innerHTML = icon;
  return b;
}

/** 分段选择（主题色块 / 对齐方式这类二到五项互斥选择）。返回容器，项点击回调 value。 */
export function segmented<T extends string>(
  options: Array<{ value: T; label: string; swatch?: string }>,
  value: T,
  onPick: (v: T) => void,
): HTMLElement {
  const box = el('div', 'bzr-seg');
  for (const opt of options) {
    const b = el('button', 'bzr-seg-item' + (opt.value === value ? ' is-on' : ''));
    b.type = 'button';
    b.textContent = opt.label;
    if (opt.swatch) {
      const dot = el('span', 'bzr-seg-dot');
      dot.style.background = opt.swatch;
      b.prepend(dot);
    }
    b.addEventListener('click', () => {
      for (const child of Array.from(box.children)) child.classList.remove('is-on');
      b.classList.add('is-on');
      onPick(opt.value);
    });
    box.appendChild(b);
  }
  return box;
}

/** 带数值回显的滑杆（字号 18 这种）。返回 { row, set } */
export function slider(opts: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  format?: (v: number) => string;
  onInput: (v: number) => void;
}): { row: HTMLElement; set: (v: number) => void } {
  const row = el('div', 'bzr-slider');
  const label = el('span', 'bzr-slider-label', opts.label);
  const input = el('input', 'bzr-slider-input');
  input.type = 'range';
  input.min = String(opts.min);
  input.max = String(opts.max);
  input.step = String(opts.step);
  input.value = String(opts.value);
  const fmt = opts.format ?? ((v: number) => String(v));
  const value = el('span', 'bzr-slider-value', fmt(opts.value));
  input.addEventListener('input', () => {
    const v = Number(input.value);
    value.textContent = fmt(v);
    opts.onInput(v);
  });
  row.append(label, input, value);
  return {
    row,
    set: (v: number) => {
      input.value = String(v);
      value.textContent = fmt(v);
    },
  };
}
