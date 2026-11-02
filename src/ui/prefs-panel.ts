/* ============================================================
 * bz-reader · 排版面板（ui/prefs-panel.ts）
 *
 * 桌面从右下浮起（318px 小卡），移动端从底部长出来（sheet + 抓手）。
 * 同一个 DOM，两套皮——因为它调的是同一组值，拆两份没有意义。
 *
 * 原型 reader-v2 的三个件：
 *   - 滑杆带刻度档（先看得清档位再拖）
 *   - 方向不用文字钮，直接画一小格竖排示意——横竖的区别不用读字就知道
 *   - 主题是纸样圆，选中的圆外一圈铜环
 *
 * 改一项立刻生效（不点确定）：排版是看着调的，不是填表。
 * ============================================================ */
import {
  FONT_FAMILIES,
  FONT_SIZE_RANGE,
  LINE_HEIGHT_RANGE,
  MARGIN_RANGE,
  THEME_OPTIONS,
  type ReaderPrefs,
} from '../data/prefs';
import { el, seg, swatches, trackRow } from './dom';

export interface PrefsPanel {
  root: HTMLElement;
  show: () => void;
  hide: () => void;
  toggle: () => void;
  isOpen: () => boolean;
  refresh: (prefs: ReaderPrefs) => void;
}

/** 方向示意格：两枚小格里直接画出横排/竖排的样子，选中格铜边 */
function dirGrid(value: ReaderPrefs['layout'], onPick: (v: ReaderPrefs['layout']) => void): HTMLElement {
  const box = el('div', 'bzr-dirgrid');
  const defs: Array<{ value: ReaderPrefs['layout']; label: string; demo: string; vert: boolean }> = [
    { value: 'horizontal', label: '横排', demo: '山月记', vert: false },
    { value: 'vertical', label: '竖排', demo: '山月记', vert: true },
  ];
  for (const d of defs) {
    const cell = el('button', `bzr-dir${d.vert ? ' bzr-dir-vert' : ''}${d.value === value ? ' is-on' : ''}`);
    cell.type = 'button';
    cell.setAttribute('aria-label', d.label);
    cell.appendChild(el('span', 'bzr-dir-demo', d.demo));
    cell.appendChild(el('span', 'bzr-dir-label', d.label));
    cell.addEventListener('click', () => {
      for (const c of Array.from(box.children)) c.classList.remove('is-on');
      cell.classList.add('is-on');
      onPick(d.value);
    });
    box.appendChild(cell);
  }
  return box;
}

export function createPrefsPanel(initial: ReaderPrefs, onChange: (patch: Partial<ReaderPrefs>) => void): PrefsPanel {
  const root = el('div', 'bzr-prefs');
  // 桌面头行（衬线「排 版」+ 说明 + ✕）；移动 sheet 用抓手+标题，头行被 CSS 藏掉
  const head = el('div', 'bzr-prefs-head');
  const closeBtn = el('button', 'x', '✕');
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', '关闭排版面板');
  closeBtn.addEventListener('click', () => root.classList.remove('is-open'));
  head.append(el('b', '', '排 版'), el('span', 'n', '改动立即生效'), el('span', 'sp'), closeBtn);
  // 抓手与标题只在移动 sheet 形态下显示（CSS 控制，不在这里判断平台）
  root.append(head, el('div', 'bzr-msheet-grab'), el('div', 'bzr-msheet-title', '排版'));

  const fontSlider = trackRow({
    label: '字号',
    ...FONT_SIZE_RANGE,
    value: initial.fontSize,
    format: (v) => `${v}px`,
    ticks: 7,
    onInput: (v) => onChange({ fontSize: v }),
  });
  const lineSlider = trackRow({
    label: '行距',
    ...LINE_HEIGHT_RANGE,
    value: initial.lineHeight,
    format: (v) => v.toFixed(1),
    ticks: 5,
    onInput: (v) => onChange({ lineHeight: v }),
  });
  const marginSlider = trackRow({
    label: '页边距',
    ...MARGIN_RANGE,
    value: initial.margin,
    format: (v) => `${v}`,
    ticks: 5,
    onInput: (v) => onChange({ margin: v }),
  });

  /* 字体：跟随 / 宋 / 黑。移动端这一行末尾再挂一个「两端」 */
  let align: ReaderPrefs['align'] = initial.align;

  /* 对齐：桌面单列一行；移动端并进字体那行（只留一个切换钮） */
  const alignSeg = seg(
    [
      { value: 'justify' as const, label: '两端对齐' },
      { value: 'left' as const, label: '左对齐' },
    ],
    initial.align,
    (v) => {
      align = v;
      alignToggle.textContent = v === 'left' ? '左对齐' : '两端';
      onChange({ align: v });
    },
  );
  const alignRow = el('div', 'bzr-prefs-align-row');
  alignRow.append(el('span', 'bzr-track-label', '对齐'), alignSeg);

  const fontSeg = seg(
    FONT_FAMILIES.map((f) => ({ value: f.value, label: f.label.replace(' / 衬线', '').replace(' / 无衬线', '') })),
    initial.fontFamily,
    (v) => onChange({ fontFamily: v }),
  );
  const alignToggle = el('button', 'bzr-prefs-align-inline', initial.align === 'left' ? '左对齐' : '两端');
  alignToggle.type = 'button';
  alignToggle.title = '切换对齐方式';
  alignToggle.addEventListener('click', () => {
    align = align === 'justify' ? 'left' : 'justify';
    alignToggle.textContent = align === 'left' ? '左对齐' : '两端';
    const buttons = Array.from(alignSeg.querySelectorAll('button'));
    buttons[0]?.classList.toggle('is-on', align === 'justify');
    buttons[1]?.classList.toggle('is-on', align === 'left');
    onChange({ align });
  });
  fontSeg.appendChild(alignToggle);
  const fontRow = el('div', 'bzr-track-row');
  fontRow.append(el('span', 'bzr-track-label', '字体'), fontSeg);

  const themeRow = el('div', 'bzr-track-row');
  themeRow.append(
    el('span', 'bzr-track-label', '主题'),
    swatches(
      THEME_OPTIONS.map((t) => ({
        value: t.value,
        label: t.label,
        bg: t.bg || 'linear-gradient(135deg,#f5efdf 50%,#211c15 50%)',
      })),
      initial.theme,
      (v) => onChange({ theme: v }),
    ),
  );

  const rows: HTMLElement[] = [fontSlider.row, lineSlider.row, marginSlider.row, fontRow, alignRow];
  // 方向与栏数是高级版能力：写进 if 而不是三元，base 构建时连字符串一起被删。
  // dirGrid 必须在块内直接调用（摇树教训：隔一层中间函数整个模块漏进 base）
  if (__BZ_READER_PRO__) {
    const layoutRow = el('div', 'bzr-prefs-block');
    layoutRow.append(el('span', 'bzr-track-label', '方向'), dirGrid(initial.layout, (v) => onChange({ layout: v })));
    const columnsRow = el('div', 'bzr-track-row');
    columnsRow.append(
      el('span', 'bzr-track-label', '栏数'),
      seg(
        [
          { value: 1 as const, label: '单栏' },
          { value: 2 as const, label: '双栏' },
        ],
        initial.columns,
        (v) => onChange({ columns: v }),
      ),
    );
    rows.push(layoutRow, columnsRow);
  }
  rows.push(themeRow);
  root.append(...rows);

  return {
    root,
    show: () => root.classList.add('is-open'),
    hide: () => root.classList.remove('is-open'),
    toggle: () => root.classList.toggle('is-open'),
    isOpen: () => root.classList.contains('is-open'),
    refresh: (prefs) => {
      fontSlider.set(prefs.fontSize);
      lineSlider.set(prefs.lineHeight);
      marginSlider.set(prefs.margin);
    },
  };
}
