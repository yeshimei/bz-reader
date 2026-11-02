/* ============================================================
 * bz-reader · 阅读设置面板（ui/prefs-panel.ts）
 *
 * 右下角弹出的小面板：字号 / 行距 / 页边距 / 字体 / 对齐 / 主题。
 * 改一项立刻生效（不点确定）—— 排版是看着调的，不是填表。
 * ============================================================ */
import {
  FONT_FAMILIES,
  FONT_SIZE_RANGE,
  LINE_HEIGHT_RANGE,
  MARGIN_RANGE,
  THEME_OPTIONS,
  type ReaderPrefs,
} from '../data/prefs';
import { el, segmented, slider } from './dom';

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

  const fontSlider = slider({
    label: '字号',
    ...FONT_SIZE_RANGE,
    value: initial.fontSize,
    format: (v) => `${v}px`,
    onInput: (v) => onChange({ fontSize: v }),
  });
  const lineSlider = slider({
    label: '行距',
    ...LINE_HEIGHT_RANGE,
    value: initial.lineHeight,
    format: (v) => v.toFixed(1),
    onInput: (v) => onChange({ lineHeight: v }),
  });
  const marginSlider = slider({
    label: '页边距',
    ...MARGIN_RANGE,
    value: initial.margin,
    format: (v) => `${v}px`,
    onInput: (v) => onChange({ margin: v }),
  });

  const themeBox = el('div', 'bzr-prefs-row');
  themeBox.appendChild(el('span', 'bzr-slider-label', '主题'));
  const themeHolder = el('div', 'bzr-prefs-holder');
  themeHolder.appendChild(
    segmented(
      THEME_OPTIONS.map((t) => ({ value: t.value, label: t.label, swatch: t.bg || undefined })),
      initial.theme,
      (v) => onChange({ theme: v }),
    ),
  );
  themeBox.appendChild(themeHolder);

  const fontBox = el('div', 'bzr-prefs-row');
  fontBox.appendChild(el('span', 'bzr-slider-label', '字体'));
  const fontHolder = el('div', 'bzr-prefs-holder');
  fontHolder.appendChild(
    segmented(
      FONT_FAMILIES.map((f) => ({ value: f.value, label: f.label })),
      initial.fontFamily,
      (v) => onChange({ fontFamily: v }),
    ),
  );
  fontBox.appendChild(fontHolder);

  const alignBox = el('div', 'bzr-prefs-row');
  alignBox.appendChild(el('span', 'bzr-slider-label', '对齐'));
  const alignHolder = el('div', 'bzr-prefs-holder');
  alignHolder.appendChild(
    segmented(
      [
        { value: 'justify' as const, label: '两端对齐' },
        { value: 'left' as const, label: '左对齐' },
      ],
      initial.align,
      (v) => onChange({ align: v }),
    ),
  );
  alignBox.appendChild(alignHolder);

  root.append(themeBox, fontSlider.row, lineSlider.row, marginSlider.row, fontBox, alignBox);

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
