/* ============================================================
 * bz-reader · 设置页（shell/render/settings.ts）
 *
 * 从 Obsidian 原生设置面板搬进书架，成为第四个页签；插件已不再注册
 * 原生设置页，这里是唯一的设置入口。
 * 理由：这些选项全都服务于「怎么读」，用户调它们的时候正看着书，
 * 不该被拽到一个和阅读无关的系统面板里。
 *
 * 写入分两条线：
 *   prefs    → 版式与正文纸色（改完立刻重排版面）
 *   settings → 导出目录、AI 服务（改完不影响当前页面）
 * 两条都在 bz-reader.json 里，与书架同一份。
 *
 * 文案分两类，界线要守住：
 *   · **散装句子**走 `t()`（组标题、说明、按钮字）；
 *   · **成套选项**（字体档、强调色档、笔色、头栏图标）走各自的集中标签表
 *     （fontLabel / accentLabel / colorLabel / headerActionLabel）。
 *     成套的东西拆进八份语言包，漏翻一条不会让 tsc 报错——只会让某个语言的
 *     用户在某一个档位上看到中文。集中表用 `Record<Locale, string>` 锁八种齐。
 * ============================================================ */
import { t, LOCALES, LOCALE_NAMES, type MsgKey } from '../../i18n';
import { ACCENT_OPTIONS, accentLabel, FONT_FAMILIES, fontLabel, FONT_SIZE_RANGE, LINE_HEIGHT_RANGE, MARGIN_RANGE, TTS_CACHE_RANGE, TTS_RATE_RANGE, type ReaderPrefs } from '../../data/prefs';
import { ttsEngineReady, type TtsEngine } from '../../core/tts-engine';
import { HIGHLIGHT_COLORS, colorLabel } from '../../data/notes';
import { DEFAULT_SETTINGS, type ReaderSettings } from '../../data/settings';
import { can, entitlement, GROUP_ID, tierText } from '../../data/entitlement';
import { dataDirOf } from '../../core/plugin-path';
import { isMobileShell } from '../../core/mobile';
import type { HotkeyRow } from '../../core/hotkeys';
import { headerActionSpec, isMobileHiddenAction, userFacingActionIds, type HeaderActionId } from '../../view/header-actions';
import { rangeFill } from '../range-fill';
import { esc, githubIcon, ico } from './html';
import { segHtml } from './seg';

export interface SettingsView {
  prefs: ReaderPrefs;
  settings: ReaderSettings;
  /** 默认笔色（壳层存，不占用 prefs） */
  pen: string;
  /** 命令 → 当前键位（来自宿主，不是我们存的） */
  hotkeys: HotkeyRow[];
  /** 已激活时点了「重新激活」：临时允许编辑激活码（不落盘） */
  relicense?: boolean;
  /** 插件版本（manifest.json），「关于」条显示它 */
  version?: string;
  /**
   * BZ AI 知识库现状：AI 组里「连接至 BZ AI 知识库」那行按它显示。
   *
   * 只读展示、不给开关——2026-11-07 起是自动识别（data/bz-bridge）。缺省 =
   * 还没探测到，按「未连接」画状态并给教程出口，不摆假开关。
   */
  bz?: { ok: boolean; version: string; model: string; entry: boolean; notes: boolean };
  /** 当前这本书的离线音频（烤进书库的包）：null = 还没识别到 */
  offline?: { chapters: number; mb: number } | null;
  /** 整本预生成是否正在跑（按钮据此换成「停止」） */
  prefetchingBook?: boolean;
  /**
   * 是不是手机形态（缺省 `isMobileShell()`——含桌面验收用的 force-mobile）。
   *
   * 手机上没有的几项（分栏、朗读、快捷键）直接不渲染：
   *   · 分栏——引擎竖屏规则写死单栏，给了选择也是白给；
   *   · 朗读——手机浏览器内核没有稳定的语音合成通道；
   *   · 快捷键——点一行打开的是桌面快捷键面板，手机没有这一页。
   * 参数留给测试直接钉两端，不必去模拟 Platform。
   *
   * 这里用 `isMobileShell` 而不是 `isMobileEnv`：桌面验收时只要按手机形态
   * 跑（force-mobile），看到的就该是手机上那套设置，否则「隐藏生没生效」
   * 只能在真机上看，一轮几分钟。
   */
  mobile?: boolean;
}

/**
 * 设置页要露出来的命令。
 *
 * `builtin` 是阅读页内置的单键（不经过宿主，阅读页聚焦时才生效）；
 * 用户没在宿主里另绑时显示它，绑了就显示绑的——两套都真实存在，
 * 藏起任何一套都会让人以为「这键不能改」。
 *
 * 存 key 不存 label：label 在 `shelf-page` 调 `readHotkeys` 时才求值，
 * 这样切语言后重绘设置页就能看到新名字，而不是等重启。
 */
export const KEY_COMMANDS: Array<{ id: string; key: MsgKey; builtin?: string }> = [
  { id: 'bz-reader:page-next', key: 'key.pageNext', builtin: '→' },
  { id: 'bz-reader:page-prev', key: 'key.pagePrev', builtin: '←' },
  { id: 'bz-reader:open', key: 'key.open', builtin: 'g' },
  { id: 'bz-reader:search', key: 'key.search', builtin: '⌘/Ctrl + F' },
  { id: 'bz-reader:sidebar', key: 'key.sidebar', builtin: 's' },
  { id: 'bz-reader:focus', key: 'key.focus', builtin: 'f' },
  { id: 'bz-reader:fullscreen', key: 'key.fullscreen' },
  { id: 'bz-reader:bookmark', key: 'key.bookmark', builtin: 'b' },
  { id: 'bz-reader:typography', key: 'key.typography', builtin: 't' },
  { id: 'bz-reader:bookmap', key: 'key.bookmap', builtin: 'm' },
  { id: 'bz-reader:tts', key: 'key.tts', builtin: 'r' },
  { id: 'bz-reader:continue', key: 'key.continue' },
  /* PDF 专用：都从命令面板注册，这里只是把它们摆进同一张键位表让人看得见 */
  { id: 'bz-reader:pdf-zoom-in', key: 'key.pdfZoomIn' },
  { id: 'bz-reader:pdf-zoom-out', key: 'key.pdfZoomOut' },
  { id: 'bz-reader:pdf-fit-width', key: 'key.pdfFitWidth' },
  { id: 'bz-reader:pdf-fit-page', key: 'key.pdfFitPage' },
  { id: 'bz-reader:pdf-rotate', key: 'key.pdfRotate' },
  { id: 'bz-reader:pdf-spread', key: 'key.pdfSpread' },
  { id: 'bz-reader:pdf-paged', key: 'key.pdfPaged' },
  { id: 'bz-reader:pdf-thumbs', key: 'key.pdfThumbs' },
  { id: 'bz-reader:pdf-copy-link', key: 'key.pdfCopyLink' },
  { id: 'bz-reader:pdf-export-page', key: 'key.pdfExportPage' },
  { id: 'bz-reader:pdf-back', key: 'key.pdfBack' },
];

function seg(name: string, opts: Array<[string, string]>, cur: string, act = 'setpref', cls = 'bzs-seg'): string {
  return segHtml(
    opts.map(([v, k]) => ({ v, k })),
    cur,
    { act, name, cls },
  );
}

function range(k: string, label: string, val: number, min: number, max: number, step: number, fmt: (v: number) => string): string {
  /* --fill 必须在渲染时就写：缺省 50% 会让「已填充」段和圆点对不上。
     `.bzs-range` 是移动端的手势层（见 shell/range-touch.ts）：原生滑块按下
     即跳值，手机上滚动时扫过滑轨就会误改，所以触摸由外面这层接管。 */
  return `<div class="bzs-setrow"><label>${label}</label>
    <span class="bzs-range"><input type="range" data-role="pref" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${val}" style="--fill:${rangeFill(min, max, val)}"></span>
    <span class="val">${fmt(val)}</span></div>`;
}

function toggle(k: string, on: boolean, label: string): string {
  return `<div class="bzs-setrow"><label>${label}</label><button class="bzs-switch${on ? ' on' : ''}" data-act="toggle" data-k="${k}" aria-label="${label}"></button></div>`;
}

/** 阅读偏好（prefs）上的开关：和上面 shell 设置那类 toggle 分开走 */
function prefToggle(k: string, on: boolean, label: string): string {
  return `<div class="bzs-setrow"><label>${label}</label><button class="bzs-switch${on ? ' on' : ''}" data-act="preftoggle" data-k="${k}" aria-label="${label}"></button></div>`;
}

/**
 * 设置页顶部那条「关于」（横跨两栏）。
 *
 * 版本号与授权徽章紧跟「关于」后面：「我这是哪一版」「我买没买」是同一类
 * 问题，不该让人先翻到页尾的授权组再回来。四个出口都是「离开设置页去别处」
 * 的入口，不是设置项——这也是它横跨两栏的理由：它是整页的题头，不是两列
 * 里的又一个方框。
 *
 * 视频教程占一格：没装 bz 的人先看一期整体介绍，所以它和 GitHub、
 * 交流群一样是常驻出口，不做成「做好了再放上来」。
 */
function aboutBar(version: string, paid: boolean, patron: boolean, name?: string): string {
  const ver = version ? `v${esc(version)}` : t('settings.about.version');
  /* 授权徽章只有一枚（2026-11-10）：普通码写「高级版」，赞助人码换成
     「赞助人」，报过 nickname 就写昵称。两枚同款铜印胶囊、只换文字——
     并排两枚会让人以为「高级版」和「赞助人」是两档不同权益，而事实是
     赞助人本来就包含高级版。
     昵称来自我们签的码，照样转义——签名保证来源，不保证字符安全。 */
  const paidLabel = patron ? (name ? esc(name) : t('settings.about.patron')) : t('settings.about.paid');
  const label = paid ? paidLabel : t('settings.about.base');
  /* 读屏读「赞助人 · 面包」：只念名字等于没说身份。悬停提示说清这枚标记。
     基础版不挂 role/title——没买的人不该被打上身份。 */
  const hint = patron ? t('settings.about.patron') : t('settings.about.paid');
  const aria = patron && name ? `${hint} · ${esc(name)}` : hint;
  const seal = paid ? ico('seal', 'bzs-badge-seal') : '';
  const attrs = paid ? ` role="img" aria-label="${aria}" title="${hint}"` : '';
  const badge = `<span class="bzs-about-badge${paid ? '' : ' is-base'}${paid && patron ? ' is-patron' : ''}"${attrs}>${seal}${label}</span>`;
  return `<div class="bzs-setgrp wide bzs-about">
      <h3>${t('settings.about')}</h3>
      <span class="bzs-about-meta"><span class="bzs-about-ver">${ver}</span>${badge}</span>
      <span class="sp"></span>
      <button class="bzs-about-link" data-act="aboutgithub" title="${t('settings.about.repo')}">
        ${githubIcon(15)}<b>GitHub</b>
      </button>
      <span class="dot"></span>
      <button class="bzs-about-link" data-act="aboutvideo" title="${t('settings.about.videoTip')}">
        ${ico('video')}<b>${t('settings.about.video')}</b>
      </button>
      <span class="dot"></span>
      <button class="bzs-about-link" data-act="copygroup" title="${t('settings.about.groupTip')}">
        ${ico('group')}<b>${t('settings.about.group')}</b><i>${esc(GROUP_ID)}</i>
      </button>
      <span class="dot"></span>
      <button class="bzs-about-link" data-act="support" title="${t('settings.about.supportTip')}">
        ${ico('heart')}<b>${t('settings.about.support')}</b>
      </button>
      <span class="dot"></span>
      <button class="bzs-about-link" data-act="changelog" title="${t('settings.about.changelogTip')}">
        ${ico('history')}<b>${t('settings.about.changelog')}</b>
      </button>
    </div>`;
}

export function viewSettings(v: SettingsView): string {
  const p = v.prefs;
  const s = v.settings;
  const mobile = v.mobile ?? isMobileShell();
  /* 授权结论页头（关于条）与页尾（授权组）都要用，取一次 */
  const ent = entitlement();
  const paid = ent.tier === 'paid';

  /* 界面语言：放最前，因为它是「其他设置长什么样」的前提。
     auto = 跟随 Obsidian；手动选了之后不再看宿主——用户特意选中文，
     换台英文 Obsidian 不该把界面翻回去。

     九档（auto + 八种）在单行里放不下，用 `bzs-seg-wrap` 折行——强调色那组
     也是八档、也走这个 class，宽度行为已经验过。语言名一律用**自称**
     （Deutsch / 日本語），这几条不走 t()：只会德语的人在中文界面里
     也得找得到 "Deutsch"。

     组内没有说明行：2026-11-05 去掉，选择器本身就是全部交互。 */
  const languageOpts: Array<[string, string]> = [
    ['auto', t('settings.language.auto')],
    ...LOCALES.map((l) => [l, LOCALE_NAMES[l]] as [string, string]),
  ];
  const languageGrp = `<div class="bzs-setgrp">
      <h3>${t('settings.grp.ui')}</h3>
      <div class="bzs-setrow"><label>${t('settings.language')}</label><div class="bzs-seg bzs-seg-wrap">${languageOpts
        .map(
          (o) =>
            `<button class="${String(s.language) === o[0] ? 'on' : ''}" data-act="setlang" data-k="language" data-v="${o[0]}">${o[1]}</button>`,
        )
        .join('')}</div></div>
    </div>`;

  const layout = `<div class="bzs-setgrp">
      <h3>${t('settings.grp.layout')}</h3>
      <div class="bzs-setrow"><label>${t('settings.font')}</label>${seg(
        'fontFamily',
        FONT_FAMILIES.map((f) => [f.value, fontLabel(f.value)] as [string, string]),
        p.fontFamily,
      )}</div>
      ${range('fontSize', t('settings.fontSize'), p.fontSize, FONT_SIZE_RANGE.min, FONT_SIZE_RANGE.max, FONT_SIZE_RANGE.step, (x) => `${x}px`)}
      ${range('lineHeight', t('settings.lineHeight'), p.lineHeight, LINE_HEIGHT_RANGE.min, LINE_HEIGHT_RANGE.max, LINE_HEIGHT_RANGE.step, (x) => x.toFixed(1))}
      ${range('margin', t('settings.margin'), p.margin, MARGIN_RANGE.min, MARGIN_RANGE.max, MARGIN_RANGE.step, (x) => `${x}px`)}
      <div class="bzs-setrow"><label>${t('settings.align')}</label>${seg(
        'align',
        [
          ['justify', t('settings.align.justify')],
          ['left', t('settings.align.left')],
        ],
        p.align,
      )}</div>
      <div class="bzs-setrow"><label>${t('settings.direction')}</label>${seg(
        'layout',
        [
          ['horizontal', t('settings.direction.h')],
          ['vertical', t('settings.direction.v')],
        ],
        p.layout,
      )}</div>
      ${
        /* 手机竖屏恒为单栏（引擎的容器方向规则写死 1），这一行给了也白给 */
        mobile
          ? ''
          : `<div class="bzs-setrow"><label>${t('settings.columns')}</label>${seg(
              'columns',
              [
                ['1', t('settings.columns.1')],
                ['2', t('settings.columns.2')],
              ],
              String(p.columns),
            )}</div>`
      }
      ${
        /* 桌面点正文翻页：默认关（正文点下去是选字 / 点链接，不是翻页）。
           只有桌面有这一项——手机那儿点按就是唯一的翻页手势，没有开关可关。 */
        mobile
          ? ''
          : `${prefToggle('desktopTapTurn', p.desktopTapTurn === true, t('settings.desktopTapTurn'))}
      <div class="bzs-mini" style="margin:-4px 0 8px">${t('settings.desktopTapTurn.hint')}</div>`
      }
    </div>`;

  /* 外观只剩强调色一项：底色与文字跟随 Obsidian，不再有皮肤可挑。
     第一档是「跟随 Obsidian」，用户换主题或切明暗时它自己跟着变。 */
  const accentBtns = ACCENT_OPTIONS.map(
    (a) =>
      `<button class="${p.accent === a.value ? 'on' : ''}" data-act="setpref" data-k="accent" data-v="${a.value}"><span class="dot" style="background:${
        a.css || 'var(--interactive-accent)'
      }"></span>${accentLabel(a.value)}</button>`,
  ).join('');
  /* 工具条样式：文字 / 图标。默认文字（老用户升级后外观不变）；
     图标模式下按钮只剩一枚宿主图标，窄屏能省出一截。 */
  const toolbarStyleBtns = seg(
    'toolbarStyle',
    [
      ['text', t('settings.toolbarStyle.text')],
      ['icon', t('settings.toolbarStyle.icon')],
    ],
    p.toolbarStyle,
  );
  /* 阅读页页码：关（默认）/ 本章 / 全书。正文上一行小字，不占高度；
     默认关是老用户的界面不该变，想要的人自己开。 */
  const pageLabelBtns = seg(
    'pageLabel',
    [
      ['off', t('settings.pageLabel.off')],
      ['chapter', t('settings.pageLabel.chapter')],
      ['book', t('settings.pageLabel.book')],
    ],
    p.pageLabel,
  );
  const look = `<div class="bzs-setgrp">
      <h3>${t('settings.grp.look')}</h3>
      <div class="bzs-setrow"><label>${t('settings.accent')}</label><div class="bzs-seg bzs-seg-wrap">${accentBtns}</div></div>
      <div class="bzs-setrow"><label>${t('settings.toolbarStyle')}</label>${toolbarStyleBtns}</div>
      <div class="bzs-setrow"><label>${t('settings.pageLabel')}</label>${pageLabelBtns}</div>
      ${prefToggle('chapterLabel', p.chapterLabel !== false, t('settings.chapterLabel'))}
      <div class="bzs-setrow"><label>${t('settings.footnote')}</label>${seg(
        'footnote',
        // 浮窗已并入基础版：两个选项都是真实可用的
        [
          ['popup', t('settings.footnote.popup')],
          ['jump', t('settings.footnote.jump')],
        ],
        p.footnote,
      )}</div>
    </div>`;

  /* PDF 单独一组：自动复制链接 / 链接别名原来混在「外观」里，跟强调色、
     工具条样式摆在一起，找的人不会想到去那里翻。PDF 整本都属高级版，
     基础版照朗读 / AI 的口径整组灰掉，点一下弹高级功能说明。
     2026-11-10：PDF 在对照表里单独成段，锁标指向那一小段（cap 'pdf'），
     不再借用「更多格式」那一行。 */
  const pdfUnlocked = can('pdf');
  /* 本组三套分段控件一律带 bzs-seg-wrap，并按档数挂 pdf4 / pdf3：
     手机上设置卡片只有 ~300px，flex 平分会把四档挤成「3 个一行 + 最后一个
     被拉成整条」；桌面右列 ~340px 时 auto-fit 也只算得出 3 列，四档会变 3+1。
     列数统一交给 study.css（桌面 4/3）与 mobile.css（窄屏 2/3）。
     链接别名只列三档（📖 档收起来了，见下方 seg），挂 pdf3。 */
  const exportScaleBtns = seg(
    'pdfExportScale',
    [1, 2, 3].map((n) => [String(n), `${n}×`] as [string, string]),
    String(p.pdfExportScale),
    'setpref',
    'bzs-seg bzs-seg-wrap bzs-seg-pdf3',
  );
  const pdf = `<div class="bzs-setgrp bzs-setgrp-pdf${pdfUnlocked ? '' : ' is-locked'}"${
    pdfUnlocked ? '' : ` data-act="unlock" data-mode="pdf" title="${t('settings.locked')}"`
  }>
      <h3>${t('settings.grp.pdf')}</h3>
      <div class="bzs-setrow is-segrow"><label>${t('pdf.layout.flow')}</label>${seg(
        'pdfFlow',
        [
          ['scroll', t('pdf.layout.scroll')],
          ['paged', t('pdf.layout.paged')],
        ],
        p.pdfFlow,
      )}</div>
      <div class="bzs-setrow is-segrow"><label>${t('pdf.layout.pages')}</label>${seg(
        'pdfSpread',
        [
          ['single', t('pdf.layout.single')],
          ['spread', t('pdf.layout.spread')],
        ],
        p.pdfSpread ? 'spread' : 'single',
      )}</div>
      <div class="bzs-setrow is-segrow"><label>${t('settings.pdfZoom')}</label>${seg(
        'pdfZoom',
        [
          ['auto', t('settings.pdfZoom.auto')],
          ['width', t('settings.pdfZoom.width')],
          ['page', t('settings.pdfZoom.page')],
          ['actual', t('settings.pdfZoom.actual')],
        ],
        p.pdfZoom,
        'setpref',
        'bzs-seg bzs-seg-wrap bzs-seg-pdf4',
      )}</div>
      <div class="bzs-mini" style="margin:-4px 0 8px">${t('settings.pdfZoom.hint')}</div>
      <div class="bzs-setrow"><label>${t('settings.pdfAnnots')}</label><button class="bzs-switch${
        p.pdfAnnots ? ' on' : ''
      }" data-act="setpref" data-k="pdfAnnots" data-v="${p.pdfAnnots ? '0' : '1'}" aria-label="${t(
        'settings.pdfAnnots',
      )}"></button></div>
      <div class="bzs-setrow"><label>${t('settings.pdfBacklinks')}</label><button class="bzs-switch${
        p.pdfBacklinks ? ' on' : ''
      }" data-act="setpref" data-k="pdfBacklinks" data-v="${p.pdfBacklinks ? '0' : '1'}" aria-label="${t(
        'settings.pdfBacklinks',
      )}"></button></div>
      <div class="bzs-setrow is-segrow"><label>${t('settings.pdfExportScale')}</label>${exportScaleBtns}</div>
      <div class="bzs-setrow"><label>${t('settings.pdfAutoLink')}</label><button class="bzs-switch${
        p.pdfAutoLink ? ' on' : ''
      }" data-act="setpref" data-k="pdfAutoLink" data-v="${p.pdfAutoLink ? '0' : '1'}" aria-label="${t(
        'settings.pdfAutoLink',
      )}"></button></div>
      <div class="bzs-mini" style="margin:-4px 0 8px">${t('settings.pdfAutoLink.hint')}</div>
      <div class="bzs-setrow is-segrow"><label>${t('settings.pdfLinkLabel')}</label>${seg(
        'pdfLinkLabel',
        /* 只列三档：📖（emoji）档从面板收起（2026-11-10），面板更干净；
           prefs / 链接渲染仍认 'emoji'，已选该档的老数据照旧生效。 */
        [
          ['text', t('settings.pdfLinkLabel.text')],
          ['page', t('settings.pdfLinkLabel.page')],
          ['titlePage', t('settings.pdfLinkLabel.titlePage')],
        ],
        p.pdfLinkLabel,
        'setpref',
        'bzs-seg bzs-seg-wrap bzs-seg-pdf3',
      )}</div>
      <div class="bzs-mini" style="margin:-4px 0 8px">${t('settings.pdfLinkLabel.hint')}</div>
    </div>`;

  /* 阅读页右上角图标：可排序、可收起。收起的进 ⋮；移动端最多露 3 颗。
     手机上不提供的那几项（并排 / 对照书籍 / 朗读）不列出来——
     列出来的话，用户能把它们拖进前三颗，头栏就多一颗点不动的按钮。
     PDF 那三颗照旧列出：它们在桌面 PDF 里还有用。 */
  const listed = userFacingActionIds().filter((id) => !(mobile && isMobileHiddenAction(id)));
  const headerOrder: string[] = (p.headerOrder.length ? p.headerOrder : userFacingActionIds().slice())
    .filter((id) => listed.includes(id as HeaderActionId));
  /* 用户顺序里没有的（新加的动作、或刚从手机切回桌面）按默认顺序补在后面 */
  for (const id of listed) if (!headerOrder.includes(id)) headerOrder.push(id);
  const headerRows = headerOrder
    .map((id, i) => {
      const spec = headerActionSpec(id as HeaderActionId);
      const hidden = p.headerHidden.includes(id);
      /* 标题前补一枚与头栏同款的图标：阅读页右上角只画图标、不写字，
         这里按名字找的人得靠形状把两处对上。图标先留空壳，页面挂上之后
         由 hydrateIcons 交给宿主的 setIcon 画（本插件不自绘近似图形）。 */
      return `<div class="bzs-setrow">
        <label><span class="bzs-hicon" data-icon="${esc(spec.icon)}"></span>${esc(spec.label)}</label>
        <button class="bzs-btn sm" data-act="headermove" data-k="${id}" data-v="-1" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button class="bzs-btn sm" data-act="headermove" data-k="${id}" data-v="1" ${
          i === headerOrder.length - 1 ? 'disabled' : ''
        }>↓</button>
        <button class="bzs-switch${hidden ? '' : ' on'}" data-act="headertoggle" data-k="${id}" aria-label="${esc(
          spec.label,
        )}"></button>
      </div>`;
    })
    .join('');
  const header = `<div class="bzs-setgrp wide bzs-setgrp-header">
      <h3>${t('settings.grp.header')}</h3>
      <div class="bzs-mini" style="margin:0 0 8px">${t('settings.header.hint')}</div>
      ${headerRows}
    </div>`;

  /* 朗读（2026-11-14 二轮重做）：三张引擎卡，选中哪张只展开那张的字段。
     以前三档 seg 把所有字段堆在一起，换引擎要在一屏里找哪几行属于自己；
     现在「用哪个」和「怎么配」分成两步，一眼能看出当前在哪台引擎上。
     手机上也给本地：允许填局域网地址，连同一 Wi-Fi 的电脑。 */
  const ttsState = (id: TtsEngine): boolean =>
    ttsEngineReady({ engine: id, online: s.ttsOnline, local: s.ttsLocal });
  /* 卡上只留「名字 + 状态」：说明文字塞进三张小卡会把字挤成一片
     （2026-11-14 真机截图），要解释的挪到选中引擎下面一行，且只说一句。 */
  const engCard = (
    id: TtsEngine,
    icon: string,
    name: string,
    desc: string,
    state: string,
    ok: boolean,
  ): string => `<button class="bzs-engcard${p.ttsEngine === id ? ' on' : ''}" data-act="ttsengine" data-v="${id}" title="${esc(desc)}">
      <span class="bzs-engicon">${ico(icon)}</span>
      <span class="bzs-engtx"><b>${name}</b></span>
      <span class="bzs-engst"><span class="dot${ok ? ' ok' : ''}"></span>${state}</span>
    </button>`;
  /* DeepSeek 的两把嗓子有中文名；其它服务的音色名就是服务里的 id，原样显示 */
  const voiceName = (v: string): string =>
    v === 'stella'
      ? t('settings.ttsVoice.stella')
      : v === 'tide'
        ? t('settings.ttsVoice.tide')
        : v || t('settings.ttsVoice.default');
  const voicePick = (engine: 'local' | 'online'): string => {
    const cur = engine === 'local' ? p.ttsVoiceLocal : p.ttsVoiceOnline;
    return `<div class="bzs-setrow"><label>${t('settings.ttsVoice')}</label>
      <button class="bzs-voicepick" data-act="ttsvoices" data-v="${engine}">
        <span class="who">${esc(voiceName(cur))}</span>
        <span class="code">${esc(cur)}</span>
        ${ico('chevron-right')}
      </button></div>`;
  };
  const tts = `<div class="bzs-setgrp" id="bz-set-tts">
      <h3>${t('settings.grp.tts')}</h3>
      <div class="bzs-engines">
        ${engCard(
          'online',
          'cloud',
          t('settings.ttsEngine.online'),
          t('settings.ttsEngine.onlineDesc'),
          t(ttsState('online') ? 'settings.ttsEngine.ready' : 'settings.ttsEngine.notReady'),
          ttsState('online'),
        )}
        ${engCard(
          'local',
          'server',
          t('settings.ttsEngine.local'),
          t('settings.ttsEngine.localDesc'),
          t(ttsState('local') ? 'settings.ttsEngine.ready' : 'settings.ttsEngine.notReady'),
          ttsState('local'),
        )}
        ${engCard(
          'system',
          'monitor',
          t('settings.ttsEngine.system'),
          t('settings.ttsEngine.systemDesc'),
          t('settings.ttsEngine.ready'),
          true,
        )}
      </div>
      ${isMobileShell() ? `<div class="bzs-mini">${t('settings.ttsEngine.mobileHint')}</div>` : ''}
      ${
        p.ttsEngine === 'online'
          ? `<div class="bzs-setrow"><label>${t('settings.ttsOnline.url')}</label>
        <input data-role="setting" data-k="ttsOnline.url" value="${esc(s.ttsOnline.url)}" style="flex:1"></div>
      ${s.ttsOnline.url ? '' : `<div class="bzs-mini">${t('settings.ttsOnline.urlHint')}</div>`}
      <div class="bzs-setrow"><label>${t('settings.ttsOnline.model')}</label>
        <input data-role="setting" data-k="ttsOnline.model" value="${esc(s.ttsOnline.model)}" style="flex:1"></div>
      <div class="bzs-setrow"><label>${t('settings.ttsOnline.key')}</label>
        <input type="password" data-role="setting" data-k="ttsOnline.apiKey" value="${esc(s.ttsOnline.apiKey)}" style="flex:1"></div>
      ${voicePick('online')}
      <div class="bzs-mini">${t('settings.ttsVoice.modelHint')}</div>`
          : ''
      }
      ${
        p.ttsEngine === 'local'
          ? `<div class="bzs-setrow"><label>${t('settings.ttsLocal.url')}</label>
        <input data-role="setting" data-k="ttsLocal.url" value="${esc(s.ttsLocal.url)}" style="flex:1">
        <button class="bzs-btn sm" data-act="ttsprobe">${t('settings.ttsProbe')}</button></div>
      <div class="bzs-mini" data-role="probe-out">${s.ttsLocal.url ? '' : t('settings.ttsLocal.urlHint')}</div>
      ${voicePick('local')}
      <div class="bzs-mini">${t('settings.ttsVoice.modelHint')}</div>
      <div class="bzs-setrow"><label>${t('settings.ttsDeploy')}</label>
        <button class="bzs-btn sm" data-act="ttscopyprompt">${t('settings.ttsDeploy.copy')}</button>
        <span class="bzs-mini" style="margin:0">${t('settings.ttsDeploy.hint')}</span>
      </div>
      <details class="bzs-adv">
        <summary>${t('settings.ttsLocal.advanced')}</summary>
        <div class="bzs-setrow"><label>${t('settings.ttsLocal.model')}</label>
          <input data-role="setting" data-k="ttsLocal.model" value="${esc(s.ttsLocal.model)}" style="flex:1"></div>
        <div class="bzs-setrow"><label>${t('settings.ttsLocal.key')}</label>
          <input type="password" data-role="setting" data-k="ttsLocal.apiKey" value="${esc(s.ttsLocal.apiKey)}" style="flex:1"></div>
        <div class="bzs-setrow"><label>${t('settings.ttsLocal.format')}</label>${seg(
          'ttsLocalFormat',
          [
            ['mp3', 'MP3'],
            ['wav', 'WAV'],
            ['opus', 'Opus'],
          ],
          s.ttsLocal.format,
        )}</div>
        <div class="bzs-mini">${t('settings.ttsLocal.modelHint')}</div>
      </details>`
          : ''
      }
      ${
        p.ttsEngine === 'system'
          ? `<div class="bzs-mini">${t('settings.ttsEngine.systemHint')}</div>`
          : ''
      }
      <div class="bzs-setrow"><label>${t('settings.ttsTest')}</label>
        <button class="bzs-btn sm pri" data-act="ttstest">${t('settings.ttsTestNow')}</button>
        <span class="bzs-mini" data-role="ttstest-out"></span>
        <span class="bzs-mini" style="margin:0 0 0 auto">${
          p.ttsEngine === 'online' ? t('settings.ttsSpent', { chars: String(s.ttsStats.chars) }) : ''
        }</span>
      </div>
      ${range('ttsRate', t('settings.ttsRate'), p.ttsRate, TTS_RATE_RANGE.min, TTS_RATE_RANGE.max, TTS_RATE_RANGE.step, (x) => `${x.toFixed(1)}×`)}
      <div class="bzs-setrow"><label>${t('settings.ttsFollow')}</label>${seg(
        'ttsFollow',
        [
          ['1', t('settings.ttsFollow.on')],
          ['0', t('settings.ttsFollow.off')],
        ],
        p.ttsFollow ? '1' : '0',
      )}</div>
      <details class="bzs-adv">
        <summary>${t('settings.ttsCache.title')}</summary>
        ${range('ttsCacheMB', t('settings.ttsCache'), p.ttsCacheMB, TTS_CACHE_RANGE.min, TTS_CACHE_RANGE.max, TTS_CACHE_RANGE.step, (x) => `${x} MB`)}
        <div class="bzs-setrow"><label></label>
          <span class="bzs-mini" style="margin:0;flex:1">${t('settings.ttsCache.hint')}</span>
          <button class="bzs-btn sm" data-act="ttscacheclear">${t('settings.ttsCache.clear')}</button>
        </div>
        ${prefToggle('ttsOfflineSave', p.ttsOfflineSave, t('settings.ttsOffline.save'))}
        <div class="bzs-setrow"><label>${t('settings.ttsOffline.title')}</label>
          <span class="bzs-mini" style="margin:0;flex:1">${
            v.offline
              ? t('settings.ttsOffline.state', { chapters: String(v.offline.chapters), mb: String(v.offline.mb) })
              : t('settings.ttsOffline.none')
          }</span>
          <button class="bzs-btn sm" data-act="ttsofflinereload">${t('settings.ttsOffline.reload')}</button>
          ${v.offline ? `<button class="bzs-btn sm" data-act="ttsofflinedel">${t('settings.ttsOffline.clear')}</button>` : ''}
        </div>
        ${prefToggle('ttsPackFirst', p.ttsPackFirst, t('settings.ttsPackFirst'))}
        <div class="bzs-setrow"><label>${t('settings.ttsBook')}</label>
          <button class="bzs-btn sm${v.prefetchingBook ? ' pri' : ''}" data-act="ttsprefetchbook">${t(
            v.prefetchingBook ? 'settings.ttsBook.stop' : 'settings.ttsBook.start',
          )}</button>
          <span class="bzs-mini" style="margin:0">${t('settings.ttsBook.hint')}</span>
        </div>
      </details>
    </div>`;

  /* 标注组只剩能动手的三项：画笔、导出目录、带想法。「摘录链接」那一行没有
     任何控件，讲的双链能力在复制书摘时本来就有，2026-11-05 整行去掉。
     笔色五档走 bzs-seg-wrap：与语言、强调色同一套格子下限，窄窗不会叠字。 */
  const marks = `<div class="bzs-setgrp">
      <h3>${t('settings.grp.marks')}</h3>
      <div class="bzs-setrow"><label>${t('settings.pen')}</label><div class="bzs-seg bzs-seg-wrap">${HIGHLIGHT_COLORS.map(
        (c) =>
          `<button class="${v.pen === c.value ? 'on' : ''}" data-act="setpen" data-v="${c.value}"><span class="dot" style="background:${c.css}"></span>${colorLabel(c.value)}</button>`,
      ).join('')}</div></div>
      <div class="bzs-mini" style="margin:-4px 0 8px">${t('settings.pen.hint')}</div>
      <div class="bzs-setrow"><label>${t('settings.exportDir')}</label>
        <button class="bzs-pickdir" data-act="pickexportdir" title="${t('settings.pickFromList')}">
          <span>${esc(s.exportDir)}/</span>${ico('folder') || ''}<i>${t('settings.pick')}</i>
        </button></div>
      ${toggle('exportComments', s.exportComments, t('settings.exportComments'))}
    </div>`;

  /* 入口平权：AI 组始终出现。基础版整组灰掉、点一下就弹高级功能说明——
     只读输入框既不说明为什么不能改，也点不出任何出口。
     2026-11-11 同日回摆：不提供服务商选择，只留地址 / 模型 / 密钥三个自由输入框。 */
  const aiUnlocked = can('ai');
  const aiReadonly = aiUnlocked ? '' : ' readonly';
  /* 「连上了」= bz 在且有嵌入模型。bz 装着但没选模型，索引照样建不了，
     对用户来说就是没连上——所以门禁看 model，不看 bz 在不在。 */
  const kbLinked = !!v.bz?.model;
  const ai = `<div class="bzs-setgrp${aiUnlocked ? '' : ' is-locked'}"${
    aiUnlocked ? '' : ` data-act="unlock" data-mode="ai" title="${t('settings.locked')}"`
  }>
      <h3>${t('settings.grp.ai')}</h3>
      <div class="bzs-setrow"><label>${t('settings.ai.baseUrl')}</label><input data-role="setting" data-k="ai.baseUrl" placeholder="${t('settings.ai.baseUrl.ph')}" value="${esc(s.ai.baseUrl)}" style="flex:1"${aiReadonly}></div>
      <div class="bzs-setrow"><label>${t('settings.ai.model')}</label><input data-role="setting" data-k="ai.model" placeholder="${t('settings.ai.model.ph')}" value="${esc(s.ai.model)}" style="flex:1"${aiReadonly}></div>
      <div class="bzs-setrow"><label>${t('settings.ai.key')}</label><input type="password" data-role="setting" data-k="ai.apiKey" placeholder="${t('settings.ai.key.ph')}" value="${esc(s.ai.apiKey)}" style="flex:1"${aiReadonly}></div>
    </div>`;

  /* bz 组（2026-11-13）：两项外部能力从 AI 组里抽出来单独成组。
        · 剪藏本——要人主动打开，所以是开关；装了 bz 才画开关，没装只留说明。
          摆一颗点不动的灰开关，人会以为是自己点坏了。
        · AI 知识盒——检测到 bz 就自动连（data/bz-bridge 逐项降级），没有
          「关掉」这个动作，所以永远只报连没连上，不给开关。
     两项各有自己的教程：剪藏本讲成书，知识盒讲索引怎么建，共一颗就会指错。 */
  const bzOk = !!v.bz?.ok;
  const tutBtn = (act: string, key: MsgKey): string =>
    `<button class="bzs-bztut" data-act="${act}">${ico('video')}<span>${t(key)}</span></button>`;
  /* 剪藏成书是高级版能力（2026-11-14 补的门禁）。基础版用户在设置里看到的
     是一颗点了就弹解锁层的开关——不是灰着不动的死开关，那样人只会以为坏了。
     范围内三选只在解锁后画：没解锁时选了也不会生效，摆出来等于骗人。 */
  const clipUnlocked = can('clipBook');
  const clipOn = clipUnlocked && s.clipBook === true;
  const clipScopeSeg = clipUnlocked
    ? `<div class="bzs-setrow"><label>${t('settings.bz.clip.scope')}</label>${seg(
        'clipScope',
        [
          ['all', t('settings.bz.clip.scope.all')],
          ['unread', t('settings.bz.clip.scope.unread')],
          ['todayUnread', t('settings.bz.clip.scope.today')],
        ],
        s.clipScope,
        'setscope',
      )}</div>`
    : '';
  const bzClip = `<div class="bzs-bzitem">
      ${
        bzOk
          ? clipUnlocked
            ? toggle('clipBook', clipOn, t('settings.bz.clip'))
            : `<div class="bzs-setrow"><label>${t('settings.bz.clip')}</label>
                <button class="bzs-switch" data-act="unlock" data-mode="clipBook" title="${t(
                  'settings.locked',
                )}" aria-label="${t('settings.bz.clip')}"></button></div>`
          : `<div class="bzs-setrow"><label>${t('settings.bz.clip')}</label></div>`
      }
      ${clipScopeSeg}
      <div class="bzs-bznote">${t('settings.bz.clip.hint')}${tutBtn('cliptut', 'settings.bz.tut')}</div>
    </div>`;
  const bzKb = `<div class="bzs-bzitem">
      <div class="bzs-setrow"><label>${t('settings.bz.kb')}</label>
        <span class="bzs-kbstate${kbLinked ? ' on' : ''}"><i></i>${
          kbLinked ? t('settings.ai.kb.on') : t('settings.ai.kb.off')
        }</span></div>
      <div class="bzs-bznote">${t('settings.ai.kb.hint')}${tutBtn('aitutorial', 'settings.bz.tut')}</div>
    </div>`;
  /* 没装 bz 时补一句「为什么现在不能用」+ 安装教程（第 2P）。
     装了就整块不渲染：装完这一节没有第二次用途。 */
  const bz = `<div class="bzs-setgrp">
      <h3>${t('settings.grp.bz')}</h3>
      ${bzClip}${bzKb}
      ${
        bzOk
          ? ''
          : `<div class="bzs-bzguide"><div class="bzs-bznote">${t('settings.bz.missing')}${tutBtn(
              'bzinstall',
              'settings.bz.install',
            )}</div></div>`
      }
    </div>`;

  /* 激活之后这组变成「凭证」：码只读，日常不让人误改。
     但**必须留一个换码入口**——先用群里的 7 天试用，再买正式版，
     如果输入框只读又没有按钮，就变成「买了却填不进去」。
     点「重新激活」进入一次性的替换态（relicense），取消即回只读。 */
  const editingLicense = paid && !!v.relicense;
  /* 赞助人码在状态行也画一枚小铜印（2026-11-10）：这一句本来只有文字，
     和关于条的身份标记呼应不上。普通码不加，免得人人都有印。 */
  const licStatus = paid && ent.patron
    ? `<span class="bzs-mini bzs-licstat" style="flex:1">${ico('seal', 'bzs-lic-seal')}${esc(tierText(ent))}</span>`
    : `<span class="bzs-mini" style="flex:1">${esc(tierText(ent))}</span>`;
  const lic = `<div class="bzs-setgrp">
      <h3>${t('settings.grp.lic')}</h3>
      <div class="bzs-setrow"><label>${t('settings.lic.status')}</label>${licStatus}</div>
      <div class="bzs-setrow"><label>${t('settings.lic.code')}</label>
        <input data-role="license" placeholder="BZR2.… 或 BZR1.…" value="${esc(ent.license)}" spellcheck="false" style="flex:1"${
          paid && !editingLicense ? ' readonly' : ''
        }>
        ${
          paid && !editingLicense
            ? `<button class="bzs-btn sm" data-act="relicense">${t('settings.lic.relicense')}</button>`
            : `<button class="bzs-btn sm pri" data-act="activate">${t('settings.lic.activate')}</button>`
        }</div>
      ${
        paid
          ? ''
          : `<div class="bzs-setrow"><label>${t('settings.lic.paid')}</label>
        <span class="bzs-mini" style="flex:1">${t('settings.lic.benefits')}</span>
        <button class="bzs-btn sm" data-act="unlock">${t('settings.lic.compare')}</button></div>`
      }
    </div>`;

  const dir = dataDirOf();
  /* 目录一律只给选择器，不给输入框：vault 路径有口径（分隔符、首尾斜杠、
     大小写），手打死角很多，错了还不报错——文件会写进别处。 */
  const importDir = s.importDir || DEFAULT_SETTINGS.importDir;
  /* 备份说明紧跟「备份与恢复」那一行（2026-11-09）：它说的是备份，不该挂在
     下一项调试开关的脚下。调试那一项只留一句「只在排查问题时打开」。 */
  const data = `<div class="bzs-setgrp">
      <h3>${t('settings.grp.data')}</h3>
      <div class="bzs-setrow"><label>${t('settings.importDir')}</label>
        <button class="bzs-pickdir" data-act="pickimportdir" title="${t('settings.pickFolder')}">
          <span>${esc(importDir)}/</span>${ico('folder') || ''}<i>${t('settings.pick')}</i>
        </button></div>
      <div class="bzs-setrow"><label>${t('settings.dataDir')}</label>
        <button class="bzs-pickdir" data-act="pickdatadir" title="${t('settings.pickFromList')}">
          <span>${esc(dir)}/</span>${ico('folder') || ''}<i>${t('settings.pick')}</i>
        </button></div>
      <div class="bzs-setrow"><label>${t('settings.backupRestore')}</label>
        <button class="bzs-btn sm" data-act="backup" title="${t('settings.backup.tip')}">${t('settings.backup')}</button>
        <button class="bzs-btn sm" data-act="restore" title="${t('settings.restore.tip')}">${t('settings.restore')}</button></div>
      <div class="bzs-mini" style="margin-top:2px;line-height:1.9">
        ${t('settings.data.hint')}
      </div>
      ${toggle('debugLog', s.debugLog, t('settings.debugLog'))}
      <div class="bzs-mini" style="margin-top:2px;line-height:1.9">
        ${t('settings.debugLog.hint')}
        <button class="bzs-btn sm" data-act="debugcopy">${t('settings.debugLog.copy')}</button>
      </div>
    </div>`;

  /* 快捷键不是我们自己的一张表，而是宿主里那些命令的当前绑定：
     点一行 → 打开 Obsidian 的快捷键设置并搜这条命令，改完回来这里就是新的。 */
  const keyRows = v.hotkeys
    .map((k) => {
      const bound = k.keys.length ? k.keys.join(' / ') : k.builtin || t('settings.key.unset');
      return `<button class="bzs-keyrow" data-act="hotkey" data-k="${esc(k.id)}" title="${t('settings.key.tip')}">
        <span>${esc(k.label)}</span><kbd class="${k.keys.length ? '' : 'soft'}">${esc(bound)}</kbd>
      </button>`;
    })
    .join('');

  /* 手机没有物理键盘、也没有那一页设置，整组收起。 */
  const keys = mobile
    ? ''
    : `<div class="bzs-setgrp wide">
      <h3>${t('settings.grp.keys')}</h3>
      <div class="bzs-keys">${keyRows}</div>
    </div>`;

  /* 两列各自成流（布局说明见 study.css 的 .bzs-set-page）。
     2026-11-11 两轮调整：
       ① 原来左列只有界面 + 版式，右列七组，下半页左边整条空白；
       ② 朗读组按用户要求挪到**右列、AI 之上**，左列只留界面 / 版式 / 外观 / PDF。

     切点仍按原顺序切，不重排其余分组：窄屏叠成一列时「左列全部 → 右列全部」
     仍是界面 → 版式 → 外观 → PDF → 标注 → 数据 → 朗读 → AI → 授权。 */
  const leftCol = `${languageGrp}${layout}${look}${pdf}`;
  const rightCol = `${marks}${data}${tts}${ai}${bz}${lic}`;

  return `<div class="bzs-set-page">${aboutBar(v.version || '', paid, ent.patron, ent.name)}<div class="bzs-set-grid"><div class="bzs-set-col">${leftCol}</div><div class="bzs-set-col">${rightCol}</div></div>${header}${keys}</div>`;
}
