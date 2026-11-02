/* ============================================================
 * bz-reader · 章节样式注入（engine/theme.ts）
 *
 * **全仓唯一的 `<style>` 注入点。** 别的文件不许自己造 style 标签：
 * 阅读器必须往 iframe 文档里写样式（书自带的 CSS 会覆盖一切宿主设置），
 * 这是 bz 硬约束「样式源只有 styles.css」的第三个例外，范围仅限
 * foliate 渲染的 iframe 文档内部，不外溢到主窗口。
 *
 * 注入走 `paginator.setStyles(css)`，不用 document.createElement('style')——
 * 后者在重排时会累积成多个标签，越读越慢。
 * ============================================================ */

export interface ReaderTheme {
  /** 正文字号 px */
  fontSize: number;
  /** 行距倍数 */
  lineHeight: number;
  /** 页面左右留白 px */
  margin: number;
  /** 字体族；空 = 跟随书自带 */
  fontFamily: string;
  textColor: string;
  bgColor: string;
  /** 浅色/深色标记，给书里的图片做反相兜底 */
  dark: boolean;
}

export const DEFAULT_THEME: ReaderTheme = {
  fontSize: 18,
  lineHeight: 1.8,
  margin: 32,
  fontFamily: '',
  textColor: '',
  bgColor: '',
  dark: false,
};

/**
 * 生成注入 iframe 的 CSS。
 *
 * 全部 `!important`：EPUB 里 `p { color: #333 }` 这类写法极常见，
 * 不加的话「换主题没反应」——用户看到的是书没变，实际是我们被书压住了。
 */
export function buildChapterCSS(t: ReaderTheme): string {
  const family = t.fontFamily ? `font-family: ${t.fontFamily} !important;` : '';
  const color = t.textColor ? `color: ${t.textColor} !important;` : '';
  const bg = t.bgColor ? `background: ${t.bgColor} !important;` : '';
  const imgFilter = t.dark ? 'filter: invert(1) hue-rotate(180deg);' : '';

  return `
html, body {
  ${bg}
  ${color}
  ${family}
  line-height: ${t.lineHeight} !important;
  font-size: ${t.fontSize}px !important;
  -webkit-font-smoothing: antialiased;
}
body {
  padding-left: ${t.margin}px !important;
  padding-right: ${t.margin}px !important;
  box-sizing: border-box !important;
}
p, div, li, blockquote, dd, dt, td, th {
  line-height: inherit !important;
  ${color}
  ${family}
}
h1, h2, h3, h4, h5, h6 {
  line-height: 1.4 !important;
  ${color}
}
${imgFilter ? `img, svg, video { ${imgFilter} }` : ''}
a { color: inherit !important; text-decoration: underline !important; }
/* 书里写死的窄栏宽会让字号放大后只剩一行两个字 */
body > div, body > section { max-width: none !important; }
`;
}

/** 从宿主 CSS 变量取色（跟随 Obsidian 明暗），拿不到就交给书自己的底色 */
export function themeFromHost(): Pick<ReaderTheme, 'textColor' | 'bgColor' | 'dark'> {
  const style = getComputedStyle(document.body);
  const text = style.getPropertyValue('--bzr-text-1').trim();
  const bg = style.getPropertyValue('--bzr-surface-0').trim();
  const dark = document.body.classList.contains('theme-dark');
  return { textColor: text, bgColor: bg, dark };
}
