const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '../public/runtime-log');

// Event/DOM harness only: no desktop window, browser automation or screenshot.
function harness() {
  const doc = {events:{}, activeElement:null};
  const attachEvents = target => {
    target.addEventListener = (name, fn) => (target.events[name] ||= []).push(fn);
    target.fire = (name, values={}) => { for(const fn of target.events[name] || []) fn({target,preventDefault(){},stopPropagation(){},...values}); };
  };
  attachEvents(doc);
  class Element {
    constructor(tag) {
      this.tagName=tag.toUpperCase(); this.children=[]; this.dataset={}; this.attrs={}; this.events={}; this.style={};
      this.className=''; this.namespaceURI='http://www.w3.org/1999/xhtml'; this.scrollTop=0; this.clientHeight=100; this.offsetTop=0;
      this.open=false; this.disabled=false;
      this.classList={contains:name=>this.className.split(' ').includes(name),toggle:(name,force)=>{
        const values=new Set(this.className.split(' ').filter(Boolean)); const result=force ?? !values.has(name);
        if(result) values.add(name); else values.delete(name); this.className=[...values].join(' '); return result;
      },add:name=>this.classList.toggle(name,true),remove:name=>this.classList.toggle(name,false)};
      attachEvents(this);
    }
    set textContent(value) { this.text=String(value); this.innerHTML=''; }
    get textContent() { return (this.text || '')+this.children.map(child=>child.textContent).join(''); }
    set innerHTML(value) { for(const child of this.children) child.parentElement=null; this.children=[]; }
    get isConnected() { return this===doc.body || Boolean(this.parentElement?.isConnected); }
    get lastElementChild() { return this.children.at(-1); }
    get scrollHeight() { return this.children.length*60; }
    appendChild(child) { child.parentElement=this; this.children.push(child); return child; }
    append(...children) { children.forEach(child=>this.appendChild(child)); }
    setAttribute(name,value) {
      this.attrs[name]=String(value);
      if(name==='class') this.className=String(value);
      if(name==='id') this.id=String(value);
      if(name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g,(_,v)=>v.toUpperCase())]=String(value);
    }
    getAttribute(name) { return this.attrs[name] ?? null; }
    removeAttribute(name) { delete this.attrs[name]; }
    matches(selector) {
      if(selector.startsWith('#')) return this.id===selector.slice(1);
      if(selector.startsWith('.')) return this.classList.contains(selector.slice(1));
      const attr=selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
      if(attr) return attr[2]===undefined ? this.attrs[attr[1]]!==undefined : this.attrs[attr[1]]===attr[2];
      return this.tagName===selector.toUpperCase();
    }
    closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
    querySelectorAll(selector) {
      const [ancestor,childSelector]=selector.split(' ');
      if(childSelector) return this.querySelectorAll(ancestor).flatMap(child=>child.querySelectorAll(childSelector));
      return this.children.flatMap(child=>[...(child.matches(selector) ? [child] : []),...child.querySelectorAll(selector)]);
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    contains(target) { return this===target || this.children.some(child=>child.contains(target)); }
    focus() { doc.activeElement=this; }
    click() { if(!this.disabled) this.fire('click'); }
  }
  doc.body=new Element('body'); doc.createElement=tag=>new Element(tag);
  doc.getElementById=id=>doc.body.querySelector(`#${id}`);
  doc.querySelectorAll=selector=>doc.body.querySelectorAll(selector);
  // Parse the actual static shell so missing IDs fail the renderer tests.
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8').split(/<body[^>]*>/)[1].split('</body>')[0];
  const stack=[doc.body]; const voidTags=new Set(['input','img','br','meta','link']);
  for(const match of html.matchAll(/<(\/?)([\w-]+)([^>]*)>/g)) {
    const [,close,tag,attrs]=match;
    if(close) { stack.pop(); continue; }
    const node=new Element(tag);
    for(const attr of attrs.matchAll(/([\w-]+)(?:="([^"]*)")?/g)) node.setAttribute(attr[1],attr[2] ?? '');
    node.disabled=node.attrs.disabled!==undefined; node.checked=node.attrs.checked!==undefined;
    stack.at(-1).appendChild(node); if(!voidTags.has(tag)) stack.push(node);
  }
  const sent=[]; const win={events:{},parent:{postMessage:message=>sent.push(message)},localStorage:{getItem(){return null;},setItem(){}}}; attachEvents(win);
  const ctx=vm.createContext({window:win,document:doc,Element,Node:Element,MutationObserver:class {observe(){}},setInterval(){},Date});
  vm.runInContext(fs.readFileSync(path.join(root,'run-log.js'),'utf8'),ctx);
  return {doc,win,sent,$:id=>doc.getElementById(id),send:data=>win.fire('message',{data}),api:win.__runLog};
}
const start=1700000000;
const step=(id,status='succeeded',source='a',extra={})=>({type:'step',log_source:source,step_id:id,run_id:source,ts:start+10,
  step:{name:`节点 ${id}`,action:'vision.wait_template',node_kind:'task',status,started_at:start+1,ts:start+1,duration_ms:432,
    workflow_depth:1,workflow_path:['主流程','子流程'],params:{template:'assets/templates/test.png',threshold:.88,timeout_seconds:6,roi:[1,2,30,40]},output:[{confidence:.97}],...extra}});
function init(h,events=[],sources=[{id:'a',label:'mumu-1',status:'succeeded',startedAt:start*1000}]) {
  h.send({type:'init',descriptor:{workflow:'demo.json',sources},events,engineOutput:'\x1b[31mengine\x1b[0m'});
}

test('compact rows keep full detail data and show failures without expansion',()=>{
  const h=harness(); init(h,[step('ok'),step('bad','failed','a',{error:'目标丢失',error_category:'not_matched'})]);
  const [ok,bad]=h.$('step-list').children;
  assert.equal(ok.tagName,'DETAILS'); assert.equal(ok.open,false);
  assert.match(ok.children[0].textContent,/节点 ok/); assert.match(ok.children[0].textContent,/432 ms/);
  assert.doesNotMatch(ok.children[0].textContent,/vision\.wait_template|ROI|开始时间/);
  assert.match(ok.children[1].textContent,/实际参数/); assert.match(ok.children[1].textContent,/子流程/);
  assert.match(ok.children[1].textContent,/ROI \[1, 2, 30, 40\]/);
  assert.match(bad.children[0].textContent,/失败原因/);
  assert.equal(h.$('completed-count').textContent,'1'); assert.equal(h.$('failed-count').textContent,'1');
});

test('expanded rows and reading position survive live refresh and source switching',()=>{
  const h=harness(); init(h,[step('one'),step('two','failed','b')],[{id:'a',label:'A',status:'succeeded'},{id:'b',label:'B',status:'failed'}]);
  h.$('auto-scroll').checked=false;
  h.$('step-list').children[0].open=true; h.$('step-list').scrollTop=42;
  h.send({type:'runEvent',event:step('next')});
  assert.equal(h.$('step-list').children[0].open,true); assert.equal(h.$('step-list').scrollTop,42);
  h.$('source-tabs').children[1].click(); assert.equal(h.doc.body.classList.contains('status-failed'),true);
  assert.equal(h.$('step-list').children[0].open,false);
  h.$('source-tabs').children[0].click(); assert.equal(h.doc.body.classList.contains('status-succeeded'),true);
  assert.equal(h.$('step-list').children[0].open,true); assert.equal(h.$('step-list').scrollTop,42);
});

test('filters, engine tab and clear do not lose or mutate log data',()=>{
  const h=harness(); init(h,[step('ok'),step('bad','failed')]);
  h.$('filters').children[2].click(); assert.equal(h.$('step-list').children.length,1);
  assert.equal(h.$('filters').children[2].getAttribute('aria-pressed'),'true');
  h.$('tab-engine').click(); assert.equal(h.$('engine-output').textContent,'engine');
  assert.equal(h.$('tab-engine').getAttribute('aria-selected'),'true');
  assert.equal(h.$('auto-scroll').closest('.filterbar').classList.contains('hidden'),false);
  h.$('btn-clear').click(); assert.equal(h.sent.at(-1).message.type,'clear');
  assert.equal(h.api.state.runs.get('a').rows.length,2);
  h.send({type:'cleared'}); assert.equal(h.$('step-list').children.length,0);
});

test('display cap retains complete statistics; pending duration is not zero',()=>{
  const h=harness(); init(h,Array.from({length:305},(_,i)=>step(String(i))));
  assert.equal(h.$('step-list').children.length,300); assert.equal(h.$('completed-count').textContent,'305');
  assert.equal(h.$('cap-note').textContent,'最近 300 / 305 条');
  h.api.state.runs.get('a').rows.at(-1).duration=null; h.api.render();
  assert.equal(h.$('step-list').lastElementChild.querySelector('.duration').textContent,'—');
});

test('running states enable stop and expose current task; completed disables stop',()=>{
  const h=harness(); init(h,[step('live','running')],[{id:'a',status:'running',startedAt:start*1000}]);
  assert.equal(h.$('btn-stop').disabled,false); assert.equal(h.$('current-step').textContent,'节点 live');
  h.$('btn-stop').click(); assert.equal(h.sent.at(-1).message.type,'stopWorkflow');
  h.send({type:'runEvent',event:step('live')});
  h.send({type:'runEvent',event:{type:'run_finished',log_source:'a',ts:start+15,status:'succeeded'}});
  assert.equal(h.$('btn-stop').disabled,true); assert.equal(h.$('current-step').parentElement.classList.contains('hidden'),true);
});

test('screenshots are keyboard buttons; Escape restores focus',()=>{
  const h=harness(); const event=step('image'); event.thumbnail='data:image/png;base64,aGVsbG8='; init(h,[event]);
  const button=h.$('step-list').querySelector('.screenshot-button'); button.click();
  assert.equal(h.$('lightbox').classList.contains('hidden'),false); assert.equal(h.doc.activeElement,h.$('lightbox-close'));
  h.doc.fire('keydown',{key:'Escape'}); assert.equal(h.$('lightbox').classList.contains('hidden'),true);
  assert.equal(h.doc.activeElement,button);
});

test('runtime layout shares UI styles and parses without legacy overrides',()=>{
  const postcss=require('postcss');
  for(const name of ['run-log.css','showcase.css']) postcss.parse(fs.readFileSync(path.join(root,name),'utf8'));
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8'); assert.match(html,/\.\.\/legacy\/ui\.css/);
  assert.match(html,/class="ui-button ui-segment/);
});
