/**
 * 阅读页的三种失败态与加载态（S13 定稿，纯函数，node 里可直接测）。
 *
 * 统一的读法：**标题说结论，第二行说原因，动作最多三个**。
 *   · 这本书不在书架上 → 只要「回书架」；
 *   · 找不到文件 → 「重新定位文件…」在前，回书架/重试在后；
 *   · 打不开 → 带一份自检信息（平台 / 阶段 / 文件 / iframe·blob），
 *     用户看不懂也不碍事，真机排查全靠它。
 *
 * 不编造进度：加载中只写「正在打开《书名》…」，没有真实百分比就不画进度条。
 */

import { ico } from '../shell/render/html';
import { t } from '../i18n';

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
}

export interface FaultDiagLine {
  k: string;
  v: string;
}

export interface FaultAction {
  label: string;
  act: string;
  primary?: boolean;
}

export interface FaultInput {
  /** ico 名：book / folder / alert */
  icon: string;
  title: string;
  desc: string;
  diag?: FaultDiagLine[];
  actions: FaultAction[];
}

export function faultHtml(input: FaultInput): string {
  /* 自检信息默认折起来：普通读者看到「内核 Chromium 142 / iframe·blob ✓」
     只会困惑（真机两次提到），真机排查时展开「详情」即可。 */
  const diag = input.diag?.length
    ? `<details class="bzs-fault-more"><summary>${esc(t('fault.details'))}</summary><div class="bzs-fault-diag">${input.diag
        .map((l) => `<div data-k="${esc(l.k)}"><span class="k">${esc(l.k)}</span>${esc(l.v)}</div>`)
        .join('')}</div></details>`
    : '';
  const acts = input.actions
    .map(
      (a) =>
        `<button class="bzs-btn${a.primary ? ' pri' : ''}" data-act="${esc(a.act)}">${esc(a.label)}</button>`,
    )
    .join('');
  return `<div class="bzs-fault">
    <span class="fi">${ico(input.icon)}</span>
    <b>${esc(input.title)}</b>
    <p>${esc(input.desc)}</p>
    ${diag}
    <div class="acts">${acts}</div>
  </div>`;
}

/**
 * 加载中：一个转圈 + 一行字。
 *
 * 打开一本大书要解包、解析目录、排版三步，手机上是好几秒——这段时间
 * 屏幕是空的，不说清楚在干什么，就会被当成点错了。
 */
export function loadingHtml(title: string): string {
  return `<div class="bzs-fault is-loading">
    <div class="spin"></div>
    <div class="mini">正在打开《${esc(title)}》…</div>
  </div>`;
}
