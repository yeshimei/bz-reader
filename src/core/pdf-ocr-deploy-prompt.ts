/* ============================================================
 * bz-reader · 扫描页识别自部署提示词（core/pdf-ocr-deploy-prompt.ts）
 *
 * 「外部 OCR 服务」最难的一步不是填地址，是先把服务装起来：端口、
 * 请求体字段、返回形状、坐标量纲、跨域，任一项对不上，插件里就只回
 * 一句「这一页没有认出文字」。用户要的是把这一整套原样丢给会装东西
 * 的 AI，而不是自己去翻 Umi-OCR 的文档（2026-11-15 用户要求）。
 *
 * 和 core/tts-deploy-prompt.ts 同一套做法：只产出一段**给 AI 看的**
 * 任务书，界面里只放一颗复制按钮，不把这段长文铺在设置页上。
 * ============================================================ */

export interface PdfOcrDeployPromptInput {
  /** 库的绝对路径：能拿到就写进去，AI 可以直接改 data.json */
  vaultPath?: string;
  /** Obsidian 的配置目录名；用户可以改成别的名字，所以要传真实值 */
  configDir?: string;
}

/**
 * 生成提示词。
 *
 * 把 `data.format=dict` 与「坐标是像素」写死是有意的：Umi-OCR 默认只回
 * 整页纯文本，装完能搜不能划，用户会以为是插件的问题。
 */
export function pdfOcrDeployPrompt(input: PdfOcrDeployPromptInput = {}): string {
  const cfg = (input.configDir ?? '').trim().replace(/^[\\/]+|[\\/]+$/g, '');
  const root = input.vaultPath ? input.vaultPath.replace(/[\\/]+$/, '') : '<你的库路径>';
  const dataPath = `${root}/${cfg || '<配置目录>'}/plugins/bz-reader/data.json`;

  return `我要在这台电脑上装一个本地 OCR 服务，供 Obsidian 插件 bz Reader 识别扫描版 PDF 使用。请直接动手装好、跑通，最后把地址写回插件设置。

【选型】优先 Umi-OCR（Windows 便携版，Rapid 引擎就够），打开它自带的 HTTP 服务，默认监听 http://127.0.0.1:1224。用别的本地 OCR（PaddleOCR / RapidOCR 自己包一层）也行，但必须满足下面的接口约定。

【接口约定】插件按这个形状请求和解析：
1. POST /api/ocr（Umi-OCR 的路径；用别的服务就告诉我实际路径）
   请求体：{"base64":"<整页图片的 base64，不含 data: 前缀>","options":{"data.format":"dict","tbpu.parser":"multi_none"}}
   - data.format 必须是 dict（Umi-OCR 默认 text 只回整页纯文本，拿不到每行的框，插件就没法划词）
   - tbpu.parser 用 multi_none，保留原始行，不要按段落合并
2. 返回：{"code":100,"data":[{"text":"这一行的文字","box":[[x1,y1],[x2,y2],[x3,y3],[x4,y4]],"score":0.99}]}
   - box 是四点坐标，单位是**提交那张图片的像素**（不是比例），原点在左上角
   - code 100 = 成功，101 = 图中没有文字；其它值插件会当失败报出来
3. 必须允许跨域：响应带 Access-Control-Allow-Origin: *（插件从 Obsidian 里直接 fetch，不带这个头会被浏览器拦掉；Umi-OCR 2.0 以后默认就有）

【部署】先用这台机器上已有的工具；缺依赖就装上。装完给出启动命令，并设成开机自启（Windows 用计划任务或快捷方式放启动目录），别再手动拉起来。不要动我已有的其它服务和端口。

【自检】用一张带中文的测试图跑通这一条，把真实输出贴给我（要能看到 data 里每行都有 text 和 box）：
curl -s -X POST http://127.0.0.1:1224/api/ocr -H "Content-Type: application/json" -d "{\\"base64\\":\\"<图片的base64>\\",\\"options\\":{\\"data.format\\":\\"dict\\",\\"tbpu.parser\\":\\"multi_none\\"}}"

【回填插件设置】服务跑通后，改这个文件（先备份一份）：
${dataPath}
- settings.pdfOcrEngine = "http"
- settings.pdfOcrUrl = "http://127.0.0.1:1224/api/ocr"（端口不同就换成实际地址）
其它字段一律不要改。文件不存在或结构对不上，就别改文件，只把这两个值列给我，我自己填。

【注意】不要把书稿或任何正文发到外网；不要写入密钥；完成后告诉我：地址、启动与重启命令、自检的真实输出。`;
}
