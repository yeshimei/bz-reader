/* ============================================================
 * bz-reader · 渲染小工具
 * 全部是纯函数：输入数据，输出 HTML 字符串。不碰 DOM、不碰状态。
 * ============================================================ */

/** 转义：拼 innerHTML 必须过这一道，书名里出现 < 不能让页面塌 */
export function esc(s: unknown): string {
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
    gear: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.4M12 18.8v2.4M4.4 7.6l2 1.2M17.6 15.2l2 1.2M4.4 16.4l2-1.2M17.6 8.8l2-1.2"/>',
    help: '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.4a2.5 2.5 0 114 2.1c-.9.7-1.6 1.2-1.6 2.4"/><circle cx="12" cy="17" r=".7" fill="currentColor"/>',
    /* 下面几枚是替掉字符图标的：★ ☆ ✦ ✓ ✕ 🔥 的粗细和基线全由字体决定，
       换一台机器就对不齐，是最典型的廉价信号。 */
    x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    star:
      '<path d="M12 3.6l2.6 5.4 5.9.8-4.3 4.2 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.8l5.9-.8z"/>',
    check: '<path d="M4.5 12.5l5 5 10-11"/>',
    sparkle: '<path d="M12 3.5l1.9 5.4 5.4 1.9-5.4 1.9L12 18.1l-1.9-5.4L4.7 10.8l5.4-1.9z"/>',
    flame: '<path d="M12 22a6 6 0 006-6c0-4.2-3.2-6.2-4.2-9.2C11.8 8.4 11 10 11 10s-1-1.2-1.2-3C8.4 8.6 6 11 6 16a6 6 0 006 6z"/>',
  };
  const p = paths[name] || '';
  return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
}

/** 中文数字：Book Map 的章节序号用，只在 1..99 上有意义。
 *  侧栏目录已经不用它了（那 24px 宁可留给章节名）。 */
export function cn(n: number): string {
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
