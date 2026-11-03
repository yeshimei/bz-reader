/**
 * node 测试里的 obsidian 替身。
 *
 * `obsidian` 包只有类型没有运行时（package.json 的 main 是空串），所以任何
 * 模块只要在运行时 import 了它（比如 core/notice 的 `Notice`），在 vitest 里
 * 就会「Cannot find module」。vitest.config.ts 把 `obsidian` 指到这里。
 *
 * 原则：只放**被测试模块真正用到的那几个符号**，不追求 API 完整。
 */
export class Notice {
  message: string;
  timeout?: number;
  constructor(message: string, timeout?: number) {
    this.message = message;
    this.timeout = timeout;
  }
  setMessage(m: string): this {
    this.message = m;
    return this;
  }
  hide(): void {
    /* noop */
  }
}

export const Platform = {
  isMobile: false,
  isPhone: false,
  isDesktop: true,
  isMacOS: false,
  isWin: true,
};

export const requestUrl = async (): Promise<{ status: number; text: string; json: unknown }> => ({
  status: 500,
  text: '',
  json: {},
});
