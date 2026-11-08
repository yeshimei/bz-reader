/* ============================================================
 * bz-reader · 渲染小工具
 * 全部是纯函数：输入数据，输出 HTML 字符串。不碰 DOM、不碰状态。
 * ============================================================ */

import { locale } from '../../i18n';

/** 转义：拼 HTML 必须过这一道，书名里出现 < 不能让页面塌。
 *  **全仓只此一份**（D8）：浮卡、工具条、想法输入条以前各抄了一份，
 *  改一处漏三处时，注入的落点就藏在漏掉的那一份里。 */
export function esc(s: string | number | null | undefined): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}


/** 线描图标：16px、1.5 描边、圆头圆角，与原型同一套 */
export function ico(name: string): string {
  const paths: Record<string, string> = {
    shelf: '<path d="M3 4h6v16H3zM11 4h4v16h-4zM17 5l3 15"/>',
    /* 书架页签那一组：书库 / 笔记 / 统计 / 设置，同一套线宽 */
    library: '<path d="M4 5.5h4.2V19H4zM9.9 5.5h4.2V19H9.9z"/><path d="M15.9 6.2l3.5 13.2"/>',
    note: '<path d="M6 3.5h8.5L18 7v13.5H6z"/><path d="M9 9h6M9 12.5h6M9 16h4"/>',
    chart: '<path d="M4 19.5V11M10 19.5V5M16 19.5v-6"/><path d="M2.5 21h19"/>',
    board: '<path d="M4 6h16M7 12h13M7 18h13"/><circle cx="4.6" cy="12" r=".6" fill="currentColor"/><circle cx="4.6" cy="18" r=".6" fill="currentColor"/>',
    pen: '<path d="M4 20l4.6-1.1L19 8.5 15.5 5 5.1 15.4z"/><path d="M14 6.5L17.5 10"/>',
    bookmark: '<path d="M7 4h10v16l-5-3.6L7 20z"/>',
    ai: '<path d="M12 3.5l1.9 5.4 5.4 1.9-5.4 1.9L12 18.1l-1.9-5.4L4.7 10.8l5.4-1.9z"/>',
    read: '<path d="M3 5.5A1.5 1.5 0 014.5 4H9a3 3 0 013 3v12a2.5 2.5 0 00-2.5-2.5H3zM21 5.5A1.5 1.5 0 0019.5 4H15a3 3 0 00-3 3v12a2.5 2.5 0 012.5-2.5H21z"/>',
    search: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5.5 5.5"/>',
    import: '<path d="M12 3v11M8 10l4 4 4-4M4 18v2h16v-2"/>',
    folder: '<path d="M3 6.5h6l1.6 2H21v10.5H3z"/>',
    theme: '<circle cx="12" cy="12" r="8"/><path d="M12 4v16"/>',
    /* 齿轮要真的是齿轮：原来那个是「圆 + 六根放射短线」，缩到 16px 就是太阳/亮度。
       换成八齿廓 + 中心圆，和这套 1.5 描边在 16px 下还能看出一圈齿。 */
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    help: '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.4a2.5 2.5 0 114 2.1c-.9.7-1.6 1.2-1.6 2.4"/><circle cx="12" cy="17" r=".7" fill="currentColor"/>',
    /* 下面几枚是替掉字符图标的：★ ☆ ✦ ✓ ✕ 🔥 的粗细和基线全由字体决定，
       换一台机器就对不齐，是最典型的廉价信号。 */
    x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    /* 下拉指示：书架排序按钮用，替掉原生 select 的箭头 */
    chevron: '<path d="M6 9.5l6 6 6-6"/>',
    star:
      '<path d="M12 3.6l2.6 5.4 5.9.8-4.3 4.2 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.8l5.9-.8z"/>',
    check: '<path d="M4.5 12.5l5 5 10-11"/>',
    sparkle: '<path d="M12 3.5l1.9 5.4 5.4 1.9-5.4 1.9L12 18.1l-1.9-5.4L4.7 10.8l5.4-1.9z"/>',
    flame: '<path d="M12 22a6 6 0 006-6c0-4.2-3.2-6.2-4.2-9.2C11.8 8.4 11 10 11 10s-1-1.2-1.2-3C8.4 8.6 6 11 6 16a6 6 0 006 6z"/>',
    /* 关于条的三枚：视频教程 / 交流群 / 更新日志。播放三角是实心的——
       1.5 描边的小三角在 15px 下会糊成一个墨点。 */
    video:
      '<rect x="2.8" y="5" width="18.4" height="14" rx="3.2"/><path d="M10.3 9.4 15 12l-4.7 2.6z" fill="currentColor" stroke="none"/>',
    group:
      '<path d="M20.5 11.4a7.9 7.9 0 0 1-8.5 7.9 8.6 8.6 0 0 1-3.5-.8L4.6 20.4l1.5-4A7.7 7.7 0 0 1 4 11.4 7.9 7.9 0 0 1 12.2 3.5a7.9 7.9 0 0 1 8.3 7.9Z"/><path d="M9 11.5h.01M12.2 11.5h.01M15.4 11.5h.01"/>',
    history: '<path d="M3.4 12a8.6 8.6 0 1 0 2.9-6.4L3.4 8"/><path d="M3.2 3.4v4.9h4.9"/><path d="M12 7.4v5l3.1 2"/>',
  };
  const p = paths[name] || '';
  return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
}

/**
 * GitHub 实心徽记（24 viewBox，吃 currentColor）。
 *
 * 线描版在 15px 下认不出是 GitHub，所以这一枚走实心。关于条与更新日志
 * 弹窗共用一份——同一个标志在两处长成两个样子是最容易被看出来的廉价感。
 */
export function githubIcon(size = 15): string {
  return (
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor" aria-hidden="true">` +
    '<path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 ' +
    '0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 ' +
    '1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 ' +
    '0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 ' +
    '1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 ' +
    '0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297 ' +
    'c0-6.627-5.373-12-12-12"/></svg>'
  );
}

/**
 * Obsidian 原生图标（lucide 那一套）：24 viewBox、2 描边。
 *
 * 与 ico() 的区别只在描边与路径来源：侧栏页签要和宿主自己的标签栏并排，
 * 1.5 描边的自绘线在 18px 下比宿主图标细一档，一眼能看出是外来的。
 * 路径与 Obsidian 的 setIcon 同源（lucide-static）。
 */
export function icoNative(name: string, size = 18): string {
  const paths: Record<string, string> = {
    'book-open':
      '<path d="M12 5v16"/><path d="M20.001 19A2 2 0 0022 17V5a2 2 0 00-1.999-2L16 3.002A5 5 0 0012 5a5 5 0 00-4-2H4a2 2 0 00-2 2v12a2 2 0 001.999 2H8a5 5 0 014 2 5 5 0 014-2z"/>',
    bookmark:
      '<path d="M17 3a2 2 0 0 1 2 2v15a1 1 0 0 1-1.496.868l-4.512-2.578a2 2 0 0 0-1.984 0l-4.512 2.578A1 1 0 0 1 5 20V5a2 2 0 0 1 2-2z"/>',
    highlighter:
      '<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>',
    sparkles:
      '<path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/><path d="M20 2v4"/><path d="M22 4h-4"/><circle cx="4" cy="20" r="2"/>',
    'list-tree':
      '<path d="M8 5h13"/><path d="M13 12h8"/><path d="M13 19h8"/><path d="M3 10a2 2 0 0 0 2 2h3"/><path d="M3 5v12a2 2 0 0 0 2 2h3"/>',
  };
  const p = paths[name] || '';
  return `<svg class="bzs-ico-native" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
}

/**
 * 章节序号：中文数字。
 *
 * 只在 zh / zh-TW 下转，其余语言直接给阿拉伯数字（D7）——以前不管界面语言
 * 一律输出「一二三」，英文界面里全书鸟瞰就成了「Chapter 一」，读起来像串码。
 * 只在 1..99 上有意义，再大也没有中文习惯写法，落回阿拉伯数字。
 */
export function cn(n: number): string {
  const l = locale();
  if (l !== 'zh' && l !== 'zh-TW') return String(n);
  const d = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
  if (n <= 10) return d[n - 1] || String(n);
  if (n < 20) return '十' + (d[n - 11] || '');
  if (n < 100) {
    const t = Math.floor(n / 10);
    const r = n % 10;
    return d[t - 1] + '十' + (r ? d[r - 1] : '');
  }
  return String(n);
}

/** 小放大镜：输入井左侧那枚 */
export const MAG = '<svg width="13" height="13" viewBox="0 0 14 14" fill="none"><circle cx="6" cy="6" r="4.4" stroke="currentColor" stroke-width="1.2"/><path d="M9.4 9.4L12.6 12.6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>';

/**
 * 竖排题签封面 / 真实封面图，两种形态一处出。
 *
 * id 非空就在节点上留 data-cid：真封面是异步来的（要解 epub），
 * 由 shell/covers.ts 的 hydrateCovers 就地换图，不走重绘。
 */
export function coverHtml(
  r: { coverUrl: string | null; bg: string; fg: string; glyph: string; title: string; id?: string },
  cls = '',
): string {
  const cid = r.id ? ` data-cid="${esc(r.id)}" data-title="${esc(r.title)}"` : '';
  if (r.coverUrl) {
    return `<div class="bzs-cov ${cls}"${cid} style="background:${r.bg}"><img class="bzs-covimg" src="${esc(
      r.coverUrl,
    )}" alt="${esc(r.title)}" loading="lazy"></div>`;
  }
  return `<div class="bzs-cov ${cls}"${cid} style="background:${r.bg};color:${r.fg}"><span class="spine"></span><span class="ct">${esc(
    r.glyph,
  )}</span></div>`;
}

/** 进度条：0..100，同一个样式在书卡、继续阅读、列表里复用 */
export function barHtml(percent: number): string {
  const w = Math.max(0, Math.min(100, percent));
  return `<div class="bar"><i style="width:${w}%"></i></div>`;
}
