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
import { ACCENT_OPTIONS, accentLabel, FONT_FAMILIES, fontLabel, FONT_SIZE_RANGE, LINE_HEIGHT_RANGE, MARGIN_RANGE, TTS_RATE_RANGE, type ReaderPrefs } from '../../data/prefs';
import { HIGHLIGHT_COLORS, colorLabel } from '../../data/notes';
import { DEFAULT_SETTINGS, type ReaderSettings } from '../../data/settings';
import { can, entitlement, GROUP_ID, tierText } from '../../data/entitlement';
import { dataDirOf } from '../../core/plugin-path';
import type { HotkeyRow } from '../../core/hotkeys';
import { HEADER_ACTION_IDS, headerActionSpec, type HeaderActionId } from '../../view/header-actions';
import { rangeFill } from '../range-fill';
import { esc, githubIcon, ico } from './html';

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
];

function seg(name: string, opts: Array<[string, string]>, cur: string, act = 'setpref'): string {
  return `<div class="bzs-seg">${opts
    .map((o) => `<button class="${String(cur) === o[0] ? 'on' : ''}" data-act="${act}" data-k="${name}" data-v="${o[0]}">${o[1]}</button>`)
    .join('')}</div>`;
}

function range(k: string, label: string, val: number, min: number, max: number, step: number, fmt: (v: number) => string): string {
  /* --fill 必须在渲染时就写：缺省 50% 会让「已填充」段和圆点对不上 */
  return `<div class="bzs-setrow"><label>${label}</label>
    <input type="range" data-role="pref" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${val}" style="--fill:${rangeFill(min, max, val)}">
    <span class="val">${fmt(val)}</span></div>`;
}

function toggle(k: string, on: boolean, label: string): string {
  return `<div class="bzs-setrow"><label>${label}</label><button class="bzs-switch${on ? ' on' : ''}" data-act="toggle" data-k="${k}" aria-label="${label}"></button></div>`;
}

/**
 * 设置页顶部那条「关于」（横跨两栏）。
 *
 * 版本号与授权徽章紧跟「关于」后面：「我这是哪一版」「我买没买」是同一类
 * 问题，不该让人先翻到页尾的授权组再回来。四个出口都是「离开设置页去别处」
 * 的入口，不是设置项——这也是它横跨两栏的理由：它是整页的题头，不是两列
 * 里的又一个方框。
 *
 * 视频教程还没剪完。它照样占一格、照样写着「制作中」，但点了只说明进度：
 * 藏起来会让人以为「这插件没有教程」，灰掉不给解释则和坏了没区别。
 */
function aboutBar(version: string, paid: boolean): string {
  const ver = version ? `v${esc(version)}` : t('settings.about.version');
  const badge = `<span class="bzs-about-badge${paid ? '' : ' is-base'}">${paid ? t('settings.about.paid') : t('settings.about.base')}</span>`;
  return `<div class="bzs-setgrp wide bzs-about">
      <h3>${t('settings.about')}</h3>
      <span class="bzs-about-meta"><span class="bzs-about-ver">${ver}</span>${badge}</span>
      <span class="sp"></span>
      <button class="bzs-about-link" data-act="aboutgithub" title="${t('settings.about.repo')}">
        ${githubIcon(15)}<b>GitHub</b>
      </button>
      <span class="dot"></span>
      <button class="bzs-about-link is-wip" data-act="aboutvideo" title="${t('settings.about.videoTip')}">
        ${ico('video')}<b>${t('settings.about.video')}</b><i>${t('settings.about.wip')}</i>
      </button>
      <span class="dot"></span>
      <button class="bzs-about-link" data-act="copygroup" title="${t('settings.about.groupTip')}">
        ${ico('group')}<b>${t('settings.about.group')}</b><i>${esc(GROUP_ID)}</i>
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
      <div class="bzs-setrow"><label>${t('settings.columns')}</label>${seg(
        'columns',
        [
          ['1', t('settings.columns.1')],
          ['2', t('settings.columns.2')],
        ],
        String(p.columns),
      )}</div>
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

  /* 外观只剩强调色一项：底色与文字跟随 Obsidian，不再有皮肤可挑。
     第一档是「跟随 Obsidian」，用户换主题或切明暗时它自己跟着变。 */
  const accentBtns = ACCENT_OPTIONS.map(
    (a) =>
      `<button class="${p.accent === a.value ? 'on' : ''}" data-act="setpref" data-k="accent" data-v="${a.value}"><span class="dot" style="background:${
        a.css || 'var(--interactive-accent)'
      }"></span>${accentLabel(a.value)}</button>`,
  ).join('');
  const look = `<div class="bzs-setgrp">
      <h3>${t('settings.grp.look')}</h3>
      <div class="bzs-setrow"><label>${t('settings.accent')}</label><div class="bzs-seg bzs-seg-wrap">${accentBtns}</div></div>
    </div>`;

  /* 阅读页右上角图标：可排序、可收起。收起的进 ⋮；移动端最多露 3 颗。 */
  const headerOrder: string[] = p.headerOrder.length ? p.headerOrder : HEADER_ACTION_IDS.slice();
  const headerRows = headerOrder
    .map((id, i) => {
      const spec = headerActionSpec(id as HeaderActionId);
      const hidden = p.headerHidden.includes(id);
      return `<div class="bzs-setrow">
        <label>${esc(spec.label)}</label>
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
  const header = `<div class="bzs-setgrp">
      <h3>${t('settings.grp.header')}</h3>
      <div class="bzs-mini" style="margin:0 0 8px">${t('settings.header.hint')}</div>
      ${headerRows}
    </div>`;

  /* 朗读：语速与「念完续页」原来塞在阅读页的排版浮层里，调的时候浮层本身
     就挡着正文。这两项属于「怎么读」，搬到设置页单起一组。 */
  const ttsUnlocked = can('tts');
  const tts = `<div class="bzs-setgrp${ttsUnlocked ? '' : ' is-locked'}"${
    ttsUnlocked ? '' : ` data-act="unlock" data-mode="tts" title="${t('settings.locked')}"`
  }>
      <h3>${t('settings.grp.tts')}</h3>
      ${range('ttsRate', t('settings.ttsRate'), p.ttsRate, TTS_RATE_RANGE.min, TTS_RATE_RANGE.max, TTS_RATE_RANGE.step, (x) => `${x.toFixed(1)}×`)}
      <div class="bzs-setrow"><label>${t('settings.ttsFollow')}</label>${seg(
        'ttsFollow',
        [
          ['1', t('settings.ttsFollow.on')],
          ['0', t('settings.ttsFollow.off')],
        ],
        p.ttsFollow ? '1' : '0',
      )}</div>
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
      <div class="bzs-setrow"><label>${t('settings.exportDir')}</label>
        <button class="bzs-pickdir" data-act="pickexportdir" title="${t('settings.pickFromList')}">
          <span>${esc(s.exportDir)}/</span>${ico('folder') || ''}<i>${t('settings.pick')}</i>
        </button></div>
      ${toggle('exportComments', s.exportComments, t('settings.exportComments'))}
    </div>`;

  /* 入口平权：AI 组始终出现。基础版整组灰掉、点一下就弹高级功能说明——
     只读输入框既不说明为什么不能改，也点不出任何出口。 */
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
      ${
        /* 知识库归 BZ AI：这里只报「连没连上」，不给选——留一个能填错的框，
           就留了一条静默错误（模型不一致 → 检索全错）。
           连不上时给一个教程出口：此刻唯一有意义的下一步是去看怎么装，
           把安装步骤原样写在这行，只是把教程复述一遍。 */
        `<div class="bzs-setrow"><label>${t('settings.ai.kb')}</label>
            <span class="bzs-kbstate${kbLinked ? ' on' : ''}"><i></i>${
              kbLinked ? t('settings.ai.kb.on') : t('settings.ai.kb.off')
            }</span></div>
          <div class="bzs-mini" style="margin:-2px 0 ${kbLinked ? '8' : '10'}px;line-height:1.7">${t('settings.ai.kb.hint')}</div>
          ${
            kbLinked
              ? ''
              : `<div class="bzs-kbacts"><button class="bzs-btn sm pri" data-act="aitutorial">${t('side.ai.index.tutorial')}</button></div>`
          }`
      }
    </div>`;

  /* 激活之后这组变成「凭证」：码只读，日常不让人误改。
     但**必须留一个换码入口**——先用群里的 7 天试用，再买正式版，
     如果输入框只读又没有按钮，就变成「买了却填不进去」。
     点「重新激活」进入一次性的替换态（relicense），取消即回只读。 */
  const editingLicense = paid && !!v.relicense;
  const lic = `<div class="bzs-setgrp">
      <h3>${t('settings.grp.lic')}</h3>
      <div class="bzs-setrow"><label>${t('settings.lic.status')}</label><span class="bzs-mini" style="flex:1">${esc(tierText(ent))}</span></div>
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
      <div class="bzs-mini" style="margin-top:10px;line-height:1.9">
        ${t('settings.data.hint')}
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

  const keys = `<div class="bzs-setgrp wide">
      <h3>${t('settings.grp.keys')}</h3>
      <div class="bzs-keys">${keyRows}</div>
    </div>`;

  /* 两列各自成流（布局说明见 study.css 的 .bzs-set-page）。
     切在「阅读页图标 / 外观」之间：左列是界面 + 版式 + 那张十行的图标表，
     右列是外观 + 其余六组，两列总高接近；DOM 顺序与原来完全一致，窄屏
     叠成一列时仍是原来的阅读顺序，现有「阅读页图标在 外观之前」的断言
     也不必改。 */
  const leftCol = `${languageGrp}${layout}${header}`;
  const rightCol = `${look}${tts}${marks}${data}${ai}${lic}`;

  return `<div class="bzs-set-page">${aboutBar(v.version || '', paid)}<div class="bzs-set-grid"><div class="bzs-set-col">${leftCol}</div><div class="bzs-set-col">${rightCol}</div></div>${keys}</div>`;
}
