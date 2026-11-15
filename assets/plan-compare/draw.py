"""生成 docs/images/plan-compare.png（基础版 / 高级版功能对照长图）。

数据不是手写的：`data.ts` 从 `src/data/entitlement.ts` 的 PLAN_TABLE 直接导出
快照，这边只负责排版。权益一改，重跑下面三条命令即可，行名与勾叉不会和
插件里的解锁弹层对不上。

  node node_modules/esbuild/bin/esbuild assets/plan-compare/data.ts --bundle \
    --platform=node --format=cjs --outfile=assets/plan-compare/data.cjs \
    --alias:obsidian=./assets/plan-compare/obsidian-stub.ts
  node assets/plan-compare/data.cjs > assets/plan-compare/plan.json
  python assets/plan-compare/draw.py

`data.cjs` 与 `plan.json` 是中间产物，已在 .gitignore 里。
"""

import json
import os

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
DATA = os.path.join(HERE, "plan.json")
OUT = os.path.join(ROOT, "docs", "images", "plan-compare.png")

W = 1440
M = 56
ROW_H = 38
GROUP_H = 58
TITLE_H = 92
HEAD_H = 74
FOOT_H = 92

PAPER = "#fbf8f1"
INK = "#2f2a24"
DIM = "#7d7466"
GROUP_BG = "#f1ead9"
RULE = "#e3dac6"
TICK = "#b3802a"
CROSS = "#cfc6b4"


def font(path, size, index=0):
    try:
        return ImageFont.truetype(path, size, index=index)
    except OSError:
        return ImageFont.load_default()


F_TITLE = font("C:/Windows/Fonts/msyhbd.ttc", 40)
F_SUB = font("C:/Windows/Fonts/msyh.ttc", 22)
F_HEAD = font("C:/Windows/Fonts/msyhbd.ttc", 24)
F_GROUP = font("C:/Windows/Fonts/msyhbd.ttc", 25)
F_ROW = font("C:/Windows/Fonts/msyh.ttc", 22)
F_FOOT = font("C:/Windows/Fonts/msyh.ttc", 20)


def draw_tick(d, cx, cy):
    d.line([(cx - 8, cy + 1), (cx - 2, cy + 7)], fill=TICK, width=3)
    d.line([(cx - 2, cy + 7), (cx + 9, cy - 7)], fill=TICK, width=3)


def draw_cross(d, cx, cy):
    d.line([(cx - 6, cy - 6), (cx + 6, cy + 6)], fill=CROSS, width=2)
    d.line([(cx - 6, cy + 6), (cx + 6, cy - 6)], fill=CROSS, width=2)


def main():
    with open(DATA, encoding="utf-8") as fh:
        data = json.load(fh)

    groups = data["groups"]
    totals = data["totals"]
    rows = sum(len(g["rows"]) for g in groups)
    height = TITLE_H + HEAD_H + GROUP_H * len(groups) + ROW_H * rows + FOOT_H + M

    img = Image.new("RGB", (W, height), PAPER)
    d = ImageDraw.Draw(img)

    # 标题
    d.text((M, 40), "bz Reader · 基础版 / 高级版", font=F_TITLE, fill=INK)
    d.text(
        (M, 92),
        f"共 {rows} 行 · 基础版 {totals['free']} 项 · 高级版 {totals['pro']} 项 · 勾 = 有，横 = 没有",
        font=F_SUB,
        fill=DIM,
    )

    col_free = W - 330
    col_pro = W - 150
    y = TITLE_H + HEAD_H - 26
    d.text((col_free, y), "基础版", font=F_HEAD, fill=INK, anchor="ma")
    d.text((col_pro, y), "高级版", font=F_HEAD, fill=INK, anchor="ma")
    y += 48
    d.line([(M, y), (W - M, y)], fill=RULE, width=1)

    y = TITLE_H + HEAD_H + 18
    for group in groups:
        # 组标题自带上下留白：上一段的最后一行与下一段标题不能贴在一起
        d.rectangle([(M, y + 4), (W - M, y + 44)], fill=GROUP_BG)
        d.text((M + 14, y + 9), group["name"], font=F_GROUP, fill=INK)
        y += GROUP_H

        for row in group["rows"]:
            cy = y + ROW_H // 2
            d.text((M + 14, cy), row["name"], font=F_ROW, fill=INK, anchor="lm")
            if row["free"] == "yes":
                draw_tick(d, col_free, cy)
            else:
                draw_cross(d, col_free, cy)
            if row["pro"] == "yes":
                draw_tick(d, col_pro, cy)
            else:
                draw_cross(d, col_pro, cy)
            d.line([(M, y + ROW_H), (W - M, y + ROW_H)], fill=RULE, width=1)
            y += ROW_H

    y += 26
    d.text((M, y), "功能对照以插件内「解锁」弹层为准；这版图由代码里的对照表直接生成。", font=F_FOOT, fill=DIM)
    d.text((W - M, y), "bz-reader", font=F_FOOT, fill=DIM, anchor="ra")

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    img.save(OUT, "PNG")
    print(f"saved {OUT}  {img.width}x{img.height}")


if __name__ == "__main__":
    main()
