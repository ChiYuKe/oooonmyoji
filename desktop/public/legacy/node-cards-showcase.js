(() => {
  const frame = document.getElementById('preview');
  function load() {
    const editor = frame.contentWindow.__btEditor;
    if (!editor) return;
    // 独立预览没有宿主下发的动作清单；补一份真实子集，参数行才有定义可以渲染。
    editor.state.catalog = [
      { name: 'input.tap_match', description: '点击匹配结果中心', parameters: {
        match: { type: 'object', required: true }, revalidate: { type: 'boolean', default: true },
        random_offset: { type: 'integer', default: 0, min: 0 }, random_interval: { type: 'array', items: { type: 'duration', min: 0 }, default: [0, 0] },
        verify_gone: { type: 'boolean', default: false }, verify_timeout_seconds: { type: 'duration', default: 8, min: 0 },
        hold_ms: { type: 'integer', default: 0, min: 0 }, disappeared_states: { type: 'array', items: { type: 'object' }, default: [] },
        disappeared_state_timeout_seconds: { type: 'duration', default: 0, min: 0 } } },
      { name: 'vision.wait_template', description: '等待模板出现或消失', parameters: {
        template: { type: 'asset', required: true }, roi: { type: 'rect' }, threshold: { type: 'number', default: 0.85, min: 0, max: 1 },
        present: { type: 'boolean', default: true }, timeout_seconds: { type: 'duration', default: 6, min: 0 },
        stable_seconds: { type: 'duration', default: 0, min: 0 } } },
      { name: 'core.sleep', description: '等待指定时长', parameters: {
        seconds: { type: 'duration', required: true, min: 0 } } },
      { name: 'input.key', description: '发送 Android keyevent', parameters: {
        keycode: { type: 'key', required: true, min_length: 1 } } },
      // 新类型展示：内置清单里还没有用到 point/color/enum 的参数，这里用一份演示定义，
      // 参数名沿用真实清单里已有的名字，卡片就能显示对应的中文标签。
      { name: 'studio.preview_types', description: '新参数类型预览', parameters: {
        realm_popup_close_point: { type: 'point', default: { x: 960, y: 540 }, description: '关闭位置坐标' },
        tint: { type: 'color', default: '#ff8c3a', description: '标记颜色' },
        wait_for: { type: 'enum', enum: ['all', 'any'], default: 'all', description: '完成条件' },
        stable_seconds: { type: 'duration', default: 1.5, min: 0, description: '稳定等待' },
        keycode: { type: 'key', default: 'BACK', description: '关闭弹窗按键' } } },
    ];
    editor.state.raw = {schema_version:4,id:'card_preview',name:'节点卡片预览',root:'root',inputs:{运行轮数:{type:'integer',default:100}},variables:{
      目标点:{type:'point',default:{x:960,y:540},display_name:'目标点'},
      主题色:{type:'color',default:'#ff8c3a',display_name:'主题色'},
      挑战模式:{type:'enum',enum:['安全','快速','极限'],default:'安全',display_name:'挑战模式'},
      稳定等待:{type:'duration',default:1.5,min:0,display_name:'稳定等待'},
      关闭按键:{type:'key',default:'BACK',display_name:'关闭按键'}},nodes:[
      {id:'root',type:'root',name:'战斗工作流',children:['sequence']},
      {id:'sequence',type:'sequence',name:'完成一轮战斗',children:['wait','tap','parallel']},
      {id:'wait',type:'task',name:'等待本轮战斗结束',action:'vision.wait_template',params:{timeout_seconds:6,threshold:.88,present:false},decorators:[{type:'retry',attempts:3}]},
      {id:'tap',type:'task',name:'点击挑战按钮',action:'input.tap_match',params:{match:{ref:'nodes.wait.output.0'},revalidate:true,random_offset:11,random_interval:[.2,.6],verify_gone:true,verify_timeout_seconds:8}},
      {id:'types',type:'task',name:'新类型参数',action:'studio.preview_types',params:{realm_popup_close_point:{x:960,y:540},tint:'#ff8c3a',wait_for:'any',stable_seconds:1.5,keycode:{ref:'variables.关闭按键'}}},
      {id:'parallel',type:'instance_parallel',name:'多实例协作',wait_for:'all',runs:[{instance:'mumu-1',workflow:'party.json',inputs:{运行轮数:{ref:'inputs.运行轮数'}}}]},
      {id:'bool',type:'bool_judge',name:'结界未结算',expression:{eq:[{ref:'variables.挑战模式'},'快速']}},
      // 拆分卡片：把来源输出的 object 拆成可单独引用的字段（UE 的 Break 结构体）。
      // 绑整体输出 → 右缘按来源 schema 排字段引脚；写了 fields 就按声明的字段名排。
      {id:'break',type:'break',name:'拆分匹配结果',ref:{ref:'nodes.wait.output'},fields:{中心点:'0.center',置信度:'0.confidence'}},
    ],_layout:{root:{x:390,y:20},sequence:{x:390,y:165},wait:{x:70,y:330},tap:{x:390,y:330},parallel:{x:710,y:330},types:{x:70,y:520},bool:{x:390,y:520},break:{x:710,y:520}},_variableCards:{rounds:{name:'运行轮数',scope:'inputs',x:70,y:790},theme:{name:'主题色',scope:'variables',x:70,y:880},point:{name:'目标点',scope:'variables',x:250,y:880},mode:{name:'挑战模式',scope:'variables',x:430,y:880},settle:{name:'稳定等待',scope:'variables',x:610,y:880},key:{name:'关闭按键',scope:'variables',x:790,y:880}}};
    editor.state.workflows=[{id:'party',name:'party.json',uri:'party.json',inputs:[{name:'运行轮数',definition:{type:'integer',default:100}},{name:'启用结界突破',definition:{type:'boolean',default:true}}]}];
    editor.state.selected=new Set(['wait']); editor.state.run=new Map([['wait',{status:'succeeded',duration:9980}],['tap',{status:'failed',duration:430,error:'点击前重新校验未匹配'}]]);
    // tap 与新类型节点展开全部参数行（UE 的显示隐藏引脚）；wait 保持默认的「必填 + 已配置」并显示折叠箭头。
    editor.state.paramRowsExpanded=new Set(['tap','types']);
    editor.state.zoom=.72; editor.state.panX=16; editor.state.panY=10;
    editor.render();
  }
  // 画布是模块脚本，__btEditor 可能在 iframe load 之后才出现：轮询等待，避免示例空白。
  let tries = 0;
  function boot() {
    if (frame.contentWindow.__btEditor) { load(); return; }
    if (tries++ < 200) setTimeout(boot, 50);
  }
  frame.addEventListener('load', boot);
  boot();
  window.StudioTheme.subscribe(theme=>{
    for(const name of ['dark','light']) { const button=document.getElementById(name); button.classList.toggle('active',name===theme); button.setAttribute('aria-pressed',String(name===theme)); }
  });
  for(const name of ['dark','light']) document.getElementById(name).addEventListener('click',()=>window.StudioTheme.set(name));
})();
