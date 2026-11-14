/* ============================================================
 * bz-reader · 本地语音自部署提示词（core/tts-deploy-prompt.ts）
 *
 * 「本地语音」最难的一步是先把服务装起来：端口、接口形状、跨域、
 * 音色列表，任一项对不上，插件里就只回一句「连不上」。用户要的是
 * 把这堆要求原样丢给会装东西的 AI，而不是自己读半天文档。
 *
 * 所以这里只产出一段**给 AI 看的**任务书：它跑完把地址 / 模型 / 音色
 * 写回插件设置，人只需要点一次复制（2026-11-14 用户要求）。
 *
 * 界面里不显示这段文字本身——又长又不给人读，摆在设置页只会变成
 * 一堵墙。要改内容改这里，按钮那边只负责复制。
 * ============================================================ */

export interface TtsDeployPromptInput {
  /** 库的绝对路径：能拿到就写进去，AI 可以直接改 data.json */
  vaultPath?: string;
  /**
   * Obsidian 的配置目录名（`app.vault.configDir`）。
   *
   * 用户可以把它改成别的名字，所以调用方要把真实值传进来；拿不到就写
   * 「配置目录」占位，让 AI 自己找——写死 `.obsidian` 会指错文件。
   */
  configDir?: string;
}

/**
 * 生成提示词。
 *
 * 要求写得死一点（端口、请求体字段、返回格式、CORS）是有意的：
 * AI 自由发挥时最容易漏掉跨域和音色接口，装完在插件里照样连不上。
 */
export function ttsDeployPrompt(input: TtsDeployPromptInput = {}): string {
  const cfg = (input.configDir ?? '').trim().replace(/^[\\/]+|[\\/]+$/g, '');
  const root = input.vaultPath ? input.vaultPath.replace(/[\\/]+$/, '') : '<你的库路径>';
  const dataPath = `${root}/${cfg || '<配置目录>'}/plugins/bz-reader/data.json`;

  return `我要在这台电脑上装一个本地语音合成（TTS）服务，供 Obsidian 插件 bz Reader 的朗读功能使用。请直接动手装好、跑通，最后把参数写回插件设置。

【接口要求】必须是 OpenAI 兼容的语音接口，插件按这个形状请求：
1. POST /v1/audio/speech
   请求体：{"model":"<模型名>","input":"<要念的文本>","voice":"<音色>","response_format":"mp3"}
   返回：音频字节，Content-Type: audio/mpeg
2. GET /v1/audio/voices[?model=<模型名>]
   返回音色列表，二选一都行：{"voices":[{"id":"...","name":"..."}]} 或 ["id1","id2"]
3. 必须允许跨域：所有响应带 Access-Control-Allow-Origin: *（插件从 Obsidian 里直接 fetch，不带跨域头会被浏览器拦掉）
4. 默认监听 http://127.0.0.1:8880；端口被占用就换一个，并告诉我实际端口

【选型与部署】
- 优先 CPU 能跑、中文效果可用、装起来不折腾的方案：Kokoro-FastAPI、openedai-speech，或 CosyVoice / GPT-SoVITS 的 OpenAI 兼容封装
- 先用这台机器上已有的 Python 或 Docker；缺依赖就装上
- 装完给出启动命令，并设成开机自启（Windows 用计划任务或服务，别再手动拉起来）
- 不要动我已有的其它服务，不要占用 8880 之外的常用端口

【自检】用 curl 跑通这两条，把真实输出贴给我：
- curl -s http://127.0.0.1:8880/v1/audio/voices
- curl -s -X POST http://127.0.0.1:8880/v1/audio/speech -H "Content-Type: application/json" -d "{\\"model\\":\\"<模型名>\\",\\"input\\":\\"你好，这是一次试听。\\",\\"voice\\":\\"<音色>\\",\\"response_format\\":\\"mp3\\"}" --output test.mp3

【回填插件设置】服务跑通后，改这个文件（先备份一份）：
${dataPath}
- settings.ttsLocal.url = 实际地址，例如 "http://127.0.0.1:8880"
- settings.ttsLocal.model = 实际模型名
- settings.ttsLocal.format = "mp3"
- prefs.ttsVoiceLocal = 推荐音色的 id
- prefs.ttsEngine = "local"
其它字段一律不要改。文件不存在或结构对不上，就别改文件，只把这几个值列给我，我自己填。

【注意】不要把书稿或正文发到外网；不要写入任何密钥；完成后告诉我：地址、模型名、音色、启动与重启命令。`;
}
