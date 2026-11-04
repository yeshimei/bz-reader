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
 * ============================================================ */
import type { ReaderPrefs } from '../../data/prefs';
import { ACCENT_OPTIONS, FONT_FAMILIES, FONT_SIZE_RANGE, LINE_HEIGHT_RANGE, MARGIN_RANGE, TTS_RATE_RANGE } from '../../data/prefs';
import { HIGHLIGHT_COLORS, colorLabel } from '../../data/notes';
import { DEFAULT_SETTINGS, type ReaderSettings } from '../../data/settings';
import { can, entitlement, GROUP_ID, REPO_URL, tierText } from '../../data/entitlement';
import { dataDirOf } from '../../core/plugin-path';
import { LOCALES, LOCALE_NAMES } from '../../i18n';
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
}

/**
 * 设置页要露出来的命令。
 *
 * `builtin` 是阅读页内置的单键（不经过宿主，阅读页聚焦时才生效）；
 * 用户没在宿主里另绑时显示它，绑了就显示绑的——两套都真实存在，
 * 藏起任何一套都会让人以为「这键不能改」。
 */
export const KEY_COMMANDS: Array<Omit<HotkeyRow, 'keys'>> = [
  { id: 'bz-reader:page-next', label: '下一页', builtin: '→' },
  { id: 'bz-reader:page-prev', label: '上一页', builtin: '←' },
  { id: 'bz-reader:open', label: '打开书架', builtin: 'g' },
  { id: 'bz-reader:search', label: '搜索（本书 / 全库）', builtin: '⌘/Ctrl + F' },
  { id: 'bz-reader:sidebar', label: '显示左侧栏', builtin: 's' },
  { id: 'bz-reader:focus', label: '专注模式', builtin: 'f' },
  { id: 'bz-reader:fullscreen', label: '全屏' },
  { id: 'bz-reader:bookmark', label: '记一枚书签', builtin: 'b' },
  { id: 'bz-reader:typography', label: '排版面板', builtin: 't' },
  { id: 'bz-reader:bookmap', label: '全书鸟瞰', builtin: 'm' },
  { id: 'bz-reader:tts', label: '朗读开关', builtin: 'r' },
  { id: 'bz-reader:continue', label: '继续阅读最近一本' },
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

/** 仓库地址在界面上只露 owner/repo：整条 URL 太长，也没人会照着读协议头 */
const REPO_PATH = REPO_URL.replace(/^https:\/\/github\.com\//, '');

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
  const ver = version ? `v${esc(version)}` : '版本未知';
  const badge = `<span class="bzs-about-badge${paid ? '' : ' is-base'}">${paid ? '高级版' : '基础版'}</span>`;
  return `<div class="bzs-setgrp wide bzs-about">
      <h3>关于</h3>
      <span class="bzs-about-meta"><span class="bzs-about-ver">${ver}</span>${badge}</span>
      <span class="sp"></span>
      <button class="bzs-about-link" data-act="aboutgithub" title="在浏览器里打开仓库">
        ${githubIcon(15)}<b>GitHub</b><i>${esc(REPO_PATH)}</i>
      </button>
      <span class="dot"></span>
      <button class="bzs-about-link is-wip" data-act="aboutvideo" title="教程还在剪，做好会在交流群里通知">
        ${ico('video')}<b>视频教程</b><i>制作中</i>
      </button>
      <span class="dot"></span>
      <button class="bzs-about-link" data-act="copygroup" title="点一下复制群号，去 QQ 搜索">
        ${ico('group')}<b>交流群</b><i>${esc(GROUP_ID)}</i>
      </button>
      <span class="dot"></span>
      <button class="bzs-about-link" data-act="changelog" title="看看每一版改了什么">
        ${ico('history')}<b>更新日志</b>
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
     也得找得到 "Deutsch"。 */
  const languageOpts: Array<[string, string]> = [
    ['auto', '跟随 Obsidian'],
    ...LOCALES.map((l) => [l, LOCALE_NAMES[l]] as [string, string]),
  ];
  const languageGrp = `<div class="bzs-setgrp">
      <h3>界面</h3>
      <div class="bzs-setrow"><label>语言</label><div class="bzs-seg bzs-seg-wrap">${languageOpts
        .map(
          (o) =>
            `<button class="${String(s.language) === o[0] ? 'on' : ''}" data-act="setlang" data-k="language" data-v="${o[0]}">${o[1]}</button>`,
        )
        .join('')}</div></div>
      <div class="bzs-mini" style="margin-top:8px;line-height:1.9">选「跟随 Obsidian」时由宿主语言决定；手动选择后界面立即生效，命令名需重启 Obsidian 才更新。</div>
    </div>`;

  const layout = `<div class="bzs-setgrp">
      <h3>版式</h3>
      <div class="bzs-setrow"><label>字体</label>${seg(
        'fontFamily',
        FONT_FAMILIES.map((f) => [f.value, f.label] as [string, string]),
        p.fontFamily,
      )}</div>
      ${range('fontSize', '字号', p.fontSize, FONT_SIZE_RANGE.min, FONT_SIZE_RANGE.max, FONT_SIZE_RANGE.step, (x) => `${x}px`)}
      ${range('lineHeight', '行距', p.lineHeight, LINE_HEIGHT_RANGE.min, LINE_HEIGHT_RANGE.max, LINE_HEIGHT_RANGE.step, (x) => x.toFixed(1))}
      ${range('margin', '页边距', p.margin, MARGIN_RANGE.min, MARGIN_RANGE.max, MARGIN_RANGE.step, (x) => `${x}px`)}
      <div class="bzs-setrow"><label>对齐</label>${seg('align', [['justify', '两端'], ['left', '居左']], p.align)}</div>
      <div class="bzs-setrow"><label>方向</label>${seg('layout', [['horizontal', '横排'], ['vertical', '竖排']], p.layout)}</div>
      <div class="bzs-setrow"><label>分栏</label>${seg('columns', [['1', '单栏'], ['2', '双栏']], String(p.columns))}</div>
      <div class="bzs-setrow"><label>脚注</label>${seg(
        'footnote',
        // 浮窗已并入基础版：两个选项都是真实可用的
        [['popup', '上方浮窗'], ['jump', '跳到章末']],
        p.footnote,
      )}</div>
    </div>`;

  /* 外观只剩强调色一项：底色与文字跟随 Obsidian，不再有皮肤可挑。
     第一档是「跟随 Obsidian」，用户换主题或切明暗时它自己跟着变。 */
  const accentBtns = ACCENT_OPTIONS.map(
    (a) =>
      `<button class="${p.accent === a.value ? 'on' : ''}" data-act="setpref" data-k="accent" data-v="${a.value}"><span class="dot" style="background:${
        a.css || 'var(--interactive-accent)'
      }"></span>${a.label}</button>`,
  ).join('');
  const look = `<div class="bzs-setgrp">
      <h3>外观</h3>
      <div class="bzs-setrow"><label>强调色</label><div class="bzs-seg bzs-seg-wrap">${accentBtns}</div></div>
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
      <h3>阅读页图标</h3>
      <div class="bzs-mini" style="margin:0 0 8px">开关控制显示 / 收起；收起的进最右侧 ⋮（Obsidian 自带的更多菜单）。移动端最多露 3 颗。</div>
      ${headerRows}
    </div>`;

  /* 朗读：语速与「念完续页」原来塞在阅读页的排版浮层里，调的时候浮层本身
     就挡着正文。这两项属于「怎么读」，搬到设置页单起一组。 */
  const ttsUnlocked = can('tts');
  const tts = `<div class="bzs-setgrp${ttsUnlocked ? '' : ' is-locked'}"${
    ttsUnlocked ? '' : ' data-act="unlock" data-mode="tts" title="高级版功能：点一下看看包含什么"'
  }>
      <h3>朗读</h3>
      ${range('ttsRate', '语速', p.ttsRate, TTS_RATE_RANGE.min, TTS_RATE_RANGE.max, TTS_RATE_RANGE.step, (x) => `${x.toFixed(1)}×`)}
      <div class="bzs-setrow"><label>朗读跟随</label>${seg(
        'ttsFollow',
        [
          ['1', '念完续页'],
          ['0', '只念本页'],
        ],
        p.ttsFollow ? '1' : '0',
      )}</div>
    </div>`;

  const marks = `<div class="bzs-setgrp">
      <h3>标注</h3>
      <div class="bzs-setrow"><label>默认笔色</label><div class="bzs-seg">${HIGHLIGHT_COLORS.map(
        (c) =>
          `<button class="${v.pen === c.value ? 'on' : ''}" data-act="setpen" data-v="${c.value}"><span class="dot" style="background:${c.css}"></span>${colorLabel(c.value)}</button>`,
      ).join('')}</div></div>
      <div class="bzs-setrow"><label>导出目录</label>
        <button class="bzs-pickdir" data-act="pickexportdir" title="从文件夹清单里选">
          <span>${esc(s.exportDir)}/</span>${ico('folder') || ''}<i>选择…</i>
        </button></div>
      ${toggle('exportComments', s.exportComments, '导出时带上想法')}
      <div class="bzs-setrow"><label>摘录链接</label><span class="bzs-mini" style="flex:1">复制成双链 <code>[[书#定位]]</code>，粘进笔记点一下跳回原句，反链面板也看得见</span></div>
    </div>`;

  /* 入口平权：AI 组始终出现。基础版整组灰掉、点一下就弹高级功能说明——
     只读输入框既不说明为什么不能改，也点不出任何出口。 */
  const aiUnlocked = can('ai');
  const aiReadonly = aiUnlocked ? '' : ' readonly';
  const ai = `<div class="bzs-setgrp${aiUnlocked ? '' : ' is-locked'}"${
    aiUnlocked ? '' : ' data-act="unlock" data-mode="ai" title="高级版功能：点一下看看包含什么"'
  }>
      <h3>AI 助手</h3>
      <div class="bzs-setrow"><label>服务商</label><input data-role="setting" data-k="ai.baseUrl" placeholder="填写服务商接口地址，以 https:// 开头" value="${esc(s.ai.baseUrl)}" style="flex:1"${aiReadonly}></div>
      <div class="bzs-setrow"><label>模型</label><input data-role="setting" data-k="ai.model" placeholder="填写你的账号可用的模型名" value="${esc(s.ai.model)}" style="flex:1"${aiReadonly}></div>
      <div class="bzs-setrow"><label>密钥</label><input type="password" data-role="setting" data-k="ai.apiKey" placeholder="填写 API 密钥" value="${esc(s.ai.apiKey)}" style="flex:1"${aiReadonly}></div>
    </div>`;

  /* 激活之后这组变成「凭证」：码只读，日常不让人误改。
     但**必须留一个换码入口**——先用群里的 7 天试用，再买正式版，
     如果输入框只读又没有按钮，就变成「买了却填不进去」。
     点「重新激活」进入一次性的替换态（relicense），取消即回只读。 */
  const editingLicense = paid && !!v.relicense;
  const lic = `<div class="bzs-setgrp">
      <h3>授权</h3>
      <div class="bzs-setrow"><label>状态</label><span class="bzs-mini" style="flex:1">${esc(tierText(ent))}</span></div>
      <div class="bzs-setrow"><label>激活码</label>
        <input data-role="license" placeholder="BZR2.… 或 BZR1.…" value="${esc(ent.license)}" spellcheck="false" style="flex:1"${
          paid && !editingLicense ? ' readonly' : ''
        }>
        ${
          paid && !editingLicense
            ? '<button class="bzs-btn sm" data-act="relicense">重新激活</button>'
            : '<button class="bzs-btn sm pri" data-act="activate">激活</button>'
        }</div>
      ${
        paid
          ? ''
          : `<div class="bzs-setrow"><label>高级版</label>
        <span class="bzs-mini" style="flex:1">导出、统计、跨书搜索、多格式等</span>
        <button class="bzs-btn sm" data-act="unlock" data-mode="export">查看功能对照</button></div>`
      }
    </div>`;

  const dir = dataDirOf();
  /* 目录一律只给选择器，不给输入框：vault 路径有口径（分隔符、首尾斜杠、
     大小写），手打死角很多，错了还不报错——文件会写进别处。 */
  const importDir = s.importDir || DEFAULT_SETTINGS.importDir;
  const data = `<div class="bzs-setgrp">
      <h3>数据</h3>
      <div class="bzs-setrow"><label>书籍导入位置</label>
        <button class="bzs-pickdir" data-act="pickimportdir" title="选择一个文件夹">
          <span>${esc(importDir)}/</span>${ico('folder') || ''}<i>选择…</i>
        </button></div>
      <div class="bzs-setrow"><label>数据目录</label>
        <button class="bzs-pickdir" data-act="pickdatadir" title="从文件夹清单里选">
          <span>${esc(dir)}/</span>${ico('folder') || ''}<i>选择…</i>
        </button></div>
      <div class="bzs-setrow"><label>备份与恢复</label>
        <button class="bzs-btn sm" data-act="backup" title="导出成一份 JSON，存进数据目录">备份</button>
        <button class="bzs-btn sm" data-act="restore" title="从备份文件恢复（合并，不覆盖现有进度）">恢复</button></div>
      <div class="bzs-mini" style="margin-top:10px;line-height:1.9">
        备份含书架、进度、标注、收藏与目标。不含激活码和 AI Key，换设备需重填。
      </div>
    </div>`;

  /* 快捷键不是我们自己的一张表，而是宿主里那些命令的当前绑定：
     点一行 → 打开 Obsidian 的快捷键设置并搜这条命令，改完回来这里就是新的。 */
  const keyRows = v.hotkeys
    .map((k) => {
      const bound = k.keys.length ? k.keys.join(' / ') : k.builtin || '未设置';
      return `<button class="bzs-keyrow" data-act="hotkey" data-k="${esc(k.id)}" title="在 Obsidian 的快捷键设置里改">
        <span>${esc(k.label)}</span><kbd class="${k.keys.length ? '' : 'soft'}">${esc(bound)}</kbd>
      </button>`;
    })
    .join('');

  const keys = `<div class="bzs-setgrp wide">
      <h3>快捷键</h3>
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
