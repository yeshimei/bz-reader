# 更新日志

## ✨ 新增

- **书架** ：以 Obsidian 原生侧栏承载书架，书库、笔记、统计、设置一页切换。
- **阅读** ：EPUB / TXT 开箱即读，目录、书签、四色划线、想法与脚注浮窗都在。
- **原文链接** ：划线可复制成带定位的 Markdown 链接，点回原文那一句。
- **阅读统计** ：热力图、每本进度、连续打卡。
- **AI** ：划词回答、摘要、解释、翻译，接你自己的 OpenAI 兼容接口。
- **多格式** ：mobi / azw3 / fb2 / 漫画；竖排、双栏、朗读、并排对照、全书鸟瞰。

## ⚡ 优化

- **数据落盘** ：原子写 + `.bak` 恢复 + 外部修改合并，跨设备同步不再互相覆盖。
- **中文 TXT** ：自动识别 UTF-8 / UTF-16 / GB18030 / Big5，不再整本乱码。
- **移动端** ：blob 章节改 srcdoc，安卓与 iOS 都不再白屏；翻页、划词、脚注浮窗对齐真机手势。

# 安装

1. 打开 **设置 → 第三方插件**，关闭安全模式。
2. 点 **浏览**，搜索 **bz Reader**，安装。
3. 启用后左侧出现 bz 图标，从书架开始。

首次上架审核通过前，也可以用 [BRAT](https://github.com/TfTHacker/obsidian42-brat) 添加 `yeshimei/bz-reader`，或手动下载本页的 `main.js`、`manifest.json`、`styles.css`，放进 `<你的库>/.obsidian/plugins/bz-reader/` 后启用。

# 付费说明

基础版免费。高级版需要付费购买激活码，在 **书架 → 设置 → 授权** 里填入，本地验签、不绑定设备数。购买入口见 [README](https://github.com/yeshimei/bz-reader#付费说明)。

# 网络访问

只有 AI 功能联网：请求发往你自己配置的 OpenAI 兼容接口，发送划选或提问的文字与当前页正文（≤6000 字）。其余功能完全离线。

# 反馈

问题与建议请提到 [GitHub Issues](https://github.com/yeshimei/bz-reader/issues)。
