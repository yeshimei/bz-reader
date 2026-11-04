<div align="center">
  <img src="docs/images/mark.svg" width="76" height="76" alt="">
  <h1>bz Reader</h1>
  <p><b>把 Obsidian 变成一个能读书的地方。</b><br>
  <sub>桌面端 + 移动端、多格式支持、八种界面语言、AI 问答、双向链接，数据全部本地。</sub></p>

  <p>
    <a href="https://obsidian.md"><img src="docs/images/badges/obsidian.svg" height="27" alt="Obsidian 1.8.7+"></a>
    <img src="docs/images/badges/version.svg" height="27" alt="版本 0.3.0">
    <img src="docs/images/badges/platform.svg" height="27" alt="桌面 + 移动">
    <img src="docs/images/badges/license.svg" height="27" alt="MIT">
  </p>

  <p><sub><b>简体中文</b> · <a href="#english">English</a> · <a href="#繁體中文">繁體中文</a> · <a href="#日本語">日本語</a> · <a href="#deutsch">Deutsch</a> · <a href="#français">Français</a> · <a href="#español">Español</a> · <a href="#português">Português</a></sub></p>
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
| 划线复制为双向链接 | — | ✓ |
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

## 界面语言

界面跟着 Obsidian 的语言走，也可以在 **书架 → 设置 → 界面** 里手动指定：简体中文、繁體中文、English、日本語、Deutsch、Français、Español、Português。

切换后界面立即生效；命令名需重启 Obsidian 才更新。繁体不是简体的字形转换，是另一套台湾用语（設定 / 預設 / 匯入 / 匯出 / 檔案）。**更新日志是唯一的例外**：它每次发版手写，只做中文与英文两版，其余六种语言显示英文条目。

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

---

## English

### Features

| | Free | Pro |
|---|:---:|:---:|
| EPUB / TXT reading, pagination, and typography | ✓ | ✓ |
| Contents, bookmarks, four-color highlights, and notes | ✓ | ✓ |
| In-book search | ✓ | ✓ |
| Footnote preview in a popover | ✓ | ✓ |
| Copy highlights as wikilinks | — | ✓ |
| Structured Markdown export | — | ✓ |
| Highlight cards | — | ✓ |
| Reading stats, heatmap, and per-book progress | — | ✓ |
| Cross-book search | — | ✓ |
| AI answers / summaries / explanations / translations | — | ✓ |
| mobi / azw3 / fb2 / comics | — | ✓ |
| Vertical and two-column layout | — | ✓ |
| Text-to-speech | — | ✓ |
| Original and translation side by side | — | ✓ |
| Book map | — | ✓ |

### Interface languages

The interface follows Obsidian's language, and you can also pick one of eight by hand under
**Shelf → Settings → Interface**: 简体中文, 繁體中文, English, 日本語, Deutsch, Français,
Español, Português.

The switch applies to the interface immediately; command names update after restarting Obsidian
(the host registers them at load time). Traditional Chinese is not a glyph conversion of
Simplified — it is a separate pack using Taiwan vocabulary (設定 / 預設 / 匯入 / 匯出 / 檔案).
**The changelog is the one exception**: it is written by hand for each release and exists only in
Chinese and English; the other six languages show the English entries.

### Paid features

The free edition covers everyday reading. Pro features require a paid license key; see the [purchase page](https://afdian.com/item/6f17bf10d7e311f1b8735254001e7c00) for the current price.

- Enter the key in **Shelf → Settings → License**. It is verified locally, with no network call.
- Keys are not tied to a device count — just enter yours again on a new device.
- One build covers desktop and mobile — no separate purchase.

### Network access

Only the AI features go online; everything else works fully offline.

- Requests go to the OpenAI-compatible endpoint you configure (your own server or a third-party API). The plugin has no server of its own.
- The request contains the text you selected or typed and the current page (trimmed to 6000 characters), plus the book title, chapter name, and the last few turns when needed.
- Your API key is stored with the rest of your settings in `data.json` inside the plugin folder. It is never sent to the plugin author; it only travels to the endpoint you configured, as a request header.

### FAQ

- **Which formats?** EPUB and TXT out of the box; mobi, azw3, fb2, and comics with Pro.
- **Does it conflict with other plugins?** The reader is a native Obsidian view and the contents are a tab in the left sidebar. Highlights can be copied as locator Markdown links that jump back to the exact passage — no separate index is built.
- **Switching computers?** Your vault carries the shelf, progress, and annotations. Re-enter the license key on the new device.
- **Do I pay again on mobile?** No. One build covers desktop and mobile.

### Installation

Install from the community directory (visible once the initial review passes):

1. Open **Settings → Community plugins** and turn off Restricted mode.
2. Click **Browse**, search for **bz Reader**, and install.
3. Enable it — a bz icon appears in the left ribbon; start from the shelf.

While the review is pending, or if search doesn't find it, install with [BRAT](https://github.com/TfTHacker/obsidian42-brat), or download `main.js`, `manifest.json`, and `styles.css` from the Release and place them in `<your vault>/.obsidian/plugins/bz-reader/`, then enable the plugin.

### License

Released under the [MIT](LICENSE) license. The rendering engine is [foliate-js](https://github.com/johnfactotum/foliate-js) 1.0.1 (MIT, distributed as an npm dependency; local patches in [patches/foliate-js@1.0.1.patch](patches/foliate-js@1.0.1.patch)).

---

<details>
<summary><b>繁體中文</b></summary>

## 繁體中文

把 Obsidian 變成一個能讀書的地方。桌面端 + 行動端、多格式、八種介面語言、AI 問答、雙向連結，資料全部本地。

### 功能

| | 基礎版 | 高級版 |
|---|:---:|:---:|
| EPUB / TXT 閱讀、翻頁與排版 | ✓ | ✓ |
| 單欄 / 雙欄 | ✓ | ✓ |
| 目錄、書籤、四色劃線與想法 | ✓ | ✓ |
| 書內搜尋 | ✓ | ✓ |
| 腳註浮窗預覽 | ✓ | ✓ |
| 劃線複製為雙向連結 | — | ✓ |
| 匯出結構化 Markdown | — | ✓ |
| 書摘卡片 | — | ✓ |
| 閱讀統計、熱力圖與每本進度 | — | ✓ |
| 跨書搜尋 | — | ✓ |
| AI 回答 / 摘要 / 解釋 / 翻譯 | — | ✓ |
| mobi / azw3 / fb2 / 漫畫 | — | ✓ |
| 豎排排版 | — | ✓ |
| 朗讀 | — | ✓ |
| 原文與譯文並排 | — | ✓ |
| 全書鳥瞰 | — | ✓ |

### 介面語言

介面跟著 Obsidian 的語言走，也可以在 **書架 → 設定 → 介面** 裡手動指定：简体中文、繁體中文、English、日本語、Deutsch、Français、Español、Português。

切換後介面立即生效；指令名稱需重新啟動 Obsidian 才更新。繁體不是簡體的字形轉換，是另一套台灣用語（設定 / 預設 / 匯入 / 匯出 / 檔案）。**更新日誌是唯一的例外**：它每次發版手寫，只做中文與英文兩版，其餘六種語言顯示英文條目。

### 付費說明

基礎版免費。高級版需要付費購買啟用碼：[購買頁面](https://afdian.com/item/6f17bf10d7e311f1b8735254001e7c00)，具體價格以該頁面為準。

- 啟用碼在 **書架 → 設定 → 授權** 裡填入，本地驗簽，不連網。
- 不綁定裝置數：換電腦或手機時，在新裝置的同一位置再填一次即可。
- 桌面端與行動端是同一個包，買一次兩邊都能用。

### 網路存取

只有 AI 功能會連網，其餘功能完全離線。

- 請求發往你在設定裡填寫的 OpenAI 相容介面（自建服務或第三方 API 均可），外掛沒有自己的伺服器。
- 發送的內容是你選取或提問的文字、目前頁正文（截到 6000 字以內），必要時還會帶上書名、章節名與最近幾輪問答。
- API 金鑰與其他設定一起保存在外掛目錄的 `data.json` 裡，不會上傳給外掛作者；只有請求你自己填寫的那個介面時，它才會以請求標頭的形式送過去。

### 常見問題

- **支援哪些格式？** EPUB 與 TXT 開箱即讀；mobi、azw3、fb2 與漫畫在高級版。
- **會和其他外掛衝突嗎？** 閱讀頁是 Obsidian 原生檢視，目錄是左側欄裡的一個頁籤；劃線可以複製成帶定位的 Markdown 連結，點一下跳回原文那一句，不另建索引。
- **換電腦怎麼辦？** 庫同步過去，書架、進度與標註跟著走；高級版在新裝置上重新填一次啟用碼。
- **手機上要單獨買嗎？** 不用，同一個包，桌面與行動都包含在內。

### 安裝

在社群市集安裝（首次上架審核通過後可見）：

1. 開啟 **設定 → 第三方外掛**，關閉安全模式。
2. 點 **瀏覽**，搜尋 **bz Reader**，安裝。
3. 啟用後左側出現 bz 圖示，從書架開始。

審核期間或搜不到時，用 [BRAT](https://github.com/TfTHacker/obsidian42-brat) 加入本倉庫安裝，或手動下載 Release 裡的 `main.js`、`manifest.json`、`styles.css`，放進 `<你的庫>/.obsidian/plugins/bz-reader/` 後啟用。

### 授權

本專案以 [MIT](LICENSE) 授權發布。渲染內核來自 [foliate-js](https://github.com/johnfactotum/foliate-js) 1.0.1（MIT，以 npm 依賴分發，本地補丁見 [patches/foliate-js@1.0.1.patch](patches/foliate-js@1.0.1.patch)）。

</details>

<details>
<summary><b>日本語</b></summary>

## 日本語

Obsidian を「本を読む場所」に。デスクトップとモバイル、複数フォーマット、8 つの表示言語、AI への質問、双方向リンク。データはすべてローカルに保存されます。

### 機能

| | ベーシック版 | プロ版 |
|---|:---:|:---:|
| EPUB / TXT の読書・ページ送り・組版 | ✓ | ✓ |
| 1 段 / 2 段組 | ✓ | ✓ |
| 目次・ブックマーク・4 色ハイライトとメモ | ✓ | ✓ |
| 本文内検索 | ✓ | ✓ |
| 脚注のポップアップ表示 | ✓ | ✓ |
| ハイライトを双方向リンクとしてコピー | — | ✓ |
| 構造化 Markdown への書き出し | — | ✓ |
| 引用カード | — | ✓ |
| 読書統計・ヒートマップ・本ごとの進捗 | — | ✓ |
| 本をまたぐ検索 | — | ✓ |
| AI による回答 / 要約 / 解説 / 翻訳 | — | ✓ |
| mobi / azw3 / fb2 / コミック | — | ✓ |
| 縦組み | — | ✓ |
| 読み上げ | — | ✓ |
| 原文と訳文の並列表示 | — | ✓ |
| 全体マップ | — | ✓ |

### 表示言語

表示言語は Obsidian の言語に従い、**本棚 → 設定 → 表示** から手動で選ぶこともできます：简体中文、繁體中文、English、日本語、Deutsch、Français、Español、Português。

切り替えると表示はすぐ変わります。コマンド名は Obsidian の再起動後に反映されます。繁体字は簡体字の字形変換ではなく、台湾の用語を使う別パックです（設定 / 預設 / 匯入 / 匯出 / 檔案）。**更新履歴だけは例外**で、リリースごとに手書きのため中国語と英語の 2 版のみ、他の 6 言語では英語の項目を表示します。

### プロ版について

ベーシック版は無料です。プロ版の機能にはライセンスキーが必要です。価格は[購入ページ](https://afdian.com/item/6f17bf10d7e311f1b8735254001e7c00)をご覧ください。

- キーは **本棚 → 設定 → ライセンス** に入力します。検証はローカルで行われ、通信しません。
- デバイス数に紐づきません。新しい端末では同じ場所にもう一度入力してください。
- デスクトップとモバイルは同じビルドなので、1 回の購入で両方使えます。

### ネットワークアクセス

ネットワークを使うのは AI 機能だけです。それ以外は完全にオフラインで動作します。

- リクエストは、設定で入力した OpenAI 互換のエンドポイント（自前のサーバーでも第三者 API でも可）に送られます。プラグイン独自のサーバーはありません。
- 送信されるのは、選択または入力したテキスト、現在のページ本文（6000 文字まで）、必要に応じて書名・章名・直近数ターンのやり取りです。
- API キーは他の設定とともにプラグインフォルダの `data.json` に保存されます。作者に送信されることはなく、設定したエンドポイントへのリクエストヘッダーとしてのみ送られます。

### よくある質問

- **対応フォーマットは？** EPUB と TXT はすぐ読めます。mobi・azw3・fb2・コミックはプロ版です。
- **他のプラグインと衝突しますか？** 読書画面は Obsidian のネイティブビュー、目次は左サイドバーのタブです。ハイライトは位置情報つきの Markdown リンクとしてコピーでき、クリックすると元の一文に戻ります。別途インデックスは作りません。
- **PC を買い替えたら？** 保管庫を同期すれば本棚・進捗・注釈もついてきます。プロ版は新しい端末でキーを再入力してください。
- **モバイルで別途購入が必要？** いいえ。1 つのビルドでデスクトップもモバイルも使えます。

### インストール

コミュニティディレクトリからインストールします（初回審査の通過後に表示されます）。

1. **設定 → コミュニティプラグイン** を開き、制限モードを解除します。
2. **閲覧** をクリックし、**bz Reader** を検索してインストールします。
3. 有効にすると左リボンに bz アイコンが現れます。本棚から始めてください。

審査中で見つからない場合は、[BRAT](https://github.com/TfTHacker/obsidian42-brat) でこのリポジトリを追加するか、Release から `main.js`・`manifest.json`・`styles.css` をダウンロードして `<保管庫>/.obsidian/plugins/bz-reader/` に置き、有効化してください。

### ライセンス

[MIT](LICENSE) ライセンスで公開しています。レンダリングエンジンは [foliate-js](https://github.com/johnfactotum/foliate-js) 1.0.1（MIT、npm 依存として配布、ローカルパッチは [patches/foliate-js@1.0.1.patch](patches/foliate-js@1.0.1.patch)）です。

</details>

<details>
<summary><b>Deutsch</b></summary>

## Deutsch

Mach aus Obsidian einen Ort zum Lesen. Desktop und Mobil, mehrere Formate, acht Oberflächensprachen, KI-Fragen, Wikilinks. Alle Daten bleiben lokal.

### Funktionen

| | Basis | Pro |
|---|:---:|:---:|
| EPUB / TXT lesen, blättern, Satz einstellen | ✓ | ✓ |
| Eine oder zwei Spalten | ✓ | ✓ |
| Inhalt, Lesezeichen, vier Markierungsfarben und Notizen | ✓ | ✓ |
| Suche im Buch | ✓ | ✓ |
| Fußnoten als Pop-up | ✓ | ✓ |
| Markierungen als Wikilink kopieren | — | ✓ |
| Strukturierter Markdown-Export | — | ✓ |
| Zitatkarten | — | ✓ |
| Lesestatistik, Heatmap, Fortschritt pro Buch | — | ✓ |
| Suche über alle Bücher | — | ✓ |
| KI: Antworten / Zusammenfassungen / Erklärungen / Übersetzung | — | ✓ |
| mobi / azw3 / fb2 / Comics | — | ✓ |
| Vertikaler Satz | — | ✓ |
| Vorlesen | — | ✓ |
| Original und Übersetzung nebeneinander | — | ✓ |
| Buchübersicht | — | ✓ |

### Oberflächensprachen

Die Oberfläche folgt der Sprache von Obsidian; unter **Regal → Einstellungen → Oberfläche** lässt sich eine von acht auch von Hand wählen: 简体中文, 繁體中文, English, 日本語, Deutsch, Français, Español, Português.

Die Umschaltung wirkt sofort auf die Oberfläche; Befehlsnamen erst nach einem Neustart von Obsidian. Traditionelles Chinesisch ist keine Glyphenumwandlung des Vereinfachten, sondern ein eigenes Paket mit Taiwan-Wortschatz (設定 / 預設 / 匯入 / 匯出 / 檔案). **Der Changelog ist die eine Ausnahme**: Er wird pro Release von Hand geschrieben und existiert nur auf Chinesisch und Englisch; die anderen sechs Sprachen zeigen die englischen Einträge.

### Pro-Funktionen

Die Basisversion ist kostenlos. Für die Pro-Funktionen braucht es einen Lizenzschlüssel; den aktuellen Preis nennt die [Kaufseite](https://afdian.com/item/6f17bf10d7e311f1b8735254001e7c00).

- Der Schlüssel wird unter **Regal → Einstellungen → Lizenz** eingetragen und lokal geprüft, ohne Netzwerkzugriff.
- Er ist an keine Gerätezahl gebunden — auf einem neuen Gerät einfach erneut eintragen.
- Ein Build deckt Desktop und Mobil ab; kein zweiter Kauf nötig.

### Netzwerkzugriff

Nur die KI-Funktionen gehen online; alles andere arbeitet vollständig offline.

- Anfragen gehen an den OpenAI-kompatiblen Endpunkt, den du einstellst (eigener Server oder Drittanbieter-API). Das Plugin hat keinen eigenen Server.
- Gesendet werden der markierte oder eingetippte Text und die aktuelle Seite (auf 6000 Zeichen gekürzt), bei Bedarf zusätzlich Buchtitel, Kapitelname und die letzten Gesprächsrunden.
- Der API-Schlüssel liegt mit den übrigen Einstellungen in `data.json` im Plugin-Ordner. Er geht nie an den Autor, sondern nur als Request-Header an den von dir eingestellten Endpunkt.

### Häufige Fragen

- **Welche Formate?** EPUB und TXT sofort; mobi, azw3, fb2 und Comics mit Pro.
- **Kollidiert es mit anderen Plugins?** Die Leseansicht ist eine native Obsidian-Ansicht, der Inhalt ein Tab in der linken Seitenleiste. Markierungen lassen sich als Markdown-Links mit Positionsangabe kopieren, die zur genauen Stelle zurückspringen — ein eigener Index wird nicht angelegt.
- **Rechnerwechsel?** Der Vault nimmt Regal, Fortschritt und Anmerkungen mit. Den Lizenzschlüssel auf dem neuen Gerät erneut eingeben.
- **Muss ich mobil noch einmal zahlen?** Nein. Ein Build deckt Desktop und Mobil ab.

### Installation

Installation über das Community-Verzeichnis (sichtbar, sobald die erste Prüfung durch ist):

1. **Einstellungen → Community-Plugins** öffnen und den eingeschränkten Modus ausschalten.
2. Auf **Durchsuchen** klicken, nach **bz Reader** suchen und installieren.
3. Aktivieren — links erscheint ein bz-Symbol; das Regal ist der Einstieg.

Solange die Prüfung läuft oder die Suche nichts findet: mit [BRAT](https://github.com/TfTHacker/obsidian42-brat) dieses Repository hinzufügen, oder `main.js`, `manifest.json` und `styles.css` aus dem Release herunterladen, nach `<dein Vault>/.obsidian/plugins/bz-reader/` legen und aktivieren.

### Lizenz

Veröffentlicht unter der [MIT](LICENSE)-Lizenz. Die Rendering-Engine ist [foliate-js](https://github.com/johnfactotum/foliate-js) 1.0.1 (MIT, als npm-Abhängigkeit verteilt; lokale Patches in [patches/foliate-js@1.0.1.patch](patches/foliate-js@1.0.1.patch)).

</details>

<details>
<summary><b>Français</b></summary>

## Français

Faites d'Obsidian un endroit où lire. Bureau et mobile, plusieurs formats, huit langues d'interface, questions à l'IA, wikiliens. Toutes les données restent en local.

### Fonctionnalités

| | Base | Pro |
|---|:---:|:---:|
| Lecture EPUB / TXT, pagination et composition | ✓ | ✓ |
| Une ou deux colonnes | ✓ | ✓ |
| Sommaire, signets, quatre couleurs de surlignage et notes | ✓ | ✓ |
| Recherche dans le livre | ✓ | ✓ |
| Aperçu des notes de bas de page | ✓ | ✓ |
| Copier les surlignages en wikiliens | — | ✓ |
| Export Markdown structuré | — | ✓ |
| Cartes de citation | — | ✓ |
| Statistiques, carte de chaleur, progression par livre | — | ✓ |
| Recherche dans tous les livres | — | ✓ |
| IA : réponses / résumés / explications / traduction | — | ✓ |
| mobi / azw3 / fb2 / BD | — | ✓ |
| Composition verticale | — | ✓ |
| Lecture à voix haute | — | ✓ |
| Original et traduction côte à côte | — | ✓ |
| Vue d'ensemble du livre | — | ✓ |

### Langues de l'interface

L'interface suit la langue d'Obsidian, et vous pouvez aussi en choisir une parmi huit sous **Bibliothèque → Réglages → Interface** : 简体中文, 繁體中文, English, 日本語, Deutsch, Français, Español, Português.

Le changement s'applique immédiatement à l'interface ; les noms des commandes après un redémarrage d'Obsidian. Le chinois traditionnel n'est pas une conversion de glyphes du simplifié : c'est un pack distinct avec le vocabulaire de Taïwan (設定 / 預設 / 匯入 / 匯出 / 檔案). **Le journal des versions est l'unique exception** : il est écrit à la main à chaque publication et n'existe qu'en chinois et en anglais ; les six autres langues affichent les entrées anglaises.

### Fonctions Pro

L'édition de base est gratuite. Les fonctions Pro demandent une clé de licence ; le prix en cours figure sur la [page d'achat](https://afdian.com/item/6f17bf10d7e311f1b8735254001e7c00).

- La clé se saisit dans **Bibliothèque → Réglages → Licence**. Elle est vérifiée localement, sans appel réseau.
- Elle n'est liée à aucun nombre d'appareils : ressaisissez-la simplement sur un nouvel appareil.
- Une seule version couvre bureau et mobile — pas de second achat.

### Accès réseau

Seules les fonctions d'IA vont en ligne ; tout le reste fonctionne hors ligne.

- Les requêtes partent vers le point d'accès compatible OpenAI que vous configurez (votre serveur ou une API tierce). Le plugin n'a pas de serveur propre.
- La requête contient le texte sélectionné ou saisi et la page courante (tronquée à 6000 caractères), plus le titre du livre, le nom du chapitre et les derniers échanges si nécessaire.
- Votre clé d'API est stockée avec le reste des réglages dans `data.json`, dans le dossier du plugin. Elle n'est jamais envoyée à l'auteur ; elle ne part que vers le point d'accès que vous avez configuré, en en-tête de requête.

### Questions fréquentes

- **Quels formats ?** EPUB et TXT d'emblée ; mobi, azw3, fb2 et BD avec Pro.
- **Des conflits avec d'autres plugins ?** Le lecteur est une vue native d'Obsidian et le sommaire un onglet du panneau latéral gauche. Les surlignages se copient en liens Markdown avec repère qui reviennent au passage exact — aucun index séparé n'est construit.
- **Changer d'ordinateur ?** Le coffre emporte la bibliothèque, la progression et les annotations. Ressaisissez la clé de licence sur le nouvel appareil.
- **Faut-il payer à nouveau sur mobile ?** Non. Une seule version couvre bureau et mobile.

### Installation

Installation depuis le répertoire communautaire (visible une fois la première validation passée) :

1. Ouvrir **Réglages → Modules complémentaires** et désactiver le mode restreint.
2. Cliquer sur **Parcourir**, chercher **bz Reader** et installer.
3. Activer — une icône bz apparaît dans le ruban de gauche ; commencez par la bibliothèque.

Pendant la validation, ou si la recherche ne donne rien : ajoutez ce dépôt avec [BRAT](https://github.com/TfTHacker/obsidian42-brat), ou téléchargez `main.js`, `manifest.json` et `styles.css` depuis la Release, placez-les dans `<votre coffre>/.obsidian/plugins/bz-reader/`, puis activez.

### Licence

Publié sous licence [MIT](LICENSE). Le moteur de rendu est [foliate-js](https://github.com/johnfactotum/foliate-js) 1.0.1 (MIT, distribué comme dépendance npm ; correctifs locaux dans [patches/foliate-js@1.0.1.patch](patches/foliate-js@1.0.1.patch)).

</details>

<details>
<summary><b>Español</b></summary>

## Español

Convierte Obsidian en un lugar donde leer. Escritorio y móvil, varios formatos, ocho idiomas de interfaz, preguntas a la IA, wikienlaces. Todos los datos se guardan en local.

### Funciones

| | Base | Pro |
|---|:---:|:---:|
| Lectura EPUB / TXT, paginación y tipografía | ✓ | ✓ |
| Una o dos columnas | ✓ | ✓ |
| Índice, marcadores, cuatro colores de subrayado y notas | ✓ | ✓ |
| Búsqueda dentro del libro | ✓ | ✓ |
| Vista previa de notas al pie | ✓ | ✓ |
| Copiar subrayados como wikienlaces | — | ✓ |
| Exportación a Markdown estructurado | — | ✓ |
| Tarjetas de cita | — | ✓ |
| Estadísticas, mapa de calor y progreso por libro | — | ✓ |
| Búsqueda en todos los libros | — | ✓ |
| IA: respuestas / resúmenes / explicaciones / traducción | — | ✓ |
| mobi / azw3 / fb2 / cómic | — | ✓ |
| Composición vertical | — | ✓ |
| Lectura en voz alta | — | ✓ |
| Original y traducción en paralelo | — | ✓ |
| Vista general del libro | — | ✓ |

### Idiomas de la interfaz

La interfaz sigue el idioma de Obsidian, y también puedes elegir uno de los ocho en **Estantería → Ajustes → Interfaz**: 简体中文, 繁體中文, English, 日本語, Deutsch, Français, Español, Português.

El cambio se aplica al instante en la interfaz; los nombres de comando, tras reiniciar Obsidian. El chino tradicional no es una conversión de glifos del simplificado: es un paquete aparte con vocabulario de Taiwán (設定 / 預設 / 匯入 / 匯出 / 檔案). **El registro de versiones es la única excepción**: se escribe a mano en cada publicación y solo existe en chino e inglés; los otros seis idiomas muestran las entradas en inglés.

### Funciones Pro

La edición base es gratuita. Las funciones Pro requieren una clave de licencia; el precio actual está en la [página de compra](https://afdian.com/item/6f17bf10d7e311f1b8735254001e7c00).

- La clave se introduce en **Estantería → Ajustes → Licencia**. Se verifica en local, sin llamada de red.
- No está ligada a un número de dispositivos: vuelve a introducirla en el nuevo dispositivo.
- Una sola compilación cubre escritorio y móvil; no hace falta comprar dos veces.

### Acceso a la red

Solo las funciones de IA se conectan; todo lo demás funciona sin conexión.

- Las peticiones van al punto de acceso compatible con OpenAI que configures (tu propio servidor o una API de terceros). El plugin no tiene servidor propio.
- La petición incluye el texto seleccionado o escrito y la página actual (recortada a 6000 caracteres), y cuando hace falta el título del libro, el nombre del capítulo y los últimos turnos.
- Tu clave de API se guarda con el resto de ajustes en `data.json`, dentro de la carpeta del plugin. Nunca se envía al autor; solo viaja al punto de acceso que hayas configurado, como cabecera de la petición.

### Preguntas frecuentes

- **¿Qué formatos?** EPUB y TXT de serie; mobi, azw3, fb2 y cómic con Pro.
- **¿Choca con otros plugins?** El lector es una vista nativa de Obsidian y el índice una pestaña del panel lateral izquierdo. Los subrayados se copian como enlaces Markdown con posición que vuelven al pasaje exacto: no se construye ningún índice aparte.
- **¿Cambio de ordenador?** La bóveda se lleva la estantería, el progreso y las anotaciones. Vuelve a introducir la clave de licencia en el nuevo dispositivo.
- **¿Pago otra vez en el móvil?** No. Una sola compilación cubre escritorio y móvil.

### Instalación

Instalación desde el directorio comunitario (visible cuando pase la primera revisión):

1. Abre **Ajustes → Complementos de la comunidad** y desactiva el modo restringido.
2. Pulsa **Explorar**, busca **bz Reader** e instala.
3. Actívalo: aparece un icono bz en la cinta izquierda; empieza por la estantería.

Mientras la revisión esté pendiente, o si la búsqueda no lo encuentra, añade este repositorio con [BRAT](https://github.com/TfTHacker/obsidian42-brat), o descarga `main.js`, `manifest.json` y `styles.css` desde la Release y colócalos en `<tu bóveda>/.obsidian/plugins/bz-reader/`, luego actívalo.

### Licencia

Publicado bajo licencia [MIT](LICENSE). El motor de renderizado es [foliate-js](https://github.com/johnfactotum/foliate-js) 1.0.1 (MIT, distribuido como dependencia npm; parches locales en [patches/foliate-js@1.0.1.patch](patches/foliate-js@1.0.1.patch)).

</details>

<details>
<summary><b>Português</b></summary>

## Português

Transforme o Obsidian num lugar para ler. Desktop e celular, vários formatos, oito idiomas de interface, perguntas à IA, wikilinks. Todos os dados ficam locais.

### Recursos

| | Base | Pro |
|---|:---:|:---:|
| Leitura EPUB / TXT, paginação e tipografia | ✓ | ✓ |
| Uma ou duas colunas | ✓ | ✓ |
| Sumário, marcadores, quatro cores de destaque e notas | ✓ | ✓ |
| Pesquisa dentro do livro | ✓ | ✓ |
| Prévia das notas de rodapé | ✓ | ✓ |
| Copiar destaques como wikilinks | — | ✓ |
| Exportação em Markdown estruturado | — | ✓ |
| Cartões de citação | — | ✓ |
| Estatísticas, mapa de calor e progresso por livro | — | ✓ |
| Pesquisa em todos os livros | — | ✓ |
| IA: respostas / resumos / explicações / tradução | — | ✓ |
| mobi / azw3 / fb2 / quadrinhos | — | ✓ |
| Composição vertical | — | ✓ |
| Leitura em voz alta | — | ✓ |
| Original e tradução lado a lado | — | ✓ |
| Visão geral do livro | — | ✓ |

### Idiomas da interface

A interface segue o idioma do Obsidian, e você também pode escolher um dos oito em **Estante → Configurações → Interface**: 简体中文, 繁體中文, English, 日本語, Deutsch, Français, Español, Português.

A troca vale na hora para a interface; os nomes dos comandos, após reiniciar o Obsidian. O chinês tradicional não é conversão de glifos do simplificado: é um pacote separado com vocabulário de Taiwan (設定 / 預設 / 匯入 / 匯出 / 檔案). **O registro de versões é a única exceção**: é escrito à mão a cada lançamento e só existe em chinês e inglês; os outros seis idiomas mostram os itens em inglês.

### Recursos Pro

A edição base é gratuita. Os recursos Pro exigem uma chave de licença; o preço atual está na [página de compra](https://afdian.com/item/6f17bf10d7e311f1b8735254001e7c00).

- A chave é informada em **Estante → Configurações → Licença**. A verificação é local, sem chamada de rede.
- Não está atrelada a um número de dispositivos: basta informá-la de novo no novo aparelho.
- Uma única compilação cobre desktop e celular — sem compra dupla.

### Acesso à rede

Só os recursos de IA acessam a rede; todo o resto funciona offline.

- As requisições vão para o endpoint compatível com OpenAI que você configurar (servidor próprio ou API de terceiros). O plugin não tem servidor próprio.
- A requisição leva o texto selecionado ou digitado e a página atual (cortada em 6000 caracteres), além do título do livro, nome do capítulo e as últimas trocas quando necessário.
- Sua chave de API fica com os demais ajustes em `data.json`, na pasta do plugin. Ela nunca é enviada ao autor; só vai para o endpoint que você configurou, como cabeçalho da requisição.

### Perguntas frequentes

- **Quais formatos?** EPUB e TXT de imediato; mobi, azw3, fb2 e quadrinhos no Pro.
- **Conflita com outros plugins?** O leitor é uma view nativa do Obsidian e o sumário é uma aba do painel lateral esquerdo. Os destaques podem ser copiados como links Markdown com posição que voltam ao trecho exato — nenhum índice separado é criado.
- **Troquei de computador?** O cofre leva a estante, o progresso e as anotações. Informe a chave de licença de novo no novo aparelho.
- **Preciso pagar de novo no celular?** Não. Uma única compilação cobre desktop e celular.

### Instalação

Instalação pelo diretório da comunidade (visível quando a primeira revisão passar):

1. Abra **Configurações → Plugins da comunidade** e desative o modo restrito.
2. Clique em **Procurar**, pesquise **bz Reader** e instale.
3. Ative — um ícone bz aparece na faixa da esquerda; comece pela estante.

Enquanto a revisão estiver pendente, ou se a busca não encontrar, adicione este repositório com o [BRAT](https://github.com/TfTHacker/obsidian42-brat), ou baixe `main.js`, `manifest.json` e `styles.css` do Release e coloque em `<seu cofre>/.obsidian/plugins/bz-reader/`, depois ative.

### Licença

Publicado sob a licença [MIT](LICENSE). O motor de renderização é o [foliate-js](https://github.com/johnfactotum/foliate-js) 1.0.1 (MIT, distribuído como dependência npm; patches locais em [patches/foliate-js@1.0.1.patch](patches/foliate-js@1.0.1.patch)).

</details>

