/* ============================================================
 * bz-reader · 更新日志弹窗（shell/changelog-note.ts）
 *
 * 版式照 bz 插件的更新日志小窗（2026-11-02 定稿），两端共用一份 DOM：
 *   桌面（>768px） 214px 版本时间轴（一根细线串起点，当前版实心点）+ 右侧
 *                单版正文（眉标 / 大号等宽版本号 / 改动统计 → 三段 → 页脚入口）；
 *   移动（≤768px） 不设版本栏：顶栏（标题 + 关闭）+ 全部版本按新→旧铺成一篇
 *                文档流 + 右下角浮动入口条。
 * 靠 CSS 媒体查询切换，不在 JS 里判断宽度——改窗口大小也不会错位。
 *
 * 页脚照 bz 的更新日志小窗（2026-11-10 用户拍板）：一排纯图标靠右、
 * 「支持作者」带文字与淡底、右上角挂「+人数」；**没有「知道了」**，关窗只走
 * 右上角 × / 点遮罩 / ESC。
 *
 * 数据全部来自 shell/changelog（内置），这里只负责「画」与「切版本」。
 * 打开方式两处：升级后第一次进书库（plugin.maybeShowChangelog，会记账）、
 * 关于条里的「更新日志」（随时回看，不记账）。
 * ============================================================ */
import { uiModal } from '../core/ui/modal';
import { VIDEO_TUTORIAL_URL } from '../core/links';
import { changelogLang } from '../i18n';
import { setHtml } from '../ui/dom';
import { esc, githubIcon } from './render/html';
import { GROUP_ID, REPO_URL } from '../data/entitlement';
import { REWARD_NAMES } from '../data/reward';
import { copyGroupId } from './group';
import { openSupportDialog } from './support-dialog';
import { ACCENT_VAR, shellAccentColor } from './theme-accent';
import {
  normalizeVersion,
  releaseEntryCount,
  type ChangelogEntry,
  type ChangelogRelease,
  type L10nText,
} from './changelog';

/**
 * 框架文案：只有中英两套。
 *
 * 跟 `i18n.changelogLang()` 走，而不是八种语言——理由写在 i18n/index.ts
 * 那个函数上：日志条目本身只有两版，框架要是八种语言，就会出现
 * 「日语的分段标题 + 中文的条目」这种半翻状态，比全英文更难看懂。
 */
interface ChangelogCopy {
  added: string;
  improved: string;
  fixed: string;
  empty: string;
  newest: string;
  older: string;
  total: (n: number) => string;
  changes: (n: number) => string;
  railTitle: string;
  railCount: (n: number) => string;
  close: string;
  title: string;
  current: string;
  github: string;
  /** 交流群：图标入口没有文字，群号与「点了是复制」只能靠这一句说清 */
  qqHint: (id: string) => string;
  video: string;
  /** 页脚「支持作者」胶囊上的四个字 */
  support: string;
  /** 页脚右侧那枚「支持作者」的人话（读屏与悬停都念这句） */
  supportTitle: (n: number) => string;
}

const COPY: Record<'zh' | 'en', ChangelogCopy> = {
  zh: {
    added: '新功能',
    improved: '体验优化',
    fixed: '修复',
    empty: '这一版没有记录。',
    newest: '本次更新',
    older: '历史版本',
    total: (n: number) => `共 ${n} 处改动`,
    changes: (n: number) => `${n} 处改动`,
    railTitle: '版本历史',
    railCount: (n: number) => `${n} 版`,
    close: '关闭更新日志',
    title: '更新日志',
    current: '当前',
    github: 'GitHub 仓库',
    qqHint: (id: string) => `QQ 交流群 ${id} · 点击复制群号`,
    video: '视频教程',
    support: '支持作者',
    /* 页脚右侧那枚：只有图标 + 人数，读屏念的是这一句。
       与 bz 同一个位置、同一个口径（人数取名单长度，不在别处再存一份）。 */
    supportTitle: (n: number) => `支持作者（已有 ${n} 位）`,
  },
  en: {
    added: 'New',
    improved: 'Improved',
    fixed: 'Fixed',
    empty: 'No entries for this version.',
    newest: 'This update',
    older: 'Earlier version',
    total: (n: number) => `${n} changes in total`,
    changes: (n: number) => `${n} changes`,
    railTitle: 'Version history',
    railCount: (n: number) => `${n} versions`,
    close: 'Close changelog',
    title: 'Changelog',
    current: 'Current',
    github: 'GitHub repository',
    qqHint: (id: string) => `QQ group ${id} · click to copy the number`,
    video: 'Video tutorial',
    support: 'Support the author',
    supportTitle: (n: number) => `Support the author (${n} backers so far)`,
  },
} as const;

function copy(): ChangelogCopy {
  return changelogLang() === 'zh' ? COPY.zh : COPY.en;
}

/** 三段定义：顺序即渲染顺序；label 每次渲染时按当前日志语言取 */
const SECTIONS = [
  { key: 'added', cls: 'add' },
  { key: 'improved', cls: 'imp' },
  { key: 'fixed', cls: 'fix' },
] as const;

/** 一条双语文本 → 当前日志语言的那一句 */
function pick(v: L10nText): string {
  return changelogLang() === 'zh' ? v.zh : v.en;
}

const CLOSE_SVG =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';

const CLOCK_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" ' +
  'stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>' +
  '<path d="M12 7v5l3 2"/></svg>';

/* 心形：与 bz 更新日志页脚的 `ICON_HEART` 逐字相同（15px、1.8 描边）。
   两个插件的同一枚图标粗细不一样，是这套底线最容易被看出来的地方。 */
const HEART_SVG =
  '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>';

/* QQ 企鹅与 B 站小电视：与 bz 的 `QQ_GROUP_ICON` / `ICON_BILI` 逐字相同
   （Simple Icons 的官方 path，15px、吃 currentColor）。
   页脚这一组是「一排同等重要的出口」，谁单独带品牌色都会把视线抢过去；
   bz 那边 2026-11-02 就把写死的亮蓝去掉了，这边照抄同一条口径。 */
const QQ_SVG =
  '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">' +
  '<path d="M21.395 15.035a40 40 0 0 0-.803-2.264l-1.079-2.695c.001-.032.014-.562.014-.836C19.526 4.632 17.351 0 12 0S4.474 4.632 4.474 9.241c0 .274.013.804.014.836l-1.08 2.695a39 39 0 0 0-.802 2.264c-1.021 3.283-.69 4.643-.438 4.673.54.065 2.103-2.472 2.103-2.472 0 1.469.756 3.387 2.394 4.771-.612.188-1.363.479-1.845.835-.434.32-.379.646-.301.778.343.578 5.883.369 7.482.189 1.6.18 7.14.389 7.483-.189.078-.132.132-.458-.301-.778-.483-.356-1.233-.646-1.846-.836 1.637-1.384 2.393-3.302 2.393-4.771 0 0 1.563 2.537 2.103 2.472.251-.03.581-1.39-.438-4.673"/></svg>';

const BILI_SVG =
  '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">' +
  '<path d="M17.813 4.653h.854c1.51.054 2.769.578 3.773 1.574 1.004.995 1.524 2.249 1.56 3.76v7.36c-.036 1.51-.556 2.769-1.56 3.773s-2.262 1.524-3.773 1.56H5.333c-1.51-.036-2.769-.556-3.773-1.56S.036 18.858 0 17.347v-7.36c.036-1.511.556-2.765 1.56-3.76 1.004-.996 2.262-1.52 3.773-1.574h.774l-1.174-1.12a1.234 1.234 0 0 1-.373-.906c0-.356.124-.658.373-.907l.027-.027c.267-.249.573-.373.92-.373.347 0 .653.124.92.373L9.653 4.44c.071.071.134.142.187.213h4.267a.836.836 0 0 1 .16-.213l2.853-2.747c.267-.249.573-.373.92-.373.347 0 .662.151.929.4.267.249.391.551.391.907 0 .355-.124.657-.373.906zM5.333 7.24c-.746.018-1.373.276-1.88.773-.506.498-.769 1.13-.786 1.894v7.52c.017.764.28 1.395.786 1.893.507.498 1.134.756 1.88.773h13.334c.746-.017 1.373-.275 1.88-.773.506-.498.769-1.129.786-1.893v-7.52c-.017-.765-.28-1.396-.786-1.894-.507-.497-1.134-.755-1.88-.773zM8 11.107c.373 0 .684.124.933.373.25.249.383.569.4.96v1.173c-.017.391-.15.711-.4.96-.249.25-.56.374-.933.374s-.684-.125-.933-.374c-.25-.249-.383-.569-.4-.96V12.44c0-.373.129-.689.386-.947.258-.257.574-.386.947-.386zm8 0c.373 0 .684.124.933.373.25.249.383.569.4.96v1.173c-.017.391-.15.711-.4.96-.249.25-.56.374-.933.374s-.684-.125-.933-.374c-.25-.249-.383-.569-.4-.96V12.44c.017-.391.15-.711.4-.96.249-.249.56-.373.933-.373Z"/></svg>';

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
        `<span class="bzs-chgn-k">${esc(pick(e.domain))}</span>` +
        `<span class="bzs-chgn-t">${esc(pick(e.text))}</span>` +
        '</div>',
    )
    .join('');
}

function groupsHtml(release: ChangelogRelease): string {
  const c = copy();
  const out = SECTIONS.map((sec) => {
    const list = release[sec.key] ?? [];
    if (!list.length) return '';
    return (
      '<section class="bzs-chgn-grp">' +
      `<div class="bzs-chgn-grp-hd"><i class="bzs-chgn-g-${sec.cls}"></i>${c[sec.key]}` +
      `<span class="bzs-chgn-grp-cnt">${list.length}</span></div>` +
      rowsHtml(list) +
      '</section>'
    );
  }).join('');
  return out || `<div class="bzs-chgn-empty">${c.empty}</div>`;
}

/** 右栏头部：眉标 + 版本号 + 统计（切版本时只换这一块和正文） */
function headHtml(release: ChangelogRelease, isNewest: boolean): string {
  const c = copy();
  const total = releaseEntryCount(release);
  const parts = SECTIONS.filter((s) => (release[s.key] ?? []).length).map(
    (s) => `${c[s.key]} ${(release[s.key] ?? []).length}`,
  );
  const meta = [c.total(total), ...parts]
    .map((t) => `<span>${esc(t)}</span>`)
    .join('<span class="bzs-chgn-sep"></span>');
  return (
    `<div class="bzs-chgn-eyebrow">${isNewest ? c.newest : c.older}</div>` +
    `<h1 class="bzs-chgn-ver">v${esc(release.version)}<small>${fmtDate(release.date)}</small></h1>` +
    `<div class="bzs-chgn-meta">${meta}</div>`
  );
}

/* ── 移动端：整篇文档流 ───────────────────── */

function mobBlocksHtml(release: ChangelogRelease): string {
  const c = copy();
  return SECTIONS.map((sec) => {
    const list = release[sec.key] ?? [];
    if (!list.length) return '';
    return (
      '<div class="bzs-chgn-mblk">' +
      `<div class="bzs-chgn-mblk-t"><i class="bzs-chgn-g-${sec.cls}"></i>${c[sec.key]}` +
      `<span class="bzs-chgn-mcnt">${list.length}</span></div>` +
      list
        .map(
          (e) =>
            '<div class="bzs-chgn-mit">' +
            `<span class="bzs-chgn-mdom">${esc(pick(e.domain))}</span>` +
            `<span class="bzs-chgn-mtxt">${esc(pick(e.text))}</span>` +
            '</div>',
        )
        .join('') +
      '</div>'
    );
  }).join('');
}

function mobReleaseHtml(release: ChangelogRelease, newest: boolean): string {
  const c = copy();
  return (
    '<section class="bzs-chgn-mrel">' +
    '<div class="bzs-chgn-mrel-hd">' +
    `<span class="bzs-chgn-mver">v${esc(release.version)}</span>` +
    (newest ? `<span class="bzs-chgn-mcur">${c.current}</span>` : '') +
    `<span class="bzs-chgn-mdate">${fmtDate(release.date)}</span>` +
    '</div>' +
    mobBlocksHtml(release) +
    '</section>'
  );
}

/* ── 外链入口（桌面页脚 / 手机浮条共用） ───── */

/**
 * 三个纯图标入口，顺序与图标都照 bz：GitHub → QQ 群 → B 站。
 *
 * 只给图标是因为这一行最后还要放一枚带文字的「支持作者」胶囊；三段文字
 * 并排会压成字墙。可发现性交给悬停提示与读屏（`title` / `aria-label`），
 * 交流群那枚还要说清点下去是**复制群号**——它不开链接。
 *
 * 行为键带 `chgn` 前缀：这个弹窗不在壳层里，但同一套 `data-act` 口径
 * 容易被全局动作表误认，前缀是给自己留的隔离带。
 */
function linksHtml(): string {
  const c = copy();
  const items = [
    { act: 'chgnrepo', label: c.github, icon: githubIcon(15) },
    { act: 'chgnqq', label: c.qqHint(GROUP_ID), icon: QQ_SVG },
    { act: 'chgnvideo', label: c.video, icon: BILI_SVG },
  ];
  return items
    .map(
      (l) =>
        `<button class="bzs-chgn-link" type="button" data-act="${l.act}" ` +
        `title="${esc(l.label)}" aria-label="${esc(l.label)}">${l.icon}</button>`,
    )
    .join('');
}

/**
 * 页脚右侧的「支持作者」：心形 + 文字 + 右上角「+人数」角标。
 *
 * 形状照 bz（2026-11-10）：这一行最后一枚是唯一带文字、带底色的，
 * 它要人看见；人数是它唯一的信息量——「已经有多少人支持过」。角标
 * 照 bz 带「+」并封顶 99+，读屏与悬停念完整那句（`supportTitle`）。
 * 心形与 bz 的 `ICON_HEART` 逐字相同（15px、1.8 描边）——同一枚图标在
 * 两个插件里粗细不一样，是这套底线最容易被看出来的地方。
 */
function supportBtnHtml(): string {
  const c = copy();
  const n = REWARD_NAMES.length;
  const label = c.supportTitle(n);
  const badge =
    n > 0 ? `<span class="bzs-chgn-count" aria-hidden="true">+${n > 99 ? '99+' : n}</span>` : '';
  return (
    `<button class="bzs-chgn-support" type="button" data-role="chgnsupport" ` +
    `title="${esc(label)}" aria-label="${esc(label)}">${HEART_SVG}<span>${esc(c.support)}</span>${badge}</button>`
  );
}

/* ── 桌面：时间轴 + 单版正文 ───────────────── */

function railHtml(list: readonly ChangelogRelease[], active: number): string {
  const c = copy();
  const items = list
    .map(
      (r, i) =>
        `<button class="bzs-chgn-v${i === active ? ' on' : ''}" type="button" data-i="${i}"` +
        `${i === active ? ' aria-current="true"' : ''}>` +
        `<span class="v">v${esc(r.version)}</span>` +
        `<span class="d">${fmtDate(r.date)}</span>` +
        `<span class="n">${esc(c.changes(releaseEntryCount(r)))}</span>` +
        '</button>',
    )
    .join('');
  return (
    '<aside class="bzs-chgn-rail">' +
    `<div class="bzs-chgn-rail-hd"><b>${c.railTitle}</b>` +
    `<span>${esc(c.railCount(list.length))}</span></div>` +
    `<div class="bzs-chgn-rail-list">${items}</div>` +
    '</aside>'
  );
}

/**
 * 弹窗内容（桌面 + 手机两套标记，CSS 媒体查询切换）。
 * `expectVersion` 找不到时落在最新一版——手动从设置页打开就走这条。
 */
export function changelogNoteHtml(releases: readonly ChangelogRelease[], expectVersion = ''): string {
  const c = copy();
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
    `<footer class="bzs-chgn-ft">${linksHtml()}${supportBtnHtml()}</footer>` +
    `<button class="bzs-chgn-close" type="button" aria-label="${c.close}" title="${c.close}">${CLOSE_SVG}</button>` +
    '</div>';

  const mobile =
    '<div class="bzs-chgn-m">' +
    `<div class="bzs-chgn-mbar"><div class="bzs-chgn-mtitle">${CLOCK_SVG}${c.title}</div>` +
    `<button class="bzs-chgn-close" type="button" aria-label="${c.close}" title="${c.close}">${CLOSE_SVG}</button>` +
    '</div>' +
    `<div class="bzs-chgn-mpage">${list.map((r, i) => mobReleaseHtml(r, i === 0)).join('')}</div>` +
    `<div class="bzs-chgn-mtools">${linksHtml()}${supportBtnHtml()}</div>` +
    '</div>';

  return desktop + mobile;
}

export interface ChangelogNoteHandle {
  /** 关闭弹窗（插件卸载 / 测试收口）；正常交互走 ×、点遮罩、ESC */
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
    title: copy().title,
    onClose: () => {
      window.removeEventListener('resize', syncFade);
      bodyEl?.removeEventListener('scroll', syncFade);
    },
  });
  modal.mask.classList.add('bzs-chgn-mask');
  /* 跟随设置页选的那一档强调色（弹窗不在 .bzs-shell 里，带不过来） */
  const accent = shellAccentColor();
  if (accent) modal.popup.style.setProperty(ACCENT_VAR, accent);
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

  /* 一处事件委托管三件事：切版本 / 关闭 / 支持作者 / 三个入口。
     两类端（桌面 + 手机）的标记都在同一棵 DOM 里，绑一次全管上。 */
  popup.addEventListener('click', (e) => {
    const target = e.target as HTMLElement | null;
    if (!target?.closest) return;
    const version = target.closest<HTMLElement>('.bzs-chgn-v');
    if (version) {
      select(Number(version.dataset.i) || 0);
      return;
    }
    if (target.closest('.bzs-chgn-close')) {
      modal.close();
      return;
    }
    /* 支持作者（2026-11-10）：先收日志窗再开赞赏窗——两层遮罩叠着，
       关掉上面那层下面还在，看着像关不掉。这里不弹提醒，点了就是点了。 */
    if (target.closest('[data-role="chgnsupport"]')) {
      modal.close();
      openSupportDialog();
      return;
    }
    const act = target.closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act === 'chgnrepo') window.open(REPO_URL, '_blank', 'noopener,noreferrer');
    else if (act === 'chgnvideo') window.open(VIDEO_TUTORIAL_URL, '_blank', 'noopener,noreferrer');
    /* 交流群不开链接：qm.qq.com 短链实测 404，只有群号不变，所以走复制
       （与设置页关于条那颗 `copygroup` 说同一句话，见 shell/group.ts）。 */
    else if (act === 'chgnqq') void copyGroupId();
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
