(() => {
  const frame = document.getElementById('preview');
  function load() {
    const editor = frame.contentWindow.__btEditor;
    if (!editor) return;
    editor.state.raw = {schema_version:4,id:'card_preview',name:'节点卡片预览',root:'root',inputs:{运行轮数:{type:'integer',default:100}},variables:{},nodes:[
      {id:'root',type:'root',name:'战斗工作流',children:['sequence']},
      {id:'sequence',type:'sequence',name:'完成一轮战斗',children:['wait','tap','parallel']},
      {id:'wait',type:'task',name:'等待本轮战斗结束',action:'vision.wait_template',params:{timeout_seconds:6,threshold:.88,present:false},decorators:[{type:'retry',attempts:3}]},
      {id:'tap',type:'task',name:'点击战斗结束后的继续按钮',action:'input.tap_match',params:{hold_ms:100}},
      {id:'parallel',type:'instance_parallel',name:'多实例协作',wait_for:'all',runs:[{instance:'mumu-1',workflow:'party.json',inputs:{运行轮数:{ref:'inputs.运行轮数'}}}]},
    ],_layout:{root:{x:390,y:20},sequence:{x:390,y:165},wait:{x:70,y:330},tap:{x:390,y:330},parallel:{x:710,y:330}},_variableCards:{rounds:{name:'运行轮数',scope:'inputs',x:70,y:510}}};
    editor.state.workflows=[{id:'party',name:'party.json',uri:'party.json',inputs:[{name:'运行轮数',definition:{type:'integer',default:100}},{name:'启用结界突破',definition:{type:'boolean',default:true}}]}];
    editor.state.selected=new Set(['wait']); editor.state.run=new Map([['wait',{status:'succeeded',duration:9980}],['tap',{status:'failed',duration:430,error:'点击前重新校验未匹配'}]]);
    editor.state.zoom=.9; editor.state.panX=16; editor.state.panY=10;
    editor.render();
  }
  frame.addEventListener('load',load);
  if(frame.contentWindow.__btEditor) load();
  window.StudioTheme.subscribe(theme=>{
    for(const name of ['dark','light']) { const button=document.getElementById(name); button.classList.toggle('active',name===theme); button.setAttribute('aria-pressed',String(name===theme)); }
  });
  for(const name of ['dark','light']) document.getElementById(name).addEventListener('click',()=>window.StudioTheme.set(name));
})();
