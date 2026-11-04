<div align="center">
  <img src="docs/images/mark.svg" width="76" height="76" alt="">
  <h1>bz Reader</h1>
  <p><b>把 Obsidian 变成一个能读书的地方。</b><br>
  <sub>桌面端+移动端、多格式支持、AI 问答、原文链接，数据本地。</sub></p>

  <p>
    <a href="https://obsidian.md"><img src="docs/images/badges/obsidian.svg" height="27" alt="Obsidian 1.7.2+"></a>
    <img src="docs/images/badges/version.svg" height="27" alt="版本 0.1.2">
    <img src="docs/images/badges/platform.svg" height="27" alt="桌面 + 移动">
    <img src="docs/images/badges/license.svg" height="27" alt="MIT">
  </p>

</div>

<p align="center">
  <img src="docs/images/shelf-desktop-light.webp" alt="书架：继续阅读、筛选条、书架分组与封面墙（左侧亮色、右侧暗色）">
</p>

<p align="center">
  <img src="docs/images/read-desktop-light.webp" alt="阅读页：左侧目录、正文单栏、划词胶囊与脚注浮窗（左侧亮色、右侧暗色）">
</p>

<p align="center">
  <img src="docs/images/shelf-mobile-light.webp" width="288" alt="阅读 · 移动端 · 亮色">
  &nbsp;&nbsp;
  <img src="docs/images/read-mobile-dark.webp" width="288" alt="阅读 · 移动端 · 暗色">
</p>

## 功能

| | 基础版 | 高级版 |
|---|:---:|:---:|
| EPUB / TXT 阅读、翻页与排版 | ✓ | ✓ |
| 单栏 / 双栏 | ✓ | ✓ |
| 目录、书签、四色划线与想法 | ✓ | ✓ |
| 书内搜索 | ✓ | ✓ |
| 脚注浮窗预览 | ✓ | ✓ |
| 划线复制为原文链接 | — | ✓ |
| 导出结构化 Markdown | — | ✓ |
| 书摘卡片 | — | ✓ |
| 阅读统计、热力图与每本进度 | — | ✓ |
| 跨书搜索 | — | ✓ |
| AI 回答 / 摘要 / 解释 / 翻译 | — | ✓ |
| mobi / azw3 / fb2 / 漫画 | — | ✓ |
| 竖排排版 | — | ✓ |
| 朗读 | — | ✓ |
| 原文与译文并排 | — | ✓ |
| 全书鸟瞰 | — | ✓ |

## 付费说明

基础版免费。高级版需要付费购买激活码：[购买页面](https://afdian.com/item/6f17bf10d7e311f1b8735254001e7c00)，具体价格以该页面为准。

- 激活码在 **书架 → 设置 → 授权** 里填入，本地验签，不联网。
- 不绑定设备数：换电脑或手机时，在新设备的同一位置再填一次即可。
- 桌面端与移动端是同一个包，买一次两边都能用。

## 网络访问

只有 AI 功能会联网，其余功能完全离线。

- 请求发往你在设置里填写的 OpenAI 兼容接口（自建服务或第三方 API 均可），插件没有自己的服务器。
- 发送的内容是你划选或提问的文字、当前页正文（截到 6000 字以内），必要时还会带上书名、章节名与最近几轮问答。
- API Key 与其他设置一起保存在插件目录的 `data.json` 里，不会上传给插件作者；只有请求你自己填写的那个接口时，它才会以请求头的形式发过去。

## 常见问题

- **支持哪些格式？** EPUB 与 TXT 开箱即读；mobi、azw3、fb2 与漫画在高级版。
- **会和其他插件打架吗？** 阅读页是 Obsidian 原生视图，目录是左侧栏里的一个页签；划线可以复制成带定位的 Markdown 链接，点一下跳回原文那一句，不另建索引。
- **换电脑怎么办？** 库同步过去，书架、进度和标注跟着走；高级版在新设备上重新填一次激活码。
- **手机上要单独买吗？** 不用，同一个包，桌面与移动都包含在内。

## 安装

在社区市场安装（首次上架审核通过后可见）：

1. 打开 **设置 → 第三方插件**，关闭安全模式。
2. 点 **浏览**，搜索 **bz Reader**，安装。
3. 启用后左侧出现 bz 图标，从书架开始。

审核期间或搜不到时，用 [BRAT](https://github.com/TfTHacker/obsidian42-brat) 添加本仓库安装，或手动下载 Release 里的 `main.js`、`manifest.json`、`styles.css`，放进 `<你的库>/.obsidian/plugins/bz-reader/` 后启用。

## 许可

本项目以 [MIT](LICENSE) 许可发布。渲染内核来自 [foliate-js](https://github.com/johnfactotum/foliate-js) 1.0.1（MIT，以 npm 依赖分发，本地补丁见 [patches/foliate-js@1.0.1.patch](patches/foliate-js@1.0.1.patch)）。

## English

Turn your vault into a place to read. Desktop and mobile, EPUB / TXT and more, with highlights, notes, footnotes, reading stats, and an optional AI assistant that talks to the endpoint you configure.

### Installation

1. Open **Settings → Community plugins** and turn off Restricted mode.
2. Click **Browse**, search for **bz Reader**, and install.
3. Enable it — a bz icon appears in the left ribbon; start from the shelf.

While the directory review is pending, install with [BRAT](https://github.com/TfTHacker/obsidian42-brat) using `yeshimei/bz-reader`, or download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/yeshimei/bz-reader/releases/latest) into `<your vault>/.obsidian/plugins/bz-reader/`.

### Usage

- Click the ribbon icon to open the shelf; **Import** adds EPUB / TXT files from your vault.
- In the reader, tap the lower or upper half of the page to turn pages on mobile, or use the arrow keys and wheel on desktop. Select text to highlight it, write a note, or copy a Markdown link back to the exact passage.
- **Shelf → Settings** holds typography, the data folder, the license key, and the AI endpoint.

### Paid features

The base version is free. Pro features — structured Markdown export, highlight cards, reading stats, cross-book search, AI answers, mobi / azw3 / fb2 / comics, vertical layout, text-to-speech, parallel reading, and the book map — require a license key, purchased from the link in the 付费说明 section above. The key is verified locally and is not tied to a device count.

### Network access

Only the AI feature uses the network: requests go to the OpenAI-compatible endpoint you configure, sending the selected text and the current page (up to 6,000 characters). Everything else works offline.
