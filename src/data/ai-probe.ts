/* ============================================================
 * bz-reader · AI 设置连接测试（data/ai-probe.ts，2026-11-17）
 *
 * 设置页里地址 / 模型 / 密钥填错，以前要开一本书、建一次索引才知道。
 * 这里给「测试连接」按钮一个纯函数：分别探 chat 与 embed，各报各的。
 *
 * 两条分开报是刻意的：问答用 chat 接口、检索用 bz 的嵌入接口，两者不在
 * 一个服务上。合成一句「连上了」会把「chat 通、embed 没配」这种最常见的
 * 半通状态糊过去，用户照样建不了索引。
 *
 * 只做一次最小请求：chat 发一句最短的话，embed 嵌一个短词。按调用方计量，
 * 和正式使用同一口径——测试按钮不该被误认为免费的「ping」。
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
  /** 嵌一个短词，成功返回向量 */
  embed: () => Promise<number[]>;
  /** 当前配置能不能发起 chat（地址 / 模型 / 密钥齐了没） */
  chatReady: boolean;
  /** bz 在不在、嵌入模型选了没 */
  embedModel: string;
}

export interface AiProbeReport {
  chat: ProbeResult;
  embed: ProbeResult;
}

/** 文案由调用方注入（data 层不碰 i18n 之外的界面文案） */
export interface AiProbeLabels {
  chatTesting: string;
  embedTesting: string;
  ok: (model: string) => string;
  empty: string;
  notReady: string;
  embedOk: (model: string) => string;
  embedNoModel: string;
  embedEmpty: string;
  failed: string;
}

/**
 * 探一次 chat 与 embed。
 *
 * 每条独立 try：chat 挂了不能连累 embed 的结果，反过来也一样。用 `aiReady`
 * 门控 chat——没配好就直接报「没配」，不发一个注定失败的请求。
 */
export async function aiProbe(deps: AiProbeDeps, labels: AiProbeLabels): Promise<AiProbeReport> {
  const chat = await (async (): Promise<ProbeResult> => {
    if (!deps.chatReady) return { level: 'skip', message: labels.notReady };
    try {
      const text = (await deps.chat()).trim();
      return text
        ? { level: 'ok', message: labels.ok(text) }
        : { level: 'fail', message: labels.empty };
    } catch (e) {
      return { level: 'fail', message: `${labels.failed}：${(e as Error)?.message || ''}` };
    }
  })();

  const embed = await (async (): Promise<ProbeResult> => {
    if (!deps.embedModel) return { level: 'skip', message: labels.embedNoModel };
    try {
      const vec = await deps.embed();
      return vec?.length
        ? { level: 'ok', message: labels.embedOk(deps.embedModel) }
        : { level: 'fail', message: labels.embedEmpty };
    } catch (e) {
      return { level: 'fail', message: `${labels.failed}：${(e as Error)?.message || ''}` };
    }
  })();

  return { chat, embed };
}
