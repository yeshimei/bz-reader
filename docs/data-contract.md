# 业务数据契约（给外部消费者）

bz-reader 的书架、进度、标注全在一个 JSON 里。这份文档是给 **bz 书库**这类外部
消费者看的：插件不改存储形状去迁就谁，这里只保证「字段齐全、语义稳定」。

## 1. 文件在哪

| 项 | 值 |
|---|---|
| 插件配置 | `.obsidian/plugins/bz-reader/data.json`（`settings` / `entitlement` / `dataDir`） |
| 业务数据 | `<dataDir>/bz-reader.json`，`dataDir` 默认 `bz 阅读`，用户可在「书架 · 设置」里改 |
| 封面缓存 | `<dataDir>/covers/` |
| 同目录其它文件 | `bz-reader.json.tmp` / `.bak`（原子写残留，不要读）、`bz-reader.broken-*.json`（坏文件留档） |

**不要**从 localStorage 猜数据目录；权威值在 `data.json` 的 `dataDir`。

## 2. 顶层形状

```jsonc
{
  "version": 1,          // JSON 结构版本（能不能读）
  "schemaVersion": 2,    // 字段代际（给外部判断，只加字段时不动 version）
  "books": [ /* 见下 */ ],
  "prefs": { /* 排版偏好 */ },
  "goal": 20,
  "dailyGoalMinutes": 30,
  "checkins": { "2026-11-04": 1830 },
  "dataDir": "bz 阅读"   // 数据目录的镜像
}
```

`books` 是**数组**（weave 是字典），每项：

```jsonc
{
  "id": "b1nt0nt7",            // 稳定 id（路径哈希；改名/移动后不变）
  "meta": {
    "title": "红楼梦",
    "titleEdited": true,        // 用户改过名 → 打开书时不再用文件书名覆盖
    "author": "曹雪芹",
    "publisher": "人民文学出版社",
    "language": "zh",
    "description": "……",
    "subjects": ["古典文学"],   // 分类（dc:subject）
    "isbn": "9787020002207",
    "identifier": "urn:isbn:9787020002207",
    "publishDate": "2019-10-16T16:00:00+00:00",
    "series": "中国古典文学读本丛书",
    "seriesIndex": "1",
    "subtitle": "彩皮版",
    "wordCount": 879954,
    "chapterCount": 138,       // spine 篇数（整本单文件的书会偏小）
    "coverPath": "bz 阅读/covers/b1nt0nt7-3263507.jpg"
  },
  "fileRef": {
    "vaultPath": "书库/红楼梦.epub",
    "format": "epub",          // epub/txt/mobi/azw3/fb2/cbz
    "size": 3263507,
    "fileMissing": false       // 扫描时发现文件不在了
  },
  "reading": {
    "position": {
      "percent": 0.0126,       // 0..1（weave 是 0..100，别混）
      "cfi": "epubcfi(/6/24!/4,/10/9:79,/12/1:140)",
      "chapterIndex": 11,
      "chapterTitle": "第一回 …",
      "chapterHref": "text/ch001.xhtml"
    },
    "lastPosition": { /* 同上 + savedAt：被顶掉的上一个位置，冗余 */ },
    "stats": {
      "totalReadTime": 1709,   // 毫秒
      "lastReadTime": 1793749018707,
      "completedTime": 1793749018707,  // 可选；到 99% 时落一次
      "startReadTime": 1793621963884,  // 可选
      "rating": 5,             // 可选：读完打分 1..5
      "review": "……"           // 可选：读完一句话感受
    },
    "sessions": [
      {
        "start": 1793745648636,      // 毫秒；缺失/≤0 的行直接丢，不要补 0
        "end": 1793746890519,
        "durationSeconds": 75,
        "percent": 0.0126,           // 会话结束时的进度 0..1
        "chapterIndex": 11,          // 冗余：会话结束时所在章
        "chapterTitle": "第一回 …"
      }
    ]
  },
  "notes": {
    "highlights": [
      {
        "id": "hmw1fm7137ioe",
        "text": "大荒山无稽",
        "cfiRange": "epubcfi(/6/24!/4/10,/5:4,/5:9)",
        "chapterIndex": 11,          // 可选
        "chapterTitle": "第一回 …",
        "color": "amber",            // 颜色名，不是色值
        "comment": "想法正文",        // 注意：不是 commentText
        "createdAt": 1793755340823,  // 注意：不是 createdTime
        "updatedAt": 1793755344324
      }
    ],
    "excerpts": [ /* 与 highlights 同 id 的镜像，不是独立的「想法」集合 */ ],
    "bookmarks": [
      { "id": "m…", "cfi": "…", "percent": 0.0126, "chapterTitle": "…", "label": "…", "createdAt": 1 }
    ]
  },
  "addedAt": 1793743805421,
  "updatedAt": 1793755351553,
  "favorite": true,             // 可选
  "shelf": "技术"               // 可选：用户起的书架分组名
}
```

## 3. bz 书库字段对照

| bz 侧读的 | 这份数据里的位置 | 备注 |
|---|---|---|
| `meta.title` | `meta.title` | 文件书名可能很长（含副标题/版本说明），bz 可自行截断 |
| `meta.author` | `meta.author` | 多人以「、」拼接 |
| `meta.subjects[0]` | `meta.subjects[0]` | 没有就是 `[]` |
| `meta.coverPath` | `meta.coverPath` | 首次解出封面/打开书时回填；值就是 vault 内图片路径 |
| `meta.wordCount` | `meta.wordCount` | EPUB 按章节文本字节累加 |
| `file.vaultPath` | **`fileRef.vaultPath`** | 键名不同 |
| `reading.position.percent` | 同左 | **0..1** |
| `reading.stats.*` | 同左 | 毫秒 |
| `reading.sessions[].start/end/durationSeconds` | 同左 | `start` 缺失/≤0 的行已被插件丢掉 |
| `notes.highlights[].text` | 同左 | |
| `notes.highlights[].commentText` | **`comment`** | 键名不同 |
| `notes.highlights[].createdTime` | **`createdAt`** | 键名不同 |
| `notes.excerpts.length`（想法数） | 不能直接用 | 它是 highlights 的镜像；想法数应数 `highlights` 里 `comment` 非空的条数 |
| `file.sourceId`（深链） | 无 | 用本条的 `id` + `obsidian://bz-reader?book=<id>&cfi=<cfi>` |

## 4. 封面

- 缓存文件：`<dataDir>/covers/<bookId>-<size>.<ext>`（jpg/png/webp/gif/svg/avif）
- 索引：`<dataDir>/covers/index.json`，`{ "<bookId>-<size>": { "mime": "image/jpeg", "file": "<bookId>-<size>.jpg" } }`
- 旧版本留下的索引值是字符串（文件无扩展名），插件读取时会顺手升级；外部消费者
  以 `meta.coverPath` 为准，不要自己拼文件名。

## 5. 写入语义（外部直改前必读）

- **原子写**：先写 `.tmp` 再 rename；失败退回 `.bak` / 就地覆盖。
- **外部修改合并**：插件 500ms 防抖写盘，写前比对磁盘 `mtime:size`；变了就重读，
  按每本书的 `updatedAt` **整本二选一**合并（不是按字段/按条合并）。
- 因此外部直改 `bz-reader.json` 时：
  1. 必须同时把该书的 `updatedAt` 推到「比插件内存里的新」，否则下一次翻页落盘
     会用旧快照整本覆盖你的改动；
  2. 改 `highlights` 时要同步 `excerpts` 镜像（同 id），否则删掉划线后镜像还在；
  3. 不要改 `schemaVersion` / `version` 的含义，只加字段时推 `schemaVersion`。
- 更稳的做法是走 `obsidian://bz-reader?book=<id>&cfi=<cfi>` 打开书，让用户在插件里改。
