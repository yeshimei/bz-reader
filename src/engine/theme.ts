/* ============================================================
 * bz-reader · 章节样式注入（engine/theme.ts）
 *
 * **全仓唯一的 `<style>` 注入点。** 别的文件不许自己造 style 标签：
 * 阅读器必须往 iframe 文档里写样式（书自带的 CSS 会覆盖一切宿主设置），
 * 这是 bz 硬约束「样式源只有 styles.css」的例外，范围仅限
 * foliate 渲染的 iframe 文档内部，不外溢到主窗口。
 *
 * 注入走 `paginator.setStyles(css)`，不用 document.createElement('style')——
 * 后者在重排时会累积成多个标签，越读越慢。
 * ============================================================ */
import { FONT_FAMILIES, THEME_OPTIONS, type ReaderPrefs, type ThemeName } from '../data/prefs';

export interface ResolvedTheme {
  textColor: string;
  bgColor: string;
  dark: boolean;
}

/** 主题名 → 实际颜色。auto 读宿主令牌（跟随 Obsidian 明暗）。 */
export function resolveTheme(name: ThemeName): ResolvedTheme {
  const dark = document.body.classList.contains('theme-dark');
  if (name === 'auto') {
    const style = getComputedStyle(document.body);
    const text = style.getPropertyValue('--bzr-text-1').trim() || (dark ? '#c8ccd2' : '#1f1f1f');
    const bg = style.getPropertyValue('--bzr-surface-0').trim() || (dark ? '#17191d' : '#ffffff');
    return { textColor: text, bgColor: bg, dark };
  }
  const opt = THEME_OPTIONS.find((t) => t.value === name) ?? THEME_OPTIONS[1];
  return { textColor: opt.fg, bgColor: opt.bg, dark: name === 'dark' };
}

/**
 * 生成注入 iframe 的 CSS。
 *
 * 全部 `!important`：EPUB 里 `p { color: #333 }` 这类写法极常见，
 * 不加的话「换主题没反应」——用户看到的是书没变，实际是我们被书压住了。
 */
export function buildChapterCSS(prefs: ReaderPrefs): string {
  const theme = resolveTheme(prefs.theme);
  const family = FONT_FAMILIES.find((f) => f.value === prefs.fontFamily)?.css || '';
  const familyDecl = family ? `font-family: ${family} !important;` : '';
  const imgFilter = theme.dark ? 'filter: invert(1) hue-rotate(180deg);' : '';

  return `
html, body {
  background: ${theme.bgColor} !important;
  color: ${theme.textColor} !important;
  ${familyDecl}
  line-height: ${prefs.lineHeight} !important;
  font-size: ${prefs.fontSize}px !important;
  text-align: ${prefs.align} !important;
  -webkit-font-smoothing: antialiased;
}
body {
  padding-left: ${prefs.margin}px !important;
  padding-right: ${prefs.margin}px !important;
  box-sizing: border-box !important;
}
p, div, li, blockquote, dd, dt, td, th {
  line-height: inherit !important;
  color: ${theme.textColor} !important;
  text-align: inherit !important;
  ${familyDecl}
}
h1, h2, h3, h4, h5, h6 {
  line-height: 1.4 !important;
  color: ${theme.textColor} !important;
  ${familyDecl}
}
${imgFilter ? `img, svg, video { ${imgFilter} }` : ''}
a { color: inherit !important; text-decoration: underline !important; }
/* 书里写死的窄栏宽会让字号放大后只剩一行两个字 */
body > div, body > section { max-width: none !important; }
/* 标注覆盖层（overlayer.js 读这两个变量）：
   浅底用 multiply，像真马克笔压过纸；深底必须 normal，multiply 在暗色上等于没画 */
:root {
  --overlayer-highlight-opacity: ${theme.dark ? '0.34' : '0.42'};
  --overlayer-highlight-blend-mode: ${theme.dark ? 'normal' : 'multiply'};
}
`;
}
