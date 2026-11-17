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
import { currentPatrons, onPatronsChange, refreshPatrons } from '../data/patrons';
import {
  currentBzrData,
  onBzrDataChange,
  refreshBzrData,
  safeFeedbackUrl,
  type BzrData,
  type RoadmapFeedback,
} from '../data/bzr-data';
import type { RewardName } from '../data/reward';
import { copyGroupId } from './group';
import { openSupportDialog } from './support-dialog';
import { ACCENT_VAR, shellAccentColor } from './theme-accent';
import {
  compareVersions,
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
  /** 路线图入口 / 面板标题 */
  roadmap: string;
  /** 路线图入口副标题：主题数与条目数 */
  roadmapCount: (themes: number, items: number) => string;
  /** 统计卡：高级用户 / 赞助人 */
  proUsers: string;
  patrons: string;
  /** 二次确认弹窗 */
  buyTitle: string;
  buyDesc: string;
  supportTitle2: string;
  supportDesc: string;
  cancel: string;
  confirmBuy: string;
  confirmSupport: string;
  /** 用户反馈路径 */
  feedback: string;
  /** 路线图状态筛选的「全部」 */
  all: string;
  githubIssue: string;
  qqGroup: string;
  copied: string;
  /** 路线图状态与来源 */
  statePlan: string;
  stateDoing: string;
  stateDone: string;
  srcBuiltin: string;
  srcGithub: string;
  roadmapFoot: string;
  emptyRoadmap: string;
  closeRoadmap: string;
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
    roadmap: '路线图 Roadmap',
    roadmapCount: (themes: number, items: number) => `${themes} 主题 · ${items} 项`,
    proUsers: '高级用户',
    patrons: '赞助人',
    buyTitle: '升级高级版',
    buyDesc: '是否购买 BZ Reader 高级版激活码？解锁全部高级功能。',
    supportTitle2: '支持作者',
    supportDesc: '是否前往支持作者页面？你的赞助会帮助 BZ Reader 持续更新。',
    cancel: '取消',
    confirmBuy: '去购买',
    confirmSupport: '去支持',
    feedback: '用户反馈',
    all: '全部',
    githubIssue: 'GitHub issue',
    qqGroup: 'QQ 交流群',
    copied: '已复制群号',
    statePlan: '计划中',
    stateDoing: '进行中',
    stateDone: '已完成',
    srcBuiltin: '内置',
    srcGithub: 'GitHub',
    roadmapFoot: '内置项随版本发布 · GitHub 项与反馈链接在线获取（本地缓存 6 小时）',
    emptyRoadmap: '路线图暂无条目',
    closeRoadmap: '关闭路线图',
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
    roadmap: 'Roadmap',
    roadmapCount: (themes: number, items: number) => `${themes} themes · ${items} items`,
    proUsers: 'Pro users',
    patrons: 'Patrons',
    buyTitle: 'Upgrade to Pro',
    buyDesc: 'Buy a BZ Reader Pro activation code to unlock all premium features?',
    supportTitle2: 'Support the author',
    supportDesc: 'Open the support page? Your sponsorship keeps BZ Reader growing.',
    cancel: 'Cancel',
    confirmBuy: 'Buy now',
    confirmSupport: 'Support',
    feedback: 'Feedback',
    all: 'All',
    githubIssue: 'GitHub issue',
    qqGroup: 'QQ group',
    copied: 'Group number copied',
    statePlan: 'Planned',
    stateDoing: 'In progress',
    stateDone: 'Done',
    srcBuiltin: 'Built-in',
    srcGithub: 'GitHub',
    roadmapFoot: 'Built-in items ship with releases · GitHub items and links fetched online (6h local cache)',
    emptyRoadmap: 'No roadmap items yet',
    closeRoadmap: 'Close roadmap',
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

/* ── 路线图 / 统计 / 反馈路径 零件 ──────────── */

const RM_ICON =
  '<svg class="bzs-chgn-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
  'stroke-linecap="round" aria-hidden="true"><path d="M4 5h16M4 12h16M4 19h10"/><circle cx="18" cy="19" r="2"/></svg>';
const EXT_ICON =
  '<svg class="bzs-chgn-ext" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" ' +
  'aria-hidden="true"><path d="M4.5 2.5h5v5M9.5 2.5 5 7"/><path d="M8 8.5v1h-6v-6h1"/></svg>';
const SEARCH_ICON =
  '<svg class="bzs-chgn-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
  'aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';
const GH_ICON =
  '<svg class="bzs-chgn-svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
  '<path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34' +
  '-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.89 1.52 2.34 1.08 2.91.83' +
  '.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64' +
  ' 0 0 .84-.27 2.75 1.02A9.56 9.56 0 0 1 12 6.8c.85 0 1.71.11 2.51.34 1.91-1.29 2.75-1.02 2.75-1.02' +
  '.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85v2.74' +
  'c0 .27.18.58.69.48A10 10 0 0 0 12 2Z"/></svg>';
const QQ_ICON =
  '<svg class="bzs-chgn-svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
  '<path d="M12 2C6.5 2 2 6 2 11c0 2.6 1.2 4.9 3.1 6.5L4 21l3.6-1.2c1.4.5 2.9.8 4.4.8 5.5 0 10-4 10-9S17.5 2 12 2Z"/></svg>';

/** 统计卡：数字来自在线配置；没拿到数据时显示占位（不显示假数字） */
function statsHtml(data: BzrData | null): string {
  const c = copy();
  const pro = data ? data.stats.pro.toLocaleString() : '—';
  const patrons = data ? data.stats.patrons.toLocaleString() : '—';
  return (
    '<div class="bzs-chgn-stats">' +
    `<button class="bzs-chgn-stat" type="button" data-stat="pro"><b>${esc(pro)}</b>` +
    `<span>${esc(c.proUsers)}</span><i>›</i></button>` +
    `<button class="bzs-chgn-stat sponsor" type="button" data-stat="patrons"><b>${esc(patrons)}</b>` +
    `<span>${esc(c.patrons)}</span><i>›</i></button></div>`
  );
}

/** 用户反馈路径：GitHub issue 在前，QQ 群在后（复制群号，短链实测 404） */
function feedbackPathHtml(): string {
  const c = copy();
  return (
    '<div class="bzs-chgn-fbpath">' +
    `<span>${esc(c.feedback)}</span>` +
    `<a class="bzs-chgn-gh" href="${esc(REPO_URL)}/issues" target="_blank" rel="noopener">${GH_ICON}${esc(c.githubIssue)}</a>` +
    `<button class="bzs-chgn-qq" type="button" data-copy-qq>${QQ_ICON}${esc(c.qqGroup)}</button>` +
    `<small data-copy-hint></small></div>`
  );
}

function roadmapToolsHtml(): string {
  const c = copy();
  return (
    '<div class="bzs-chgn-rmtools">' +
    '<div class="bzs-chgn-rmfilters">' +
    `<button type="button" data-f="all" class="on">${esc(c.all)}</button>` +
    `<button type="button" data-f="doing">${esc(c.stateDoing)}</button>` +
    `<button type="button" data-f="plan">${esc(c.statePlan)}</button>` +
    `<button type="button" data-f="done">${esc(c.stateDone)}</button></div></div>`
  );
}

/** 一条反馈链接：issue 类用仓库地址拼，其余用白名单校验后的 href；不合法就不给 href */
function feedbackLinkHtml(fb: RoadmapFeedback): string {
  let href: string | null = '';
  if (fb.kind === 'issue') href = REPO_URL + '/issues/' + String(fb.n ?? '');
  else href = safeFeedbackUrl(fb.href);
  const cls = 'bzs-chgn-fb ' + esc(fb.kind);
  if (!href) return '<span class="' + cls + '">' + esc(fb.label) + '</span>';
  return '<a class="' + cls + '" href="' + esc(href) + '" target="_blank" rel="noopener">' + EXT_ICON + esc(fb.label) + '</a>';
}

/** 两级路线图：主题（按 order）→ 条目（按状态排：进行中 → 计划中 → 已完成） */
function roadmapRowsHtml(data: BzrData | null, filter = 'all', query = ''): string {
  const c = copy();
  const themes = (data?.roadmap ?? []).slice().sort((a, b) => a.order - b.order);
  const stateRank: Record<string, number> = { doing: 0, plan: 1, done: 2 };
  const q = query.trim().toLowerCase();
  const blocks = themes
    .map((t) => ({
      ...t,
      items: t.items
        .filter((i) => (filter === 'all' || i.state === filter) && (!q || i.title.toLowerCase().includes(q)))
        .sort((a, b) => (stateRank[a.state] ?? 9) - (stateRank[b.state] ?? 9)),
    }))
    .filter((t) => t.items.length);
  if (!blocks.length) return `<div class="bzs-chgn-rmempty">${esc(c.emptyRoadmap)}</div>`;
  return blocks
    .map((t, ti) => {
      const done = t.items.filter((i) => i.state === 'done').length;
      const pct = Math.round((done / t.items.length) * 100);
      const rows = t.items
        .map(
          (it) =>
            '<div class="bzs-chgn-rmitem">' +
            `<i class="bzs-chgn-dot ${esc(it.state)}"></i><div>` +
            `<div class="bzs-chgn-rmtitle">${esc(it.title)}</div>` +
            '<div class="bzs-chgn-rmmeta">' +
            `<span class="bzs-chgn-src ${esc(it.src)}">${esc(it.src === 'builtin' ? c.srcBuiltin : c.srcGithub)}</span>` +
            `<span>${esc(it.state === 'plan' ? c.statePlan : it.state === 'doing' ? c.stateDoing : c.stateDone)}</span>` +
            feedbackLinkHtml(it.fb) +
            '</div></div></div>',
        )
        .join('');
      return (
        `<section class="bzs-chgn-rmtheme${ti > 1 ? ' fold' : ''}">` +
        `<div class="bzs-chgn-rmthemehd" data-rm-theme><span class="bzs-chgn-chev">▾</span>` +
        `<i class="bzs-chgn-bar" style="background:${esc(t.color)}"></i><b>${esc(t.theme)}</b>` +
        `<span class="bzs-chgn-prog"><span class="bzs-chgn-track"><i style="width:${pct}%"></i></span>` +
        `<small>${done}/${t.items.length}</small></span></div>` +
        `<div class="bzs-chgn-rmitems">${rows}</div></section>`
      );
    })
    .join('');
}

/** 路线图面板：反馈路径 + 工具条 + 两级内容（桌面侧栏 / 手机全屏共用） */
function roadmapPanelHtml(data: BzrData | null): string {
  return (
    feedbackPathHtml() + roadmapToolsHtml() +
    `<div class="bzs-chgn-rmlist" data-rm-list>${roadmapRowsHtml(data)}</div>`
  );
}

/* ── 正文零件 ─────────────────────────────── */

/** 条目尾部的 #N 链接：issue 来自在线配置；点开新标签跳 GitHub */
function issueLinkHtml(n?: number): string {
  if (typeof n !== 'number' || !Number.isInteger(n) || n <= 0) return '';
  return `<a class="bzs-chgn-issue" href="${esc(REPO_URL)}/issues/${n}" target="_blank" rel="noopener">#${n} ↗</a>`;
}

function rowsHtml(list: readonly ChangelogEntry[]): string {
  return list
    .map(
      (e) =>
        '<div class="bzs-chgn-row">' +
        `<span class="bzs-chgn-k">${esc(pick(e.domain))}</span>` +
        `<span class="bzs-chgn-t">${esc(pick(e.text))}${issueLinkHtml(e.issue)}</span>` +
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
            `<span class="bzs-chgn-mtxt">${esc(pick(e.text))}${issueLinkHtml(e.issue)}</span>` +
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
        `<button class="bzs-chgn-link" type="button" data-act="${l.act}">` +
        `<span class="bzs-sr-only">${esc(l.label)}</span>${l.icon}</button>`,
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
function supportBtnHtml(names: readonly RewardName[] = currentPatrons()): string {
  const c = copy();
  const n = names.length;
  const label = c.supportTitle(n);
  const badge =
    n > 0 ? `<span class="bzs-chgn-count" aria-hidden="true">+${n > 99 ? '99+' : n}</span>` : '';
  return (
    `<button class="bzs-chgn-support" type="button" data-role="chgnsupport">` +
    `<span class="bzs-sr-only">${esc(label)}</span>${HEART_SVG}<span>${esc(c.support)}</span>${badge}</button>`
  );
}

/**
 * 名单是异步来的：打开时按钮先按缓存画（没有就是 0），拉到之后把页脚和
 * 手机工具条两处的数字**原地**改掉——不重开弹窗，用户不会看到闪一下。
 *
 * 两处一起改是因为桌面页脚与手机工具条各有一套同名按钮（≤768px 由 CSS 切），
 * 只改其中一套，换端看就是旧数字。
 */
function syncSupportBadges(root: HTMLElement): void {
  const c = copy();
  const n = currentPatrons().length;
  const label = c.supportTitle(n);
  root.querySelectorAll<HTMLElement>('[data-role="chgnsupport"]').forEach((btn) => {
    btn.appendChild(Object.assign(createSpan(), { className: 'bzs-sr-only', textContent: label }));
    const old = btn.querySelector('.bzs-chgn-count');
    if (n > 0) {
      const text = `+${n > 99 ? '99+' : n}`;
      if (old) old.textContent = text;
      else {
        const badge = createSpan();
        badge.className = 'bzs-chgn-count';
        badge.setAttribute('aria-hidden', 'true');
        badge.textContent = text;
        btn.appendChild(badge);
      }
    } else {
      old?.remove();
    }
  });
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

/** 正文顶部的统计卡 + 路线图入口（桌面 / 手机共用） */
function topStripHtml(data: BzrData | null): string {
  const c = copy();
  const themes = data?.roadmap.length ?? 0;
  const items = data?.roadmap.reduce((n, t) => n + t.items.length, 0) ?? 0;
  return (
    statsHtml(data) +
    `<button class="bzs-chgn-rmentry" type="button" data-open-rm>${RM_ICON}` +
    `<b>${esc(c.roadmap)}</b><span>${esc(c.roadmapCount(themes, items))}</span><i>›</i></button>`
  );
}

/** 二次确认弹窗（购买 / 支持）：文案固定，跳转地址在点击时从在线数据读 */
function confirmDialogHtml(): string {
  const c = copy();
  return (
    '<div class="bzs-chgn-confirm" data-confirm hidden>' +
    '<div class="bzs-chgn-confirm-box" role="dialog" aria-modal="true">' +
    '<div class="bzs-chgn-confirm-icon" data-confirm-icon></div>' +
    '<h3 data-confirm-title></h3><p data-confirm-desc></p>' +
    '<div class="bzs-chgn-confirm-acts">' +
    `<button type="button" data-confirm-cancel>${esc(c.cancel)}</button>` +
    `<button type="button" data-confirm-ok class="primary"></button></div></div></div>`
  );
}

/**
 * 弹窗内容（桌面 + 手机两套标记，CSS 媒体查询切换）。
 * `expectVersion` 找不到时落在最新一版——手动从设置页打开就走这条。
 * `data` 为在线配置（可注入测试）；不传时读当前在线数据（可能只有内置兜底）。
 */
export function changelogNoteHtml(
  releases: readonly ChangelogRelease[],
  expectVersion = '',
  names: readonly RewardName[] = currentPatrons(),
  data: BzrData | null = viewData(),
): string {
  const c = copy();
  /* 在线日志优先：data.changelog 有的版本用在线的（带 issue 字段），
     没有的沿用内置 releases（离线兜底 / 在线还没收录的版本）。 */
  const merged = mergeReleases(releases, data?.changelog ?? []);
  const list = usable(merged);
  if (!list.length) return '';
  const at = activeIndex(list, expectVersion);
  const head = list[at];

  const desktop =
    '<div class="bzs-chgn" data-role="chgn">' +
    railHtml(list, at) +
    '<main class="bzs-chgn-pane">' +
    `<div class="bzs-chgn-hd">${headHtml(head, at === 0)}</div>` +
    `<div class="bzs-chgn-topbar">${topStripHtml(data)}</div>` +
    '<div class="bzs-chgn-wrap">' +
    '<div class="bzs-chgn-fade-top"></div>' +
    `<div class="bzs-chgn-body">${groupsHtml(head)}</div>` +
    '<div class="bzs-chgn-fade-bot"></div>' +
    '</div>' +
    '</main>' +
    /* 右侧路线图抽屉（不是大弹窗，被弹窗 overflow 裁不到） */
    `<aside class="bzs-chgn-drawer" data-rm-drawer>` +
    `<div class="bzs-chgn-drawerhd"><b>${esc(c.roadmap)}</b>` +
    `<button class="bzs-chgn-rmclose" type="button" data-rm-close><span class="bzs-sr-only">${esc(c.closeRoadmap)}</span>${CLOSE_SVG}</button></div>` +
    roadmapPanelHtml(data) +
    '</aside>' +
    `<footer class="bzs-chgn-ft">${linksHtml()}${supportBtnHtml(names)}</footer>` +
    `<button class="bzs-chgn-close" type="button"><span class="bzs-sr-only">${c.close}</span>${CLOSE_SVG}</button>` +
    '</div>';

  const mobile =
    '<div class="bzs-chgn-m">' +
    `<div class="bzs-chgn-mbar"><div class="bzs-chgn-mtitle">${CLOCK_SVG}${c.title}</div>` +
    `<button class="bzs-chgn-close" type="button"><span class="bzs-sr-only">${c.close}</span>${CLOSE_SVG}</button>` +
    '</div>' +
    `<div class="bzs-chgn-mtop">${topStripHtml(data)}</div>` +
    `<div class="bzs-chgn-mpage">${list.map((r, i) => mobReleaseHtml(r, i === 0)).join('')}</div>` +
    /* 手机全屏路线图：从右侧滑满整窗，带返回 */
    `<div class="bzs-chgn-mrm" data-mrm>` +
    `<div class="bzs-chgn-mrmbar"><button type="button" data-mrm-back>‹</button><b>${esc(c.roadmap)}</b></div>` +
    roadmapPanelHtml(data) +
    '</div>' +
    `<div class="bzs-chgn-mtools">${linksHtml()}${supportBtnHtml(names)}</div>` +
    '</div>';

  return desktop + mobile + confirmDialogHtml();
}

/** 测试注入：换掉渲染用的在线数据（传 null 恢复） */
let testData: BzrData | null = null;
export function setChangelogDataForTests(d: BzrData | null): void {
  testData = d;
}
function viewData(): BzrData | null {
  return testData ?? currentBzrData();
}

/**
 * 内置日志 + 在线日志合并：在线有的版本整块替换内置的（它带 issue 字段、
 * 文案也是最新的），在线没有的版本保留内置。全部按新→旧排。
 */
function mergeReleases(
  builtin: readonly ChangelogRelease[],
  online: readonly ChangelogRelease[],
): ChangelogRelease[] {
  if (!online.length) return [...builtin];
  const map = new Map<string, ChangelogRelease>();
  for (const r of builtin) map.set(normalizeVersion(r.version), r);
  for (const r of online) {
    const v = normalizeVersion(r.version);
    if (v) map.set(v, r);
  }
  return [...map.values()].sort((a, b) => compareVersions(b.version, a.version));
}

/** 路线图搜索框的当前值（按面板容器找），没有就是空串 */
function currentQuery(box: HTMLElement | null): string {
  return box?.querySelector<HTMLInputElement>('[data-rm-search]')?.value ?? '';
}

/* 二次确认弹窗：文案和图标固定，跳转地址在点击时从在线数据读 */
let confirmTarget = '';
function openConfirm(kind: 'buy' | 'support'): void {
  const popup = document.querySelector<HTMLElement>('.bzs-chgn-confirm');
  if (!popup) return;
  const c = copy();
  const d = viewData();
  const isBuy = kind === 'buy';
  confirmTarget = safeFeedbackUrl(isBuy ? (d?.links.buy ?? '') : (d?.links.support ?? '')) ?? '';
  setHtml(popup.querySelector<HTMLElement>('[data-confirm-icon]')!, isBuy ? '★' : '♥');
  const title = popup.querySelector<HTMLElement>('[data-confirm-title]');
  const desc = popup.querySelector<HTMLElement>('[data-confirm-desc]');
  const ok = popup.querySelector<HTMLElement>('[data-confirm-ok]');
  if (title) title.textContent = isBuy ? c.buyTitle : c.supportTitle2;
  if (desc) desc.textContent = isBuy ? c.buyDesc : c.supportDesc;
  if (ok) ok.textContent = isBuy ? c.confirmBuy : c.confirmSupport;
  popup.removeAttribute('hidden');
}
function closeConfirm(): void {
  document.querySelector<HTMLElement>('.bzs-chgn-confirm')?.setAttribute('hidden', '');
  confirmTarget = '';
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
  data?: BzrData | null,
): ChangelogNoteHandle {
  const list = usable(mergeReleases(releases, data?.changelog ?? viewData()?.changelog ?? []));
  const html = changelogNoteHtml(list, expectVersion, currentPatrons(), data);
  if (!html) return { close: () => undefined };

  liveNote?.close();
  liveNote = null;

  let bodyEl: HTMLElement | null = null;
  let fadeTop: HTMLElement | null = null;
  let fadeBot: HTMLElement | null = null;
  /* 订阅要在 onClose 里退：这个弹窗可以反复开关，不退就会一次多挂一个 */
  let offSupport: () => void = () => undefined;
  let offData: () => void = () => undefined;

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
      offSupport();
      offData();
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

  /* 名单跟更新日志没关系，但页脚那枚按钮的人数要靠它：打开时拉一次
     （60 秒节流在 data/patrons 里），拉到就原地改数字。 */
  offSupport = onPatronsChange(() => syncSupportBadges(popup));
  void refreshPatrons();

  /* 在线配置：打开时后台校验一次；拉到了就**原地换**统计卡与路线图，
     不重开弹窗（用户不会看到闪一下）。数据层有 60 秒节流与 6 小时缓存。 */
  const syncData = (d: BzrData): void => {
    const stats = popup.querySelector<HTMLElement>('.bzs-chgn-topbar');
    const mstats = popup.querySelector<HTMLElement>('.bzs-chgn-mtop');
    if (stats) setHtml(stats, topStripHtml(d));
    if (mstats) setHtml(mstats, topStripHtml(d));
    popup.querySelectorAll<HTMLElement>('[data-rm-list]').forEach((el) => {
      setHtml(el, roadmapRowsHtml(d));
    });
  };
  offData = onBzrDataChange(syncData);
  void refreshBzrData();

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

  /* 一处事件委托管全部：切版本 / 关闭 / 支持作者 / 路线图 / 确认弹窗。
     两类端（桌面 + 手机）的标记都在同一棵 DOM 里，绑一次全管上。 */
  popup.addEventListener('click', (e) => {
    const target = e.target as HTMLElement | null;
    if (!target?.closest) return;

    const version = target.closest<HTMLElement>('.bzs-chgn-v');
    if (version) { select(Number(version.dataset.i) || 0); return; }

    /* 统计卡 → 二次确认弹窗（购买 / 支持）。地址在点击时才从在线数据读，
       不写死在 DOM 里（远端换了链接也不用重开弹窗）。 */
    const stat = target.closest<HTMLElement>('[data-stat]');
    if (stat) { openConfirm(stat.dataset.stat === 'pro' ? 'buy' : 'support'); return; }

    /* 路线图入口：桌面开右侧边栏，手机开全屏（各管各的标记）。
       桌面侧栏是「往右延伸」——给弹窗加 rm-wide 加宽，不挤正文。 */
    if (target.closest('[data-open-rm]')) {
      const rail = popup.querySelector<HTMLElement>('.bzs-chgn');
      const mob = popup.querySelector<HTMLElement>('.bzs-chgn-mrm');
      if (target.closest('.bzs-chgn-mtop')) mob?.classList.add('on');
      else {
        rail?.classList.add('rm-open');
        popup.classList.add('rm-wide');
      }
      return;
    }
    if (target.closest('[data-rm-close]')) {
      popup.querySelector<HTMLElement>('.bzs-chgn')?.classList.remove('rm-open');
      popup.classList.remove('rm-wide');
      return;
    }
    if (target.closest('[data-mrm-back]')) {
      popup.querySelector<HTMLElement>('.bzs-chgn-mrm')?.classList.remove('on');
      return;
    }

    /* 路线图筛选 / 主题折叠：只换列表区，不重排整窗 */
    const fbtn = target.closest<HTMLElement>('[data-f]');
    if (fbtn) {
      const box = fbtn.closest<HTMLElement>('.bzs-chgn-rmtools')?.parentElement;
      if (box) {
        box.querySelectorAll<HTMLElement>('[data-f]').forEach((x) => x.classList.remove('on'));
        fbtn.classList.add('on');
        const list = box.querySelector<HTMLElement>('[data-rm-list]');
        const d = viewData();
        if (list) setHtml(list, roadmapRowsHtml(d, fbtn.dataset.f || 'all', currentQuery(box)));
      }
      return;
    }
    const themeHd = target.closest<HTMLElement>('[data-rm-theme]');
    if (themeHd) { themeHd.parentElement?.classList.toggle('fold'); return; }

    /* 用户反馈路径：QQ 群复制群号（短链实测 404） */
    if (target.closest('[data-copy-qq]')) {
      void copyGroupId();
      const hint = target.closest('.bzs-chgn-fbpath')?.querySelector<HTMLElement>('[data-copy-hint]');
      if (hint) {
        hint.textContent = copy().copied;
        window.setTimeout(() => { hint.textContent = ''; }, 1600);
      }
      return;
    }

    /* 确认弹窗：取消 / 确认 / 点遮罩都收起；确认才打开在线地址 */
    if (target.closest('[data-confirm-cancel]')) { closeConfirm(); return; }
    if (target.closest('[data-confirm-ok]')) {
      const url = confirmTarget;
      closeConfirm();
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
      return;
    }
    if (target.classList.contains('bzs-chgn-confirm')) { closeConfirm(); return; }

    if (target.closest('.bzs-chgn-close')) { modal.close(); return; }
    /* 支持作者（2026-11-10）：先收日志窗再开赞赏窗——两层遮罩叠着，
       关掉上面那层下面还在，看着像关不掉。这里不弹提醒，点了就是点了。 */
    if (target.closest('[data-role="chgnsupport"]')) { modal.close(); openSupportDialog(); return; }
    const act = target.closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act === 'chgnrepo') window.open(REPO_URL, '_blank', 'noopener,noreferrer');
    else if (act === 'chgnvideo') window.open(VIDEO_TUTORIAL_URL, '_blank', 'noopener,noreferrer');
    else if (act === 'chgnqq') void copyGroupId();
  });

  /* 路线图搜索：输入时过滤列表（移动端 / 桌面各一份） */
  popup.addEventListener('input', (e) => {
    const input = e.target as HTMLInputElement | null;
    if (!input?.matches('[data-rm-search]')) return;
    const box = input.closest<HTMLElement>('.bzs-chgn-rmtools')?.parentElement;
    const list = box?.querySelector<HTMLElement>('[data-rm-list]');
    const fbtn = box?.querySelector<HTMLElement>('[data-f].on');
    if (box && list) setHtml(list, roadmapRowsHtml(viewData(), fbtn?.dataset.f || 'all', input.value));
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
