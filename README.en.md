<div align="center">
  <img src="docs/images/mark.svg" width="76" height="76" alt="">
  <h1>bz Reader</h1>
  <p><b>Turn Obsidian into a place to read.</b><br>
  <sub>Desktop and mobile, multiple formats, AI Q&amp;A, source links. All data stored locally.</sub></p>

  <p>
    <a href="https://obsidian.md"><img src="docs/images/badges/obsidian.svg" height="27" alt="Obsidian 1.7.2+"></a>
    <img src="docs/images/badges/version.svg" height="27" alt="version 0.1.1">
    <img src="docs/images/badges/platform.svg" height="27" alt="Desktop and mobile">
    <img src="docs/images/badges/license.svg" height="27" alt="MIT">
  </p>

  <p><a href="README.md">简体中文</a></p>
</div>

<p align="center">
  <img src="docs/images/shelf-desktop-light.webp" alt="Shelf: continue reading, filter bar, shelf groups, and the cover wall (light on the left, dark on the right)">
</p>

<p align="center">
  <img src="docs/images/read-desktop-light.webp" alt="Reader: contents on the left, single-column text, selection capsule, footnote popover (light on the left, dark on the right)">
</p>

<p align="center">
  <img src="docs/images/shelf-mobile-light.webp" width="288" alt="Shelf on mobile, light theme">
  &nbsp;&nbsp;
  <img src="docs/images/read-mobile-dark.webp" width="288" alt="Reader on mobile, dark theme">
</p>

## Features

| | Free | Pro |
|---|:---:|:---:|
| EPUB / TXT reading, pagination, and typography | ✓ | ✓ |
| Contents, bookmarks, four-color highlights, and notes | ✓ | ✓ |
| In-book search | ✓ | ✓ |
| Footnote preview in a popover | ✓ | ✓ |
| Copy highlights as source links | — | ✓ |
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

## Paid features

The free edition covers everyday reading. Pro features require a paid license key; see the [purchase page](https://afdian.com/item/6f17bf10d7e311f1b8735254001e7c00) for the current price.

- Enter the key in **Shelf → Settings → 授权 (License)**. It is verified locally, with no network call.
- Keys are not tied to a device count — just enter yours again on a new device.
- One build covers desktop and mobile — no separate purchase.

## Network access

Only the AI features go online; everything else works fully offline.

- Requests go to the OpenAI-compatible endpoint you configure (your own server or a third-party API). The plugin has no server of its own.
- The request contains the text you selected or typed and the current page (trimmed to 6000 characters), plus the book title, chapter name, and the last few turns when needed.
- Your API key is stored with the rest of your settings in `data.json` inside the plugin folder. It is never sent to the plugin author; it only travels to the endpoint you configured, as a request header.

## FAQ

- **Which formats?** EPUB and TXT out of the box; mobi, azw3, fb2, and comics with Pro.
- **Does it conflict with other plugins?** The reader is a native Obsidian view and the contents are a tab in the left sidebar. Highlights can be copied as locator Markdown links that jump back to the exact passage — no separate index is built.
- **Switching computers?** Your vault carries the shelf, progress, and annotations. Re-enter the license key on the new device.
- **Do I pay again on mobile?** No. One build covers desktop and mobile.

## Installation

Install from the community directory (visible once the initial review passes):

1. Open **Settings → Community plugins** and turn off Restricted mode.
2. Click **Browse**, search for **bz Reader**, and install.
3. Enable it — a bz icon appears in the left ribbon; start from the shelf.

While the review is pending, or if search doesn't find it, install with [BRAT](https://github.com/TfTHacker/obsidian42-brat), or download `main.js`, `manifest.json`, and `styles.css` from the Release and place them in `<your vault>/.obsidian/plugins/bz-reader/`, then enable the plugin.

## License

Released under the [MIT](LICENSE) license. The rendering engine is [foliate-js](https://github.com/johnfactotum/foliate-js) 1.0.1 (MIT, distributed as an npm dependency; local patches in [patches/foliate-js@1.0.1.patch](patches/foliate-js@1.0.1.patch)).
