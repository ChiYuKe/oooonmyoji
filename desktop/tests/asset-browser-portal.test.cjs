const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../public/legacy/workflow-editor.js'),'utf8');
function harness(){
  const element=tag=>({tag,children:[],events:{},style:{setProperty(){}},classList:{add(){},remove(){}},
    setAttribute(){},appendChild(child){this.children.push(child);child.parentNode=this;},
    addEventListener(type,fn){this.events[type]=fn;},attachShadow(){assert.equal(tag,'div');return element('shadow');},
    showModal(){this.open=true;},close(){this.open=false;},remove(){this.removed=true;}});
  const parent=element('body'),overlay=element('overlay');parent.appendChild(overlay);
  const focus={isConnected:true,focus(){this.restored=true;}};
  const document={body:parent,documentElement:{},activeElement:focus,baseURI:'http://localhost/legacy/editor-frame.html',createElement:element};
  const topDocument={body:element('top-body'),createElement:element};
  const ctx=vm.createContext({document,window:{top:{document:topDocument}},URL,state:{assetBrowser:{}},
    $:()=>overlay,getComputedStyle:()=>({getPropertyValue:()=> '#252525'}),
    MutationObserver:class{observe(){}disconnect(){this.disconnected=true;}}});
  const start=source.indexOf('  let assetBrowserPortal = null;');
  vm.runInContext(source.slice(start,source.indexOf('  function openAssetBrowser(',start)),ctx);
  const close=source.indexOf('  function closeAssetBrowser(');
  vm.runInContext(source.slice(close,source.indexOf('\n  }',close)+4),ctx);
  return {ctx,parent,overlay,focus,topDocument};
}
test('picker is mounted in the top window modal, not the inspector viewport',()=>{
  const {ctx,overlay,topDocument}=harness();ctx.mountAssetBrowser();
  assert.equal(topDocument.body.children.length,1);
  const host=topDocument.body.children[0];assert.equal(host.tag,'dialog');assert.equal(host.open,true);
  assert.equal(overlay.parentNode.tag,'shadow');assert.equal(ctx.assetBrowserOverlay(),overlay);
  ctx.mountAssetBrowser();assert.equal(topDocument.body.children.length,1);
});
test('closing restores the original overlay and focus, including Escape',()=>{
  const {ctx,overlay,parent,focus,topDocument}=harness();ctx.mountAssetBrowser();
  const host=topDocument.body.children[0];
  host.events.keydown({key:'Escape',preventDefault(){},stopPropagation(){}});
  assert.equal(host.open,false);assert.equal(host.removed,true);assert.equal(overlay.parentNode,parent);
  assert.equal(focus.restored,true);assert.equal(ctx.state.assetBrowser,null);
  ctx.closeAssetBrowser();
});
test('picker styling is independent, centered and theme-aware without bright borders',()=>{
  const css=fs.readFileSync(path.join(__dirname,'../public/legacy/asset-browser.css'),'utf8');
  assert.match(css,/place-items: center/);assert.match(css,/width: min\(1040px, 100%\)/);
  assert.match(css,/grid-template-columns: 190px minmax\(0, 1fr\)/);
  assert.match(css,/var\(--ui-selected/);assert.match(css,/border: 0; border-radius: 8px/);
});
