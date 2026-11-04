/* ============================================================
 * bz-reader · 更新日志数据与判定（shell/changelog.ts）
 *
 * 一、数据是**内置**的（照 bz 插件的做法）：不下载、不联网、不读远端文件。
 *     好处是升级后离线也能弹；坏处是每发一版要手工在最前面插一条——
 *     忘了插的代价是「这一版不弹」，不会弹错版本，这是刻意选的失败方向。
 *     发版时 version 必须与 manifest.json 完全一致（pickReleaseFor 是全等
 *     匹配，不做就近匹配）。
 *
 * 二、什么时候弹（planChangelog 一张表说清）：
 *     · 升级过（记录比当前旧）          → 弹，等用户第一次进书库
 *     · 老库没有记录（功能上线之前）    → 当升级，弹一次
 *     · 真新装（data.json 本来就不存在）→ 只记账不弹：他没用过旧版，
 *       给他看一屏「修好了什么」是纯噪音（bz 也是这么定的）
 *     · 同一版已记过                    → 跳过，一个字节都不写
 *     · 降级 / 回滚                     → 记账不弹
 *
 * 三、文案口径：一条日志只讲**用户能感知的变化**。构建方式、依赖升级这类
 *     内部改动写成「包体更小 / 装得更快」，别把 commit message 抄进来。
 * ============================================================ */

/**
 * 一条日志的双语文本。
 *
 * **更新日志是全仓唯一只做两版的文案**（见 `i18n.changelogLang`）：每次发版
 * 手写，八种语言维护一轮就是八倍工作量。中文给简中与繁中共用，其余六种语言
 * 读英文——读日志的人本来就知道自己在看什么，这不是「假装看得懂」。
 */
export interface L10nText {
  zh: string;
  en: string;
}

/** 一条日志：domain 是左侧那枚域名小标签，text 是一句话 */
export interface ChangelogEntry {
  domain: L10nText;
  text: L10nText;
}

/** 一个版本的日志块 */
export interface ChangelogRelease {
  version: string;
  /** YYYY-MM-DD；弹窗里格式化成 2026.11.04 */
  date?: string;
  added?: ChangelogEntry[];
  improved?: ChangelogEntry[];
  fixed?: ChangelogEntry[];
}

/**
 * 内置日志，**最新在前**。
 *
 * 发版流程里记得加一条（docs/note-v<版本>.md 与 GitHub Release 用同一批句子，
 * 别在这里另写一版）。条数多了从末尾裁掉最旧的——弹窗只回溯到第一个上架版本，
 * 再往前没有用户走过。
 *
 * 英文那半边**不是机翻**：它是给海外用户看的版本，句子按英文习惯重写，
 * 不是把中文逐字对过去（逐字对过去读起来像说明书）。
 */
export const CHANGELOG_RELEASES: readonly ChangelogRelease[] = [
  {
    version: '0.3.0',
    date: '2026-11-05',
    added: [
      {
        domain: { zh: '语言', en: 'Language' },
        text: {
          zh: '界面语言可手动选择：跟随 Obsidian，或指定中文、繁體中文、English、日本語、Deutsch、Français、Español、Português。',
          en: 'The interface language can now be chosen: follow Obsidian, or pick Chinese, Traditional Chinese, English, Japanese, German, French, Spanish or Portuguese.',
        },
      },
    ],
    improved: [
      {
        domain: { zh: '设置', en: 'Settings' },
        text: {
          zh: '设置页新增「界面」一组，语言切换后立即生效；命令名需重启 Obsidian 才更新。',
          en: 'A new “Interface” group in Settings applies the language immediately; command names update after restarting Obsidian.',
        },
      },
    ],
  },
  {
    version: '0.1.2',
    date: '2026-11-04',
    improved: [
      {
        domain: { zh: '安装包', en: 'Bundle' },
        text: {
          zh: '渲染内核改走依赖打包，包体更小、装上更快。',
          en: 'The rendering core now ships as a bundled dependency — smaller download, faster install.',
        },
      },
    ],
    fixed: [
      {
        domain: { zh: '社区市场', en: 'Marketplace' },
        text: {
          zh: '修掉上架审核报的错，现在能搜到并正常安装。',
          en: 'Fixed the errors from the directory review; the plugin can be found and installed again.',
        },
      },
    ],
  },
  {
    version: '0.1.1',
    date: '2026-11-04',
    added: [
      {
        domain: { zh: '阅读', en: 'Reading' },
        text: {
          zh: 'EPUB 与 TXT 开箱即读，桌面和手机是同一个包。',
          en: 'EPUB and TXT open out of the box, from a single build for desktop and mobile.',
        },
      },
      {
        domain: { zh: '书架', en: 'Shelf' },
        text: {
          zh: '封面墙、继续阅读、分组筛选，一本书读到哪一眼就看到。',
          en: 'Cover wall, continue reading and group filters — see where you are in a book at a glance.',
        },
      },
      {
        domain: { zh: '标注', en: 'Highlights' },
        text: {
          zh: '四色划线、书签、想法；划过的话能带着定位复制成链接。',
          en: 'Four highlight colours, bookmarks and notes; copy a highlight as a link that keeps its position.',
        },
      },
      {
        domain: { zh: '排版', en: 'Typography' },
        text: {
          zh: '字号、行距、页边距、单双栏与竖排，边调边看。',
          en: 'Font size, line height, margins, one or two columns and vertical text — all adjusted live.',
        },
      },
      {
        domain: { zh: '笔记', en: 'Notes' },
        text: {
          zh: '划线导出成结构化的 Markdown，留在自己的笔记库里。',
          en: 'Export highlights as structured Markdown that stays in your own vault.',
        },
      },
      {
        domain: { zh: 'AI', en: 'AI' },
        text: {
          zh: '接自己的 OpenAI 兼容接口，划词提问、解释、翻译、摘要。',
          en: 'Plug in your own OpenAI-compatible endpoint to ask, explain, translate and summarise a selection.',
        },
      },
    ],
  },
];

/** 去掉 v 前缀与首尾空白；空值给空串（调用方据此判「没有版本」） */
export function normalizeVersion(v: string | null | undefined): string {
  return String(v ?? '')
    .trim()
    .replace(/^v/i, '')
    .trim();
}

function segments(v: string): number[] {
  const out: number[] = [];
  for (const part of v.split(/[.\-+]/)) {
    const n = Number(part);
    if (Number.isFinite(n) && part.trim() !== '') out.push(n);
  }
  return out;
}

/**
 * 比版本号：按段比数字，缺的段当 0。
 *
 * 不按字符串比——`0.1.10` 会被判成比 `0.1.9` 旧，于是升级永远等不到弹窗
 * （反而更难查：界面一切正常，只是「更新日志不见了」）。
 */
export function compareVersions(a: string, b: string): number {
  const pa = segments(normalizeVersion(a));
  const pb = segments(normalizeVersion(b));
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff) return diff > 0 ? 1 : -1;
  }
  return 0;
}

/** 取与 version 完全相等的那个日志块；找不到 → null（调用方据此不弹、只记账） */
export function pickReleaseFor(
  releases: readonly ChangelogRelease[],
  version: string,
): ChangelogRelease | null {
  const target = normalizeVersion(version);
  if (!target) return null;
  return releases.find((r) => normalizeVersion(r?.version || '') === target) || null;
}

/** 这一版有多少条改动（三段求和） */
export function releaseEntryCount(release: ChangelogRelease): number {
  return (release.added?.length || 0) + (release.improved?.length || 0) + (release.fixed?.length || 0);
}

export type ChangelogPlan =
  /** 弹：等到第一次进书库时把 version 这一版推给用户 */
  | { action: 'show'; version: string }
  /** 只记账：把记录推到 version，别打扰 */
  | { action: 'record'; version: string }
  /** 什么都不做 */
  | { action: 'skip'; version: '' };

/**
 * 该不该弹（见文件头的判定表）。
 *
 * `freshInstall` 必须由 onload 时「data.json 存不存在」来给：
 * 光看 seen 为空分不出「新装」与「老库第一次跑到这个功能」。
 */
export function planChangelog(input: {
  current: string;
  seen: string;
  freshInstall: boolean;
}): ChangelogPlan {
  const current = normalizeVersion(input.current);
  if (!current) return { action: 'skip', version: '' };
  if (input.freshInstall) return { action: 'record', version: current };
  const seen = normalizeVersion(input.seen);
  if (!seen) return { action: 'show', version: current };
  const cmp = compareVersions(current, seen);
  if (cmp > 0) return { action: 'show', version: current };
  if (cmp < 0) return { action: 'record', version: current };
  return { action: 'skip', version: '' };
}
