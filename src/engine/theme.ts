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

const DARK_THEMES: ReadonlySet<ThemeName> = new Set(['ink', 'moss', 'night']);

/** 铜金：暗主题亮一档，纸面压深一档。正文里的章题短线与首字下沉用它。 */
export function copperOf(dark: boolean): string {
  return dark ? '#c8a464' : '#9a7434';
}

/** 主题名 → 实际颜色。auto 读宿主令牌（跟随 Obsidian 明暗）。 */
export function resolveTheme(name: ThemeName): ResolvedTheme {
  const dark = document.body.classList.contains('theme-dark');
  if (name === 'auto') {
    const style = getComputedStyle(document.body);
    const text = style.getPropertyValue('--bzr-text-1').trim() || (dark ? '#ede4d4' : '#2c2519');
    const bg = style.getPropertyValue('--bzr-surface-0').trim() || (dark ? '#211c15' : '#f5efdf');
    return { textColor: text, bgColor: bg, dark };
  }
  const opt = THEME_OPTIONS.find((t) => t.value === name) ?? THEME_OPTIONS[1];
  return { textColor: opt.fg, bgColor: opt.bg, dark: DARK_THEMES.has(name) };
}

/**
 * 生成注入 iframe 的 CSS。
 *
 * 全部 `!important`：EPUB 里 `p { color: #333 }` 这类写法极常见，
 * 不加的话「换主题没反应」——用户看到的是书没变，实际是我们被书压住了。
 *
 * 版式（原型 reader-v2「书是主角」一套）：
 *   - 章题（h1）居中、衬线字距，下面一条 34px 铜金短线——整章唯一的装饰
 *   - 次级标题（h2/h3）居中但不出线
 *   - 正文加 0.015em 字距（汉字可读性贴着排印下限给）
 *   - 横排时首段首字下沉（铜金）；竖排的 writing-mode 下 float 行为不可控，跳过
 */
export function buildChapterCSS(prefs: ReaderPrefs): string {
  const theme = resolveTheme(prefs.theme);
  const family = FONT_FAMILIES.find((f) => f.value === prefs.fontFamily)?.css || '';
  const familyDecl = family ? `font-family: ${family} !important;` : '';
  const imgFilter = theme.dark ? 'filter: invert(1) hue-rotate(180deg);' : '';
  const copper = copperOf(theme.dark);
  // 竖排写在 html 上，body 继承。foliate 引擎在每次章节装载时读 body 的
  // computed writing-mode 判定横竖（paginator.js 的 getDirection），而注入
  // 恰好发生在那次读取之前——所以竖排不需要任何引擎侧配合，改 prefs 重注即可。
  // 用 if 赋值而不是三元：dev 构建不开 minify，三元里的分支字符串会原样
  // 留在 base 包里，看起来像基础版漏了高级功能（历史坑 #3）。竖排是 pro 能力。
  let verticalDecl = '';
  if (__BZ_READER_PRO__ && prefs.layout === 'vertical') {
    verticalDecl = 'html { writing-mode: vertical-rl !important; }';
  }
  // 首字下沉只给横排：竖排里 float 会把字提到整页最上头，没法用
  let dropCapDecl = '';
  if (prefs.layout !== 'vertical' || !__BZ_READER_PRO__) {
      dropCapDecl = `
body > p:first-of-type::first-letter {
  float: left !important;
  font-size: 2.6em !important;
  line-height: 0.9 !important;
  padding: 0.05em 0.14em 0 0 !important;
  color: ${copper} !important;
  font-weight: 500 !important;
}`;
  }

  return `
html, body {
  background: ${theme.bgColor} !important;
  color: ${theme.textColor} !important;
  ${familyDecl}
  line-height: ${prefs.lineHeight} !important;
  font-size: ${prefs.fontSize}px !important;
  text-align: ${prefs.align} !important;
  letter-spacing: 0.015em !important;
  -webkit-font-smoothing: antialiased;
}
${verticalDecl}
body {
  /* 顶栏底栏是悬浮毛玻璃条（原型①：工具悬浮在正文上），上下留白由正文
     自己让出来——竖排时这是块方向留白，同样成立 */
  padding-top: 68px !important;
  padding-bottom: 60px !important;
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
h1 {
  text-align: center !important;
  font-size: 1.5em !important;
  font-weight: 500 !important;
  letter-spacing: 0.08em !important;
  margin-top: 1.4em !important;
  margin-bottom: 1.5em !important;
}
h1::after {
  content: "" !important;
  display: block !important;
  width: 34px !important;
  height: 1px !important;
  margin: 1.1em auto 0 !important;
  background: ${copper} !important;
  opacity: 0.7;
}
h2, h3 {
  text-align: center !important;
  font-weight: 500 !important;
  letter-spacing: 0.06em !important;
}
${dropCapDecl}
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
