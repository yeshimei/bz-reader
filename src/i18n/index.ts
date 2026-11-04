/**
 * i18n 核心（src/i18n/index.ts）
 *
 * 三件事：当前语言、翻译、语言变化通知。语言包是 TS 对象，编译进包体——
 * 不做运行时读盘/fetch：插件必须离线可用，多一条启动期 IO 就多一类「打开
 * 就白屏」的失败面。
 *
 * **默认语言是 zh。** 不是随手定的：现网只有中文用户，语言探测拿不到值时
 * 必须退回中文而不是英文，否则海外环境的探测失败会让中文用户看到英文界面。
 * 测试也靠这条默认值继续断言中文文案（300 余处断言一条没改）。
 *
 * key 用语义短名分域（`cmd.open`、`notice.export.done`），中文包是基准包，
 * 它的 key 集合就是类型真源：任何一包漏一条，`tsc --noEmit` 直接红。
 *
 * 八种语言：zh 简中（基准）、zh-TW 繁中、en 英、ja 日、de 德、fr 法、es 西、
 * pt 葡。**只有更新日志是例外**（只做中英两版，见 `changelogLang`）。
 */

import { getLanguage } from 'obsidian';
import { DE } from './de';
import { EN } from './en';
import { ES } from './es';
import { FR } from './fr';
import { JA } from './ja';
import { PT } from './pt';
import { ZH, type MsgKey } from './zh';
import { ZH_TW } from './zh-tw';

export type Locale = 'zh' | 'zh-TW' | 'en' | 'ja' | 'de' | 'fr' | 'es' | 'pt';
export type { MsgKey };

/** 翻译参数。只收字符串与数字，够用且不会被误塞对象 */
export type MsgParams = Record<string, string | number>;

/**
 * 八种语言的固定顺序。
 *
 * 设置页按这个顺序铺按钮，测试也钉这个顺序——顺序变了是可见的变化，
 * 不该悄悄随对象键序漂移。
 */
export const LOCALES: readonly Locale[] = ['zh', 'zh-TW', 'en', 'ja', 'de', 'fr', 'es', 'pt'];

/**
 * 每种语言用**它自己的语言**标注自己。
 *
 * 这是界面语言选择器的通行做法（Obsidian 自己的语言列表也这么写）：
 * 一个只会德语的人，在中文界面里找得到 "Deutsch"，但找不到「德语」。
 * 这几条**不走 t()**——它们必须与当前界面语言无关。
 */
export const LOCALE_NAMES: Record<Locale, string> = {
  zh: '中文',
  'zh-TW': '繁體中文',
  en: 'English',
  ja: '日本語',
  de: 'Deutsch',
  fr: 'Français',
  es: 'Español',
  pt: 'Português',
};

const PACKS: Record<Locale, Record<MsgKey, string>> = {
  zh: ZH,
  'zh-TW': ZH_TW,
  en: EN,
  ja: JA,
  de: DE,
  fr: FR,
  es: ES,
  pt: PT,
};

/** 语言包本体（测试要逐包遍历；运行期取文案用 `t`，不要直接用这个） */
export const PACK_OF: Record<Locale, Record<MsgKey, string>> = PACKS;

/** 这个值是不是我们支持的语言（`auto` 不算；设置落盘校验用） */
export function isLocale(v: unknown): v is Locale {
  return typeof v === 'string' && (LOCALES as readonly string[]).includes(v);
}

/**
 * 当前语言。
 *
 * 模块级状态而不是传参：文案散在几十个纯函数渲染器里，逐个加语言参数会把
 * 每个函数签名都改一遍，且调用链上任何一处忘了传就静默退回中文。
 */
let current: Locale = 'zh';

const listeners = new Set<(l: Locale) => void>();

/**
 * Obsidian 的语言代码 → 我们支持的语言。
 *
 * `getLanguage()` 给的是 ISO 639-1（`zh`、`zh-TW`、`en-GB`、`ja`、`ar`…）。
 * 繁体与简体**分开两包**：两者文案不是字形转换的关系（設定/设置、檔案/文件、
 * 匯入/导入），合成一包只会让繁体用户读到大陸用词。
 *
 * 没有对应包的语言一律退英文——英文是国际用户的兜底，不是「假装看得懂」。
 */
export function normalizeLocale(code: string | null | undefined): Locale {
  const raw = String(code ?? '')
    .trim()
    .toLowerCase()
    .replace(/_/g, '-');
  if (!raw) return 'en';
  const base = raw.split('-')[0];
  switch (base) {
    case 'zh':
      /* 繁体：台湾、香港、澳门，以及脚本标记 Hant。
         `zh-Hant-CN` 这种「繁体脚本 + 大陆地区」按脚本走——脚本才决定字形。 */
      if (/^zh-(tw|hk|mo)\b/.test(raw) || raw.includes('hant')) return 'zh-TW';
      return 'zh';
    case 'en':
      return 'en';
    case 'ja':
      return 'ja';
    case 'de':
      return 'de';
    case 'fr':
      return 'fr';
    case 'es':
      return 'es';
    case 'pt':
      return 'pt';
    default:
      return 'en';
  }
}

/** 当前界面语言 */
export function locale(): Locale {
  return current;
}

/**
 * 切换界面语言。返回「是否真的变了」——调用方据此决定要不要重绘，
 * 同语言重复设置不该触发一轮无谓的整壳重渲。
 */
export function setLocale(next: Locale): boolean {
  const code = normalizeLocale(next);
  if (code === current) return false;
  current = code;
  for (const fn of [...listeners]) {
    try {
      fn(code);
    } catch {
      /* 一个订阅者抛错不该让其余订阅者收到通知 */
    }
  }
  return true;
}

/**
 * 订阅语言变化，返回退订函数。
 *
 * 弹窗与面板是长生命周期的（打开后就挂在那儿），语言切了它们得自己重画；
 * 退订交给调用方的收尾逻辑，这里不持有引用。
 */
export function onLocaleChange(fn: (l: Locale) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * 取一条文案。
 *
 * 两条防御，都是为了「界面不因漏翻而坏」：
 *   1. key 不在当前语言包里 → 先用中文包的值（中文是基准，永远有），
 *      再不行就把 key 原样返回——屏幕上出现 `notice.x` 比空白更容易定位。
 *   2. 参数缺失 → 保留 `{name}` 占位符，不静默替换成空串：漏传参数会
 *      在界面上露出来，比「已导出 条划线到」这种半截句子更好查。
 */
export function t(key: MsgKey, params?: MsgParams): string {
  const pack = PACKS[current] ?? ZH;
  const raw = pack[key] ?? ZH[key] ?? String(key);
  if (!params) return raw;
  return raw.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const v = params[name];
    return v === undefined || v === null ? whole : String(v);
  });
}

/**
 * 把宿主给的语言代码收敛成界面语言。
 *
 * 入口层（plugin.onload）负责调用 `getLanguage()` 并把结果喂进来；
 * 探测逻辑本身保持纯函数，测试才能覆盖各种代码形态。
 */
export function detectLocale(code: string | null | undefined): Locale {
  return normalizeLocale(code);
}

/**
 * 用户的界面语言偏好：跟随宿主，或手动指定八种之一。
 *
 * 存在 `settings.language` 里，跟着 data.json（设备本地）。不跟库走：
 * 「这台机器用什么语言」不是书的数据，换台机器该用那台的语言。
 */
export type LanguagePref = 'auto' | Locale;

/**
 * 偏好 + 宿主语言 → 实际界面语言。
 *
 * 手动选择永远优先：用户特意选了中文，换台英文 Obsidian 不该把界面翻回去。
 *
 * `auto` 但读不到宿主语言时退回**中文**而不是英文——现网用户全是中文，
 * 探测失败是异常环境，异常时维持用户熟悉的样子比"猜一个"稳妥。
 *
 * 与 `normalizeLocale` 的区别：那个只管"代码 → 语言"，这个还要处理
 * 「用户有没有表态」。
 */
export function resolveLocale(pref: LanguagePref, hostCode?: string | null): Locale {
  if (pref !== 'auto') return normalizeLocale(pref);
  const code = String(hostCode ?? '').trim();
  return code ? normalizeLocale(code) : 'zh';
}

/**
 * 宿主当前的界面语言代码（`zh` / `zh-TW` / `en` …），读不到给空串。
 *
 * 空串的语义是「宿主没表态」，由 `resolveLocale` 决定怎么办（按当前默认，
 * 不在这里猜）。`getLanguage()` 是 1.8.7 才有的接口，这里仍然包一层
 * try/catch：插件加载不该因为一个只读接口挂掉。
 */
export function hostLanguageCode(): string {
  try {
    return String(getLanguage() ?? '');
  } catch {
    return '';
  }
}

/**
 * 更新日志用哪种语言。
 *
 * **这是全仓唯一的例外**：更新日志每次发版手写，八种语言维护一轮就是八倍的
 * 文案工作量，而读日志的人本来就知道自己在看什么。所以只做中英两版：
 *   · zh / zh-TW → 中文条目（繁中用户读简体条目读得懂，比读英文强）
 *   · 其余六种   → 英文条目（英文是国际兜底）
 *
 * 弹窗里的框架文案（新功能 / 修复 / 知道了…）也跟这条走，否则会出现
 * 「日语的章节标题 + 中文的条目」这种半翻状态。
 */
export function changelogLang(): 'zh' | 'en' {
  return current === 'zh' || current === 'zh-TW' ? 'zh' : 'en';
}
