import fs from 'node:fs';
const p = 'D:/Obsidian/bz-reader/src/view/reader-view.ts';
let s = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

/* 工具条：不吃掉选区、不越界、上方放不下就翻到下方 */
const old = `    const rootRect = root.getBoundingClientRect();
    bar.style.left = \`\${info.anchor.left - rootRect.left + info.anchor.width / 2}px\`;
    bar.style.top = \`\${info.anchor.top - rootRect.top - 8}px\`;
    root.appendChild(bar);
    this.selbar = bar;`;
const neu = `    /* 点工具条不能把系统的选区和手柄清掉：pointerdown 默认会让 iframe 失焦，
       选区一塌，后面所有动作都拿不到文本了。 */
    bar.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
    });

    root.appendChild(bar);

    /* 定位：优先贴在选区第一行上方、左右夹在可视区内；上面放不下就放到选区下方。
       以前直接用 anchor 的视口坐标减 rootRect，选区靠近顶部时条子会跑到屏幕外，
       看起来就是「偏移很远」。 */
    const rootRect = root.getBoundingClientRect();
    const barRect = bar.getBoundingClientRect();
    const cx = info.anchor.left - rootRect.left + info.anchor.width / 2;
    const half = barRect.width / 2 + 6;
    const left = Math.max(half, Math.min(rootRect.width - half, cx));
    const aboveTop = info.anchor.top - rootRect.top - 8;
    const belowTop = info.bounds.top - rootRect.top + info.bounds.height + 8;
    const top = aboveTop - barRect.height >= 4 ? aboveTop : belowTop;
    bar.style.left = \`\${Math.round(left)}px\`;
    bar.style.top = \`\${Math.round(top)}px\`;
    this.selbar = bar;`;

if (!s.includes(old)) { console.error('selbar position block not found'); process.exit(1); }
s = s.replace(old, neu);
fs.writeFileSync(p, s.replace(/\n/g, '\r\n'), 'utf8');
console.log('ok');
