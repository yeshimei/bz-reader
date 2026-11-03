import fs from 'node:fs';
const p = 'D:/Obsidian/bz-reader/src/view/reader-view.ts';
let s = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

/* 1) 选中不再自动划线：保留系统选区与两端手柄，等用户点色 */
s = s.replace(`          this.selection = info;
          this.selectionAt = Date.now();
          this.setSel(info);
          /* 手机上「选中即划」：长按选完直接按上次的颜色落下一条，
             工具条退居二线只管改色/写想法。桌面仍保留「选色才落笔」，
             因为鼠标拖选常常只是复制，不该往书里存东西。 */
          const auto = isMobileShell()
            ? createMark(getShellState().pen, { silent: true }) ?? undefined
            : undefined;
          if (auto) {
            // 划完就收掉系统选区：留下的该是一道线，不是一片蓝
            this.suppressSelClear = true;
            this.host.clearSelection();
          }
          this.showSelbar(info, auto);`, `          this.selection = info;
          this.selectionAt = Date.now();
          this.setSel(info);
          /* 选中不立刻落笔：移动端要留着系统选区与两端手柄，让用户先把范围
             调准，再点颜色。以前「选中即划」会在长按结束的瞬间落一条，
             想改范围就只能撤销重来。 */
          this.showSelbar(info);`);

/* 2) 选区塌了不立刻收条：给 300ms 让工具条上的点击先落地 */
s = s.replace(`            this.hideSelbar();
            return;
          }
          this.selection = info;`, `            this.scheduleSelbarHide();
            return;
          }
          this.selection = info;`);

/* 3) 新增延迟收起 */
s = s.replace(`  private hideSelbar(): void {
    this.selbar?.remove();`, `  /** 选区消失后延迟收起：点工具条会让 iframe 失焦、选区塌掉，立刻收会把点击吞掉 */
  private scheduleSelbarHide(): void {
    if (!this.selbar) return;
    if (this.selbarHideTimer !== null) window.clearTimeout(this.selbarHideTimer);
    this.selbarHideTimer = window.setTimeout(() => {
      this.selbarHideTimer = null;
      this.hideSelbar();
    }, 320);
  }

  private hideSelbar(): void {
    if (this.selbarHideTimer !== null) {
      window.clearTimeout(this.selbarHideTimer);
      this.selbarHideTimer = null;
    }
    this.selbar?.remove();`);

/* 4) 字段 */
s = s.replace(`  private selbar: HTMLElement | null = null;`, `  private selbar: HTMLElement | null = null;
  private selbarHideTimer: number | null = null;`);

fs.writeFileSync(p, s.replace(/\n/g, '\r\n'), 'utf8');
console.log('ok');
