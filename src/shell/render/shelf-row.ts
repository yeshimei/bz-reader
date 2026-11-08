/* ============================================================
 * bz-reader · 分类行（shell/render/shelf-row.ts）
 *
 * 分类管理弹窗里每一类后面那组动作：上移 / 下移 ｜ 改名 / 删除。
 * 2026-11-09 之前，改名与删除是两颗文字胶囊：手机上一行光按钮就吃掉
 * 大半宽度，名字稍长只剩省略号。现在四个动作统一成方形图标钮——
 * 看得见的是形状（铅笔 / 垃圾桶），读得懂的是 title 与 aria-label。
 *
 * 为什么抽成纯函数：这组按钮的契约就三句话——只画图标、标签不丢、
 * 点击标识不变。放在纯函数里，node 下就能把这三句钉死。
 * ============================================================ */
import { esc, ico } from './html';

export interface ShelfActionLabels {
  /** 上移 / 下移 / 改名 / 删除：调用点传 t() 的结果，这里不碰 i18n */
  up: string;
  down: string;
  rename: string;
  del: string;
}

/** 一枚动作钮：图标 + 悬停提示 + 读屏标签，尺寸与间距交给 .bzs-shelfrow */
function actBtn(cls: string, act: string, name: string, label: string, icon: string, extra = ''): string {
  const klass = cls ? `bzs-cbtn ${cls}` : 'bzs-cbtn';
  return `<button class="${klass}" data-act="${act}"${extra} data-name="${esc(name)}" title="${esc(
    label,
  )}" aria-label="${esc(label)}">${ico(icon)}</button>`;
}

export function shelfActionsHtml(name: string, labels: ShelfActionLabels): string {
  return `<span class="sp"></span>
    ${actBtn('up', 'shelfmove', name, labels.up, 'chevron', ' data-v="up"')}
    ${actBtn('down', 'shelfmove', name, labels.down, 'chevron', ' data-v="down"')}
    <span class="sep"></span>
    ${actBtn('', 'shelfrename', name, labels.rename, 'pencil')}
    ${actBtn('danger', 'shelfdel', name, labels.del, 'trash')}`;
}
