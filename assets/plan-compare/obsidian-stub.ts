/* 只为在 node 里跑出对照表数据：entitlement / i18n 在模块加载期只碰 Platform。 */
export const Platform = { isMobile: false, isDesktop: true, isMobileApp: false, isMacOS: false, isWin: true };
export const getLanguage = (): string => 'zh';
export const moment = (): { locale: () => string } => ({ locale: () => 'zh' });
export const requestUrl = async (): Promise<unknown> => ({});
export class Notice {
  constructor(_msg?: string) {}
  hide(): void {}
}
export default {};
