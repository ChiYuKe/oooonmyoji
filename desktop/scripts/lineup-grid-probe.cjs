// Offline probe for the lineup result grid geometry (no network, no real browser).
// Usage: electron scripts/lineup-grid-probe.cjs [--align=stretch|start] [--scenario=short|mixed] [--label=name]
const { app, BrowserWindow, protocol } = require('electron');
const fs = require('node:fs'), path = require('node:path'), { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..'), project = path.dirname(root), artifacts = path.join(project, 'artifacts/lineup-probe');
app.disableHardwareAcceleration(); app.commandLine.appendSwitch('in-process-gpu');
app.setPath('userData', path.join(artifacts, 'user-data'));

const flag = name => { const hit = process.argv.find(value => value.startsWith(`--${name}=`)); return hit ? hit.slice(name.length + 3) : ''; };
const align = flag('align') || 'stretch';
const scenario = flag('scenario') || 'mixed';
const label = flag('label') || `${align}-${scenario}`;

const LOREM = [
  '配置在动态置顶 1 一速石的阵容比较缺伤害，只适合御灵，不适合招财猫，配速要求高，无复制可自动切换收尾。',
  '只做前置御魂缘结神，神乐不带技能，晴明不带技能，八百比丘尼带复活，输出只带 2 号位速度。',
  '本攻略适合低配玩家，御魂要求不高，主要是速度与命中的取舍，面板达标即可稳定通关。',
  '',
  '阵容速度要求：一速 158 以上为合格线，二速 145 以下也能运转，输出面板越高越稳。',
  '魂海P1 9秒队伍来自@大肾2023 契灵阵容思路来着@请你凝视我的眼 pve全调/基础版调号（附讲解） 斗技调号（ban阎面队挖土附思维导图） 萌新/回坑玩家指导（包年有效 偏讲解指导不涉及…',
];
const SHORT = [2, 0, 2, 2, 1, 2, 2, 2, 0, 2, 2, 2, 1, 2, 2, 2, 0, 2, 2];
const MIXED = [2, 0, 2, 2, 1, 2, 2, 2, 3, 2, 2, 0, 3, 2, 2, 2, 3, 2, 3];

function buildResults(count, mode) {
  const pattern = mode === 'short' ? SHORT : mode === 'mixed' ? MIXED : null;
  const rows = [];
  for (let index = 0; index < count; index++) {
    const bilibili = index % 6 !== 5;
    const description = pattern && pattern[index % pattern.length] === 3 ? '' : LOREM[index % LOREM.length];
    const minimal = pattern && pattern[index % pattern.length] === 3;
    rows.push({
      bvid: bilibili ? `BV1${String(index).padStart(9, '0')}`.slice(0, 12) : `SRCH-${index.toString(16).padStart(8, '0')}`,
      source: bilibili ? 'bilibili' : 'nga',
      url: bilibili ? `https://www.bilibili.com/video/BV1${String(index).padStart(9, '0')}/` : `https://bbs.nga.cn/read.php?tid=${index}`,
      title: minimal
        ? `【阴阳师】阵容速览 ${index + 1}`
        : index === 18
          ? '【阴阳师】芥子纯大猫 daida · 萌新扫盲！如何使用御魂计算器 + 看不懂图文攻略 + 不会做阵容预设'
          : `【阴阳师】满级御魂 ${3000 + index * 100}+ 全副本预设效果展示 · 第 ${index + 1} 期阵容整理`,
      author: ['是特昂汤啊', 'NinefoldGames', '阴阳师咕咕', '夜神月Lwaite', '阴阳师南笙', 'yys苏打'][index % 6],
      description,
      publishedAt: 1780000000 + index * 86400,
      duration: bilibili ? `${1 + (index % 12)}:${String(10 + index).slice(-2)}`.padStart(4, '0') : '',
      views: 260 + index * 371,
      favorites: 4 + index * 17,
    });
  }
  return rows;
}

app.whenReady().then(async () => {
  fs.mkdirSync(artifacts, { recursive: true });
  protocol.handle('onmyoji-resource', () => new Response('', { status: 404 }));
  const source = fs.readFileSync(path.join(root, 'src/renderer/index.html'), 'utf8');
  const start = source.indexOf('<section id="module-onmyoji-team-builder"');
  const panel = source.slice(start, source.indexOf('<section id="module-reference-viewer"', start));
  const css = fs.readFileSync(path.join(root, 'src/renderer/styles.css'), 'utf8').replace(/^@import[^;]*;/, '');
  const palette = ['workbench-light.css', 'theme.css'].map(name => fs.readFileSync(path.join(root, 'public/theme', name), 'utf8')).join('\n');
  const font = pathToFileURL(path.join(root, 'public/fonts/harmonyos-sans-sc/Regular.css')).href;
  const file = path.join(artifacts, 'lineup-grid.html');
  fs.writeFileSync(file, `<!doctype html><html lang="zh-CN" data-theme="dark"><meta charset="UTF-8"><link rel="stylesheet" href="${font}"><style>${css}\n${palette}\n#module-onmyoji-team-builder{height:100vh}</style><body>${panel}</body></html>`);
  const win = new BrowserWindow({ show: false, width: 1800, height: 1030, webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false, offscreen: true, backgroundThrottling: false } });
  win.webContents.on('console-message', event => { if (event.level === 'error') console.error(event.message); });
  await win.loadFile(file);
  await win.webContents.insertCSS(`.lineup-results { align-items: ${align} !important; }`);
  const report = await win.webContents.executeJavaScript(`(async()=>{
    const {installTeamBuilderPages}=require(${JSON.stringify(path.join(root, 'dist-test-renderer/renderer/shikigami-atlas.js'))});
    const results=${JSON.stringify(buildResults(19, scenario))};
    const api={
      searchLineups:async request=>({results,unavailableSources:[]}),
      openLineupPost:async()=>{}, openLineupUrl:async()=>{}, openLineupSource:async()=>{},
      readLayout:()=>null, writeLayout:()=>{},
    };
    const container=document.getElementById('module-onmyoji-team-builder');
    window.disposePages=installTeamBuilderPages(container,api);
    document.getElementById('team-builder-tab-lineup-browser').click();
    const browser=document.getElementById('team-builder-lineup-browser');
    const grid=browser.querySelector('[data-lineup="results"]');
    for(let attempt=0;attempt<60&&!grid.querySelector('.lineup-card');attempt++)await new Promise(resolve=>setTimeout(resolve,50));
    const gridRect=grid.getBoundingClientRect();
    const cards=Array.from(grid.querySelectorAll('.lineup-card')).map(card=>{
      const rect=card.getBoundingClientRect();
      const actions=card.querySelector('.lineup-card-actions').getBoundingClientRect();
      return {x:Math.round(rect.x),y:Math.round(rect.y),w:Math.round(rect.width),h:Math.round(rect.height),
        actionsY:Math.round(actions.y),
        bottomGap:Math.round(rect.bottom-actions.bottom),
        overflowRight:Math.round(rect.right-gridRect.right), overflowBottom:Math.round(rect.bottom-gridRect.bottom)};
    });
    const rows=new Map();
    for(const card of cards){const key=card.y;if(!rows.has(key))rows.set(key,[]);rows.get(key).push(card);}
    const rowReport=Array.from(rows.entries()).map(([y,list])=>({row:y,heights:Array.from(new Set(list.map(card=>card.h))),actionsY:Array.from(new Set(list.map(card=>card.actionsY))),bottomGap:Array.from(new Set(list.map(card=>card.bottomGap)))}));
    return {
      viewport:{width:innerWidth,height:innerHeight},
      grid:{x:Math.round(gridRect.x),y:Math.round(gridRect.y),w:Math.round(gridRect.width),h:Math.round(gridRect.height),
        scrollW:grid.scrollWidth,clientW:grid.clientWidth,scrollH:grid.scrollHeight,clientH:grid.clientHeight},
      gridColumns:getComputedStyle(grid).gridTemplateColumns,
      cards,
      rows:rowReport,
      outOfBounds:cards.filter(card=>card.overflowRight>0||card.overflowBottom>0),
      gridArea:{x:Math.round(gridRect.x),y:Math.round(gridRect.y),width:Math.round(gridRect.width),height:Math.round(gridRect.height)},
    };
  })()`);
  console.log(`PROBE ${label} ` + JSON.stringify({ gridColumns: report.gridColumns, grid: report.grid, rows: report.rows, outOfBounds: report.outOfBounds }));
  const rect = report.gridArea;
  fs.writeFileSync(path.join(artifacts, `lineup-${label}.png`), (await win.webContents.capturePage({ x: Math.max(0, rect.x - 4), y: Math.max(0, rect.y - 4), width: Math.min(1790, rect.width + 12), height: Math.min(1000, rect.height + 12) })).toPNG());
  win.destroy();
  app.quit();
});
