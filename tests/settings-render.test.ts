import { describe, expect, it, vi } from 'vitest';

/* 设置页会读授权状态；测试里用一个可变开关模拟解锁前后。
   只换三个结论函数，发行信息（群号、仓库地址）仍走真实常量——
   「关于」组显示的就是它们，钉死一份假值等于什么都没测。 */
const entState = vi.hoisted(() => ({ unlocked: false, patron: false, name: '' }));
vi.mock('../src/data/entitlement', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/data/entitlement')>();
  return {
    ...actual,
    can: () => entState.unlocked,
    entitlement: () => ({
      tier: entState.unlocked ? 'paid' : 'free',
      unlocked: entState.unlocked,
      patron: entState.patron,
      name: entState.name || undefined,
      license: 'BZR2.old-code',
    }),
    tierText: () => (entState.unlocked ? '高级版已激活' : '当前未激活'),
  };
});

import { ACCENT_OPTIONS, DEFAULT_PREFS } from '../src/data/prefs';
import { DEFAULT_SETTINGS } from '../src/data/settings';
import { HIGHLIGHT_COLORS } from '../src/data/notes';
import { viewSettings } from '../src/shell/render/settings';

const html = (relicense = false, settings = DEFAULT_SETTINGS, pen = 'amber'): string =>
  viewSettings({
    prefs: DEFAULT_PREFS,
    settings,
    pen,
    hotkeys: [],
    relicense,
    version: '0.1.2',
  });

describe('界面语言', () => {
  it('九档都在：跟随 Obsidian + 八种语言', () => {
    const out = html();
    expect(out).toContain('data-act="setlang"');
    for (const v of ['auto', 'zh', 'zh-TW', 'en', 'ja', 'de', 'fr', 'es', 'pt']) {
      expect(out, v).toContain(`data-k="language" data-v="${v}"`);
    }
  });

  it('每种语言用**自称**标注：德语写 Deutsch，写「德语」等于只翻给中文用户看', () => {
    const out = html();
    for (const name of ['繁體中文', 'Deutsch', '日本語', 'Français', 'Español', 'Português']) {
      expect(out, name).toContain(`>${name}<`);
    }
    expect(out).not.toContain('>德语<');
    expect(out).not.toContain('>葡萄牙语<');
  });

  it('语言选择器在设置页里只有一处，不重复渲染', () => {
    const out = html();
    expect((out.match(/data-act="setlang"/g) ?? []).length).toBe(9);
  });

  it('当前语言那一档是选中态', () => {
    const out = html(false, { ...DEFAULT_SETTINGS, language: 'ja' });
    expect(out).toMatch(/class="on" data-act="setlang" data-k="language" data-v="ja"/);
    expect(out).not.toMatch(/class="on" data-act="setlang" data-k="language" data-v="zh"/);
  });

  it('默认（auto）时选中的是跟随 Obsidian', () => {
    const out = html();
    expect(out).toMatch(/class="on" data-act="setlang" data-k="language" data-v="auto"/);
  });

  /* 2026-11-05：语言组底部那行「选跟随 Obsidian 时由宿主语言决定……」整行去掉。
     语言包里的词条仍留着（其他语言也要有同一个 key），这里只钉界面不再渲染它。 */
  it('不再渲染语言说明那行（只留选择器本身）', () => {
    const out = html();
    expect(out).not.toContain('由宿主语言决定');
    expect(out).not.toContain('命令名需重启 Obsidian 才更新');
  });
});

describe('设置页渲染', () => {
  it('导出目录与数据目录都有文件夹选择钮', () => {
    const out = html();
    expect(out).toContain('data-act="pickexportdir"');
    expect(out).toContain('data-act="pickdatadir"');
    expect(out).toContain('data-act="pickimportdir"');
  });

  it('三个目录都不给手输框，只能从清单里选', () => {
    const out = html();
    expect(out).not.toContain('data-role="datadir"');
    expect(out).not.toContain('data-k="exportDir"');
    /* 导入位置从来没有输入框，这条防回归 */
    expect(out).not.toContain('data-k="importDir"');
  });

  /* 2026-11-09：备份说明原来排在调试开关的说明下面，像是两件事共用一段解释。
     现在它紧跟「备份与恢复」那一行，读的人知道这句说的是备份。 */
  it('备份说明紧贴备份行，落在调试开关之前', () => {
    const out = html();
    const backupAt = out.indexOf('data-act="backup"');
    const hintAt = out.indexOf('备份含书架、进度、标注、收藏与目标');
    const debugAt = out.indexOf('data-k="debugLog"');
    expect(backupAt).toBeGreaterThan(-1);
    expect(hintAt).toBeGreaterThan(backupAt);
    expect(debugAt).toBeGreaterThan(hintAt);
  });

  /* 调试开关原来挂着一段「会记触摸、选区、翻页、debug.json」的说明。
     用户只留一句「只在排查问题时打开」。 */
  it('调试项只剩一句「只在排查问题时打开」', () => {
    const out = html();
    expect(out).toContain('<label>调试</label>');
    expect(out).toContain('只在排查问题时打开。');
    expect(out).not.toContain('debug.json');
    expect(out).not.toContain('触摸、选区、翻页与跳转');
  });

  it('基础版：AI 组整组灰化，点击弹高级功能说明', () => {
    entState.unlocked = false;
    const out = html();
    expect(out).toMatch(/class="bzs-setgrp is-locked"[^>]*data-act="unlock" data-mode="ai"/);
  });

  it('placeholder 用「填写…」句式，不拿真实地址/模型名冒充已填内容', () => {
    const out = html();
    expect(out).toContain('placeholder="填写服务商接口地址，以 https:// 开头"');
    expect(out).toContain('placeholder="填写你的账号可用的模型名"');
    expect(out).toContain('placeholder="填写 API 密钥"');
    expect(out).not.toContain('deepseek-chat');
  });

  it('朗读语速与朗读跟随在设置页，单成一组', () => {
    const out = html();
    expect(out).toContain('<h3>朗读</h3>');
    expect(out).toContain('data-k="ttsRate"');
    expect(out).toContain('data-k="ttsFollow"');
  });

  it('阅读页图标可以排序与收起', () => {
    const out = html();
    expect(out).toContain('<h3>阅读页图标</h3>');
    expect(out).toContain('data-act="headertoggle"');
    expect(out).toContain('data-act="headermove"');
  });

  it('阅读页图标列出全部十四项（含 PDF 四颗与对照书籍 / 朗读 / 鸟瞰 / 沉浸 / 返回书架）', () => {
    const out = html();
    for (const id of ['paraBook', 'tts', 'bookmap', 'immersive', 'library', 'thumb', 'copy', 'history', 'export']) {
      expect(out, id).toContain(`data-k="${id}"`);
    }
    expect((out.match(/data-act="headertoggle"/g) ?? []).length).toBe(14);
  });

  it('PDF 单成一组：开书缩放 / 批注 / 反链 / 导出倍率 / 自动复制链接 / 别名都在里面', () => {
    const out = html();
    expect(out).toContain('<h3>PDF</h3>');
    for (const k of ['pdfZoom', 'pdfAnnots', 'pdfBacklinks', 'pdfExportScale', 'pdfAutoLink', 'pdfLinkLabel']) {
      expect(out, k).toContain(`data-k="${k}"`);
    }
    /* 这六项不该还留在「外观」组里 */
    const start = out.indexOf('<h3>外观</h3>');
    const lookGroup = out.slice(start, out.indexOf('<h3>', start + 1));
    expect(lookGroup).not.toContain('data-k="pdfAutoLink"');
    expect(lookGroup).not.toContain('data-k="pdfZoom"');
  });

  it('基础版：PDF 组整组灰化，点击弹高级功能说明', () => {
    entState.unlocked = false;
    const out = html();
    /* 2026-11-10：PDF 在对照表里单独成段，锁标指向那一小段（mode 'pdf'），
       不再借用「更多格式」那一行。 */
    expect(out).toMatch(/class="bzs-setgrp[^"]*is-locked"[^>]*data-act="unlock" data-mode="pdf"/);
    entState.unlocked = false;
  });

  it('PDF 组三套分段控件都带窄栏折行 class，长标签组可单独收窄', () => {
    const out = html();
    /* 四档一组（开书缩放）、三档两组（链接别名 / 导出倍率）：手机上
       label 最长 144px，同行布局会把控件挤成一列。这些 class 是窄栏
       两行布局的挂点，缺一个就会退回「四档竖成一条」。 */
    expect((out.match(/bzs-seg-pdf4/g) ?? []).length).toBe(1);
    expect((out.match(/bzs-seg-pdf3/g) ?? []).length).toBe(2);
    expect((out.match(/bzs-seg bzs-seg-wrap/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(out).toContain('bzs-setgrp-pdf');
    /* 「复制链接（页 / 视图 / 嵌入 / 标注）」那行标签最长，需要定点放开折行 */
    expect(out).toContain('bzs-setgrp-header');
  });

  it('链接别名的 emoji 档已从设置里收起，只列原文 / 页码 / 书名 + 页码', () => {
    const out = html();
    const at = out.indexOf('data-k="pdfLinkLabel"');
    expect(at).toBeGreaterThan(0);
    const rowStart = out.lastIndexOf('<div class="bzs-setrow"', at);
    const row = out.slice(rowStart, out.indexOf('</div>', at));
    /* 「只藏图标、不删能力」：三段按钮里不再出现 📖 与 emoji 值，
       但 prefs 仍认识 'emoji'（见 tests/prefs.test.ts）。 */
    expect(row).not.toContain('📖');
    expect(row).not.toContain('data-v="emoji"');
    expect((row.match(/data-v="/g) ?? []).length).toBe(3);
    expect(row).toContain('bzs-seg-pdf3');
    expect(row).not.toContain('bzs-seg-pdf4');
  });

  it('分组顺序：阅读页图标排在外观之前', () => {
    const out = html();
    const headerAt = out.indexOf('<h3>阅读页图标</h3>');
    const lookAt = out.indexOf('<h3>外观</h3>');
    expect(headerAt).toBeGreaterThan(0);
    expect(lookAt).toBeGreaterThan(0);
    expect(headerAt).toBeLessThan(lookAt);
  });

  it('收起的去向写明是 Obsidian 自带的 ⋮，不是插件自己的菜单', () => {
    const out = html();
    expect(out).toContain('最右侧 ⋮');
    expect(out).not.toContain('进右上角 ⋮');
  });

  it('三个目录的「迁移」按钮已去掉（改由选不同目录时二次确认）', () => {
    const out = html();
    expect(out).not.toContain('datadirmove');
    expect(out).not.toContain('datadomigrate');
  });

  it('不再出现「关于这一版」与它的说明', () => {
    const out = html();
    expect(out).not.toContain('关于这一版');
    expect(out).not.toContain('不联网、不上传');
  });

  it('滑杆渲染时就带上 --fill（否则圆点和已填充段对不上）', () => {
    const out = html();
    expect(out).toMatch(/data-k="fontSize"[^>]*--fill:\d/);
  });

  /* 插件已不再注册 Obsidian 原生设置页，这里是填激活码的唯一入口。
     一旦这组被删或改名，用户就无处可激活——所以钉死输入框与按钮。 */
  it('未激活时给出激活码输入框与激活按钮', () => {
    const out = html();
    expect(out).toContain('<h3>授权</h3>');
    expect(out).toContain('data-role="license"');
    expect(out).toContain('data-act="activate"');
  });

  /* 入口平权：基础版也看得见 AI 组。但没解锁时输入框只读——
     让基础版改一个用不了的配置只会制造「我填了为什么不行」的困惑。
     AI 组里不放「查看功能对照」这类提示：要解锁去授权组，别在配置区塞推销。 */
  it('基础版：AI 组仍在，三个输入框都是只读', () => {
    entState.unlocked = false;
    const out = html();
    expect(out).toContain('<h3>AI 助手</h3>');
    for (const k of ['ai.baseUrl', 'ai.model', 'ai.apiKey']) {
      expect(out, k).toMatch(new RegExp(`data-k="${k.replace('.', '\\.')}"[^>]*readonly`));
    }
  });

  it('基础版：AI 组里没有查看 / 对照按钮', () => {
    entState.unlocked = false;
    const out = html();
    const start = out.indexOf('<h3>AI 助手</h3>');
    const next = out.indexOf('<h3>', start + 1);
    const aiGroup = out.slice(start, next < 0 ? undefined : next);
    expect(aiGroup).not.toContain('data-act="unlock"');
    expect(aiGroup).not.toContain('查看');
    expect(aiGroup).not.toContain('对照');
  });

  it('基础版：AI 组不再有「状态」描述行', () => {
    entState.unlocked = false;
    const out = html();
    const start = out.indexOf('<h3>AI 助手</h3>');
    const next = out.indexOf('<h3>', start + 1);
    const aiGroup = out.slice(start, next < 0 ? undefined : next);
    expect(aiGroup).not.toContain('<label>状态</label>');
    expect(aiGroup).not.toContain('高级版功能 · 配置会保存在本地');
  });

  it('解锁后 AI 输入框可编辑，且不再提示解锁', () => {
    entState.unlocked = true;
    const out = html();
    expect(out).not.toMatch(/data-k="ai\.baseUrl"[^>]*readonly/);
    expect(out).not.toContain('data-act="unlock"');
    entState.unlocked = false;
  });
});

/**
 * 关于组（2026-11-05）。
 *
 * 设置页顶部一条横跨两栏的带子，四个出口：GitHub / 视频教程 / 交流群 /
 * 更新日志。版本号与授权徽章跟在「关于」后面——用户想知道「我这是哪一版、
 * 买没买」时就往这儿看一眼，不用先翻到页尾的授权组。
 */
describe('关于组', () => {
  /** 截出「关于」组那一段：只看组内，不误判别的组 */
  function aboutGroup(out: string): string {
    const start = out.indexOf('<h3>关于</h3>');
    const next = out.indexOf('<h3>', start + 1);
    return out.slice(start, next < 0 ? undefined : next);
  }

  it('是设置页第一组，且横跨两栏', () => {
    const out = html();
    expect(out.indexOf('<h3>关于</h3>')).toBeLessThan(out.indexOf('<h3>版式</h3>'));
    expect(out).toMatch(/<div class="[^"]*\bwide\b[^"]*">\s*<h3>关于<\/h3>/);
  });

  it('四个出口都在：GitHub / 视频教程 / QQ 交流群 / 更新日志', () => {
    const g = aboutGroup(html());
    for (const act of ['aboutgithub', 'aboutvideo', 'copygroup', 'changelog']) {
      expect(g, act).toContain(`data-act="${act}"`);
    }
  });

  it('版本号与授权徽章跟在「关于」后面', () => {
    const g = aboutGroup(html());
    expect(g).toContain('v0.1.2');
    expect(g).toContain('基础版');
  });

  it('已激活：徽章写「高级版」', () => {
    entState.unlocked = true;
    expect(aboutGroup(html())).toContain('高级版');
    entState.unlocked = false;
  });

  it('视频教程已是真入口：不再标「制作中」，点击交给动作层', () => {
    const g = aboutGroup(html());
    expect(g).not.toContain('制作中');
    expect(g).not.toMatch(/data-act="aboutvideo"[^>]*data-href/);
  });

  it('QQ 交流群把群号直接印出来（不依赖短链，短链实测 404）', () => {
    const g = aboutGroup(html());
    expect(g).toContain('QQ 交流群');
    expect(g).toContain('1130883117');
  });

  /* 2026-11-05：GitHub 项只留名字。后面那串 owner/repo 是点开前做判断用的，
     但设置页的「关于」是一条带四个出口的题头，挂上路径会被读成一段网址。
     仓库地址仍在点击行为里（openRepo），点开就是。 */
  it('GitHub 只写名字，不再挂仓库路径小字', () => {
    const g = aboutGroup(html());
    expect(g).toContain('<b>GitHub</b>');
    expect(g).not.toContain('yeshimei/bz-reader');
  });
});

/**
 * 更新日志入口。
 *
 * 弹窗只在升级后第一次进书库自动出现一次，没有常驻入口就再也找不回来。
 * 2026-11-05 从「数据」组挪进「关于」组：它讲的是「这一版改了什么」，
 * 跟导出目录、备份恢复不是一类事，所以整条搬去了「关于」。
 */

/**
 * 数据组 · 说明文字（2026-11-05 定稿）。
 *
 * 更新日志入口不在这组了，说明文字只留备份那一条。文案是用户挑定的定稿，
 * 别再改回长句。
 */
describe('数据组 · 说明文字', () => {
  /** 截出「数据」组那一段：只看组内，不误判别的组 */
  function dataGroup(out: string): string {
    const start = out.indexOf('<h3>数据</h3>');
    const next = out.indexOf('<h3>', start + 1);
    return out.slice(start, next < 0 ? undefined : next);
  }

  /* 主分支上这条原本是「整页都不许有 data-act="changelog"」——那时入口被删光了。
     现在入口搬到了「关于」，所以断言收窄成「这一组没有它」。 */
  it('不再画「更新日志」入口（行与按钮都不见）', () => {
    expect(dataGroup(html())).not.toContain('data-act="changelog"');
    expect(dataGroup(html())).not.toContain('更新日志');
  });

  it('说明文字只讲备份：范围与不备份的东西', () => {
    const group = dataGroup(html());
    expect(group).toContain('备份含书架、进度、标注、收藏与目标。不含激活码和 AI Key，换设备需重填。');
    expect(group).not.toContain('导入的书');
    expect(group).not.toContain('改数据目录');
  });

  it('入口搬到了「关于」组，全页仍只有一个', () => {
    const out = html();
    expect(out.slice(0, out.indexOf('<h3>版式</h3>'))).toContain('data-act="changelog"');
    expect((out.match(/data-act="changelog"/g) ?? []).length).toBe(1);
  });
});

/**
 * 已激活的人也必须能换码：先用群里的 7 天试用，再买正式版——
 * 如果输入框只读、又没有激活按钮，用户就卡在「买了却填不进去」。
 */
describe('授权组 · 重新激活', () => {
  it('已激活：输入框只读，但给出「重新激活」', () => {
    entState.unlocked = true;
    const out = html(false);
    expect(out).toMatch(/data-role="license"[^>]*readonly/);
    expect(out).toContain('data-act="relicense"');
    expect(out).toContain('重新激活');
    expect(out).not.toContain('data-act="activate"');
    entState.unlocked = false;
  });

  it('点了「重新激活」：输入框可编辑，原码保留，只给激活', () => {
    entState.unlocked = true;
    const out = html(true);
    expect(out).not.toMatch(/data-role="license"[^>]*readonly/);
    expect(out).toContain('data-act="activate"');
    expect(out).not.toContain('data-act="cancelrelicense"');
    expect(out).toContain('value="BZR2.old-code"');
    entState.unlocked = false;
  });
});

/**
 * 两列各自成流（2026-11-05）。
 *
 * 原来是一条 grid 里两两配对：矮组和高组同行，行高按高者算，矮组下方
 * 就空出一大块——「界面」贴着「版式」空约 400px，「外观」贴着「阅读页
 * 图标」又空约 400px，最后「授权」右边还空一格。改成左、右两条独立的
 * 列流后，卡片在列内紧贴，空白只会落在两列末端，不再出现在页面中间。
 *
 * 这一组钉的是「谁在左、谁在右」和「关于 / 快捷键仍在列外通栏」：
 * 挪错一组，列高就会重新歪掉。
 */
describe('设置页 · 两列各自成流', () => {
  const COL = '<div class="bzs-set-col">';

  /** 左列范围 [第一个 col, 第二个 col)；右列范围 [第二个 col, 快捷键组之前) */
  function splitCols(out: string): [string, string] {
    const a = out.indexOf(COL);
    const b = out.indexOf(COL, a + COL.length);
    expect(a, '有左列').toBeGreaterThan(-1);
    expect(b, '有右列').toBeGreaterThan(a);
    const keysAt = out.indexOf('<h3>快捷键</h3>', b);
    expect(keysAt, '快捷键排在两列之后').toBeGreaterThan(b);
    return [out.slice(a, b), out.slice(b, keysAt)];
  }

  it('最外层是设置页容器，两列在它里面', () => {
    const out = html();
    expect(out.startsWith('<div class="bzs-set-page">')).toBe(true);
    expect((out.match(/class="bzs-set-col"/g) ?? []).length).toBe(2);
  });

  it('左列三组：界面、版式、阅读页图标', () => {
    const [left] = splitCols(html());
    for (const h of ['界面', '版式', '阅读页图标']) expect(left, h).toContain(`<h3>${h}</h3>`);
    for (const h of ['外观', '朗读', '标注', '数据', 'AI 助手', '授权']) expect(left, h).not.toContain(`<h3>${h}</h3>`);
  });

  it('右列六组：外观、朗读、标注、数据、AI 助手、授权', () => {
    const [, right] = splitCols(html());
    for (const h of ['外观', '朗读', '标注', '数据', 'AI 助手', '授权']) expect(right, h).toContain(`<h3>${h}</h3>`);
    for (const h of ['界面', '版式', '阅读页图标']) expect(right, h).not.toContain(`<h3>${h}</h3>`);
  });

  /* 关于条与快捷键是整页的题头 / 页脚，横跨两栏：
     关进列里会被挤成半宽，也会把两列的高度重新带歪。 */
  it('关于与快捷键都在两列之外', () => {
    const out = html();
    const gridAt = out.indexOf('<div class="bzs-set-grid">');
    expect(out.indexOf('<h3>关于</h3>')).toBeLessThan(gridAt);
    expect(out.indexOf('<h3>界面</h3>')).toBeGreaterThan(gridAt);
    expect(out.indexOf('<h3>快捷键</h3>')).toBeGreaterThan(gridAt);
  });

  /* 窄屏会把两列叠成一列：「左列全部 → 右列全部」必须仍是原来的阅读顺序，
     否则手机上「外观」会掉到「授权」后面。 */
  it('摊平后仍是原来的组分顺序', () => {
    const out = html();
    const order = [...out.matchAll(/<h3>(.*?)<\/h3>/g)].map((m) => m[1]);
    expect(order).toEqual([
      '关于',
      '界面',
      '版式',
      '阅读页图标',
      '外观',
      'PDF',
      '朗读',
      '标注',
      '数据',
      'AI 助手',
      '授权',
      '快捷键',
    ]);
  });
});

/**
 * 「摘录链接」一行的回收（2026-11-05）。
 *
 * 这一档没有任何可操作项，只是一句说明；它讲的双链能力在复制书摘时本来
 * 就生效，占着一行反而让人以为有个开关可调。整行删掉，语言包里的词条
 * 留着（八个包的 key 集合必须一致）。
 */
describe('标注组 · 不再有摘录链接说明', () => {
  /** 截出「标注」组那一段：只看组内，不误判别的组 */
  function marksGroup(out: string): string {
    const start = out.indexOf('<h3>标注</h3>');
    const next = out.indexOf('<h3>', start + 1);
    return out.slice(start, next < 0 ? undefined : next);
  }

  it('整行不见：标签与说明都不再渲染', () => {
    const out = html();
    expect(out).not.toContain('摘录链接');
    expect(out).not.toContain('反链面板也看得见');
  });

  it('同组其余项没被误删：画笔、导出目录、带想法', () => {
    const g = marksGroup(html());
    for (const marker of ['data-act="setpen"', 'data-act="pickexportdir"', 'data-k="exportComments"']) {
      expect(g, marker).toContain(marker);
    }
  });
});

/**
 * 多档位选项按格子下限排行（2026-11-05）。
 *
 * 窄窗下书架内容区只剩 900 左右，两列各 457：语言那排四个一行，每格
 * 只有 75px，「跟随 Obsidian」画到了右边那格上——真机截图是一行字叠一行字。
 * 现在语言、强调色、笔色三组都挂 bzs-seg-wrap，由 CSS 按 88px 的格子下限
 * 算列数（放不下就少一列，不硬挤）。
 *
 * 这里钉的是「三组都拿到了这个类」：以后加档位时漏挂，窄窗那格就又会叠字，
 * 而单测跑得出来，不用等到真机截图。
 */
describe('多档位选项 · 窄窗按格子下限排行', () => {
  /** 截出某一组：从它的 h3 到下一个 h3 */
  function group(out: string, title: string): string {
    const start = out.indexOf(`<h3>${title}</h3>`);
    const next = out.indexOf('<h3>', start + 1);
    expect(start, title).toBeGreaterThan(-1);
    return out.slice(start, next < 0 ? undefined : next);
  }

  it('语言（9 档）、强调色（8 档）、笔色（5 档）都带 bzs-seg-wrap', () => {
    const out = html();
    const cases: Array<[string, string]> = [
      ['界面', 'data-act="setlang"'],
      ['外观', 'data-k="accent"'],
      ['标注', 'data-act="setpen"'],
    ];
    for (const [title, marker] of cases) {
      const g = group(out, title);
      expect(g, title).toContain('class="bzs-seg bzs-seg-wrap"');
      expect(g, title).toContain(marker);
    }
    /* 档位数量没变：wrap 只是排版，不许顺手删档 */
    expect((group(out, '界面').match(/data-act="setlang"/g) ?? []).length).toBe(9);
    expect((group(out, '外观').match(/data-act="setpref" data-k="accent"/g) ?? []).length).toBe(
      ACCENT_OPTIONS.length,
    );
    expect((group(out, '标注').match(/data-act="setpen"/g) ?? []).length).toBe(HIGHLIGHT_COLORS.length);
  });

  it('两档的单行分段不挂 wrap：两端 / 居左仍平分一行', () => {
    const g = group(html(), '版式');
    expect(g).not.toContain('bzs-seg-wrap');
    expect(g).toContain('class="bzs-seg"');
  });
});

/**
 * 调试日志（2026-11-09 发版复核）。
 *
 * 开关只管「抓」，抓到的 JSON 得有一个出口：真机上翻不到数据目录，
 * 只能靠粘贴板带出来。设置页这一行因此必须有一颗复制按钮，
 * 点了走 `debugcopy`（不再只是「写进 debug.json 就没了」）。
 */
describe('调试日志出口', () => {
  it('设置页有「复制调试数据」按钮，接的是 debugcopy', () => {
    const out = html();
    expect(out).toContain('data-act="debugcopy"');
    expect(out).toContain('复制调试数据');
  });
});

/**
 * 赞助人徽章（2026-11-09 立项，2026-11-10 换铜印胶囊）。
 *
 * 商品页承诺「使用此高级版激活码，会额外在插件中标识赞助人身份」。
 * 徽章挂在「关于」条上，只在已激活时出现——基础版不显示，
 * 免得没买的人也被打上标。
 *
 * 2026-11-10 改规则：不再是「高级版 + 赞助人」两枚并排，而是**一枚**——
 * 普通码写「高级版」，赞助人码换成「赞助人」（有昵称就写昵称）。两枚同款，
 * 铜印胶囊；基础版那枚退成中性线框，不画铜印。
 */
describe('赞助人徽章', () => {
  /** 截出「关于」组那一段：只看组内，不误判别的组 */
  function aboutGroup(out: string): string {
    const start = out.indexOf('<h3>关于</h3>');
    const next = out.indexOf('<h3>', start + 1);
    return out.slice(start, next < 0 ? undefined : next);
  }

  it('已激活 + 赞助人：只此一枚，文字换成赞助人', () => {
    entState.unlocked = true;
    entState.patron = true;
    const g = aboutGroup(html());
    expect(g).toContain('is-patron');
    expect(g).toContain('bzs-badge-seal');
    expect(g).not.toContain('高级版');
    entState.patron = false;
    entState.unlocked = false;
  });

  it('已激活的普通码：一枚「高级版」，同样带铜印', () => {
    entState.unlocked = true;
    const g = aboutGroup(html());
    expect(g).toContain('高级版');
    expect(g).toContain('bzs-badge-seal');
    expect(g).not.toContain('is-patron');
    entState.unlocked = false;
  });

  it('已激活但老码没有赞助人：不出现赞助人徽章', () => {
    entState.unlocked = true;
    const g = aboutGroup(html());
    expect(g).not.toContain('is-patron');
    entState.unlocked = false;
  });

  it('基础版即使码里带赞助人也不显示，且不画铜印', () => {
    entState.patron = true;
    const g = aboutGroup(html());
    expect(g).not.toContain('is-patron');
    expect(g).toContain('is-base');
    expect(g).not.toContain('bzs-badge-seal');
    entState.patron = false;
  });

  it('徽章带悬停说明与读屏文字', () => {
    entState.unlocked = true;
    entState.patron = true;
    entState.name = '面包';
    const g = aboutGroup(html());
    expect(g).toContain('title="赞助人"');
    expect(g).toContain('aria-label="赞助人 · 面包"');
    entState.name = '';
    entState.patron = false;
    entState.unlocked = false;
  });

  it('昵称里的引号与尖括号照样转义', () => {
    entState.unlocked = true;
    entState.patron = true;
    entState.name = '"><b>x';
    const g = aboutGroup(html());
    expect(g).not.toContain('"><b>');
    expect(g).toContain('&quot;&gt;&lt;b&gt;');
    entState.name = '';
    entState.patron = false;
    entState.unlocked = false;
  });

  it('授权状态行：赞助人也画一枚小铜印', () => {
    entState.unlocked = true;
    entState.patron = true;
    expect(html()).toContain('bzs-licstat');
    entState.patron = false;
    entState.unlocked = false;
  });

  it('授权状态行：普通码不画铜印', () => {
    entState.unlocked = true;
    expect(html()).not.toContain('bzs-licstat');
    entState.unlocked = false;
  });
});

/**
 * 定制昵称（2026-11-09）。
 *
 * 商品页第二条承诺：想要定制昵称的人加群报名字，另签一枚带 name 的赞助人码。
 * 那枚码的徽章文字直接用昵称；没报名字的批次码仍写「赞助人」。
 */
describe('赞助人徽章 · 定制昵称', () => {
  it('赞助人 + 昵称：徽章文字换成昵称', () => {
    entState.unlocked = true;
    entState.patron = true;
    entState.name = '小明';
    const out = html();
    expect(out).toContain('is-patron');
    expect(out).toContain('>小明<');
    entState.name = '';
    entState.patron = false;
    entState.unlocked = false;
  });

  it('赞助人无昵称：徽章仍写「赞助人」', () => {
    entState.unlocked = true;
    entState.patron = true;
    const out = html();
    expect(out).toContain('>赞助人<');
    entState.patron = false;
    entState.unlocked = false;
  });

  it('普通码带昵称但没 patron：不出徽章', () => {
    entState.unlocked = true;
    entState.name = '小明';
    const out = html();
    expect(out).not.toContain('is-patron');
    entState.name = '';
    entState.unlocked = false;
  });
});

/**
 * 划线颜色（2026-11-10）
 *
 * 设置页这一行不是「一个独立的默认值」，它就是划词条上那四个色点：
 * 点过哪个，这里选中哪个；这里的改动，下次划词、双链、存知识盒都用它。
 * 所以设置页必须**看得见上次用的颜色**，并且说清楚它是同一处。
 */
describe('划线颜色 · 与划词条同一份', () => {
  const selectedPen = (out: string): string[] =>
    Array.from(out.matchAll(/class="on" data-act="setpen" data-v="(\w+)"/g)).map((m) => m[1]);

  it('上次用的颜色在设置页里亮着', () => {
    expect(selectedPen(html(false, DEFAULT_SETTINGS, 'blue'))).toEqual(['blue']);
    expect(selectedPen(html(false, DEFAULT_SETTINGS, 'green'))).toEqual(['green']);
  });

  it('同一时刻只有一个色亮着（不是四选多）', () => {
    expect(selectedPen(html(false, DEFAULT_SETTINGS, 'vermilion'))).toHaveLength(1);
  });

  it('说明写清楚"点色点会记住"，不是一句孤零零的默认值', () => {
    expect(html()).toContain('点划词条上的色点就会记在这里');
  });
});
