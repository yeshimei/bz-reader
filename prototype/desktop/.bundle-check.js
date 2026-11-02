/* ==========================================================
   bz 阅读 · Obsidian 内嵌原型 · 核心层（数据 / 状态 / 渲染）
   与 ui.js 拼接进同一个 script 作用域；本文件不绑定事件，
   所有交互元素只带 data-act，由 ui.js 统一委托。

   承载模型（2026-11-03 定）：
     阅读 = 中心原生 tab（可与笔记并排）
     书房 = 另一个中心 tab，内部三页：书库 / 笔记 / 统计
     侧栏 = 左侧栏 leaf，放「书的坐标」：目录 / 书签 / 划线 / AI
     设置 = 原生设置面板（弹层模拟）
   ========================================================== */

/* ─────────── 语料 ─────────── */
const PARAS = [
  '陇西的李征，博学才颖，天宝末年以名进士登第，补江南尉。性狷介，自恃甚高，不甘以贱吏为伍，不久便辞官归田，闭门绝交，专心于诗作。',
  '他认为与其在官场屈膝低眉，不如以诗名流芳百世。可诗名未成，生计先窘，日渐憔悴，唯余一双灼灼的眼。',
  '某夜月下，他忽闻一声低吼，起身推门，山风里立着一虎。那虎竟是他自己，此事他后来只说与最亲近的友人听。',
  '自卑与自尊在他体内日夜厮磨，像两枚不肯相让的印。人一旦把自我看得太重，便再也容不下一件寻常事。',
  '世间原本也不是非黑即白，人心明暗之间，原就没有清楚的界限。所谓清醒，不过是肯承认自己看不清。',
  '子贡在廊下立了很久，直到烛火燃尽。他并不聪敏，却肯把一句问过三遍；仲尼说，汝器也，曰：何器也？曰：瑚琏也。',
  '一味求快，反而什么都没有留下。慢不是迟钝，是把一件事放得比自己更大。',
  '李陵提五千步卒，当单于八万骑，转斗千里，矢尽道穷。人之相知，贵相知心，可朝堂要的从来不是知心。',
  '读书之难，不在字句，在肯把别人的处境放进自己的身体里过一遍。译本再忠实，也译不出那一夜的月光。',
  '词语是有重量的。同一个「归」字，写在边塞与写在江南，落纸的分量并不相同。',
  '他后来常想，若那夜没有出门，会不会仍是江南尉。可人不能两次走进同一片月光。',
  '写作不过是把散落的日子重新排好，让它们互相照见。所谓风格，是一个人反复犹豫之后留下的痕迹。',
  '夜深时书页翻动的声音很轻，像雪落在纸上。时间在这里不催人，只把人慢慢沏开。',
  '凡值得反复看的段落，多半说的不是道理，而是一种处境。我们划线，其实是在替未来的自己留一个座位。',
];

const PENS = [
  { v:'amber',     label:'琥珀', css:'#e8b53a', soft:'rgba(232,181,58,.30)', meaning:'共鸣' },
  { v:'vermilion', label:'朱红', css:'#e2571c', soft:'rgba(226,87,28,.28)',  meaning:'异议' },
  { v:'green',     label:'松绿', css:'#4f9a63', soft:'rgba(79,154,99,.28)',  meaning:'方法' },
  { v:'blue',      label:'黛蓝', css:'#4a83d0', soft:'rgba(74,131,208,.28)', meaning:'存疑' },
];
const IDEA_TYPES = ['笔记','灵感','准备实践','反复看','疑问'];

const BOOKS = [
  { id:'b1', title:'山月记', author:'中岛敦', shelf:'文学', tags:['短篇','日本文学'], format:'EPUB', seed:0,
    bg:'linear-gradient(150deg,#4a3a28,#2c2115)', fg:'#e9dcc3', glyph:'山月',
    desc:'以唐人传奇为骨，写才名、孤绝与自我的变形。八篇短章彼此照见，是那种读完要合上书坐一会儿的书。',
    chapters:['山月记','名人传','弟子','李陵','夫妇','光・风・梦','悟净出世','悟净叹异'],
    percent:62, status:'reading', fav:true, minutes:186, last:'今天' },
  { id:'b2', title:'雪国', author:'川端康成', shelf:'文学', tags:['长篇','日本文学'], format:'EPUB', seed:3,
    bg:'linear-gradient(150deg,#35424a,#1f2830)', fg:'#d7e2e8', glyph:'雪国',
    desc:'穿过县界长长的隧道，便是雪国。驹子与岛村之间那些没有说出口的部分，比说出口的更重。',
    chapters:['序','雪国（一）','雪国（二）','雪国（三）','雪国（四）','终章'],
    percent:100, status:'done', fav:false, minutes:242, last:'10月26日' },
  { id:'b3', title:'人间失格', author:'太宰治', shelf:'文学', tags:['长篇','私小说'], format:'EPUB', seed:6,
    bg:'linear-gradient(150deg,#3a2f33,#241c1f)', fg:'#e3d3d6', glyph:'人间',
    desc:'三张照片与三篇手记，写一个人如何一步步失去做人的资格。读它不宜太晚，也不宜太快。',
    chapters:['第一手记','第二手记','第三手记','三张照片','后记'],
    percent:28, status:'reading', fav:true, minutes:96, last:'昨天' },
  { id:'b4', title:'局外人', author:'加缪', shelf:'文学', tags:['长篇','法国文学'], format:'EPUB', seed:9,
    bg:'linear-gradient(150deg,#47413a,#2a2521)', fg:'#e6dfd2', glyph:'局外',
    desc:'今天，妈妈死了。也许是昨天，我不确定。一个不肯表演悲伤的人，如何被整个世界审判。',
    chapters:['第一部 · 一','第一部 · 二','第一部 · 三','第二部 · 一','第二部 · 二','第二部 · 三'],
    percent:45, status:'reading', fav:false, minutes:74, last:'10月30日' },
  { id:'b5', title:'月亮与六便士', author:'毛姆', shelf:'文学', tags:['长篇','英国文学'], format:'EPUB', seed:12,
    bg:'linear-gradient(150deg,#2f4038,#1c2620)', fg:'#d5e4da', glyph:'月亮',
    desc:'满地都是六便士，他却抬头看见了月亮。一个证券经纪人中年出走画画的故事。',
    chapters:['第一章','第二章','第三章','第四章','第五章','第六章'],
    percent:0, status:'new', fav:false, minutes:0, last:'—' },
  { id:'b6', title:'陶庵梦忆', author:'张岱', shelf:'古典', tags:['小品','明末'], format:'TXT', seed:2,
    bg:'linear-gradient(150deg,#503a2a,#2f2115)', fg:'#ecdcc0', glyph:'陶庵',
    desc:'繁华靡丽，过眼皆空，五十年来，总成一梦。晚明小品里最不肯醒的一本。',
    chapters:['卷一','卷二','卷三','卷四','卷五','卷六'],
    percent:12, status:'reading', fav:false, minutes:38, last:'10月22日' },
  { id:'b7', title:'世说新语', author:'刘义庆', shelf:'古典', tags:['志人','魏晋'], format:'EPUB', seed:5,
    bg:'linear-gradient(150deg,#3c3630,#211d18)', fg:'#ddd3c0', glyph:'世说',
    desc:'三十六门，一千余则，魏晋人怎么说话、怎么生气、怎么在乱世里保持体面。',
    chapters:['德行','言语','政事','文学','方正','雅量','识鉴'],
    percent:83, status:'reading', fav:true, minutes:310, last:'10月29日' },
  { id:'b8', title:'我的天才女友', author:'埃莱娜·费兰特', shelf:'待读', tags:['长篇','意大利'], format:'EPUB', seed:8,
    bg:'linear-gradient(150deg,#55372c,#2f1f18)', fg:'#f0d9cc', glyph:'天才',
    desc:'那不勒斯四部曲的开篇。两个女孩一生的友谊与较劲，从一条街开始。',
    chapters:['引子','童年 · 一','童年 · 二','童年 · 三','青春期 · 一','青春期 · 二'],
    percent:5, status:'new', fav:false, minutes:12, last:'10月18日' },
];

const SHELVES = ['全部','文学','古典','待读'];
const STUDY_PAGES = [['library','书库'],['notes','笔记'],['stats','统计']];
const SHORTCUTS = [
  ['← / →','翻上一页 / 下一页'],['/','搜索（本书 / 全库）'],['f','专注模式（只留正文）'],
  ['b','记一枚书签'],['t','排版面板'],['s','收起 / 展开左侧栏'],
  ['g','书房 ⇄ 阅读'],['m','Book Map 全书鸟瞰'],['r','朗读开关'],
  ['?','帮助与页面导览'],['Esc','关闭浮层 / 退出专注'],
];
const TOUR = [
  ['library','书库','书房 · 封面墙 / 列表 / 书架 / 继续阅读'],
  ['notes','笔记','书房 · 跨书划线想法 / 每日回顾 / 导出'],
  ['stats','统计','书房 · 连续天数 / 热力图 / 年度海报'],
  ['reader','阅读','中心原生 tab · 分页 / 双栏 / 竖排 / 悬浮栏'],
  ['toc','左侧栏','目录 / 书签 / 划线 / AI 四个页签'],
  ['search','搜索','本书全文 / 全库全文 · 命中跳转'],
  ['settings','设置','原生设置面板 · 版式 / 标注 / AI / 快捷键'],
  ['import','导入','拖入 epub / txt，或直接放进笔记库'],
  ['bookmap','Book Map','章节 / 书签 / 划线的一屏鸟瞰'],
  ['film','页面浏览器','像胶片一样缩览全书'],
  ['quote','书摘卡','引文 + 出处 + 可回溯的深链'],
  ['ai','AI 问答','解释 / 翻译 / 摘要，不剧透当前位置之后'],
];

/* ─────────── 状态 ─────────── */
const LS_KEY = 'bz-obsidian-proto-v1';
const S = {
  /* 承载位置 */
  tab:'study', studyPage:'library', leftOpen:true, focus:false,
  /* 阅读位置 */
  bookId:'b1', chapter:2, page:0,
  /* 书库视图 */
  libView:'grid', libSort:'recent', libFilter:'all', libShelf:'全部', libKw:'',
  theme:'ink', sideTab:'toc', parallel:false, parallelId:'b2',
  noteFilter:'all', noteKw:'', reviewIdx:0,
  stats:{ minutesToday:42, pagesToday:12, streak:17, yearDone:12, goal:20, totalMinutes:3180, weekly:[3.2,4.6,2.1,5.4,3.8,6.2,4.4,5.1] },
  settings:{ font:'serif', size:18.5, leading:2.05, width:680, gap:1.55, align:'justify',
             columns:1, vertical:false, mode:'paged', pen:'amber', autoExport:true,
             aiProvider:'本地模型', aiKey:'', aiOn:false, aiNoSpoiler:true,
             ttsRate:1, ttsVoice:'沉静女声', ttsSleep:15, sort:'recent' },
  books: BOOKS.map(b => ({...b})),
  marks:{}, bookmarks:{},
  overlay:null, toastTimer:null,
};
const RT = { sel:null, tts:false, ttsTimer:null, searchKw:'', searchScope:'book', aiMode:'解释', aiLog:[], ideaType:'笔记', dictWord:'' };

/* ─────────── 工具 ─────────── */
function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function $(sel){ return document.querySelector(sel); }
function uid(p){ return p + Math.random().toString(36).slice(2,8); }
function clamp(n,a,b){ return Math.min(b,Math.max(a,n)); }
function penOf(v){ return PENS.find(p=>p.v===v) || PENS[0]; }
function book(id){ return S.books.find(b=>b.id===id) || S.books[0]; }
function totalPages(b){ return b.chapters.length*3; }
function pageNo(){ return S.chapter*3 + S.page; }
function chapterTitle(b,ch){ return b.chapters[ch] || '（未命名章节）'; }
function absOf(ch,pg,i){ return (ch*3+pg)*2+i; }
function relOf(b,abs){ return (abs + b.seed) % PARAS.length; }
function paraAt(b,abs){ return PARAS[relOf(b,abs)]; }
function absToPos(abs){ return { ch:Math.floor(abs/6), pg:Math.floor((abs%6)/2) }; }
function pctOf(b){ return Math.round(((S.chapter*3+S.page+1)/totalPages(b))*100); }
function fmtDate(ts){ const d=new Date(ts); return `${d.getMonth()+1}月${d.getDate()}日`; }
function toast(msg){
  const t=$('#toast'); if(!t)return;
  t.textContent=msg; t.classList.add('on');
  clearTimeout(S.toastTimer); S.toastTimer=setTimeout(()=>t.classList.remove('on'),1900);
}
function save(){
  try{ localStorage.setItem(LS_KEY, JSON.stringify({
    tab:S.tab, studyPage:S.studyPage, leftOpen:S.leftOpen, focus:S.focus,
    theme:S.theme, books:S.books, marks:S.marks, bookmarks:S.bookmarks, stats:S.stats,
    settings:S.settings, chapter:S.chapter, page:S.page, bookId:S.bookId, vocab:S.vocab||[],
  })); }catch(e){}
}
function load(){
  try{
    const raw=localStorage.getItem(LS_KEY); if(!raw)return false;
    const d=JSON.parse(raw);
    if(d.books && Array.isArray(d.books) && d.books.length) S.books=d.books;
    S.theme=d.theme||'ink'; S.marks=d.marks||S.marks; S.bookmarks=d.bookmarks||S.bookmarks;
    if(d.stats)S.stats=d.stats; if(d.settings)Object.assign(S.settings,d.settings);
    S.chapter=d.chapter??2; S.page=d.page??0; S.bookId=d.bookId||'b1'; S.vocab=d.vocab||[];
    S.tab=d.tab||'study'; S.studyPage=d.studyPage||'library';
    S.leftOpen=d.leftOpen!==false; S.focus=!!d.focus && false;
    return true;
  }catch(e){ return false; }
}
function coverHtml(b,cls){
  return `<div class="cov ${cls||''}" style="background:${b.bg};color:${b.fg}"><span class="spine"></span><span class="ct">${esc(b.glyph)}</span></div>`;
}

/* ─────────── 预置数据 ─────────── */
function seed(){
  const defs=[
    ['不甘以贱吏为伍，不久便辞官归田，闭门绝交，专心于诗作。','amber','自恃才高者的孤绝，是从拒绝同流开始的。','笔记'],
    ['世间原本也不是非黑即白，人心明暗之间，原就没有清楚的界限。','blue','','疑问'],
    ['自卑与自尊在他体内日夜厮磨，像两枚不肯相让的印。','amber','','笔记'],
    ['子贡在廊下立了很久，直到烛火燃尽。','vermilion','子贡的笨，是一种忠诚。','反复看'],
    ['一味求快，反而什么都没有留下。','green','做事的节奏感，比聪明要紧。','准备实践'],
    ['李陵提五千步卒，当单于八万骑，转斗千里，矢尽道穷。','amber','明知不可为而为之的惨烈。','笔记'],
    ['词语是有重量的。','blue','','疑问'],
    ['凡值得反复看的段落，多半说的不是道理，而是一种处境。','green','划线是替未来的自己留一个座位。','灵感'],
  ];
  S.marks.b1 = defs.map((d,i)=>{
    const rel = PARAS.findIndex(p=>p.includes(d[0]));
    const abs = rel<0?0:rel;
    return { id:'m'+(i+1), bookId:'b1', abs, ch:absToPos(abs).ch, text:d[0], color:d[1], comment:d[2], type:d[3], date:Date.now()-i*86400000 };
  });
  S.bookmarks.b1 = [
    { id:'k1', bookId:'b1', ch:0, pg:1, label:'山月记', date:Date.now()-6*86400000 },
    { id:'k2', bookId:'b1', ch:1, pg:2, label:'名人传', date:Date.now()-13*86400000 },
    { id:'k3', bookId:'b1', ch:2, pg:0, label:'弟子', date:Date.now()-2*86400000 },
    { id:'k4', bookId:'b1', ch:2, pg:1, label:'弟子', date:Date.now()-1*86400000 },
    { id:'k5', bookId:'b1', ch:4, pg:2, label:'李陵', date:Date.now()-20*86400000 },
  ];
}

/* ─────────── 正文装饰（划线） ─────────── */
function decorate(text, abs, bookId){
  let out = esc(text);
  const ms = (S.marks[bookId]||[]).filter(m=>m.abs===abs && text.includes(m.text)).sort((a,b)=>b.text.length-a.text.length);
  const slots=[];
  ms.forEach((m,i)=>{
    const t=esc(m.text);
    if(out.includes(t)){ out=out.replace(t,`\u0001${i}\u0001`); slots.push(m); }
  });
  slots.forEach((m,i)=>{
    out=out.replace(`\u0001${i}\u0001`,`<mark class="hl${m.comment?' note':''}" style="--c:${penOf(m.color).css};--c-soft:${penOf(m.color).soft}" data-act="hlcard" data-id="${m.id}">${esc(m.text)}</mark>`);
  });
  return out;
}
function sheetHtml(b,ch,pg,opt){
  const paras=[];
  const list = opt.scroll ? Array.from({length:6},(_,i)=>absOf(ch,0,0)+i) : [absOf(ch,pg,0),absOf(ch,pg,1)];
  for(const abs of list){
    const text=paraAt(b,abs);
    paras.push(`<p class="para${opt.first&&abs===list[0]?' first':''}${RT.tts&&abs===list[0]?' speaking':''}" data-abs="${abs}">${decorate(text,abs,b.id)}</p>`);
  }
  const head = (pg===0||opt.scroll) ? `<div class="chhead"><div class="vol">第 ${cn(ch+1)} 章</div><h3>${esc(chapterTitle(b,ch))}</h3><div class="rule"></div></div>` : '';
  const cls=['sheet',S.settings.vertical?'vertical':'',S.settings.columns===2?'two-col':'',S.settings.mode==='scroll'?'scrollmode':''].filter(Boolean).join(' ');
  return `<div class="${cls}">${opt.label?`<span class="plabel">${esc(opt.label)}</span>`:''}${head}${paras.join('')}</div>`;
}
function cn(n){
  const d=['一','二','三','四','五','六','七','八','九','十'];
  if(n<=10)return d[n-1]||String(n);
  if(n<20)return '十'+(d[n-11]||'');
  return String(n);
}

/* ─────────── 图标 ─────────── */
function ico(name){
  const p={
    shelf:'<path d="M3 4h6v16H3zM11 4h4v16h-4zM17 5l3 15"/>',
    read:'<path d="M3 5.5A1.5 1.5 0 014.5 4H9a3 3 0 013 3v12a2.5 2.5 0 00-2.5-2.5H3zM21 5.5A1.5 1.5 0 0019.5 4H15a3 3 0 00-3 3v12a2.5 2.5 0 012.5-2.5H21z"/>',
    search:'<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5.5 5.5"/>',
    import:'<path d="M12 3v11M8 10l4 4 4-4M4 18v2h16v-2"/>',
    theme:'<circle cx="12" cy="12" r="8"/><path d="M12 4v16"/>',
    gear:'<circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.4M12 18.8v2.4M4.4 7.6l2 1.2M17.6 15.2l2 1.2M4.4 16.4l2-1.2M17.6 8.8l2-1.2"/>',
    help:'<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.4a2.5 2.5 0 114 2.1c-.9.7-1.6 1.2-1.6 2.4"/><circle cx="12" cy="17" r=".7" fill="currentColor"/>',
  }[name]||'';
  return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
}

/* ─────────── 骨架渲染 ─────────── */
function applySettings(){
  const app=$('#app'), s=S.settings;
  if(!app)return;
  app.style.setProperty('--rd-size',s.size+'px');
  app.style.setProperty('--rd-leading',String(s.leading));
  app.style.setProperty('--rd-width',s.width+'px');
  app.style.setProperty('--rd-gap',s.gap+'em');
  app.style.setProperty('--rd-align',s.align);
  app.style.setProperty('--rd-font',s.font==='sans'?'var(--sans)':'var(--serif)');
}
function render(){
  document.documentElement.dataset.theme=S.theme;
  const app=$('#app');
  app.classList.toggle('focus',S.focus);
  $('#canvas').classList.toggle('focus',S.focus);
  renderRibbon(); renderLeft(); renderTabs(); renderStage(); renderStatus(); renderOverlay();
  applySettings();
}
function renderRibbon(){
  const top=[
    ['study','shelf','书房'],['reader','read','阅读'],
  ];
  const mid=[['search','search','搜索'],['import','import','导入']];
  const bot=[['theme','theme','换主题'],['help','help','帮助'],['settings','gear','设置']];
  const onState=(go)=>{
    if(go==='study')return S.tab==='study';
    if(go==='reader')return S.tab==='reader';
    return false;
  };
  const btn=(a)=>`<button class="rib${onState(a[0])?' on':''}" data-act="rib" data-go="${a[0]}" title="${a[2]}" aria-label="${a[2]}">${ico(a[1])}</button>`;
  $('#ribbon').innerHTML = top.map(btn).join('')+`<div class="rib-sep"></div>`+mid.map(btn).join('')+
    `<div class="rib-bot">${bot.map(b=>`<button class="rib" data-act="rib" data-go="${b[0]}" title="${b[2]}" aria-label="${b[2]}">${ico(b[1])}</button>`).join('')}</div>`;
}
function renderTabs(){
  const b=book(S.bookId);
  const tab=(k,name,ic)=>`<div class="tab${S.tab===k?' on':''}" data-act="tab" data-go="${k}">
      <span class="tico">${ic}</span><span class="tname">${esc(name)}</span>
      <button class="x" data-act="closetab" data-go="${k}" title="关闭">×</button></div>`;
  $('#tabbar').innerHTML = tab('reader',b.title,'▤') + tab('study','书房','▦') +
    `<span class="sp"></span><button class="tabnew" data-act="tab" data-go="study" title="打开书房">+</button>`;
}
function renderStage(){
  const key=S.tab+'|'+S.studyPage+'|'+S.bookId;
  const box=$('#stage');
  box.innerHTML = S.tab==='reader' ? viewReader() : viewStudy();
  if(key!==renderStage._k){
    const sc=box.querySelector('.stubody')||box.querySelector('.rpages');
    if(sc)sc.scrollTop=0;
    renderStage._k=key;
  }
}
function renderStatus(){
  const marks=Object.values(S.marks).reduce((n,a)=>n+a.length,0);
  const b=book(S.bookId);
  const pos = S.tab==='reader' ? `${esc(b.title)} · 第 ${cn(S.chapter+1)} 章 · ${pctOf(b)}%` : `书房 · ${S.books.length} 本`;
  $('#statusbar').innerHTML=`<span><i class="dot"></i>${pos}</span><span class="sp"></span>
    <span>${marks} 条划线 · ${S.books.filter(x=>x.status==='reading').length} 本在读</span>
    <span class="sp"></span><span>← → 翻页　s 侧栏　f 专注　? 帮助</span>`;
}
function renderLeft(){
  const box=$('#lefts'); if(!box)return;
  box.classList.toggle('hide',!S.leftOpen);
  if(!S.leftOpen)return;
  const b=book(S.bookId);
  const tabs=[['toc','目录',b.chapters.length],['bookmarks','书签',(S.bookmarks[b.id]||[]).length],['highlights','划线',(S.marks[b.id]||[]).length],['ai','AI',0]];
  box.innerHTML=`<div class="lhead"><span class="t">bz 阅读</span><span class="sp"></span><button class="cbtn" data-act="left" title="收起侧栏（s）">‹</button></div>
    <div class="sbhead"><b>${esc(b.title)}</b></div>
    <div class="sbtabs">${tabs.map(t=>`<button class="sbtab${S.sideTab===t[0]?' on':''}" data-act="sbtab" data-tab="${t[0]}">${t[1]}${t[2]?`<span class="n">${t[2]}</span>`:''}</button>`).join('')}</div>
    <div class="sbbody">${sideBody(b)}</div>`;
}
function sideBody(b){
  const tab=S.sideTab;
  if(tab==='toc'){
    let out='';
    b.chapters.forEach((t,i)=>{
      out+=`<button class="chaprow${i===S.chapter?' on':''}" data-act="jumpch" data-ch="${i}"><span class="no">${cn(i+1)}</span><span class="t">${esc(t)}</span><span class="pc">${Math.round(i/b.chapters.length*100)}%</span></button>`;
      if(i===3) out+=`<button class="chaprow d1" data-act="jumpch" data-ch="3"><span class="no">·</span><span class="t">李陵之三 · 归汉</span><span class="pc">53%</span></button>`;
    });
    return `<div class="sbsec">当前 · 第 ${cn(S.chapter+1)} 章</div>${out}`;
  }
  if(tab==='bookmarks'){
    const ks=[...(S.bookmarks[b.id]||[])].sort((a,c)=>a.ch*3+a.pg-(c.ch*3+c.pg));
    if(!ks.length)return `<div class="empty">还没有书签。<br>读到的地方，点阅读栏「签」记一枚。</div>`;
    return `<div class="sbsec">按书中先后</div><div class="timeline">${ks.map(k=>`<div class="mkrow" data-act="jumpbookmark" data-id="${k.id}"><span class="tt">${esc(k.label)}</span><span class="pc">${Math.round((k.ch*3+k.pg+1)/totalPages(b)*100)}%</span><span class="sp"></span><em>${fmtDate(k.date)}</em><button class="x" data-act="delbookmark" data-id="${k.id}" title="删除">×</button></div>`).join('')}</div>`;
  }
  if(tab==='highlights'){
    const ms=S.marks[b.id]||[];
    if(!ms.length)return `<div class="empty">还没有划线。<br>在正文里选中一段文字，浮出的色点里挑一支笔。</div>`;
    const groups={}; ms.forEach(m=>{const t=chapterTitle(b,m.ch);(groups[t]||(groups[t]=[])).push(m);});
    return Object.entries(groups).map(([t,arr])=>`<div class="hlgroup"><div class="hlg-h"><span>${esc(t)}</span><span class="n">${arr.length}</span><span class="ln"></span></div>
      ${arr.map(m=>`<div class="hlit" style="--c:${penOf(m.color).css}" data-act="hlcard" data-id="${m.id}"><span class="tx">${esc(m.text)}</span>${m.comment?`<span class="cm"><b>想法</b>${esc(m.comment)}</span>`:''}<button class="x" data-act="delmark" data-id="${m.id}" title="删除">×</button></div>`).join('')}</div>`).join('');
  }
  const log=RT.aiLog.length?RT.aiLog:[{me:false,tag:'AI · 可由本地模型作答',text:'选中一段文字，点划词浮层里的「AI 解释」；或直接在这本书里问一个问题。回答只会引用你当前位置之前的内容，不剧透后面。'}];
  return `<div class="aichat">${log.map(m=>`<div class="aibubble${m.me?' me':''}"><span class="tag">${m.me?'我':esc(m.tag)}</span>${esc(m.text)}</div>`).join('')}
    <div class="aiask"><input data-role="aiask" placeholder="问这本书…" value=""><button class="btn sm pri" data-act="aiask">问</button></div>
    <div class="mini" style="padding:6px 2px">仅看当前位置之前 · 服务商：${esc(S.settings.aiProvider)}</div></div>`;
}

/* ─────────── 书房外壳 ─────────── */
function viewStudy(){
  const fn={library:viewLibrary,notes:viewNotes,stats:viewStats}[S.studyPage]||viewLibrary;
  const html=fn();
  return `<div class="studio">
    <div class="stuhead">
      <div><div class="kick">bz 阅读</div><h1>书 房</h1></div>
      <nav class="stunav">${STUDY_PAGES.map(p=>`<button class="${S.studyPage===p[0]?'on':''}" data-act="study" data-p="${p[0]}">${p[1]}</button>`).join('')}</nav>
      <span class="sp"></span>
      <div class="stuacts">
        <button class="cbtn" data-act="search" title="搜索（/）">搜</button>
        <button class="btn sm" data-act="import">+ 导入</button>
      </div>
    </div>
    <div class="stubody">${html}</div>
  </div>`;
}

/* ─────────── 书库 ─────────── */
function libBooks(){
  let arr=[...S.books];
  const k=S.libKw.trim().toLowerCase();
  if(k)arr=arr.filter(b=>(b.title+b.author+b.tags.join('')).toLowerCase().includes(k));
  if(S.libShelf!=='全部')arr=arr.filter(b=>b.shelf===S.libShelf);
  if(S.libFilter==='reading')arr=arr.filter(b=>b.status==='reading');
  if(S.libFilter==='done')arr=arr.filter(b=>b.status==='done');
  if(S.libFilter==='new')arr=arr.filter(b=>b.status==='new');
  if(S.libFilter==='fav')arr=arr.filter(b=>b.fav);
  if(S.libSort==='recent')arr.sort((a,b)=>(b.last==='今天'?9:0)-(a.last==='今天'?9:0)||b.percent-a.percent);
  if(S.libSort==='title')arr.sort((a,b)=>a.title.localeCompare(b.title,'zh'));
  if(S.libSort==='progress')arr.sort((a,b)=>b.percent-a.percent);
  return arr;
}
function viewLibrary(){
  const recent=S.books.find(b=>b.status==='reading'&&b.percent>0)||S.books[0];
  const arr=libBooks();
  const cont=`<div class="cont2">${coverHtml(recent,'')}<div class="ci"><div class="kick">继续阅读</div><h2>${esc(recent.title)}</h2><div class="sub">${esc(recent.author)} · 上次读到 ${esc(recent.chapters[Math.floor(recent.percent/100*recent.chapters.length)]||recent.chapters[0])}</div>
    <div class="prog"><div class="bar"><i style="width:${recent.percent}%"></i></div><b>${recent.percent}%</b></div></div>
    <div class="acts"><button class="btn pri" data-act="openbook" data-id="${recent.id}">接着读 ›</button><button class="btn" data-act="detail" data-id="${recent.id}">书籍详情</button></div></div>`;
  const filters=`<div class="filters">
    <div class="well"><svg width="13" height="13" viewBox="0 0 14 14" fill="none"><circle cx="6" cy="6" r="4.4" stroke="currentColor" stroke-width="1.2"/><path d="M9.4 9.4L12.6 12.6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg><input data-role="libkw" placeholder="搜索书名 / 作者 / 标签" value="${esc(S.libKw)}"></div>
    ${[['all','全部'],['reading','在读'],['done','已读'],['new','未读'],['fav','收藏']].map(f=>`<button class="chip${S.libFilter===f[0]?' on':''}" data-act="libfilter" data-v="${f[0]}">${f[1]}</button>`).join('')}
    <span style="flex:1"></span>
    <select data-role="libsort" style="padding:7px 9px"><option value="recent"${S.libSort==='recent'?' selected':''}>最近阅读</option><option value="title"${S.libSort==='title'?' selected':''}>书名</option><option value="progress"${S.libSort==='progress'?' selected':''}>进度</option></select>
    <button class="chip${S.libView==='grid'?' on':''}" data-act="libview" data-v="grid">封面墙</button><button class="chip${S.libView==='list'?' on':''}" data-act="libview" data-v="list">列表</button>
  </div>
  <div style="display:flex;gap:7px;margin-bottom:18px;align-items:center"><span class="mini" style="margin-right:4px">书架</span>${SHELVES.map(s=>`<button class="chip${S.libShelf===s?' on':''}" data-act="shelf" data-v="${s}">${s}</button>`).join('')}<span style="flex:1"></span><span class="mini">${arr.length} 本</span></div>`;
  const body=arr.length?(S.libView==='grid'
    ? `<div class="grid">${arr.map(b=>`<div class="bkcard${b.status==='done'?' is-done':''}" data-act="detail" data-id="${b.id}">
        ${b.status==='done'?`<span class="flag">已读完</span>`:b.fav?`<span class="flag">收藏</span>`:''}
        ${coverHtml(b,'')}<div class="bi"><b>${esc(b.title)}</b><span class="sub">${esc(b.author)}</span><div class="bar"><i style="width:${b.percent}%"></i></div>
        <div class="meta"><span>${b.format} · ${b.last}</span><em>${b.percent>0?b.percent+'%':'—'}</em></div></div>
        <div class="rowacts"><button data-act="openbook" data-id="${b.id}">阅读</button><button data-act="fav" data-id="${b.id}">${b.fav?'取消收藏':'收藏'}</button><button data-act="done" data-id="${b.id}">${b.status==='done'?'标为在读':'标为读完'}</button></div>
      </div>`).join('')}</div>`
    : `<div class="list">${arr.map(b=>`<div class="bkrow2" data-act="detail" data-id="${b.id}">${coverHtml(b,'')}<div class="bi"><b>${esc(b.title)}</b><div class="sub">${esc(b.author)} · ${b.shelf} · ${b.format}</div></div><div class="bar"><i style="width:${b.percent}%"></i></div><span class="pct">${b.percent>0?b.percent+'%':'—'}</span><span class="dt">${b.last}</span></div>`).join('')}</div>`)
    : `<div class="empty">没有匹配的书。换个关键词，或点右上「导入」放一本进来。</div>`;
  return `${cont}${filters}${body}`;
}

/* ─────────── 阅读 ─────────── */
function viewReader(){
  const b=book(S.bookId);
  const tool=`<div class="rtool">
    <div class="meta"><b>${esc(b.title)}</b><span>${esc(b.author)} · 第 ${cn(S.chapter+1)} 章 ${esc(chapterTitle(b,S.chapter))}</span></div>
    <span class="sp"></span>
    <button class="cbtn${S.sideTab==='toc'&&S.leftOpen?' on':''}" data-act="sbtab" data-tab="toc" title="目录（s）">目</button>
    <button class="cbtn" data-act="addbookmark" title="记书签（b）">签</button>
    <button class="cbtn" data-act="search" title="搜索（/）">搜</button>
    <button class="cbtn" data-act="typography" title="排版（t）">字</button>
    <button class="cbtn${S.parallel?' on':''}" data-act="parallel" title="并排阅读">并</button>
    ${S.parallel?`<select data-role="parallelbook" title="对照的另一本书" style="max-width:120px;padding:6px 8px">${S.books.map(x=>`<option value="${x.id}"${x.id===S.parallelId?' selected':''}>${esc(x.title)}</option>`).join('')}</select>`:''}
    <button class="cbtn${RT.tts?' on':''}" data-act="tts" title="朗读（r）">读</button>
    <button class="cbtn" data-act="bookmap" title="Book Map（m）">图</button>
    <button class="cbtn" data-act="film" title="页面浏览器">页</button>
    <button class="cbtn${S.focus?' on':''}" data-act="focus" title="专注模式（f）">专</button>
    <button class="cbtn" data-act="help" title="帮助（?）">?</button>
  </div>`;
  const opt={scroll:S.settings.mode==='scroll',first:true};
  let body;
  if(S.parallel){
    const b2=book(S.parallelId);
    body=`<div class="parallel">${sheetHtml(b,S.chapter,S.page,{...opt,label:b.title})}${sheetHtml(b2,Math.min(S.chapter,b2.chapters.length-1),Math.min(S.page,2),{...opt,label:b2.title})}</div>`;
  } else body=sheetHtml(b,S.chapter,S.page,opt);
  const pct=pctOf(b), done=Math.round((totalPages(b)-pageNo()-1)*1.5);
  const foot=`<div class="rfoot">
    <span class="chap">${esc(chapterTitle(b,S.chapter))}</span>
    <button class="nav" data-act="prev" title="上一页">‹</button>
    <div class="track" data-act="track"><div class="fill" style="width:${pct}%"></div><div class="knob" style="left:${pct}%"></div></div>
    <button class="nav" data-act="next" title="下一页">›</button>
    <span class="pct">${pct}%</span><span class="left">约剩 ${done} 分钟</span>
  </div>`;
  const tts=RT.tts?`<div class="ttsbar"><button data-act="tts" title="暂停/播放">❚❚</button><span class="wave"><i></i><i></i><i></i><i></i><i></i></span><span>朗读中 · 语速 ${S.settings.ttsRate.toFixed(1)}×</span><span class="mini">睡眠 ${S.settings.ttsSleep} 分</span></div>`:'';
  const reopen=!S.leftOpen?`<button class="cbtn" style="position:absolute;right:12px;top:52px;z-index:9" data-act="left" title="展开左侧栏">›</button>`:'';
  return `<div class="reader${S.settings.vertical?' vertical':''}">${tool}${reopen}<div class="rpages">${body}</div>${foot}${tts}</div>`;
}

/* ─────────── 笔记 ─────────── */
function allMarks(){
  const out=[];
  for(const b of S.books)for(const m of (S.marks[b.id]||[]))out.push({b,m});
  return out;
}
function noteCardHtml(b,m,showLoc){
  return `<div class="ncard" style="--c:${penOf(m.color).css}">
    <div class="tx">${esc(m.text)}</div>
    ${m.comment?`<div class="cm"><b>${esc(m.type||'想法')}</b>${esc(m.comment)}</div>`:''}
    ${showLoc!==false?`<div class="loc"><span>${esc(b.title)} · 第 ${cn(m.ch+1)} 章</span><button data-act="jumpmark" data-id="${m.id}" data-book="${b.id}">↪ 回到原文</button><span style="margin-left:auto">${fmtDate(m.date)}</span></div>`:''}
  </div>`;
}
function viewNotes(){
  const all=allMarks();
  const kw=S.noteKw.trim().toLowerCase();
  let arr=all.filter(({b,m})=>(!kw||(m.text+m.comment+b.title).toLowerCase().includes(kw)) && (S.noteFilter==='all'||m.comment||m.color===S.noteFilter));
  const groups={}; arr.forEach(x=>(groups[x.b.id]||(groups[x.b.id]=[])).push(x));
  const review=all.filter(x=>x.m.comment).slice(0,3);
  const rv=review[S.reviewIdx%Math.max(1,review.length)]||review[0];
  const reviewHtml=rv?`<div class="review"><div class="kick">每 日 回 顾</div><h3>今天回来看看这条</h3><div class="q">「${esc(rv.m.text)}」</div>
    <div class="acts"><button class="btn sm" data-act="reviewnext">下一条 ›</button><button class="btn sm" data-act="jumpmark" data-id="${rv.m.id}" data-book="${rv.b.id}">回到原文</button><span class="idx">${S.reviewIdx%review.length+1} / ${review.length}</span></div></div>`:'';
  return `<div class="noteshead">
      <div class="well"><svg width="13" height="13" viewBox="0 0 14 14" fill="none"><circle cx="6" cy="6" r="4.4" stroke="currentColor" stroke-width="1.2"/><path d="M9.4 9.4L12.6 12.6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg><input data-role="notekw" placeholder="搜划线、想法、书名" value="${esc(S.noteKw)}"></div>
      <button class="chip${S.noteFilter==='all'?' on':''}" data-act="notefilter" data-v="all">全部</button>
      <button class="chip${S.noteFilter==='comment'?' on':''}" data-act="notefilter" data-v="comment">有想法</button>
      ${PENS.map(p=>`<button class="chip${S.noteFilter===p.v?' on':''}" data-act="notefilter" data-v="${p.v}"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.css};margin-right:6px"></span>${p.label}</button>`).join('')}
      <span style="flex:1"></span><span class="mini">${arr.length} 条 · ${all.filter(x=>x.m.comment).length} 条想法</span>
      <button class="btn sm pri" data-act="export">导出为 Markdown</button>
    </div>
    ${reviewHtml}
    ${Object.keys(groups).length?Object.entries(groups).map(([id,items])=>`<div class="nbook"><div class="nbook-h"><b>${esc(book(id).title)}</b><span class="mini">${items.length} 条</span><span class="sp"></span><button class="btn sm" data-act="export" data-id="${id}">导出这本</button></div><div class="ngrid">${items.map(x=>noteCardHtml(x.b,x.m,true)).join('')}</div></div>`).join(''):`<div class="empty">没有匹配的标注。去阅读页选中一段文字试试。</div>`}`;
}

/* ─────────── 统计 ─────────── */
function heatHtml(){
  let seed=7,out='';
  for(let i=0;i<140;i++){
    seed=(seed*1103515245+12345)&0x7fffffff;
    let l=seed%5; if(i>132&&i%3===0)l=4; if(i===139)l=4;
    if(i<20)l=Math.max(0,l-1);
    out+=`<i class="l${l}" title="第 ${Math.floor(i/7)+1} 周"></i>`;
  }
  return out;
}
function rankHtml(){
  return S.books.slice().sort((a,b)=>b.minutes-a.minutes).slice(0,5).map(b=>`<div class="r"><span class="nm">${esc(b.title)}</span><div class="bar"><i style="width:${Math.round(b.minutes/310*100)}%"></i></div><em>${b.minutes} 分</em></div>`).join('');
}
function viewStats(){
  const st=S.stats, max=Math.max(...st.weekly);
  const pct=Math.min(100,Math.round(st.yearDone/st.goal*100));
  const C=2*Math.PI*52;
  return `<div class="kpis">
      <div class="k"><b>${st.streak}</b><span>连续阅读 · 天</span></div>
      <div class="k"><b>${st.yearDone}</b><span>今年读完 · 本</span></div>
      <div class="k"><b>${Math.round(st.totalMinutes/60)}</b><span>累计时长 · 小时</span></div>
      <div class="k"><b>${st.pagesToday}</b><span>今日页数 · 页</span></div>
    </div>
    <div class="stats-grid">
      <div class="card goal"><svg width="130" height="130" viewBox="0 0 130 130"><circle cx="65" cy="65" r="52" fill="none" stroke="var(--line)" stroke-width="8"/><circle cx="65" cy="65" r="52" fill="none" stroke="var(--copper)" stroke-width="8" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C*(1-pct/100)}" transform="rotate(-90 65 65)"/><text x="65" y="62" text-anchor="middle" fill="var(--copper)" font-family="Georgia,serif" font-size="24">${pct}%</text><text x="65" y="84" text-anchor="middle" fill="var(--t3)" font-size="10">年度目标</text></svg>
        <div class="gi"><b>${st.yearDone} / ${st.goal} 本</b><span>今年还差 ${Math.max(0,st.goal-st.yearDone)} 本达成目标。<br>按当前速度，预计提前 3 周完成。</span><div style="margin-top:14px"><button class="btn sm" data-act="setgoal">调整目标</button><button class="btn sm" data-act="poster">年度海报</button></div></div></div>
      <div class="card"><div class="sect-h" style="margin:0 0 4px"><b>近 20 周</b><span class="ln"></span></div><div class="heat">${heatHtml()}</div><div class="heat-axis"><span>20 周前</span><span>本周</span></div>
        <div class="mini" style="margin-top:14px;line-height:1.9">格子越亮，那天读得越久。连续 ${st.streak} 天没有断过。</div></div>
      <div class="card"><div class="sect-h" style="margin:0 0 4px"><b>每周时长</b><span class="ln"></span></div><div class="bars">${st.weekly.map((v,i)=>`<div class="b"><i style="height:${Math.round(v/max*100)}%"></i><span>W${i+1}</span></div>`).join('')}</div>
        <div class="kv" style="margin-top:14px"><b>平均翻页速度</b><span>1 页 / 46 秒</span></div><div class="kv"><b>今日时长</b><span>${st.minutesToday} 分钟</span></div></div>
      <div class="card"><div class="sect-h" style="margin:0 0 4px"><b>按书时长</b><span class="ln"></span></div><div class="rank">${rankHtml()}</div></div>
    </div>`;
}

/* ─────────── 设置（原生设置面板） ─────────── */
function segHtml(name,opts,cur){
  return `<div class="seg">${opts.map(o=>`<button class="${cur===o[0]?'on':''}" data-act="set" data-k="${name}" data-v="${o[0]}">${o[1]}</button>`).join('')}</div>`;
}
function rangeHtml(k,label,val,min,max,step,fmt){
  return `<div class="setrow"><label>${label}</label><input type="range" data-role="set" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${val}"><span class="val">${fmt(val)}</span></div>`;
}
function switchHtml(k,on,label){
  return `<div class="setrow"><label>${label}</label><button class="switch${on?' on':''}" data-act="toggle" data-k="${k}" aria-label="${label}"></button></div>`;
}
function settingsBody(){
  const s=S.settings;
  return `<div class="set-grid">
    <div class="setgrp"><h3>版式</h3><p class="hint">衬线管书，无衬线管事；数值直接写进正文。</p>
      <div class="setrow"><label>字体</label>${segHtml('font',[['serif','衬线'],['sans','无衬线']],s.font)}</div>
      ${rangeHtml('size','字号',s.size,15,24,.5,v=>v+'px')}
      ${rangeHtml('leading','行距',s.leading,1.6,2.6,.05,v=>v.toFixed(2))}
      ${rangeHtml('width','行宽',s.width,480,960,20,v=>v+'px')}
      ${rangeHtml('gap','段距',s.gap,1,2.4,.05,v=>v.toFixed(2))}
      <div class="setrow"><label>对齐</label>${segHtml('align',[['justify','两端'],['left','居左']],s.align)}</div>
      <div class="setrow"><label>翻页</label>${segHtml('mode',[['paged','分页'],['scroll','滚动']],s.mode)}</div>
      <div class="setrow"><label>分栏</label>${segHtml('columns_n',[['1','单栏'],['2','双栏']],String(s.columns))}</div>
      ${switchHtml('vertical',s.vertical,'竖排（直排）')}
    </div>
    <div class="setgrp"><h3>外观</h3><p class="hint">三套纸色，一个强调色。主题跟随整个窗口。</p>
      <div class="setrow"><label>主题</label>${segHtml('theme_n',[['ink','墨'],['paper','纸'],['sepia','夜棕']],S.theme)}</div>
      <div class="setrow"><label>强调</label><span style="display:flex;gap:8px;align-items:center;flex:1"><i style="width:16px;height:16px;border-radius:50%;background:var(--copper);display:block"></i><span class="mini">铜金 · 单一强调色</span></span></div>
      <div class="setrow"><label>书库排序</label><select data-role="set" data-k="sort"><option value="recent"${s.sort==='recent'?' selected':''}>最近阅读</option><option value="title"${s.sort==='title'?' selected':''}>书名</option><option value="progress"${s.sort==='progress'?' selected':''}>进度</option></select></div>
      <div class="setrow"><label>进入时</label><span class="mini" style="flex:1">书房 · 书库（书库是唯一入口）</span></div>
      <div class="mini" style="margin-top:12px;line-height:1.9">书籍、进度、标注与设置都留在本地笔记库里；原型用本地存储记住你的改动。</div>
    </div>
    <div class="setgrp"><h3>标注</h3><p class="hint">四支笔各司其职；想法分五类，写过的会自动汇进笔记页。</p>
      <div class="setrow"><label>默认笔色</label><div class="seg">${PENS.map(p=>`<button class="${s.pen===p.v?'on':''}" data-act="set" data-k="pen" data-v="${p.v}"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.css};margin-right:5px"></span>${p.label}</button>`).join('')}</div></div>
      <div class="setrow"><label>想法类型</label><span class="mini" style="flex:1">${IDEA_TYPES.join(' · ')}</span></div>
      ${switchHtml('autoExport',s.autoExport,'划线自动写入摘录笔记')}
      <div class="setrow"><label>摘录链接</label><span class="mini" style="flex:1">Wiki 链接 #cfi=…（可从笔记跳回原文）</span></div>
    </div>
    <div class="setgrp"><h3>AI 与朗读</h3><p class="hint">默认全离线。AI 只在打开后调用，且只发送选中的那一段。</p>
      ${switchHtml('aiOn',s.aiOn,'启用 AI 助手')}
      <div class="setrow"><label>服务商</label><select data-role="set" data-k="aiProvider"><option${s.aiProvider==='本地模型'?' selected':''}>本地模型</option><option${s.aiProvider==='OpenRouter'?' selected':''}>OpenRouter</option><option${s.aiProvider==='OpenAI 兼容'?' selected':''}>OpenAI 兼容</option></select></div>
      <div class="setrow"><label>密钥</label><input type="password" data-role="set" data-k="aiKey" placeholder="留空即不联网" value="${esc(s.aiKey)}" style="flex:1"></div>
      ${switchHtml('aiNoSpoiler',s.aiNoSpoiler,'只看到当前位置之前（防剧透）')}
      ${rangeHtml('ttsRate','语速',s.ttsRate,.6,1.6,.1,v=>v.toFixed(1)+'×')}
      <div class="setrow"><label>音色</label><select data-role="set" data-k="ttsVoice"><option${s.ttsVoice==='沉静女声'?' selected':''}>沉静女声</option><option${s.ttsVoice==='清朗男声'?' selected':''}>清朗男声</option></select></div>
      ${rangeHtml('ttsSleep','睡眠定时',s.ttsSleep,5,60,5,v=>v+'分')}
    </div>
    <div class="setgrp" style="grid-column:1/-1"><h3>快捷键</h3><p class="hint">高频动作练成肌肉记忆，阅读栏只是它们的另一只手。</p>
      <div class="keys">${SHORTCUTS.map(k=>`<div><span>${k[1]}</span><kbd>${k[0]}</kbd></div>`).join('')}</div>
      <div class="srcnote"><b>这一版借鉴的社区做法</b><br>
        Obsidian 社区插件：书架分组、双栏跨页、五色标注与想法类型、摘录导出与深链回溯、防剧透 AI 问答、朗读与阅读仪表盘（EPUB Marginalia / Book Reader / Reading Vault / Tome Reader）。<br>
        Readest：并排对照阅读、整库全文搜索、书内查词翻译。<br>
        KOReader：Book Map 全书鸟瞰、页面浏览器胶片缩览、连续天数与年度海报、导出 Markdown。</div>
    </div>
  </div>`;
}

/* ==========================================================
   bz 阅读 · Obsidian 内嵌原型 · 交互层（事件 / 弹层 / 动作）
   全部用 document 上的事件委托：元素只带 data-act / data-role，
   render() 全量重绘也不会丢事件。
   ========================================================== */

/* ─────────── 弹层 ─────────── */
function modal(title, sub, body, foot, cls){
  return `<div class="scrim" id="scrim"><div class="modal ${cls||''}">
    <div class="mhead"><b>${title}</b><span class="n">${sub||''}</span><span class="sp"></span><button class="x" data-act="close">×</button></div>
    <div class="mbody">${body}</div>
    ${foot?`<div class="mfoot">${foot}</div>`:''}
  </div></div>`;
}
function openOverlay(type,payload){ S.overlay={type,...(payload||{})}; renderOverlay(); }
function closeOverlay(){ S.overlay=null; renderOverlay(); }
function renderOverlay(){
  const root=$('#overlayRoot'); if(!root)return;
  root.innerHTML = S.overlay ? overlayHtml(S.overlay) : '';
  if(S.overlay && S.overlay.type==='search'){
    const inp=root.querySelector('[data-role="searchkw"]'); if(inp)inp.focus();
  }
}
function overlayHtml(o){
  switch(o.type){
    case 'search': return overlaySearch();
    case 'import': return overlayImport();
    case 'typography': return overlayTypography();
    case 'help': return overlayHelp();
    case 'export': return overlayExport(o);
    case 'bookmap': return overlayBookmap();
    case 'film': return overlayFilm();
    case 'quote': return overlayQuote(o);
    case 'idea': return overlayIdea(o);
    case 'hlcard': return overlayHlcard(o);
    case 'ai': return overlayAI(o);
    case 'dict': return overlayDict(o);
    case 'translate': return overlayTranslate(o);
    case 'poster': return overlayPoster();
    case 'setgoal': return overlayGoal();
    case 'reset': return overlayReset();
    case 'detail': return overlayDetail(o);
    case 'settings': return overlaySettings();
    default: return '';
  }
}
function closeBtn(){ return `<span class="sp"></span><button class="btn pri" data-act="close">知道了</button>`; }

function overlaySearch(){
  const scope=RT.searchScope;
  return modal('搜索','本书 / 全库', `
    <div class="search-in"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="6" cy="6" r="4.4" stroke="var(--t3)" stroke-width="1.2"/><path d="M9.4 9.4L12.6 12.6" stroke="var(--t3)" stroke-width="1.2" stroke-linecap="round"/></svg>
      <input data-role="searchkw" placeholder="搜章节名或正文里的词…" value="${esc(RT.searchKw)}"></div>
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px">
      <button class="chip${scope==='book'?' on':''}" data-act="searchscope" data-v="book">本书 · ${esc(book(S.bookId).title)}</button>
      <button class="chip${scope==='all'?' on':''}" data-act="searchscope" data-v="all">全库 · ${S.books.length} 本</button>
      <span class="mini" style="margin-left:auto">命中会切到阅读 tab</span>
    </div>
    <div id="hitlist">${searchHits()}</div>`, '', 'wide tall');
}
function overlayImport(){
  return modal('导入书籍','epub · pdf · txt · mobi · fb2', `
    <div class="drop" data-role="drop"><b>把书拖到这里</b>也可以点下方按钮放一本示例书进来<br><span class="mini">文件会留在笔记库里，卸载插件也读得到</span></div>
    <div class="sect-h"><b>支持的格式</b><span class="ln"></span></div>
    <div class="kv"><b>EPUB / PDF / TXT</b><span>封面、目录、分页与全文搜索</span></div>
    <div class="kv"><b>MOBI / AZW3 / FB2</b><span>自动转换后入库</span></div>
    <div class="kv"><b>OPDS / Calibre</b><span>从在线书库与本地目录拉取</span></div>`,
    `<button class="btn" data-act="addsample">+ 加一本示例书</button>${closeBtn()}`);
}
function overlayTypography(){
  const s=S.settings;
  return modal('排版','改动即时作用于正文', `
    <div class="setgrp flat">
      <div class="setrow"><label>字体</label>${segHtml('font',[['serif','衬线'],['sans','无衬线']],s.font)}</div>
      ${rangeHtml('size','字号',s.size,15,24,.5,v=>v+'px')}
      ${rangeHtml('leading','行距',s.leading,1.6,2.6,.05,v=>v.toFixed(2))}
      ${rangeHtml('width','行宽',s.width,480,960,20,v=>v+'px')}
      <div class="setrow"><label>翻页</label>${segHtml('mode',[['paged','分页'],['scroll','滚动']],s.mode)}</div>
      <div class="setrow"><label>分栏</label>${segHtml('columns_n',[['1','单栏'],['2','双栏']],String(s.columns))}</div>
      <div class="setrow"><label>纸色</label>${segHtml('theme_n',[['ink','墨'],['paper','纸'],['sepia','夜棕']],S.theme)}</div>
      ${switchHtml('vertical',s.vertical,'竖排（直排）')}
    </div>`,
    `<button class="btn" data-act="tour" data-go="settings">完整设置 ›</button>${closeBtn()}`);
}
function overlayHelp(){
  return modal('页面导览','? · 原型功能地图', `
    <div class="sect-h" style="margin-top:0"><b>承载位置与工具</b><span class="ln"></span></div>
    <div class="tour">${TOUR.map(t=>`<button data-act="tour" data-go="${t[0]}"><b>${cn(TOUR.indexOf(t)+1)}</b><div>${t[1]}<span>${esc(t[2])}</span></div></button>`).join('')}</div>
    <div class="sect-h"><b>快捷键</b><span class="ln"></span></div>
    <div class="keys">${SHORTCUTS.map(k=>`<div><span>${k[1]}</span><kbd>${k[0]}</kbd></div>`).join('')}</div>
    <div class="srcnote"><b>这版的社区调研</b><br>
      Obsidian 社区插件：书架集合、双栏跨页、五色标注与想法类型、摘录导出与深链回溯、防剧透 AI、朗读、阅读仪表盘（EPUB Marginalia / Book Reader / Reading Vault / Tome Reader）。<br>
      Readest：并排对照阅读、整库全文搜索、书内查词翻译。<br>
      KOReader：Book Map 全书鸟瞰、页面浏览器、连续天数与年度海报、Markdown 导出。</div>`, closeBtn(), 'wide tall');
}
function overlayExport(o){
  return modal('导出摘录','Markdown 预览', `
    <div class="md">${esc(exportMd(o.bookId))}</div>
    <div class="mini" style="margin-top:10px;line-height:1.9">每条引文都带书名、章节与一条可回溯的深链；关掉「自动导出」后只在这里手动导出。</div>`,
    `<button class="btn" data-act="copymd" data-book="${o.bookId||''}">复制 Markdown</button>${closeBtn()}`, 'wide');
}
function overlayBookmap(){
  const b=book(S.bookId), ms=S.marks[b.id]||[], ks=S.bookmarks[b.id]||[];
  const rows=b.chapters.map((t,i)=>{
    const marks=ms.filter(m=>Math.floor(m.abs/6)===i), bks=ks.filter(k=>k.ch===i);
    const strip=`<div class="strip">${bks.map(k=>`<i style="left:${(k.pg/3)*100}%" title="书签 · ${esc(k.label)}"></i>`).join('')}${marks.map(m=>`<u style="left:${((m.abs%6)/6)*100}%;width:14%;background:${penOf(m.color).css}"></u>`).join('')}</div>`;
    return `<div class="row" data-act="jumpch" data-ch="${i}"><span class="no">${cn(i+1)}</span><span class="nm">${esc(t)}</span>${strip}<span class="mini">3 页 · ${marks.length} 划 · ${bks.length} 签</span></div>`;
  }).join('');
  return modal('Book Map','全书一屏鸟瞰', `<div class="mini" style="margin-bottom:12px">${esc(b.title)} · ${totalPages(b)} 页 · ${ks.length} 枚书签 · ${ms.length} 条划线。菱形是书签，色条是划线，点一行跳到那一章。</div><div class="bmap">${rows}</div>`, closeBtn(), 'wide tall');
}
function overlayFilm(){
  const b=book(S.bookId), n=totalPages(b);
  return modal('页面浏览器','像胶片一样缩览全书', `<div class="film">${Array.from({length:n},(_,i)=>{
    const text=paraAt(b,absOf(Math.floor(i/3),i%3,0));
    return `<button class="${S.chapter*3+S.page===i?' on':''}" data-act="filmpage" data-n="${i}"><b>第 ${i+1} 页 · ${esc(b.chapters[Math.floor(i/3)])}</b>${esc(text.slice(0,30))}…</button>`;
  }).join('')}</div>`, closeBtn(), 'wide tall');
}
function overlayQuote(o){
  const b=book(o.bookId||S.bookId);
  return modal('书摘卡','引文 · 出处 · 深链', `
    <div class="qcard"><div class="q">${esc(o.text)}</div><div class="loc">${esc(b.title)} · ${esc(b.author)} · 第 ${cn((o.ch||0)+1)} 章 · 第 ${(o.pg||0)+1} 页</div><div class="stamp">bz 阅读</div></div>
    <div class="mini" style="margin-top:12px;line-height:1.9">复制后粘到任何笔记里，链接会带 #cfi 定位，字号与分栏变了也能回到同一段。</div>`,
    `<button class="btn" data-act="copyquote" data-text="${esc(o.text)}" data-book="${b.id}" data-ch="${o.ch||0}" data-pg="${o.pg||0}">复制为引用</button>${closeBtn()}`, 'wide');
}
function overlayIdea(o){
  const m=findMark(o.id,o.bookId); if(!m)return modal('想法','', '<div class="empty">这条标注已不存在</div>', closeBtn());
  return modal('写想法', esc(penOf(m.color).label+' · '+chapterTitle(book(o.bookId),m.ch)), `
    <div class="ai-quote">「${esc(m.text)}」</div>
    <div class="types">${IDEA_TYPES.map(t=>`<button class="${RT.ideaType===t?'on':''}" data-act="ideatype" data-v="${t}">${t}</button>`).join('')}</div>
    <textarea class="idea" data-role="idea" placeholder="这一句让你想到了什么…">${esc(m.comment||'')}</textarea>
    <div class="mini" style="margin-top:8px">想法会跟着划线一起出现在左侧栏、笔记页与导出稿里。</div>`,
    `<button class="btn pri" data-act="ideasave" data-id="${m.id}" data-book="${o.bookId}">保存想法</button>${closeBtn()}`, 'wide');
}
function overlayHlcard(o){
  const m=findMark(o.id,o.bookId); if(!m)return modal('标注','', '<div class="empty">这条标注已不存在</div>', closeBtn());
  const b=book(o.bookId);
  return modal('标注', esc(chapterTitle(b,m.ch)), `
    <div class="qcard" style="border-left-color:${penOf(m.color).css}"><div class="q">${esc(m.text)}</div><div class="loc">${esc(b.title)} · 第 ${cn(m.ch+1)} 章 · ${fmtDate(m.date)}</div></div>
    ${m.comment?`<div class="card" style="margin-top:14px"><div class="mini" style="letter-spacing:.24em;color:var(--copper)">${esc(m.type||'想法')}</div><div style="font-size:13px;line-height:1.9;color:var(--ink-2);margin-top:8px">${esc(m.comment)}</div></div>`:''}
    <div class="sect-h"><b>换一支笔</b><span class="ln"></span></div>
    <div style="display:flex;gap:9px">${PENS.map(p=>`<button class="chip${m.color===p.v?' on':''}" data-act="hlcolor" data-id="${m.id}" data-book="${o.bookId}" data-v="${p.v}"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.css};margin-right:6px"></span>${p.label}</button>`).join('')}</div>`,
    `<button class="btn" data-act="hljump" data-id="${m.id}" data-book="${o.bookId}">回到原文</button>
     <button class="btn" data-act="hlidea" data-id="${m.id}" data-book="${o.bookId}">写想法</button>
     <button class="btn" data-act="hlquote" data-id="${m.id}" data-book="${o.bookId}">做成书摘</button>
     <span class="sp"></span><button class="btn danger" data-act="hldel" data-id="${m.id}" data-book="${o.bookId}">删除</button>`, 'wide');
}
function aiAnswer(mode,text){
  if(mode==='翻译')return 'He was too proud to serve among petty clerks, and soon resigned, shut his gate, and gave himself wholly to poetry. 译注：「贱吏」不作 lowly official 的贬译，保留 self-regard 的语气更贴近李征。';
  if(mode==='摘要')return '这一段交代了李征辞官的动机：不是不能做官，是不肯与「贱吏」为伍。才名、孤介与生计三件事同时压上来，为后文的变形埋下伏笔。';
  if(mode==='词源')return '「狷介」出自《论语·子路》「狂者进取，狷者有所不为也」。狷者守得住边界，也正因为守得太紧，才把自己逼到没有退路的地方。';
  return '这里的「辞官」不是洒脱，是一次自我保护：与其在人群里被磨平，不如先把人群关在门外。作者用「闭门绝交」四个字把选择写得很轻，代价却要整篇来还。';
}
function overlayAI(o){
  const modes=['解释','翻译','摘要','词源'];
  return modal('AI · '+o.mode, '仅看当前位置之前 · 不剧透', `
    <div class="ai-tag"><span class="seal">✦</span><b>${esc(S.settings.aiProvider)} · ${esc(o.mode)}</b></div>
    <div class="ai-quote">「${esc(o.text)}」</div>
    <div class="ai-body">${aiAnswer(o.mode,o.text)}</div>
    <div class="ai-src">来源：${esc(book(S.bookId).title)} · 第 ${cn(S.chapter+1)} 章及之前 · <span style="color:var(--copper)">[1]</span> 当前段落　<span style="color:var(--copper)">[2]</span> 本章前文</div>
    <div class="ai-acts">${modes.map(m=>`<button class="chip${o.mode===m?' on':''}" data-act="aimode" data-v="${m}" data-text="${esc(o.text)}">${m}</button>`).join('')}</div>
    ${!S.settings.aiOn?`<div class="mini" style="margin-top:12px">演示回包 · 设置里打开「启用 AI 助手」并填自己的密钥才会真正联网（本地模型可不联网）。</div>`:''}`,
    `<button class="btn" data-act="aisave" data-text="${esc(o.text)}" data-mode="${esc(o.mode)}">存为笔记</button>${closeBtn()}`, 'wide');
}
function overlayDict(o){
  const w=(S.vocab||[]);
  return modal('查词','离线词典 · 可存进生词本', `
    <div class="dict"><div class="w">${esc(o.word)}</div><div class="py">cí · 词语</div>
      <div class="df">在句子里，它指的是「分量」而非重量：同一个字，写在不同处境里，落纸的分量并不相同。<br><br>「在此句中」：作者借它说明书写的取舍——不是选更漂亮的字，是选更压得住那一段的字。</div></div>
    <div class="ai-src">来源：本地词典（约 5.5 MB，一次下载离线可用） · 生词本已有 ${w.length} 词</div>`,
    `<button class="btn" data-act="dictsave" data-word="${esc(o.word)}">加入生词本</button>${closeBtn()}`);
}
function overlayTranslate(o){
  const tr=aiAnswer('翻译',o.text);
  return modal('翻译','段落 · 英译', `<div class="ai-quote">「${esc(o.text)}」</div><div class="ai-body">${tr}</div><div class="ai-src">DeepL 风格演示回包 · 只发送选中的这一段</div>`,
    `<button class="btn" data-act="copytext" data-text="${esc(tr)}">复制译文</button>${closeBtn()}`, 'wide');
}
function overlayPoster(){
  const st=S.stats;
  return modal('年度海报','可以存成一张图', `<div class="poster"><div class="yr">2 0 2 6 · 阅 读 年 报</div>
    <div class="big">${st.yearDone}</div><h2>本读完了</h2>
    <div class="sub">连续 ${st.streak} 天没有断过 · 累计 ${Math.round(st.totalMinutes/60)} 小时<br>最长的一本是《世说新语》，陪了你 310 分钟</div>
    <div style="margin-top:22px;font-family:var(--serif);font-size:12px;letter-spacing:.4em;color:var(--copper)">bz 阅读 · 墨与铜</div></div>`,
    `<button class="btn" data-act="copytext" data-text="2026 阅读年报 · 读完 ${st.yearDone} 本 · 连续 ${st.streak} 天">复制文字版</button>${closeBtn()}`);
}
function overlayGoal(){
  return modal('年度目标','按自己的节奏来', `<div class="setgrp flat">
    <div class="setrow"><label>今年读</label><input type="range" data-role="goal" min="5" max="40" step="1" value="${S.stats.goal}"><span class="val" id="goalval">${S.stats.goal} 本</span></div>
    <div class="mini" style="margin-top:12px;line-height:1.9">已完成 ${S.stats.yearDone} 本。目标只影响仪表盘上的那圈铜线。</div></div>`, closeBtn());
}
function overlayReset(){
  return modal('重置演示数据','会清掉你在这个原型里做的改动', `<div style="font-size:13px;line-height:2;color:var(--t2)">划线、书签、设置、导入的书与统计都会回到初始状态。原型里的书都是示例，删除不会碰你笔记库里的任何文件。</div>`,
    `<span class="sp"></span><button class="btn" data-act="close">取消</button><button class="btn danger" data-act="resetyes">确认重置</button>`);
}

/* 书籍详情：从整页改成弹层，不打断当前 tab */
function overlayDetail(o){
  const b=book(o.id), ms=S.marks[b.id]||[];
  return modal('书籍详情', `${b.format} · ${b.shelf} · ${b.tags.join(' / ')}`, `
    <div class="detail">${coverHtml(b,'')}<div>
      <h2>${esc(b.title)}</h2><div class="au">${esc(b.author)}</div>
      <div class="desc">${esc(b.desc)}</div>
      <div class="acts"><button class="btn pri" data-act="openbook" data-id="${b.id}">开始阅读 ›</button><button class="btn" data-act="fav" data-id="${b.id}">${b.fav?'★ 已收藏':'☆ 收藏'}</button><button class="btn" data-act="done" data-id="${b.id}">${b.status==='done'?'标为在读':'标为读完'}</button></div>
      <div class="kv"><b>阅读进度</b><span>${b.percent}% · 第 ${Math.floor(b.percent/100*totalPages(b))+1} / ${totalPages(b)} 页</span></div>
      <div class="kv"><b>累计时长</b><span>${b.minutes} 分钟</span></div>
      <div class="kv"><b>划线 / 书签</b><span>${ms.length} 条 / ${(S.bookmarks[b.id]||[]).length} 枚</span></div>
      <div class="kv"><b>上次打开</b><span>${b.last}</span></div>
      <div class="sect-h"><b>目 录</b><span class="ln"></span></div>
      <div class="tocmini">${b.chapters.map((t,i)=>`<button class="chip" data-act="detailjump" data-id="${b.id}" data-ch="${i}">${cn(i+1)} · ${esc(t)}</button>`).join('')}</div>
      ${ms.length?`<div class="sect-h"><b>这本书的划线</b><span class="ln"></span></div><div class="ngrid">${ms.slice(0,3).map(m=>noteCardHtml(b,m,false)).join('')}</div>`:''}
    </div></div>`,
    `<button class="btn" data-act="export" data-id="${b.id}">导出这本书的划线</button>${closeBtn()}`, 'wide tall');
}

/* 设置：模拟 Obsidian 原生设置面板（左分类 / 右内容） */
function overlaySettings(){
  const cats=['编辑器','文件与链接','外观','快捷键','核心插件','社区插件','bz 阅读'];
  return `<div class="scrim" id="scrim"><div class="obs-set">
    <div class="oset-side"><div class="oset-t">设 置</div>
      ${cats.map(c=>`<button class="${c==='bz 阅读'?'on':''}" data-act="${c==='bz 阅读'?'noop':'osetother'}">${c}</button>`).join('')}
    </div>
    <div class="oset-main">
      <div class="oset-head"><b>bz 阅读</b><span class="n">v0.1.0 · 本地优先</span><span class="sp"></span><button class="x" data-act="close">×</button></div>
      <div class="oset-body">${settingsBody()}</div>
    </div>
  </div></div>`;
}

/* ─────────── 搜索 ─────────── */
function hi(text,kw){
  try{ return esc(text).replace(new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'gi'), m=>`<em>${m}</em>`); }
  catch(e){ return esc(text); }
}
function searchHits(){
  const kw=RT.searchKw.trim();
  if(!kw)return `<div class="empty">输入关键词，搜章节名与正文。<br>「本书」只搜当前这本，「全库」翻遍所有书。</div>`;
  const bs=RT.searchScope==='book'?[book(S.bookId)]:S.books;
  let out='',count=0;
  for(const b of bs){
    const hits=[],seen=new Set();
    for(let ch=0;ch<b.chapters.length;ch++){
      for(let pg=0;pg<3;pg++)for(let i=0;i<2;i++){
        const abs=absOf(ch,pg,i),text=paraAt(b,abs),key=ch+':'+pg;
        if(seen.has(key))continue;
        if(text.toLowerCase().includes(kw.toLowerCase())||b.chapters[ch].includes(kw)){
          seen.add(key);
          hits.push({ch,pg,text:text.slice(0,72)+'…'});
        }
      }
    }
    if(hits.length){
      count+=hits.length;
      out+=`<div class="hitgroup">${esc(b.title)} · ${hits.length} 处</div>`+hits.slice(0,9).map(h=>
        `<button class="hit" data-act="searchhit" data-book="${b.id}" data-ch="${h.ch}" data-pg="${h.pg}"><span class="loc">第 ${cn(h.ch+1)} 章 · ${esc(b.chapters[h.ch])} · 第 ${h.pg+1} 页</span>${hi(h.text,kw)}</button>`).join('');
    }
  }
  return count?out:`<div class="empty">没有找到「${esc(kw)}」</div>`;
}

/* ─────────── 导出 ─────────── */
function exportMd(bookId){
  const bs=bookId?[book(bookId)]:S.books;
  let md='';
  for(const b of bs){
    const ms=S.marks[b.id]||[]; if(!ms.length)continue;
    md+=`# ${b.title} · 摘录\n\n> ${b.author} · ${b.format}\n\n`;
    const groups={}; ms.forEach(m=>(groups[m.ch]||(groups[m.ch]=[])).push(m));
    for(const ch of Object.keys(groups).sort((a,c)=>a-c)){
      md+=`## ${cn(Number(ch)+1)} · ${b.chapters[ch]}\n\n`;
      for(const m of groups[ch]){
        md+=`> ${m.text}\n\n`;
        if(m.comment)md+=`**${m.type||'想法'}**：${m.comment}\n\n`;
        md+=`— 第 ${Math.floor(m.abs/3)+1} 页 · [↪ 回到原文](obsidian://open?book=${b.id}#cfi=para-${m.abs})\n\n`;
      }
    }
  }
  return md||'（还没有划线。去阅读页选中一段文字试试。）';
}

/* ─────────── 动作 ─────────── */
function findMark(id,bookId){
  for(const bid of Object.keys(S.marks)){
    if(bookId&&bid!==bookId)continue;
    const m=S.marks[bid].find(x=>x.id===id); if(m)return m;
  }
  return null;
}
function copyText(t){ try{ navigator.clipboard.writeText(t); }catch(e){} toast('已复制到剪贴板'); }

/* 承载切换：书房页 / 阅读 tab / 左侧栏 */
function goStudy(p){
  S.tab='study';
  if(p) S.studyPage=p;
  S.focus=false; save(); render();
}
function goReader(){
  S.tab='reader'; S.focus=false; save(); render();
}
function switchTab(k){
  if(k==='study') goStudy(S.studyPage); else goReader();
}
function rib(go){
  if(go==='study'||go==='reader'){ switchTab(go); return; }
  if(go==='search'){ openOverlay('search'); return; }
  if(go==='import'){ openOverlay('import'); return; }
  if(go==='theme'){ cycleTheme(); return; }
  if(go==='help'){ openOverlay('help'); return; }
  if(go==='settings'){ openOverlay('settings'); return; }
}
function closeTab(k){
  S.tab = k==='study' ? 'reader' : 'study';
  save(); render();
}
function gotoPage(n){
  const b=book(S.bookId),tp=totalPages(b);
  n=clamp(n,0,tp-1);
  S.chapter=Math.floor(n/3); S.page=n%3;
  b.percent=pctOf(b); b.last='今天'; save(); render();
}
function goNext(silent){
  if(S.tab!=='reader')return;
  const b=book(S.bookId),n=pageNo()+1;
  if(n>=totalPages(b)){ if(!silent)toast('已经是全书最后一页'); if(RT.tts)toggleTts(); return; }
  S.chapter=Math.floor(n/3); S.page=n%3;
  b.percent=pctOf(b); b.last='今天';
  S.stats.pagesToday++; S.stats.minutesToday+=2;
  save(); render();
}
function goPrev(){
  if(S.tab!=='reader')return;
  const n=pageNo()-1; if(n<0){toast('已经是第一页');return;}
  S.chapter=Math.floor(n/3); S.page=n%3;
  book(S.bookId).percent=pctOf(book(S.bookId)); save(); render();
}
function openBook(id){
  const b=book(id),n=clamp(Math.floor(b.percent/100*totalPages(b)),0,totalPages(b)-1);
  S.bookId=id; S.chapter=Math.floor(n/3); S.page=n%3;
  S.tab='reader'; S.leftOpen=true; S.sideTab='toc'; S.parallel=false; S.focus=false;
  S.overlay=null;
  b.last='今天'; save(); render(); toast('打开《'+b.title+'》 · 回到上次的位置');
}
function cycleTheme(){
  const list=['ink','paper','sepia'];
  S.theme=list[(list.indexOf(S.theme)+1)%list.length]; save(); render();
}
function toggleFocus(){ S.focus=!S.focus; save(); render(); }
function toggleLeft(){ S.leftOpen=!S.leftOpen; save(); render(); }
function addBookmark(){
  const b=book(S.bookId);
  (S.bookmarks[b.id]||(S.bookmarks[b.id]=[])).push({id:uid('k'),bookId:b.id,ch:S.chapter,pg:S.page,label:chapterTitle(b,S.chapter),date:Date.now()});
  S.leftOpen=true; S.sideTab='bookmarks'; save(); render(); toast('已记一枚书签 · 第 '+cn(S.chapter+1)+' 章');
}
function toggleTts(){
  RT.tts=!RT.tts;
  if(RT.tts){
    clearInterval(RT.ttsTimer);
    RT.ttsTimer=setInterval(()=>goNext(true),2600);
    toast('开始朗读 · 逐句推进');
  }else{ clearInterval(RT.ttsTimer); toast('已暂停朗读'); }
  render();
}
function addMark(color){
  const sel=RT.sel; if(!sel)return null;
  const m={id:uid('m'),bookId:sel.bookId,abs:sel.abs,ch:sel.ch,text:sel.text,color,comment:'',type:'笔记',date:Date.now()};
  (S.marks[sel.bookId]||(S.marks[sel.bookId]=[])).push(m);
  try{ window.getSelection().removeAllRanges(); }catch(e){}
  closeSelbar(); save(); render();
  toast('已用'+penOf(color).label+'划线');
  return m;
}
function removeMark(id,bookId){
  if(S.marks[bookId])S.marks[bookId]=S.marks[bookId].filter(m=>m.id!==id);
  save(); render();
}
function jumpToAbs(bookId,abs){
  const p=absToPos(abs);
  S.bookId=bookId; S.chapter=clamp(p.ch,0,book(bookId).chapters.length-1); S.page=p.pg;
  S.tab='reader'; S.leftOpen=true; S.sideTab='highlights'; S.focus=false; save(); render();
}
function addSampleBook(){
  const titles=[['瓦尔登湖','梭罗'],['小王子','圣埃克苏佩里'],['史记·列传','司马迁'],['寂静的春天','蕾切尔·卡森']];
  const t=titles[S.books.length%titles.length];
  const id=uid('b');
  S.books.unshift({ id,title:t[0],author:t[1],shelf:'待读',tags:['新导入'],format:'EPUB',seed:S.books.length%14,
    bg:'linear-gradient(150deg,#3c4438,#222820)',fg:'#dfe6d5',glyph:t[0].slice(0,2),
    desc:'刚导入的书。元数据可以在书籍详情里补全。',
    chapters:['第一章','第二章','第三章','第四章','第五章','第六章'],
    percent:0,status:'new',fav:false,minutes:0,last:'今天' });
  save(); closeOverlay(); S.tab='study'; S.studyPage='library'; render(); toast('《'+t[0]+'》已加入书库');
}
function addBookFromFile(name){
  const ext=(name.split('.').pop()||'EPUB').toUpperCase();
  const title=name.replace(/\.[^.]+$/,'');
  const id=uid('b');
  S.books.unshift({ id,title,author:'未知',shelf:'待读',tags:['新导入'],format:ext,seed:S.books.length%14,
    bg:'linear-gradient(150deg,#4a3a28,#2c2115)',fg:'#e9dcc3',glyph:title.slice(0,2),
    desc:'从笔记库导入的书。封面、目录与元数据会在打开时解析。',
    chapters:['第一章','第二章','第三章','第四章','第五章','第六章'],
    percent:0,status:'new',fav:false,minutes:0,last:'今天' });
  save(); closeOverlay(); S.tab='study'; S.studyPage='library'; render(); toast('《'+title+'》已加入书库');
}
function tourTo(go){
  S.overlay=null;
  if(go==='library'||go==='notes'||go==='stats'){ goStudy(go); return; }
  if(go==='reader'){ goReader(); return; }
  if(go==='toc'){ S.leftOpen=true; S.sideTab='toc'; save(); render(); return; }
  if(go==='settings'){ openOverlay('settings'); return; }
  const demoText=PARAS[0].slice(0,42);
  const payload={search:{},import:{},bookmap:{},film:{},quote:{text:demoText,bookId:S.bookId,ch:S.chapter,pg:S.page},ai:{mode:'解释',text:demoText}};
  S.overlay={type:go,...(payload[go]||{})}; renderOverlay();
}
function actSet(k,v){
  if(k==='theme_n'){ S.theme=v; save(); render(); return; }
  if(k==='columns_n'){ S.settings.columns=Number(v); save(); render(); return; }
  if(k==='sort'){ S.settings.sort=v; S.libSort=v; save(); render(); return; }
  S.settings[k]=v; save(); applySettings();
  if(k==='mode'||k==='font'||k==='align')render();
}
function fmtSetVal(k,v){
  if(k==='size')return Number(v)+'px';
  if(k==='leading'||k==='gap')return Number(v).toFixed(2);
  if(k==='width')return Number(v)+'px';
  if(k==='ttsRate')return Number(v).toFixed(1)+'×';
  if(k==='ttsSleep')return Number(v)+'分';
  return v;
}

/* ─────────── 划词浮层 ─────────── */
function closeSelbar(){ const el=document.getElementById('selbar'); if(el)el.remove(); }
function showSelbar(){
  const sel=window.getSelection();
  if(!sel||sel.isCollapsed)return;
  const text=sel.toString().trim();
  if(text.length<2)return;
  const node=sel.anchorNode&&sel.anchorNode.nodeType===3?sel.anchorNode.parentElement:sel.anchorNode;
  const para=node&&node.closest?node.closest('.para'):null;
  if(!para)return;
  let bar=document.getElementById('selbar');
  if(!bar){ bar=document.createElement('div'); bar.id='selbar'; bar.className='selbar'; $('#app').appendChild(bar); }
  const r=$('#app').getBoundingClientRect(), rect=sel.getRangeAt(0).getBoundingClientRect();
  bar.style.left=(rect.left-r.left+rect.width/2)+'px';
  bar.style.top=(rect.top-r.top-10)+'px';
  bar.style.transform='translate(-50%,-100%)';
  bar.innerHTML=`${PENS.map(p=>`<span class="pendot" data-act="selpen" data-v="${p.v}" title="${p.label} · ${p.meaning}" style="background:${p.css}"></span>`).join('')}
    <span class="div"></span>
    <button class="sbtn" data-act="selidea">想法</button>
    <button class="sbtn" data-act="selquote">书摘</button>
    <button class="sbtn" data-act="seldict">查词</button>
    <button class="sbtn" data-act="seltranslate">翻译</button>
    <button class="sbtn" data-act="selai">AI 解释</button>
    <button class="sbtn" data-act="selcopy">复制</button>`;
  RT.sel={text:sel.toString().trim(),abs:Number(para.dataset.abs),bookId:S.bookId,ch:S.chapter,pg:S.page};
}

/* ─────────── 事件委托 ─────────── */
function onClick(e){
  if(e.target.id==='scrim'){ closeOverlay(); return; }
  const el=e.target.closest('[data-act]');
  if(!el){ if(!e.target.closest('#selbar'))closeSelbar(); return; }
  const a=el.dataset.act, d=el.dataset;
  switch(a){
    case 'noop': break;
    case 'close': closeOverlay(); break;
    /* 承载 */
    case 'rib': rib(d.go); break;
    case 'tab': switchTab(d.go); break;
    case 'closetab': closeTab(d.go); break;
    case 'study': goStudy(d.p); break;
    case 'left': toggleLeft(); break;
    case 'focus': toggleFocus(); break;
    case 'theme': cycleTheme(); break;
    case 'help': openOverlay('help'); break;
    case 'import': openOverlay('import'); break;
    case 'search': openOverlay('search'); break;
    case 'osetother': toast('原型只演示「bz 阅读」这一栏的设置'); break;
    case 'sbtab': S.sideTab=d.tab; S.leftOpen=true; save(); render(); break;
    case 'addbookmark': addBookmark(); break;
    case 'typography': openOverlay('typography'); break;
    case 'parallel': S.parallel=!S.parallel; render(); break;
    case 'tts': toggleTts(); break;
    case 'bookmap': openOverlay('bookmap'); break;
    case 'film': openOverlay('film'); break;
    case 'poster': openOverlay('poster'); break;
    case 'setgoal': openOverlay('setgoal'); break;
    case 'reset': openOverlay('reset'); break;
    case 'resetyes': try{localStorage.removeItem(LS_KEY);}catch(e2){} location.reload(); break;
    case 'tour': tourTo(d.go); break;
    /* 书库 */
    case 'detail': openOverlay('detail',{id:d.id}); break;
    case 'openbook': openBook(d.id); break;
    case 'fav': { const b=book(d.id); b.fav=!b.fav; save(); render(); toast(b.fav?'已收藏':'已取消收藏'); break; }
    case 'done': { const b=book(d.id); b.status=b.status==='done'?'reading':'done'; if(b.status==='done'){b.percent=100;S.stats.yearDone++;} else b.percent=Math.min(b.percent,99); save(); render(); toast(b.status==='done'?'已标记读完':'已标记在读'); break; }
    case 'libfilter': S.libFilter=d.v; renderStage(); break;
    case 'libview': S.libView=d.v; renderStage(); break;
    case 'shelf': S.libShelf=d.v; renderStage(); break;
    case 'detailjump': { const b=book(d.id); closeOverlay(); S.bookId=d.id; S.chapter=Number(d.ch); S.page=0; S.tab='reader'; S.leftOpen=true; S.sideTab='toc'; save(); render(); break; }
    /* 阅读 */
    case 'next': goNext(); break;
    case 'prev': goPrev(); break;
    case 'track': { const tr=el.getBoundingClientRect(), ratio=clamp((e.clientX-tr.left)/tr.width,0,.999); gotoPage(Math.floor(ratio*totalPages(book(S.bookId)))); break; }
    case 'jumpch': closeOverlay(); S.chapter=Number(d.ch); S.page=0; S.tab='reader'; book(S.bookId).percent=pctOf(book(S.bookId)); save(); render(); break;
    case 'jumpbookmark': { const k=(S.bookmarks[book(S.bookId).id]||[]).find(x=>x.id===d.id); if(k){S.tab='reader';S.chapter=k.ch;S.page=k.pg;save();render();toast('跳到书签 · '+k.label);} break; }
    case 'delbookmark': { const id=d.id,bid=book(S.bookId).id; S.bookmarks[bid]=(S.bookmarks[bid]||[]).filter(x=>x.id!==id); save(); render(); toast('书签已删'); break; }
    case 'filmpage': gotoPage(Number(d.n)); closeOverlay(); break;
    /* 标注 */
    case 'hlcard': openOverlay('hlcard',{id:d.id,bookId:d.book||S.bookId}); break;
    case 'delmark': removeMark(d.id,book(S.bookId).id); toast('划线已删'); break;
    case 'hljump': { const m=findMark(d.id,d.book); if(m){closeOverlay();jumpToAbs(d.book,m.abs);} break; }
    case 'hlidea': { const m=findMark(d.id,d.book); if(m){RT.ideaType=m.type||'笔记';openOverlay('idea',{id:d.id,bookId:d.book});} break; }
    case 'hlquote': { const m=findMark(d.id,d.book); if(m)openOverlay('quote',{text:m.text,bookId:d.book,ch:m.ch,pg:absToPos(m.abs).pg}); break; }
    case 'hlcolor': { const m=findMark(d.id,d.book); if(m){m.color=d.v;save();render();toast('换成'+penOf(d.v).label);} break; }
    case 'hldel': { closeOverlay(); removeMark(d.id,d.book); toast('划线已删'); break; }
    case 'ideatype': RT.ideaType=d.v; renderOverlay(); break;
    case 'ideasave': { const m=findMark(d.id,d.book), ta=$('[data-role="idea"]'); if(m){m.comment=ta?ta.value.trim():'';m.type=RT.ideaType;save();closeOverlay();render();toast('想法已保存');} break; }
    case 'jumpmark': { const m=findMark(d.id,d.book); if(m){closeOverlay();jumpToAbs(d.book,m.abs);} break; }
    case 'reviewnext': S.reviewIdx++; renderStage(); break;
    /* 笔记 / 统计 */
    case 'notefilter': S.noteFilter=d.v; renderStage(); break;
    case 'export': openOverlay('export',{bookId:d.id||null}); break;
    case 'copymd': copyText(exportMd(d.book||null)); break;
    case 'copytext': copyText(d.text); break;
    case 'copyquote': copyText(`「${d.text}」\n— ${book(d.book).title} · ${book(d.book).author} · 第 ${cn(Number(d.ch)+1)} 章\n[↪ 回到原文](obsidian://open?book=${d.book}#cfi=para-${d.pg})`); break;
    /* 设置 */
    case 'set': actSet(d.k,d.v); break;
    case 'toggle': S.settings[d.k]=!S.settings[d.k]; save(); render(); break;
    /* 搜索 */
    case 'searchscope': RT.searchScope=d.v; renderOverlay(); break;
    case 'searchhit': { S.bookId=d.book; S.chapter=Number(d.ch); S.page=Number(d.pg); S.tab='reader'; S.focus=false; closeOverlay(); save(); render(); toast('已跳到命中位置'); break; }
    /* 划词 */
    case 'selpen': addMark(d.v); break;
    case 'selidea': { const m=addMark(S.settings.pen); if(m){RT.ideaType='笔记';openOverlay('idea',{id:m.id,bookId:m.bookId});} break; }
    case 'selquote': { if(RT.sel)openOverlay('quote',{text:RT.sel.text,bookId:RT.sel.bookId,ch:RT.sel.ch,pg:RT.sel.pg}); closeSelbar(); break; }
    case 'seldict': { if(RT.sel)openOverlay('dict',{word:RT.sel.text.slice(0,6)}); closeSelbar(); break; }
    case 'seltranslate': { if(RT.sel)openOverlay('translate',{text:RT.sel.text}); closeSelbar(); break; }
    case 'selai': { if(RT.sel)openOverlay('ai',{mode:'解释',text:RT.sel.text}); closeSelbar(); break; }
    case 'selcopy': { if(RT.sel)copyText(RT.sel.text); closeSelbar(); break; }
    /* AI / 词典 / 导入 */
    case 'aimode': S.overlay.mode=d.v; renderOverlay(); break;
    case 'aiask': { const inp=$('[data-role="aiask"]'),q=inp?inp.value.trim():''; if(!q)break;
      RT.aiLog.push({me:true,text:q}); RT.aiLog.push({me:false,tag:'AI · 本地模型',text:aiAnswer('解释',q)+'（仅引用当前位置之前的内容）'});
      if(RT.aiLog.length>8)RT.aiLog=RT.aiLog.slice(-8); render(); break; }
    case 'aisave': { toast('已存进笔记页 · 可导出为 Markdown'); closeOverlay(); break; }
    case 'dictsave': { (S.vocab||(S.vocab=[])).push(d.word); save(); closeOverlay(); toast('「'+d.word+'」已加入生词本'); break; }
    case 'addsample': addSampleBook(); break;
    default: break;
  }
}
function onInput(e){
  const t=e.target, role=t.dataset.role, k=t.dataset.k;
  if(role==='libkw'){ S.libKw=t.value; renderStage(); const n=$('[data-role="libkw"]'); if(n){n.focus();n.setSelectionRange(t.value.length,t.value.length);} return; }
  if(role==='notekw'){ S.noteKw=t.value; renderStage(); const n=$('[data-role="notekw"]'); if(n){n.focus();n.setSelectionRange(t.value.length,t.value.length);} return; }
  if(role==='searchkw'){ RT.searchKw=t.value; const h=$('#hitlist'); if(h)h.innerHTML=searchHits(); return; }
  if(role==='set'){
    const nums=['size','leading','width','gap','ttsRate','ttsSleep'];
    S.settings[k]=nums.includes(k)?Number(t.value):t.value;
    if(k==='sort')S.libSort=t.value;
    applySettings();
    const v=t.parentElement&&t.parentElement.querySelector('.val'); if(v)v.textContent=fmtSetVal(k,t.value);
    save(); if(k==='mode')renderStage(); return;
  }
  if(role==='goal'){ S.stats.goal=Number(t.value); const v=$('#goalval'); if(v)v.textContent=t.value+' 本'; save(); return; }
  if(role==='parallelbook'){ S.parallelId=t.value; render(); return; }
  if(role==='libsort'){ S.libSort=t.value; S.settings.sort=t.value; save(); renderStage(); return; }
  if(role==='idea')return;
}
function onKeydown(e){
  const t=e.target, typing=t&&(t.tagName==='INPUT'||t.tagName==='TEXTAREA'||t.tagName==='SELECT');
  if(e.key==='Escape'){
    if(document.getElementById('selbar')){closeSelbar();return;}
    if(S.overlay){closeOverlay();return;}
    if(S.focus){S.focus=false;save();render();return;}
    return;
  }
  if(typing){
    if(e.key==='Enter'&&t.dataset.role==='aiask'){e.preventDefault();const q=t.value.trim();if(q){RT.aiLog.push({me:true,text:q});RT.aiLog.push({me:false,tag:'AI · 本地模型',text:aiAnswer('解释',q)});render();}}
    return;
  }
  switch(e.key){
    case '/': e.preventDefault(); openOverlay('search'); break;
    case 'f': toggleFocus(); break;
    case 'g': switchTab(S.tab==='study'?'reader':'study'); break;
    case 's': toggleLeft(); break;
    case 'b': if(S.tab==='reader')addBookmark(); break;
    case 't': if(S.tab==='reader')openOverlay('typography'); break;
    case 'm': if(S.tab==='reader')openOverlay('bookmap'); break;
    case 'r': if(S.tab==='reader')toggleTts(); break;
    case '?': openOverlay('help'); break;
    case 'ArrowRight': if(S.tab==='reader'&&!S.overlay){e.preventDefault();goNext();} break;
    case 'ArrowLeft': if(S.tab==='reader'&&!S.overlay){e.preventDefault();goPrev();} break;
  }
}
function onMouseup(e){
  if(e.target.closest('#selbar'))return;
  if(!e.target.closest('.rpages'))return;
  setTimeout(showSelbar,0);
}
function onDrag(e){
  const drop=$('[data-role="drop"]'); if(!drop)return;
  if(e.type==='dragover'){ e.preventDefault(); drop.classList.add('over'); }
  if(e.type==='dragleave'){ drop.classList.remove('over'); }
  if(e.type==='drop'){
    e.preventDefault(); drop.classList.remove('over');
    const f=e.dataTransfer&&e.dataTransfer.files&&e.dataTransfer.files[0];
    if(f)addBookFromFile(f.name);
  }
}
function init(){
  if(!load())seed();
  if(!Object.keys(S.marks).length)seed();
  S.vocab=S.vocab||[];
  render();
  document.addEventListener('click',onClick);
  document.addEventListener('input',onInput);
  document.addEventListener('change',onInput);
  document.addEventListener('keydown',onKeydown);
  document.addEventListener('mouseup',onMouseup);
  document.addEventListener('dragover',onDrag);
  document.addEventListener('dragleave',onDrag);
  document.addEventListener('drop',onDrag);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init); else init();
