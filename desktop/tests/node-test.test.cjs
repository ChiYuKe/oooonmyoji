const {test}=require('node:test');
const assert=require('node:assert/strict');
const {validateTestNode,nodeTestText}=require('../dist-electron/shared/node-test.js');
const {parseDocument}=require('../dist-electron/shared/workflow/graph-dsl.js');
const {toCanvasDocument}=require('../dist-electron/shared/workflow/graph-document.js');
const {TestNodeTransfers}=require('../dist-electron/main/testNodeTransfer.js');
const {createTestNodeInserter}=require('../dist-test-renderer/canvas/state/test-node-insertion.js');
const catalog=[{name:'vision.match_template',parameters:{template:{type:'asset',required:true},threshold:{type:'number',min:0,max:1,default:.85},roi:{type:'rect'},timeout:{type:'duration',min:0}}}];
const draft={action:'vision.match_template',name:'识别组队',params:{template:'assets/templates/party.png',threshold:.93,roi:[0,0,1920,1080],timeout:2.5}};

test('a detached test uses exactly the configured node and preserves typed parameters',()=>{
  const value=validateTestNode(draft,catalog);const raw=toCanvasDocument(parseDocument(nodeTestText(value,[160,90])));
  assert.equal(raw.nodes.length,2);assert.equal(raw.nodes[1].action,draft.action);assert.deepEqual(raw.nodes[1].params,draft.params);assert.deepEqual(raw.resolution,[160,90]);
  value.params.threshold=.5;assert.equal(draft.params.threshold,.93);
  assert.throws(()=>validateTestNode({...draft,params:{}},catalog),/模板/);
  assert.throws(()=>validateTestNode({...draft,params:{...draft.params,threshold:2}},catalog),/匹配阈值/);
  assert.throws(()=>validateTestNode({...draft,params:{template:{ref:'nodes.old.output'}}},catalog),/具体参数值/);
});

test('canvas insertion is one undo entry, keeps existing edits and rejects invalid or duplicate requests',()=>{
  const nodes=[{id:'root',type:'root',children:[]},{id:'old',type:'task',params:{edited:true}}];let layout={old:{x:0,y:0}};const replies=[],undo=[];let focused;
  const insert=createTestNodeInserter({catalog:()=>catalog,buildNode:()=>({id:'node_'+nodes.length,type:'task'}),nodes:()=>nodes,layout:()=>layout,point:()=>({x:130,y:70}),mutate:fn=>{undo.push(structuredClone({nodes,layout}));fn();},created(){},focus:id=>focused=id,reply:result=>replies.push(result)});
  const request={requestId:'one',uri:'original.owf',node:draft};insert(request);
  assert.equal(nodes.length,3);assert.equal(undo.length,1);assert.deepEqual(nodes[1].params,{edited:true});assert.deepEqual(nodes[2].params,draft.params);assert.equal(focused,'node_2');assert.equal(layout.node_2.x,300);
  insert(request);assert.equal(nodes.length,3);assert.equal(undo.length,1);assert.equal(replies.at(-1).nodeId,'node_2');
  insert({...request,requestId:'bad',node:{...draft,params:{}}});assert.equal(nodes.length,3);assert.match(replies.at(-1).error,/模板/);
  const previous=undo.pop();nodes.splice(0,nodes.length,...previous.nodes);layout=previous.layout;assert.equal(nodes.length,2);assert.deepEqual(nodes[1].params,{edited:true});
});

test('transfer waits for the owning canvas acknowledgement and reports rejection',async()=>{
  const transfers=new TestNodeTransfers();let request,settled=false;
  const promise=transfers.add('original.owf',draft,value=>request=value).then(id=>{settled=true;return id;});
  transfers.complete({requestId:request.requestId,uri:'other.owf',nodeId:'wrong'});await Promise.resolve();assert.equal(settled,false);
  transfers.complete({requestId:request.requestId,uri:request.uri,nodeId:'node_2'});assert.equal(await promise,'node_2');
  const rejected=transfers.add('original.owf',draft,value=>request=value);transfers.complete({requestId:request.requestId,uri:request.uri,error:'目标工作流已关闭'});await assert.rejects(rejected,/已关闭/);
});

test('the host routes additions back to the original document and rejects closed canvases',async()=>{
  const {createEditorHost}=require('../dist-test-renderer/renderer/editor-host.js');
  const frame={contentWindow:{}},other={contentWindow:{}},posted=[],acks=[];let listener,closed=false,activated;
  const host=createEditorHost({
    api:{onWorkflowTestAddNode:fn=>listener=fn,workflowTestNodeAdded:async value=>acks.push(value)},
    workspace:{tab:uri=>!closed&&uri==='original.owf'?{uri}:undefined,frameUriForFrame:value=>value===frame?'original.owf':'other.owf',getDocumentRuntimes:()=>new Map(),activeUri:()=> 'other.owf',postToFrame:(target,message)=>posted.push({target,message})},
    getDocumentFrame:uri=>uri==='original.owf'?frame:other,openWorkflowTab:async uri=>activated=uri,errorMessage:error=>error.message,showToast(){},setStatus(){}
  });
  listener({requestId:'route',uri:'original.owf',node:draft});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(activated,'original.owf');assert.equal(posted[0].target,frame);assert.equal(posted[0].message.command,'addTestNode');
  await host.handleMessage({type:'workflowTestNodeAdded',requestId:'route',uri:'original.owf',nodeId:'node_2'},other);assert.equal(acks.length,0);
  await host.handleMessage({type:'workflowTestNodeAdded',requestId:'route',uri:'original.owf',nodeId:'node_2'},frame);assert.equal(acks[0].nodeId,'node_2');
  closed=true;listener({requestId:'closed',uri:'original.owf',node:draft});await new Promise(resolve=>setImmediate(resolve));assert.equal(posted.length,1);assert.match(acks.at(-1).error,/已关闭/);
});
