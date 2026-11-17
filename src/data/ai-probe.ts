/* ============================================================
 * bz-reader · AI 设置连接测试（data/ai-probe.ts，2026-11-17）
 *
 * 设置页里地址 / 模型 / 密钥填错，以前要开一本书、发一次问才知道。
 * 这里给「测试」按钮一个纯函数：只探问答，发一句最短的话。
 *
 * 2026-11-17 收窄：原来还顺手探一次 bz 的嵌入接口，并在设置页单列一行
 * 「检索」。那行在没装 bz 时只会报「建不了索引」，用户看懂了也帮不上忙，
 * 于是整行删掉——探测跟着只留问答，不再偷偷发一次按量计费的嵌入请求。
 *
 * 只做一次最小请求：chat 发一句最短的话。按调用方计量，和正式使用同一
 * 口径——测试按钮不该被误认为免费的「ping」。
 * ============================================================ */
export type ProbeLevel = 'ok' | 'fail' | 'skip';

export interface ProbeResult {
  level: ProbeLevel;
  /** 给用户看的一行结论 */
  message: string;
}

export interface AiProbeDeps {
  /** 发一句最短的 chat，成功返回正文（不为空即可） */
  chat: () => Promise<string>;
  /** 当前配置能不能发起 chat（地址 / 模型 / 密钥齐了没） */
  chatReady: boolean;
}

/** 文案由调用方注入（data 层不碰 i18n 之外的界面文案） */
export interface AiProbeLabels {
  testing: string;
  ok: (model: string) => string;
  empty: string;
  notReady: string;
  failed: string;
}

/**
 * 探一次 chat。
 *
 * 用 `chatReady` 门控——没配好就直接报「没配」，不发一个注定失败的请求。
 */
export async function aiProbe(deps: AiProbeDeps, labels: AiProbeLabels): Promise<ProbeResult> {
  if (!deps.chatReady) return { level: 'skip', message: labels.notReady };
  try {
    const text = (await deps.chat()).trim();
    return text
      ? { level: 'ok', message: labels.ok(text) }
      : { level: 'fail', message: labels.empty };
  } catch (e) {
    return { level: 'fail', message: `${labels.failed}：${(e as Error)?.message || ''}` };
  }
}
