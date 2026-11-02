/* ============================================================
 * bz-reader · 排版面板（ui/prefs-panel.ts）
 *
 * 桌面从右下浮起（280px 小卡），移动端从底部长出来（sheet + 抓手）。
 * 同一个 DOM，两套皮——因为它调的是同一组值，拆两份没有意义。
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

export function createPrefsPanel(initial: ReaderPrefs, onChange: (patch: Partial<ReaderPrefs>) => void): PrefsPanel {
  const root = el('div', 'bzr-prefs');
  // 抓手与标题只在移动 sheet 形态下显示（CSS 控制，不在这里判断平台）
  root.append(el('div', 'bzr-msheet-grab'), el('div', 'bzr-msheet-title', '排版'));

  const fontSlider = trackRow({
    label: '字号',
    ...FONT_SIZE_RANGE,
    value: initial.fontSize,
    format: (v) => `${v}px`,
    onInput: (v) => onChange({ fontSize: v }),
  });
  const lineSlider = trackRow({
    label: '行距',
    ...LINE_HEIGHT_RANGE,
    value: initial.lineHeight,
    format: (v) => v.toFixed(1),
    onInput: (v) => onChange({ lineHeight: v }),
  });
  const marginSlider = trackRow({
    label: '页边距',
    ...MARGIN_RANGE,
    value: initial.margin,
    format: (v) => `${v}`,
    onInput: (v) => onChange({ margin: v }),
  });

  /* 字体：跟随 / 宋 / 黑。移动端这一行末尾再挂一个「两端」，和原型一致 */
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
        bg: t.bg || 'linear-gradient(140deg,#2a2a32,#16161c)',
      })),
      initial.theme,
      (v) => onChange({ theme: v }),
    ),
  );

  root.append(fontSlider.row, lineSlider.row, marginSlider.row, fontRow, alignRow, themeRow);

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
