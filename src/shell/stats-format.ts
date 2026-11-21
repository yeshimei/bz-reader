/* ============================================================
 * bz-reader · 统计页数字格式（shell/stats-format.ts）
 *
 * 页面、复制报告、导出海报三处共用同一套人话数字：上万折成「万」，
 * 一以下不印小数。以前页签和海报各抄了一份 `wan()`，改一处漏一处。
 * ============================================================ */
import { t } from '../i18n';

/** 字数额：不印精确到个位的长数字，上万折成「万」（12.3 万） */
export function fmtWan(n: number): string {
  const v = Math.max(0, Math.round(n));
  return v >= 10_000 ? t('stats.f.words.wan', { n: (v / 10_000).toFixed(1) }) : String(v);
}
