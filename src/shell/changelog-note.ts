/* ============================================================
 * bz-reader · 更新日志弹窗（shell/changelog-note.ts）
 *
 * 版式照 bz 插件的更新日志小窗（2026-11-02 定稿），两端共用一份 DOM：
 *   桌面（>768px） 214px 版本时间轴（一根细线串起点，当前版实心点）+ 右侧
 *                单版正文（眉标 / 大号等宽版本号 / 改动统计 → 三段 → 页脚入口）；
 *   移动（≤768px） 不设版本栏：顶栏（标题 + 关闭）+ 全部版本按新→旧铺成一篇
 *                文档流 + 底部入口条。
 * 靠 CSS 媒体查询切换，不在 JS 里判断宽度——改窗口大小也不会错位。
 *
 * 数据全部来自 shell/changelog（内置），这里只负责「画」与「切版本」。
 * 打开方式只有一处：升级后第一次进书库（plugin.maybeShowChangelog 判定）。
 * ============================================================ */
import { uiModal } from '../core/ui/modal';
import { setHtml } from '../ui/dom';
import { esc } from './render/html';
import {
  normalizeVersion,
  releaseEntryCount,
  type ChangelogEntry,
  type ChangelogRelease,
} from './changelog';

/** 三段定义：顺序即渲染顺序，措辞与线上更新日志同一套 */
const SECTIONS = [
  { key: 'added', label: '新功能', cls: 'add' },
  { key: 'improved', label: '体验优化', cls: 'imp' },
  { key: 'fixed', label: '修复', cls: 'fix' },
] as const;

const REPO_URL = 'https://github.com/yeshimei/bz-reader';

const CLOSE_SVG =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';

const CLOCK_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" ' +
  'stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>' +
  '<path d="M12 7v5l3 2"/></svg>';

/* GitHub 与「反馈」都取 Simple Icons / 线描的官方形状，颜色吃 currentColor：
   页脚这一排是同等重要的出口，谁单独带品牌色都会把视线抢过去。 */
const GITHUB_SVG =
  '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">' +
  '<path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 ' +
  '0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 ' +
  '1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 ' +
  '0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 ' +
  '1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 ' +
  '0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297 ' +
  'c0-6.627-5.373-12-12-12"/></svg>';

const FEEDBACK_SVG =
  '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9.2 9.2 0 0 1-3.8-.8L3 21l1.7-4.6A8.2 8.2 0 0 1 3 11.5 ' +
  'a8.4 8.4 0 0 1 9-8.4 8.4 8.4 0 0 1 9 8.4z"/><path d="M8.5 11.5h.01M12 11.5h.01M15.5 11.5h.01"/></svg>';

/** 2026-11-04 → 2026.11.04（等宽数字里点比短横线安静） */
function fmtDate(date?: string): string {
  return esc((date || '').replace(/-/g, '.'));
}

/** 只留下「有版本号且有内容」的版本；一版都没有时弹窗不该开 */
function usable(releases: readonly ChangelogRelease[]): ChangelogRelease[] {
  return releases.filter((r) => !!normalizeVersion(r?.version) && releaseEntryCount(r) > 0);
}

/** 打开时先停在哪一版：命中本次要提示的版本，否则最新一版（0） */
export function activeIndex(releases: readonly ChangelogRelease[], version = ''): number {
  const list = usable(releases);
  if (!list.length) return 0;
  const target = normalizeVersion(version);
  if (!target) return 0;
  const at = list.findIndex((r) => normalizeVersion(r.version) === target);
  return at < 0 ? 0 : at;
}

/* ── 正文零件 ─────────────────────────────── */

function rowsHtml(list: readonly ChangelogEntry[]): string {
  return list
    .map(
      (e) =>
        '<div class="bzs-chgn-row">' +
        `<span class="bzs-chgn-k">${esc(e.domain)}</span>` +
        `<span class="bzs-chgn-t">${esc(e.text)}</span>` +
        '</div>',
    )
    .join('');
}

function groupsHtml(release: ChangelogRelease): string {
  const out = SECTIONS.map((sec) => {
    const list = release[sec.key] ?? [];
    if (!list.length) return '';
    return (
      '<section class="bzs-chgn-grp">' +
      `<div class="bzs-chgn-grp-hd"><i class="bzs-chgn-g-${sec.cls}"></i>${sec.label}` +
      `<span class="bzs-chgn-grp-cnt">${list.length}</span></div>` +
      rowsHtml(list) +
      '</section>'
    );
  }).join('');
  return out || '<div class="bzs-chgn-empty">这一版没有记录。</div>';
}

/** 右栏头部：眉标 + 版本号 + 统计（切版本时只换这一块和正文） */
function headHtml(release: ChangelogRelease, isNewest: boolean): string {
  const total = releaseEntryCount(release);
  const parts = SECTIONS.filter((s) => (release[s.key] ?? []).length).map(
    (s) => `${s.label} ${(release[s.key] ?? []).length}`,
  );
  const meta = [`共 ${total} 处改动`, ...parts]
    .map((t) => `<span>${esc(t)}</span>`)
    .join('<span class="bzs-chgn-sep"></span>');
  return (
    `<div class="bzs-chgn-eyebrow">${isNewest ? '本次更新' : '历史版本'}</div>` +
    `<h1 class="bzs-chgn-ver">v${esc(release.version)}<small>${fmtDate(release.date)}</small></h1>` +
    `<div class="bzs-chgn-meta">${meta}</div>`
  );
}

/* ── 移动端：整篇文档流 ───────────────────── */

function mobBlocksHtml(release: ChangelogRelease): string {
  return SECTIONS.map((sec) => {
    const list = release[sec.key] ?? [];
    if (!list.length) return '';
    return (
      '<div class="bzs-chgn-mblk">' +
      `<div class="bzs-chgn-mblk-t"><i class="bzs-chgn-g-${sec.cls}"></i>${sec.label}` +
      `<span class="bzs-chgn-mcnt">${list.length}</span></div>` +
      list
        .map(
          (e) =>
            '<div class="bzs-chgn-mit">' +
            `<span class="bzs-chgn-mdom">${esc(e.domain)}</span>` +
            `<span class="bzs-chgn-mtxt">${esc(e.text)}</span>` +
            '</div>',
        )
        .join('') +
      '</div>'
    );
  }).join('');
}

function mobReleaseHtml(release: ChangelogRelease, newest: boolean): string {
  return (
    '<section class="bzs-chgn-mrel">' +
    '<div class="bzs-chgn-mrel-hd">' +
    `<span class="bzs-chgn-mver">v${esc(release.version)}</span>` +
    (newest ? '<span class="bzs-chgn-mcur">当前</span>' : '') +
    `<span class="bzs-chgn-mdate">${fmtDate(release.date)}</span>` +
    '</div>' +
    mobBlocksHtml(release) +
    '</section>'
  );
}

/* ── 外链入口（桌面页脚 / 手机底条共用） ───── */

function linksHtml(): string {
  const items = [
    { href: REPO_URL, label: 'GitHub 仓库', icon: GITHUB_SVG },
    { href: `${REPO_URL}/issues`, label: '问题反馈', icon: FEEDBACK_SVG },
  ];
  return items
    .map(
      (l) =>
        `<button class="bzs-chgn-link" type="button" data-href="${esc(l.href)}" ` +
        `title="${esc(l.label)}" aria-label="${esc(l.label)}">${l.icon}<span>${esc(l.label)}</span></button>`,
    )
    .join('');
}

/* ── 桌面：时间轴 + 单版正文 ───────────────── */

function railHtml(list: readonly ChangelogRelease[], active: number): string {
  const items = list
    .map(
      (r, i) =>
        `<button class="bzs-chgn-v${i === active ? ' on' : ''}" type="button" data-i="${i}"` +
        `${i === active ? ' aria-current="true"' : ''}>` +
        `<span class="v">v${esc(r.version)}</span>` +
        `<span class="d">${fmtDate(r.date)}</span>` +
        `<span class="n">${releaseEntryCount(r)} 处改动</span>` +
        '</button>',
    )
    .join('');
  return (
    '<aside class="bzs-chgn-rail">' +
    '<div class="bzs-chgn-rail-hd"><b>版本历史</b>' +
    `<span>${list.length} 版</span></div>` +
    `<div class="bzs-chgn-rail-list">${items}</div>` +
    '</aside>'
  );
}

/**
 * 弹窗内容（桌面 + 手机两套标记，CSS 媒体查询切换）。
 * `expectVersion` 找不到时落在最新一版——手动从设置页打开就走这条。
 */
export function changelogNoteHtml(releases: readonly ChangelogRelease[], expectVersion = ''): string {
  const list = usable(releases);
  if (!list.length) return '';
  const at = activeIndex(list, expectVersion);
  const head = list[at];

  const desktop =
    '<div class="bzs-chgn" data-role="chgn">' +
    railHtml(list, at) +
    '<main class="bzs-chgn-pane">' +
    `<div class="bzs-chgn-hd">${headHtml(head, at === 0)}</div>` +
    '<div class="bzs-chgn-wrap">' +
    '<div class="bzs-chgn-fade-top"></div>' +
    `<div class="bzs-chgn-body">${groupsHtml(head)}</div>` +
    '<div class="bzs-chgn-fade-bot"></div>' +
    '</div>' +
    '</main>' +
    `<footer class="bzs-chgn-ft">${linksHtml()}<span class="bzs-chgn-grow"></span>` +
    '<button class="bzs-chgn-done" type="button" data-role="chgndone">知道了</button>' +
    '</footer>' +
    `<button class="bzs-chgn-close" type="button" aria-label="关闭更新日志" title="关闭">${CLOSE_SVG}</button>` +
    '</div>';

  const mobile =
    '<div class="bzs-chgn-m">' +
    `<div class="bzs-chgn-mbar"><div class="bzs-chgn-mtitle">${CLOCK_SVG}更新日志</div>` +
    `<button class="bzs-chgn-close" type="button" aria-label="关闭更新日志" title="关闭">${CLOSE_SVG}</button>` +
    '</div>' +
    `<div class="bzs-chgn-mpage">${list.map((r, i) => mobReleaseHtml(r, i === 0)).join('')}</div>` +
    `<div class="bzs-chgn-mtools">${linksHtml()}` +
    '<button class="bzs-chgn-done" type="button" data-role="chgndone">知道了</button>' +
    '</div>' +
    '</div>';

  return desktop + mobile;
}

export interface ChangelogNoteHandle {
  /** 关闭弹窗（插件卸载 / 测试收口）；正常交互走 × 、「知道了」、点遮罩、ESC */
  close: () => void;
}

/**
 * 当前活着的那一个弹窗。
 *
 * 升级提示与设置页入口共用同一个函数：连点两下「更新日志」、或提示弹出来
 * 的瞬间又点了设置页，都会各开一层遮罩叠在一起（关了上面那层，下面那层
 * 还在，看着像关不掉）。新开之前先收掉旧的，全插件恒只有一个。
 */
let liveNote: ChangelogNoteHandle | null = null;

/**
 * 打开更新日志弹窗。`releases` 按**新→旧**给（内置数据本就是）。
 *
 * 返回关闭句柄；一版日志都没有时直接返回空句柄，不开一个空窗。
 */
export function openChangelogNote(
  releases: readonly ChangelogRelease[],
  expectVersion = '',
): ChangelogNoteHandle {
  const list = usable(releases);
  const html = changelogNoteHtml(list, expectVersion);
  if (!html) return { close: () => undefined };

  liveNote?.close();
  liveNote = null;

  let bodyEl: HTMLElement | null = null;
  let fadeTop: HTMLElement | null = null;
  let fadeBot: HTMLElement | null = null;

  /* 上下渐隐：真有溢出才提示，到头/到底就撤——别拿假的「还有内容」骗人。
     声明成函数声明，供 onClose 引用（调用时 popup 一定已存在）。 */
  function syncFade(): void {
    if (!bodyEl) return;
    const more = bodyEl.scrollHeight - bodyEl.clientHeight > 2;
    fadeTop?.classList.toggle('show', more && bodyEl.scrollTop > 4);
    fadeBot?.classList.toggle('show', more && bodyEl.scrollTop + bodyEl.clientHeight < bodyEl.scrollHeight - 4);
  }

  const modal = uiModal({
    content: html,
    className: 'bzs-chgn-dialog',
    title: '更新日志',
    onClose: () => {
      window.removeEventListener('resize', syncFade);
      bodyEl?.removeEventListener('scroll', syncFade);
    },
  });
  modal.mask.classList.add('bzs-chgn-mask');
  const popup = modal.popup;

  const hd = popup.querySelector<HTMLElement>('.bzs-chgn-hd');
  bodyEl = popup.querySelector<HTMLElement>('.bzs-chgn-body');
  fadeTop = popup.querySelector<HTMLElement>('.bzs-chgn-fade-top');
  fadeBot = popup.querySelector<HTMLElement>('.bzs-chgn-fade-bot');
  const body = bodyEl;

  /* 切版本：只换头部与正文两处，不重建整个弹窗（页脚的链接与关闭钮不用重绑） */
  const select = (i: number): void => {
    const release = list[i];
    if (!release) return;
    if (hd) setHtml(hd, headHtml(release, i === 0));
    if (body) {
      setHtml(body, groupsHtml(release));
      body.scrollTop = 0;
    }
    popup.querySelectorAll<HTMLElement>('.bzs-chgn-v').forEach((el) => {
      const on = Number(el.dataset.i) === i;
      el.classList.toggle('on', on);
      if (on) el.setAttribute('aria-current', 'true');
      else el.removeAttribute('aria-current');
    });
    if (typeof window !== 'undefined') window.requestAnimationFrame(syncFade);
  };

  /* 一处事件委托管四件事：切版本 / 关闭 / 知道了 / 外链。
     两类端（桌面 + 手机）的标记都在同一棵 DOM 里，绑一次全管上。 */
  popup.addEventListener('click', (e) => {
    const target = e.target as HTMLElement | null;
    if (!target?.closest) return;
    const version = target.closest('.bzs-chgn-v') as HTMLElement | null;
    if (version) {
      select(Number(version.dataset.i) || 0);
      return;
    }
    if (target.closest('.bzs-chgn-close') || target.closest('[data-role="chgndone"]')) {
      modal.close();
      return;
    }
    const link = target.closest('[data-href]') as HTMLElement | null;
    const href = link?.dataset.href;
    if (href) window.open(href, '_blank', 'noopener,noreferrer');
  });

  body?.addEventListener('scroll', syncFade, { passive: true });
  window.addEventListener('resize', syncFade);
  // 首帧量一次拿不到真实高度（排版还没落定），下一帧再量
  if (typeof window !== 'undefined') window.requestAnimationFrame(syncFade);

  const handle: ChangelogNoteHandle = {
    close: () => {
      if (liveNote === handle) liveNote = null;
      modal.close();
    },
  };
  liveNote = handle;
  return handle;
}
