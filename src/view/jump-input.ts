/* ============================================================
 * bz-reader · 跳转输入解析（view/jump-input.ts）
 *
 * 阅读器里「跳到百分之几」只有这一个输入口：手输 0–100，允许带 %。
 * 解析抽出来是为了能单测——真机上一次输错就得重来，边界该在测试里钉死。
 * ============================================================ */

/**
 * 输入 → 0..1 的进度；不合法返回 null。
 *
 * 接受 `35`、`35%`、`35％`、`0`、`100`、`12.5`；不接受负号、超 100、
 * 纯文字、空串。小数点后多长都行，落库前不额外取整（分页器自己会夹）。
 */
export function parseJumpInput(raw: string): number | null {
  const s = String(raw ?? '')
    .trim()
    .replace(/[%％]\s*$/, '')
    .trim();
  if (!s) return null;
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const v = Number(s);
  if (!Number.isFinite(v) || v < 0 || v > 100) return null;
  return v / 100;
}

/** 当前进度 → 输入框里的初值（整数百分比，读起来不啰嗦） */
export function percentText(fraction: number): string {
  const v = Number(fraction);
  if (!Number.isFinite(v)) return '0';
  return String(Math.max(0, Math.min(100, Math.round(v * 100))));
}
