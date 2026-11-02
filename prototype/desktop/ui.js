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
