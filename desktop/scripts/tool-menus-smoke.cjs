// Actual shell markup, styles and menu controllers in an isolated Electron window.
// No host bridge, workflow edits, or device connection.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const artifacts = path.join(path.dirname(root), 'artifacts', 'tool-menus');
app.disableHardwareAcceleration();
app.setPath('userData', path.join(artifacts, 'user-data'));
app.commandLine.appendSwitch('in-process-gpu');
const pause = () => new Promise(resolve => setTimeout(resolve, 190));

app.whenReady().then(async () => {
  fs.mkdirSync(artifacts, { recursive: true });
  let html = fs.readFileSync(path.join(root, 'src/renderer/index.html'), 'utf8')
    .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/g, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '')
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/g, '')
    .replace(/href="\/([^"]+)"/g, (_, file) => `href="${pathToFileURL(path.join(root, 'public', file))}"`);
  const css = fs.readFileSync(path.join(root, 'src/renderer/styles.css'), 'utf8').replace(/^@import[^;]*;/, '');
  html = html.replace('<head>', `<head><style>${css}</style>`).replace('<html lang="zh-CN">', '<html lang="zh-CN" data-theme="dark">');
  html = html.replace('src="./assets/onmyoji-icon.png"', `src="${pathToFileURL(path.join(root,'src/renderer/assets/onmyoji-icon.png'))}"`);
  const fixture = path.join(artifacts, 'toolbar.html');
  fs.writeFileSync(fixture, html);
  const win = new BrowserWindow({ show: false, width: 1060, height: 480, webPreferences: {
    nodeIntegration: true, contextIsolation: false, sandbox: false, offscreen: true, backgroundThrottling: false,
  } });
  win.webContents.on('console-message', event => { if (event.level === 'error') console.error(event.message); });
  await win.loadFile(fixture);
  win.webContents.debugger.attach('1.3');
  await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
  const run = code => win.webContents.executeJavaScript(code);
  await run(`(() => {
    const titlebar = document.querySelector('.custom-titlebar');
    const module = document.getElementById('module-workbench');
    document.body.replaceChildren(titlebar, module);
    module.style.cssText = 'display:block;height:calc(100vh - 32px);overflow:visible';
    titlebar.style.height = '32px';
    module.querySelector('.dock-workspace-shell').style.height = '390px';
    const { createIcons, icons } = require(${JSON.stringify(path.join(root, 'node_modules/lucide'))});
    createIcons({ icons });
    const base = ${JSON.stringify(path.join(root, 'dist-test-renderer/renderer'))};
    const { installToolMenus } = require(base + '/tool-menus.js');
    const { createTitlebarMenus } = require(base + '/titlebar-menus.js');
    const { createInstancePicker } = require(base + '/instance-picker.js');
    window.actions = [];
    window.titlebarMenus = createTitlebarMenus(type => actions.push(type));
    installToolMenus(titlebarMenus.close);
    document.addEventListener('click', titlebarMenus.close);
    document.querySelectorAll('[data-editor-command]').forEach(button => button.addEventListener('click', () => actions.push(button.dataset.editorCommand)));
    const more = document.getElementById('more-button');
    more.addEventListener('click', event => { event.stopPropagation(); titlebarMenus.toggleMore(more); });
    let selected = 'one';
    const instances = [{id:'one',displayName:'扫地工 · MuMu 0'}, {id:'two',displayName:'吃鱼 · MuMu 1'}];
    window.picker = createInstancePicker({picker:document.getElementById('instance-picker'),trigger:document.getElementById('instance-select'),triggerLabel:document.getElementById('instance-select-label'),menu:document.getElementById('instance-menu')}, id => { selected=id; picker.close(); picker.update(instances, selected); });
    picker.render(instances, selected); picker.install(() => selected);
    document.getElementById('instance-select').addEventListener('click', titlebarMenus.close);
    document.addEventListener('keydown', event => { if(event.key==='Escape') { titlebarMenus.close(); picker.close(true); } });
    const { installTitlebarMenuBar } = require(base + '/titlebar-menus.js');
    installTitlebarMenuBar(() => titlebarMenus.close());
    window.assert = require('node:assert/strict');
    window.arrow = index => getComputedStyle(document.querySelectorAll('.tool-menu-chevron')[index]).transform;
    window.closedArrow = arrow(0);
    window.checkSpacing = selector => {
      const items=[...document.querySelector(selector).querySelectorAll('button,option')];
      assert.ok(items.length>=2,selector);
      const first=items[0].getBoundingClientRect(), second=items[1].getBoundingClientRect();
      assert.ok(second.top-first.bottom>=3, selector+' adjacent highlight gap');
    };
    const { dropdown } = require(${JSON.stringify(path.join(root, 'dist-test-renderer/canvas/ui/elements.js'))});
    const demo = dropdown({value:'one',options:[{value:'one',label:'选项一'},{value:'two',label:'选项二'}],onChange:value=>actions.push(value)});
    demo.id='shared-dropdown'; demo.style.cssText='position:absolute;left:800px;top:110px;width:170px'; module.append(demo);
    const native=document.createElement('select');native.id='native-picker';native.style.cssText='position:absolute;left:800px;top:180px;width:170px';native.innerHTML='<option>默认顺序</option><option>等级</option>';module.append(native);
  })()`);
  const point = selector => run(`(() => { const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}; })()`);
  const click = async selector => {
    const p = await point(selector);
    win.webContents.sendInputEvent({ type:'mouseMove', ...p });
    win.webContents.sendInputEvent({ type:'mouseDown', button:'left', clickCount:1, ...p });
    win.webContents.sendInputEvent({ type:'mouseUp', button:'left', clickCount:1, ...p });
    await pause();
  };
  const escape = async () => { win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'}); win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'}); await pause(); };
  const capture = async name => fs.writeFileSync(path.join(artifacts,name), (await win.webContents.capturePage()).toPNG());
  await pause();
  const triggerPoint = await point('.tool-overflow:nth-of-type(1) summary');
  win.webContents.sendInputEvent({type:'mouseMove',...triggerPoint}); await pause();
  const hoverFill = await run(`getComputedStyle(document.querySelector('.tool-menu-trigger')).backgroundColor`);
  win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...triggerPoint}); await pause();
  await run(`assert.notEqual(getComputedStyle(document.querySelector('.tool-menu-trigger')).backgroundColor,${JSON.stringify(hoverFill)});`);
  win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...triggerPoint}); await pause();
  await run(`assert.equal(document.querySelectorAll('.tool-overflow')[0].open,true); assert.notEqual(arrow(0),closedArrow); assert.equal(document.querySelectorAll('.tool-overflow')[1].open,false);`);
  await run(`checkSpacing('.tool-overflow[open] .tool-menu');`);
  await capture('add-nodes-dark.png');
  await click('.tool-group:nth-of-type(2) summary');
  await run(`assert.equal(document.querySelectorAll('.tool-overflow')[0].open,false); assert.equal(document.querySelectorAll('.tool-overflow')[1].open,true); assert.equal(arrow(0),closedArrow); assert.notEqual(arrow(1),closedArrow);`);
  await capture('tools-dark.png');
  await click('.tool-menu [data-editor-command="exportImage"]');
  await run(`assert.equal(document.querySelectorAll('.tool-overflow')[1].open,false); assert.ok(actions.includes('exportImage'));`);
  await click('.tool-group:nth-of-type(2) summary');
  await escape();
  await run(`assert.equal(document.querySelectorAll('.tool-overflow')[1].open,false); assert.equal(document.activeElement,document.querySelectorAll('.tool-overflow summary')[1]);`);
  await click('.tool-group:nth-of-type(2) summary');
  await click('#dock-workspace');
  await run(`assert.ok([...document.querySelectorAll('.tool-overflow')].every(menu=>!menu.open));`);
  await click('#more-button svg');
  await run(`assert.equal(document.getElementById('more-button').getAttribute('aria-expanded'),'true');`);
  await run(`checkSpacing('.desktop-more-menu');`);
  await capture('more-dark.png');
  // A child icon is part of the trigger: a second click must collapse, not reopen.
  await click('#more-button svg');
  await run(`assert.equal(document.getElementById('more-button').getAttribute('aria-expanded'),'false'); assert.equal(document.querySelector('.desktop-more-menu'),null);`);
  await click('#instance-select');
  await run(`assert.equal(document.getElementById('instance-menu').hidden,false);assert.equal(document.getElementById('instance-select').getAttribute('aria-expanded'),'true');`);
  const secondInstance = await point('[data-instance-id="two"]');
  win.webContents.sendInputEvent({type:'mouseMove',...secondInstance}); await pause();
  await run(`checkSpacing('#instance-menu');`);
  await capture('instances-dark.png');
  await click('[data-instance-id="two"]');
  await run(`assert.equal(document.getElementById('instance-menu').hidden,true);assert.match(document.getElementById('instance-select-label').textContent,/吃鱼/);`);
  await click('.menu-trigger');
  await run(`checkSpacing('.menu-root.open .titlebar-dropdown');`);
  await capture('titlebar-dark.png');
  // 菜单跟随鼠标：停在菜单里保持打开，移出菜单自动关闭，横向移到别的菜单则切换过去。
  const menuEntry = await point('.menu-root.open .titlebar-dropdown button');
  win.webContents.sendInputEvent({type:'mouseMove',...menuEntry}); await pause();
  await run(`assert.ok(document.querySelector('.menu-root.open'),'hovering a menu entry keeps the menu open');`);
  const otherMenu = await point('.menu-root:nth-of-type(2) .menu-trigger');
  win.webContents.sendInputEvent({type:'mouseMove',...otherMenu}); await pause();
  await run(`(() => { const open=document.querySelector('.menu-root.open'); assert.ok(open,'moving across the menu bar keeps one menu open'); assert.equal(open.querySelector('.menu-trigger').textContent,'窗口'); })()`);
  const away = await point('#dock-workspace');
  win.webContents.sendInputEvent({type:'mouseMove',...away}); await pause();
  await run(`assert.equal(document.querySelector('.menu-root.open'),null,'leaving the open menu closes it');`);
  await click('.menu-trigger');
  await click('.tool-group:nth-of-type(2) summary');
  await run(`assert.equal(document.querySelector('.menu-root.open'),null);`);
  await escape();
  // Native summary keyboard activation must still work after the dismiss handlers.
  await run(`document.querySelectorAll('.tool-overflow summary')[1].focus();`);
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Enter'});
  win.webContents.sendInputEvent({type:'char',keyCode:'\r'});
  win.webContents.sendInputEvent({type:'keyUp',keyCode:'Enter'});
  await pause();
  await run(`assert.equal(document.querySelectorAll('.tool-overflow')[1].open,true);`);
  await escape();
  // Compare all popup families, including theme overrides and native select pickers.
  for (const theme of ['dark','light']) {
    await run(`document.documentElement.dataset.theme=${JSON.stringify(theme)};`);
    await click('#more-button');
    await run(`(() => { for(const menu of document.querySelectorAll('.tool-menu,.titlebar-dropdown,.desktop-more-menu,.instance-menu')) { const css=getComputedStyle(menu);assert.equal(css.borderTopWidth,'0px',menu.className);assert.equal(css.borderRadius,'4px');assert.notEqual(css.boxShadow,'none');assert.equal(css.backgroundColor,getComputedStyle(document.querySelector('.desktop-more-menu')).backgroundColor,menu.className); } })()`);
    await click('.tool-group:nth-of-type(2) summary');
    await capture('tools-'+theme+'.png');
    await click('#shared-dropdown button');
    await run(`checkSpacing('.ui-dropdown-list');`);
    await run(`assert.equal(document.querySelector('#shared-dropdown button').getAttribute('aria-expanded'),'true'); assert.equal(getComputedStyle(document.querySelector('.ui-dropdown-list')).borderTopWidth,'0px'); assert.notEqual(getComputedStyle(document.querySelector('#shared-dropdown button'),'::after').transform,'none');`);
    await click('.ui-dropdown-item:nth-child(2)');
    await run(`assert.equal(document.querySelector('.ui-dropdown-list'),null); assert.ok(actions.includes('two'));`);
    await click('#native-picker');
    await run(`checkSpacing('#native-picker');`);
    await run(`assert.ok(document.querySelector('#native-picker').matches(':open'));assert.equal(getComputedStyle(document.querySelector('#native-picker'),'::picker(select)').borderTopWidth,'0px');`);
    await escape();
  }
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await run(`assert.equal(getComputedStyle(document.querySelector('.tool-menu-chevron')).transitionDuration,'0s'); assert.equal(getComputedStyle(document.querySelector('.tool-menu')).animationName,'none');`);
  await click('#shared-dropdown button');
  await run(`assert.equal(getComputedStyle(document.querySelector('#shared-dropdown button'),'::after').transitionDuration,'0s');assert.equal(getComputedStyle(document.querySelector('.ui-dropdown-list')).animationName,'none');`);
  await escape();
  console.log(JSON.stringify({arrows:true,pressedFeedback:true,keyboardActivation:true,mutuallyExclusive:true,commandDismiss:true,outsideDismiss:true,escapeFocus:true,moreIconToggle:true,instanceSelection:true,sharedDropdown:true,nativePicker:true,optionSpacing:true,borderlessThemes:true,reducedMotion:true,artifacts}));
  win.destroy(); app.quit();
}).catch(error => { console.error(error); app.exit(1); });
