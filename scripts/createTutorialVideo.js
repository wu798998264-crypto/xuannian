const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'tutorial-output');
const SCENE_DIR = path.join(OUT_DIR, 'scenes');
const WIDTH = 1280;
const HEIGHT = 720;

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function sideNav(active) {
  const nav = name => `nav${active === name ? ' on' : ''}`;
  return `<div class="side"><div class="logo">玄</div><div class="${nav('clipboard')}">▣</div><div class="${nav('collection')}">▱</div><div class="side-spacer"></div><div class="${nav('settings')}">⚙</div><div class="nav">◐</div></div>`;
}

function uiClipboard() {
  return `
  <div class="app-ui">
    ${sideNav('clipboard')}
    <div class="work">
      <div class="win">⌖ － □ ×</div>
      <h2>剪切板</h2><p class="hint">所有的剪切和粘贴动作都会被录入，全面留档，防止信息丢失！</p>
      <div class="search">⌕ 搜索剪切板...</div>
      <div class="chips"><b>全部</b><span>文本</span><span>图片</span><span>链接</span><span>文件</span><button>✂</button><button>⌄</button></div>
      <div class="records">
        <div class="record blue"><strong>文本</strong><small>今天 10:12</small><p>客户回复模板：收到，我先确认资料，稍后给你完整方案。</p><em>📌 ☆ 🗑</em></div>
        <div class="record green"><strong>图片</strong><small>今天 10:08</small><div class="thumb">图片内容</div><em>📌 ☆ 🗑</em></div>
        <div class="record purple"><strong>文件</strong><small>今天 10:04</small><div class="file">DOCX<br>项目报价单.docx</div><em>📌 ☆ 🗑</em></div>
      </div>
    </div>
  </div>`;
}

function uiCollection() {
  return `
  <div class="app-ui">
    ${sideNav('collection')}
    <div class="collection-layout">
      <aside class="cat"><div class="cat-actions">☷ ＋</div><div class="cat-item on">常用回复</div><div class="cat-item">提示词库</div><div class="cat-item">文件素材</div></aside>
      <main class="work collection-work">
        <div class="win">⌖ － □ ×</div>
        <h2>收藏</h2><p class="hint">收藏你需要高频复用的指令和文件，收藏剪切板创建或自定义新建。一键复用，安全留存。</p>
        <div class="toolbar"><div class="search">⌕ 搜索收藏...</div><button>＋ 新建收藏</button><button>关闭置顶</button></div>
        <div class="note-card"><b>售后回复</b><p>收到，我会先核对订单和资料，确认后给你处理结果。</p><em>📌 ✎ 🗑</em></div>
        <div class="note-card"><b>绘画提示词</b><p>电影感构图，自然光，高细节，柔和背景。</p><div class="mini-img">参考图</div><em>📌 ✎ 🗑</em></div>
      </main>
    </div>
  </div>`;
}

function uiQuick() {
  return `
  <div class="desktop">
    <div class="input-box">当前光标在微信 / 文档 / 网页输入框中...</div>
    <div class="quick-panel">
      <div class="tabs"><b>剪切板</b><span>收藏</span></div>
      <div class="quick-list">
        <div class="quick-card blue"><b>文本 · 今天 10:12</b><p>客户回复模板：收到，我先确认资料...</p></div>
        <div class="quick-card green"><b>图片 · 今天 10:08</b><p>图片内容</p></div>
        <div class="quick-card purple"><b>文件 · 今天 10:04</b><p>项目报价单.docx</p></div>
      </div>
    </div>
    <div class="auto-tip">快捷窗口专属能力：点击内容后复制；如果光标在输入框中，会自动粘贴。</div>
  </div>`;
}

function uiSticky() {
  return `
  <div class="desktop sticky-demo">
    <div class="floating-note">
      <div class="top-tools"><span>便签</span><button title="图片镜像">⇋</button><button title="图片旋转">↻</button><button title="图片透明">◐</button><i></i><button>✎</button><button>×</button></div>
      <div class="sticky-text">参考文字可以贴在图片上方，边看边用。</div>
      <div class="sticky-image">参考图片</div>
    </div>
  </div>`;
}

function uiSettings() {
  return `
  <div class="app-ui">
    ${sideNav('settings')}
    <div class="work settings-work">
      <div class="win">⌖ － □ ×</div>
      <h2>设置</h2>
      <div class="settings-grid">
        <div class="set-card"><b>自定义存储路径</b><p>C:\\Users\\Administrator\\AppData\\Roaming\\xuannian</p><button>浏览</button></div>
        <div class="set-card"><b>剪切板保存时间（天）</b><p>31　清理缓存</p></div>
        <div class="set-card"><b>快捷窗口快捷键</b><p>Ctrl+Alt+X　查看说明</p></div>
        <div class="set-card"><b>截图快捷键</b><p>Ctrl+Alt+Shift+A</p></div>
        <div class="set-card"><b>快捷新建便签快捷键</b><p>Ctrl+Alt+S　查看说明</p></div>
        <div class="set-card"><b>置顶便签快捷键</b><p>图片镜像 X　图片旋转 R　图片透明 Shift+Wheel</p></div>
      </div>
    </div>
  </div>`;
}

function uiSummary() {
  return `
  <div class="summary-grid">
    <div><b>剪切板</b><span>全面留档</span></div>
    <div><b>收藏</b><span>高频复用</span></div>
    <div><b>快捷窗口</b><span>快速调用，输入框内自动粘贴</span></div>
    <div><b>置顶便签</b><span>桌面参考</span></div>
  </div>`;
}

function mockFor(name) {
  return {
    clipboard: uiClipboard,
    collection: uiCollection,
    quick: uiQuick,
    sticky: uiSticky,
    settings: uiSettings,
    summary: uiSummary,
  }[name]?.() || '';
}

function cursorSvg(x, y) {
  return `<svg class="cursor" style="left:${x}px;top:${y}px" width="34" height="34" viewBox="0 0 34 34">
    <path d="M5 3 28 19 17 21 12 31 5 3Z" fill="#111" opacity=".94"/>
    <path d="M5 3 28 19 17 21 12 31 5 3Z" fill="none" stroke="#fff" stroke-width="2"/>
  </svg>`;
}

function hotspot({ x, y, w, h, label }) {
  return `<div class="hotspot" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px"><span>${label}</span></div>`;
}

function sceneHtml(scene) {
  const bullets = scene.bullets.map(item => `<li>${item}</li>`).join('');
  const marks = (scene.hotspots || []).map(hotspot).join('');
  const cursor = scene.cursor ? cursorSvg(scene.cursor.x, scene.cursor.y) : '';
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box} body{margin:0;width:${WIDTH}px;height:${HEIGHT}px;overflow:hidden;font-family:"Microsoft YaHei","PingFang SC",Arial,sans-serif;background:#f4f3f0;color:#151515}
    .stage{position:relative;width:${WIDTH}px;height:${HEIGHT}px;padding:30px 44px 82px;background:linear-gradient(135deg,#fbfbfa 0%,#efefec 100%)}
    .brand{position:absolute;left:48px;top:28px;display:flex;align-items:center;gap:12px;font-size:18px;font-weight:900;z-index:20}
    .brand-mark{width:34px;height:34px;border-radius:10px;background:#111;display:grid;place-items:center;color:white}
    .title{position:absolute;left:48px;top:82px;width:390px;font-size:36px;line-height:1.14;font-weight:900;z-index:20}
    .subtitle{position:absolute;left:48px;top:180px;width:390px;color:#666;font-size:16px;line-height:1.55;z-index:20}
    .bullets{position:absolute;left:48px;top:270px;width:390px;margin:0;padding:0;list-style:none;display:grid;gap:12px;z-index:20}
    .bullets li{padding:13px 16px;border-radius:15px;background:rgba(255,255,255,.82);border:1px solid rgba(20,20,20,.08);box-shadow:0 8px 18px rgba(0,0,0,.04);font-size:17px;font-weight:900;line-height:1.35}
    .caption{position:absolute;left:48px;right:48px;bottom:24px;min-height:48px;border-radius:16px;background:#171717;color:white;display:flex;align-items:center;justify-content:center;text-align:center;font-size:20px;font-weight:900;padding:8px 22px;z-index:50}
    .mock{position:absolute;right:46px;top:60px;width:735px;height:560px;z-index:10}
    .app-ui{width:100%;height:100%;display:grid;grid-template-columns:62px 1fr;background:#fff;border:1px solid #dfdfdf;border-radius:0;overflow:hidden;box-shadow:0 24px 62px rgba(0,0,0,.16)}
    .side{background:#dedede;display:flex;flex-direction:column;align-items:center;padding:18px 8px;gap:14px}.side-spacer{flex:1}.logo{width:38px;height:38px;border-radius:12px;background:#111;color:white;display:grid;place-items:center;font-weight:900}.nav{width:42px;height:42px;border-radius:12px;display:grid;place-items:center;font-size:20px}.nav.on{background:#eee}
    .work{position:relative;padding:24px 20px;background:#fff;overflow:hidden}.win{position:absolute;right:18px;top:12px;color:#8b8b8b;font-size:14px;letter-spacing:10px}h2{margin:0 0 4px;font-size:32px}.hint{margin:0 0 14px;color:#666;font-size:12px}.search{height:44px;border:1px solid #e4e4e4;background:#f8f8f8;border-radius:13px;padding:12px 16px;color:#777}.chips{display:flex;gap:10px;margin:12px 0 16px;align-items:center}.chips span,.chips b,.chips button{border:1px solid #ddd;border-radius:10px;padding:8px 14px;background:#fff;font-weight:900}.chips b{background:#222;color:#fff}.chips button{margin-left:auto}.chips button+button{margin-left:0}
    .records{display:grid;gap:12px}.record{position:relative;border-radius:16px;background:#f6f6f6;padding:14px 150px 14px 18px;border-left:5px solid #2d7dff}.record.green{border-left-color:#36bf6a}.record.purple{border-left-color:#9c68e8}.record strong{color:#2d7dff}.record.green strong{color:#28a758}.record.purple strong{color:#8c55df}.record small{position:absolute;right:120px;top:14px;color:#777}.record em{position:absolute;right:16px;top:38px;font-style:normal}.record p{margin:8px 0 0}.thumb,.file{margin-top:8px;width:88px;height:58px;border-radius:10px;background:#dde8ff;display:grid;place-items:center;font-size:12px;font-weight:900}.file{background:#fff;border:1px solid #ddd;color:#666}
    .collection-layout{width:100%;height:100%;display:grid;grid-template-columns:190px 1fr;background:#fff;border:1px solid #dfdfdf;overflow:hidden;box-shadow:0 24px 62px rgba(0,0,0,.16)}.cat{background:#f0f0f0;border-right:1px solid #ddd;padding:28px 12px}.cat-actions{font-weight:900;margin-bottom:12px;text-align:right}.cat-item{padding:14px;border-radius:14px;background:#fff;margin-bottom:10px;font-weight:900}.cat-item.on{background:#dcdcdc}.collection-work{box-shadow:none}.toolbar{display:flex;gap:10px;margin:12px 0}.toolbar .search{flex:1}.toolbar button{border:0;border-radius:12px;background:#222;color:#fff;padding:0 14px;font-weight:900}.note-card{position:relative;margin-top:14px;border-radius:16px;background:#f7f7f7;padding:18px 110px 18px 18px}.note-card em{position:absolute;right:16px;top:34px;font-style:normal}.mini-img{width:92px;height:54px;background:#dce8ff;border-radius:9px;display:grid;place-items:center;font-weight:900}
    .desktop{position:relative;width:100%;height:100%;border-radius:22px;background:#ececec;box-shadow:0 24px 62px rgba(0,0,0,.16);overflow:hidden}.input-box{position:absolute;left:55px;top:90px;width:340px;height:70px;border-radius:20px;background:#fff;border:1px solid #ddd;display:flex;align-items:center;padding:0 22px;color:#666;font-weight:900}.auto-tip{position:absolute;left:55px;top:180px;width:300px;border-radius:18px;background:#e9f2ff;border:1px solid #bfd7ff;color:#1e56a8;padding:16px;font-weight:900;line-height:1.5}.quick-panel{position:absolute;right:35px;top:42px;width:340px;height:470px;background:#fff;border-radius:22px;box-shadow:0 18px 50px rgba(0,0,0,.22);overflow:hidden}.tabs{display:grid;grid-template-columns:1fr 1fr;padding:10px;gap:8px;border-bottom:1px solid #e5e5e5}.tabs b,.tabs span{text-align:center;padding:12px;border-radius:12px;font-weight:900}.tabs b{background:#222;color:#fff}.quick-list{padding:14px;display:grid;gap:12px}.quick-card{border-radius:14px;background:#f7f7f7;border-left:4px solid #2d7dff;padding:12px}.quick-card.green{border-left-color:#36bf6a}.quick-card.purple{border-left-color:#9c68e8}.quick-card p{margin:8px 0 0;color:#333}
    .sticky-demo{display:grid;place-items:center}.floating-note{width:360px;min-height:430px;border-radius:20px;background:#fff;box-shadow:0 18px 56px rgba(0,0,0,.22);overflow:hidden}.top-tools{height:42px;display:flex;align-items:center;gap:7px;padding:6px 10px;background:#f5f5f5;font-weight:900}.top-tools i{flex:1}.top-tools button{width:30px;height:30px;border-radius:9px;border:1px solid #ddd;background:#fff}.sticky-text{padding:14px;font-weight:800;line-height:1.5}.sticky-image{margin:0 14px 14px;height:245px;border-radius:14px;background:linear-gradient(135deg,#111,#777);color:white;display:grid;place-items:center;font-size:28px;font-weight:900}
    .settings-work{padding:22px 18px}.settings-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.set-card{min-height:82px;border-radius:16px;background:#f5f5f5;padding:13px 14px;position:relative;overflow:hidden}.set-card b{display:block;color:#666;margin-bottom:9px;font-size:14px}.set-card p{margin:0;background:#fff;border:1px solid #ddd;border-radius:12px;padding:10px 12px;font-size:14px;line-height:1.25}.set-card button{position:absolute;right:16px;bottom:14px;border-radius:11px;background:#222;color:#fff;padding:8px 14px}
    .summary-grid{position:absolute;right:85px;top:110px;width:600px;display:grid;grid-template-columns:1fr 1fr;gap:18px}.summary-grid div{height:170px;border-radius:24px;background:#fff;box-shadow:0 16px 42px rgba(0,0,0,.12);display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:20px}.summary-grid b{font-size:30px}.summary-grid span{margin-top:12px;color:#666;font-size:18px;font-weight:900}
    .hotspot{position:absolute;border:4px solid #2f7df6;border-radius:16px;z-index:40;box-shadow:0 0 0 9999px rgba(0,0,0,.04)}.hotspot span{position:absolute;left:12px;top:-38px;background:#2f7df6;color:white;border-radius:999px;padding:7px 13px;font-size:15px;font-weight:900;white-space:nowrap}.cursor{position:absolute;z-index:45;filter:drop-shadow(0 7px 8px rgba(0,0,0,.28))}
  </style></head><body><div class="stage"><div class="brand"><div class="brand-mark">玄</div>玄念 4.0</div><div class="title">${scene.title}</div><div class="subtitle">${scene.subtitle}</div><ul class="bullets">${bullets}</ul><div class="mock">${mockFor(scene.mock)}</div>${marks}${cursor}<div class="caption">${scene.caption}</div></div></body></html>`;
}

const scenes = [
  { mock:'clipboard', title:'玄念 4.0 快速上手', subtitle:'把复制记录、常用收藏和桌面参考内容放到一个轻量工具里。', bullets:['剪切板：自动留档，防止信息丢失','收藏：高频内容一键复用','置顶便签：把参考内容贴在桌面上'], caption:'玄念 4.0 主要围绕剪切板、收藏、快捷窗口和置顶便签展开。', duration:8 },
  { mock:'clipboard', title:'剪切板：全面留档', subtitle:'复制和剪切过的内容会自动进入剪切板，后续可以搜索、筛选、重新复制。', bullets:['支持文本、图片、链接、文件','可按类型筛选，也可搜索历史','重要内容可收藏或直接置顶'], hotspots:[{x:580,y:214,w:355,h:42,label:'类型筛选'},{x:582,y:280,w:632,h:328,label:'历史内容'},{x:1117,y:216,w:46,h:42,label:'截图'}], cursor:{x:1190,y:220}, caption:'剪切板负责全面留档，帮助找回刚才复制过的重要内容。', duration:12 },
  { mock:'collection', title:'收藏：高频复用', subtitle:'收藏用于长期保存经常要发、经常要用的文字、图片、文件或组合内容。', bullets:['从剪切板收藏，也可手动新建','分类管理，搜索调用','点击收藏内容即可复制复用'], hotspots:[{x:565,y:102,w:190,h:510,label:'收藏分类'},{x:770,y:237,w:445,h:310,label:'收藏内容'}], cursor:{x:1110,y:350}, caption:'收藏负责高频复用，适合常用回复、提示词和文件素材。', duration:12 },
  { mock:'quick', title:'快捷窗口：真正的快速调用', subtitle:'默认按 Ctrl + Alt + X，在鼠标附近打开快捷窗口。', bullets:['快速访问剪切板和收藏','点击内容即可复制','光标在输入框中时，快捷窗口可自动粘贴'], hotspots:[{x:858,y:100,w:340,h:470,label:'快捷窗口'}], cursor:{x:998,y:250}, caption:'注意：自动粘贴只属于快捷窗口功能，主窗口主要是点击复制。', duration:14 },
  { mock:'sticky', title:'置顶便签：桌面参考', subtitle:'把文字、图片、文件或截图直接贴在桌面上，边看边用。', bullets:['可从剪切板、收藏、截图结果置顶','也可按 Ctrl + Alt + S 快捷新建','图片支持镜像、旋转和透明度调节'], hotspots:[{x:736,y:132,w:102,h:32,label:'图片工具'},{x:970,y:132,w:68,h:32,label:'编辑 / 关闭'}], cursor:{x:792,y:126}, caption:'置顶便签适合参考图、临时资料和对照内容。', duration:13 },
  { mock:'clipboard', title:'截图也能快速置顶', subtitle:'在剪切板页面点击截图按钮，选择区域后保存到剪切板。', bullets:['选择区域截图','保存到剪切板历史','可一键生成桌面置顶便签'], hotspots:[{x:1117,y:216,w:46,h:42,label:'剪切板截图按钮'}], cursor:{x:1188,y:218}, caption:'截图置顶适合临时参考网页、聊天记录、图片素材和资料片段。', duration:10 },
  { mock:'settings', title:'设置：按自己的习惯使用', subtitle:'常用快捷键和保存策略都可以在设置里调整。', bullets:['设置存储路径和剪切板保存时间','修改快捷窗口、截图、快捷新建便签快捷键','置顶便签图片工具支持自定义快捷键'], hotspots:[{x:575,y:235,w:645,h:218,label:'快捷键设置'},{x:900,y:340,w:315,h:112,label:'置顶便签快捷键'}], cursor:{x:930,y:405}, caption:'设置完成后，玄念会在托盘后台运行，随时响应复制和快捷窗口。', duration:12 },
  { mock:'summary', title:'最后总结', subtitle:'记住这四个入口，就能快速理解玄念。', bullets:['剪切板：全面留档','收藏：高频复用','快捷窗口：快速调用和自动粘贴','置顶便签：桌面参考'], caption:'玄念 4.0：记录、复用、置顶参考，减少重复操作。', duration:9 },
];

async function renderScene(win, scene, index) {
  await win.webContents.executeJavaScript(`document.open();document.write(${JSON.stringify(sceneHtml(scene))});document.close();`);
  await delay(250);
  const image = await win.webContents.capturePage();
  const out = path.join(SCENE_DIR, `scene_${String(index + 1).padStart(2, '0')}.png`);
  fs.writeFileSync(out, image.toPNG());
  return out;
}

async function main() {
  ensureDir(OUT_DIR);
  ensureDir(SCENE_DIR);
  const win = new BrowserWindow({
    show: false,
    frame: false,
    useContentSize: true,
    width: WIDTH,
    height: HEIGHT,
    backgroundColor: '#f4f3f0',
    webPreferences: { contextIsolation: false, nodeIntegration: false, backgroundThrottling: false },
  });
  await win.loadURL('about:blank');
  const rendered = [];
  for (let i = 0; i < scenes.length; i += 1) {
    rendered.push({ file: await renderScene(win, scenes[i], i), duration: scenes[i].duration });
  }
  win.destroy();
  const concatPath = path.join(OUT_DIR, 'tutorial-scenes.txt');
  const lines = [];
  for (const item of rendered) {
    lines.push(`file '${item.file.replace(/\\/g, '/')}'`);
    lines.push(`duration ${item.duration}`);
  }
  lines.push(`file '${rendered[rendered.length - 1].file.replace(/\\/g, '/')}'`);
  fs.writeFileSync(concatPath, lines.join('\n'), 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, 'tutorial-meta.json'), JSON.stringify({ scenes, rendered, concatPath }, null, 2), 'utf8');
  console.log(JSON.stringify({ outDir: OUT_DIR, concatPath, rendered }, null, 2));
}

app.whenReady().then(main).then(() => app.quit()).catch(error => {
  console.error(error);
  app.quit();
  process.exitCode = 1;
});
