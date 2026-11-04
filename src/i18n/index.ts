/**
 * i18n 核心（src/i18n/index.ts）
 *
 * 三件事：当前语言、翻译、语言变化通知。语言包是 TS 对象，编译进包体——
 * 不做运行时读盘/fetch：插件必须离线可用，多一条启动期 IO 就多一类「打开
 * 就白屏」的失败面。
 *
 * **默认语言是 zh。** 不是随手定的：现网只有中文用户，语言探测拿不到值时
 * 必须退回中文而不是英文，否则海外环境的探测失败会让中文用户看到英文界面。
 * 测试也靠这条默认值继续断言中文文案（332 处断言一条没改）。
 *
 * key 用语义短名分域（`cmd.open`、`notice.export.done`），中文包是基准包，
 * 它的 key 集合就是类型真源：en 包漏一条，`tsc --noEmit` 直接红。
 */

import { EN } from './en';
import { ZH, type MsgKey } from './zh';

export type Locale = 'zh' | 'en';
export type { MsgKey };

/** 翻译参数。只收字符串与数字，够用且不会被误塞对象 */
export type MsgParams = Record<string, string | number>;

const PACKS: Record<Locale, Record<string, string>> = { zh: ZH, en: EN };

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
 * 简体与繁体共用一个中文包：两者文案几乎一致，分开维护只会让两份中文
 * 慢慢漂移，而繁体的正字差异交给社区再补一包更划算。
 *
 * 没有对应包的语言一律退英文——英文是国际用户的兜底，不是「假装看得懂」。
 */
export function normalizeLocale(code: string | null | undefined): Locale {
  const raw = String(code ?? '').trim().toLowerCase();
  if (!raw) return 'en';
  // zh / zh-cn / zh-hans / zh-tw / zh-hant / zh-hk 都归中文
  if (raw === 'zh' || raw.startsWith('zh-') || raw.startsWith('zh_')) return 'zh';
  if (raw === 'en' || raw.startsWith('en-') || raw.startsWith('en_')) return 'en';
  return 'en';
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
      /* 一个订阅者抛错不该让其余订阅者收不到通知 */
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
