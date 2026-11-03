/* ============================================================
 * bz-reader · 全局声明（types/globals.d.ts）
 * ============================================================ */

/** 构建期注入：pro 包为 true，base 包为 false */
declare const __BZ_READER_PRO__: boolean;

/** 构建期注入：`<manifest.version>+<构建时间>`，真机角标与日志用 */
declare const __BZ_BUILD_TAG__: string;
