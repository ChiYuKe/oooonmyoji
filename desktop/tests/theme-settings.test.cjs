const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const postcss = require('postcss');
const root = path.join(__dirname,'..');
const themeSource=fs.readFileSync(path.join(root,'public/theme/theme.js'),'utf8');
function themeWindow(host,storage={}) {
  const events={}; const doc={documentElement:{dataset:{},style:{}}};
  const win={onmyoji:host,addEventListener:(name,fn)=>{(events[name] ||= []).push(fn);}}; win.parent=win;
  const ctx=vm.createContext({window:win,document:doc,localStorage:{getItem:key=>storage[key],setItem:(key,value)=>{storage[key]=value;}}});
  vm.runInContext(themeSource,ctx);
  return {win,doc,ctx,fire:(name,event)=>{for(const fn of events[name] || []) fn(event);}};
}
test('native preference wins over port-specific browser storage and synchronizes windows',()=>{
  let persisted='light'; const listeners=new Set();
  const host={getTheme:()=>persisted,setTheme:value=>{persisted=value;for(const fn of listeners) fn(value);return value;},onThemeChanged:fn=>{listeners.add(fn);return()=>listeners.delete(fn);}};
  const a=themeWindow(host,{'onmyoji-studio.appearance':'dark'}); const b=themeWindow(host);
  assert.equal(a.doc.documentElement.dataset.theme,'light');
  a.win.StudioTheme.set('dark'); assert.equal(b.doc.documentElement.dataset.theme,'dark');
  b.win.StudioTheme.set('light'); assert.equal(a.doc.documentElement.dataset.theme,'light');
  const restarted=themeWindow(host); assert.equal(restarted.win.StudioTheme.get(),'light');
  a.fire('pagehide'); assert.equal(listeners.size,2);
});
test('theme validates values and handles failed persistence without misleading selection',()=>{
  const a=themeWindow({getTheme:()=> 'dark',setTheme:()=> 'dark'});
  assert.equal(a.win.StudioTheme.set('light'),false); assert.equal(a.win.StudioTheme.get(),'dark');
  assert.equal(a.win.StudioTheme.set('invalid'),false);
  const b=themeWindow({getTheme(){throw new Error('unavailable');},setTheme(){throw new Error('read only');}});
  assert.equal(b.win.StudioTheme.get(),'dark'); assert.equal(b.win.StudioTheme.set('light'),false);
});
test('standalone previews use browser storage and react to other preview tabs',()=>{
  const store={}; const a=themeWindow(null,store);
  assert.equal(a.win.StudioTheme.set('light'),true); assert.equal(store['onmyoji-studio.appearance'],'light');
  const b=themeWindow(null,store); assert.equal(b.win.StudioTheme.get(),'light');
  b.fire('storage',{key:'onmyoji-studio.appearance',newValue:'dark'}); assert.equal(b.win.StudioTheme.get(),'dark');
});
test('all production surfaces initialize theme before content and load scoped adapters',()=>{
  const files=['src/renderer/index.html','src/renderer/popout.html','src/renderer/vision-test.html','public/legacy/editor-frame.html','public/runtime-log/index.html'];
  for(const file of files) {
    const html=fs.readFileSync(path.join(root,file),'utf8');
    assert(html.indexOf('/theme/theme.js')<html.indexOf('</head>'),file);
    assert.match(html,/theme\/(workbench|editor|log)-light.css/);
    assert.match(html,/theme\/theme.css/);
  }
});
test('light adapters are current, scoped, parseable and do not invert image pixels',()=>{
  const {generate,groups,convert}=require('../scripts/build-light-palette.cjs');
  for(const [name,files] of Object.entries(groups)) {
    const css=fs.readFileSync(path.join(root,`public/theme/${name}-light.css`),'utf8');
    assert.equal(css,generate(files));
    postcss.parse(css).walkRules(rule=>assert(rule.selector.includes('[data-theme="light"]')));
    assert.doesNotMatch(css,/filter\s*:/);
  }
  assert.equal(convert("url('data:image/svg+xml,%23ffffff')",'background'),"url('data:image/svg+xml,%23ffffff')");
  assert.equal(convert('#191919','background'),'#f3f3f3');
  assert.equal(convert('#dddddd','foreground'),'#262626');
  for(const file of ['public/theme/theme.css','public/settings/settings.css']) postcss.parse(fs.readFileSync(path.join(root,file),'utf8'));
});
test('light graph metadata remains dark and opaque panels never become black overlays',()=>{
  const {generate,convert}=require('../scripts/build-light-palette.cjs');
  const css=postcss.parse(generate(['public/legacy/workflow-editor.css']));
  for(const selector of ['.node-meta','.node-type','.instance-run-card-instance','.instance-variable-value','.variable-card-value']) {
    let fill;
    css.walkRules(rule=>{ if(rule.selector===`:root[data-theme="light"] ${selector}`) rule.walkDecls('fill',decl=>{fill=decl.value;}); });
    assert.match(fill,/^#[0-9a-f]{6}$/);
    assert(parseInt(fill.slice(1,3),16)<120,`${selector} must be foreground, not a pale shape`);
  }
  assert.equal(convert('rgba(24, 24, 24, .94)','background'),'rgba(243, 243, 243, 0.94)');
  assert.equal(convert('rgba(255, 255, 255, .05)','background'),'rgba(0, 0, 0, 0.05)');
});
test('curated light surfaces have readable contrast and all dock tab states are specified',()=>{
  const source=fs.readFileSync(path.join(root,'public/theme/theme.css'),'utf8');
  const luminance=hex=>{
    const rgb=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=.04045 ? v/12.92 : ((v+.055)/1.055)**2.4);
    return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;
  };
  const pairs=[['#29343e','#f5f6f7'],['#5e6b76','#e7eaed'],['#5e6c78','#f9fafb'],['#31546e','#d7e3ed']];
  for(const [text,bg] of pairs) assert((luminance(bg)+.05)/(luminance(text)+.05)>=4.5,`${text} on ${bg}`);
  for(const group of ['activegroup','inactivegroup']) for(const panel of ['visiblepanel','hiddenpanel']) {
    assert.match(source,new RegExp(`--dv-${group}-${panel}-tab-color: #[0-9a-f]{6}`));
  }
  assert.match(source,/#minimap \{ background: #edf1f4/);
  assert.match(source,/stroke-width: 1; filter: none/);
  assert.doesNotMatch(source,/filter:\s*(invert|brightness)/);
});
test('settings keeps original controls and separates all four categories',()=>{
  const html=fs.readFileSync(path.join(root,'src/renderer/index.html'),'utf8');
  for(const category of ['appearance','interface','runtime','about']) {
    assert.equal((html.match(new RegExp(`id="settings-page-${category}"`,'g')) || []).length,1);
    assert.match(html,new RegExp(`aria-controls="settings-page-${category}"`));
  }
  for(const id of ['settings-content-view','settings-auto-refresh','settings-default-workflow','settings-debug-enabled','settings-debug-annotate','settings-project-root']) {
    assert.equal((html.match(new RegExp(`id="${id}"`,'g')) || []).length,1);
  }
  const css=fs.readFileSync(path.join(root,'public/settings/settings.css'),'utf8');
  assert.match(css,/#module-settings.settings-module \{ display: grid; grid-template-columns: 132px minmax\(0, 1fr\)/);
});
test('settings navigation and theme events still work after the module is moved to a popout',()=>{
  function element(dataset={}) {
    const classes=new Set(); const events={}; return {dataset,classes,checked:false,
      classList:{toggle:(name,on)=>{if(on)classes.add(name);else classes.delete(name);}},setAttribute(name,value){this[name]=value;},
      addEventListener:(name,fn)=>{events[name]=fn;},fire(name,extra={}){events[name]?.({preventDefault(){},...extra});},focus(){this.focused=true;}};
  }
  const categories=['appearance','interface','runtime','about'];
  const tabs=categories.map(settingsPage=>element({settingsPage})); const pages=Object.fromEntries(categories.map(key=>[`#settings-page-${key}`,element()]));
  const feedback={}; pages['#settings-theme-feedback']=feedback;
  const choices=['dark','light'].map(value=>({...element(),value}));
  const module={querySelectorAll:selector=>selector.includes('data-settings-page') ? tabs : choices,querySelector:selector=>pages[selector]};
  const {ctx,win,doc}=themeWindow(null);
  ctx.document={...doc,getElementById:()=>module};
  vm.runInContext(fs.readFileSync(path.join(root,'public/settings/settings.js'),'utf8'),ctx);
  // The handlers retain the module, not the original document's selectors.
  ctx.document={...doc,getElementById:()=>null};
  tabs[1].fire('click'); assert.equal(tabs[1]['aria-selected'],'true'); assert.equal(pages['#settings-page-appearance'].classes.has('hidden'),true);
  tabs[1].fire('keydown',{key:'End'}); assert.equal(tabs[3]['aria-selected'],'true'); assert.equal(tabs[3].focused,true);
  choices[1].checked=true; choices[1].fire('change'); assert.equal(win.StudioTheme.get(),'light'); assert.match(feedback.textContent,/浅色/);
});
