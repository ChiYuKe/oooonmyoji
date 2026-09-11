(() => {
  'use strict';
  const frame = document.getElementById('log-preview');
  const feedback = document.getElementById('feedback');
  let scenario = 'completed';
  let ready = false;
  const scenarioButtons = [];
  const now = () => Date.now() / 1000;
  function sampleData() {
    const start = now() - 90;
    const specs = [
      ['等待本轮战斗结束', 'vision.wait_template', {template:'assets/templates/task_3-template.png',timeout_seconds:6,threshold:.88,roi:[708,958,491,122]}, [{confidence:.973}]],
      ['点击战斗结束后的继续', 'input.tap_match', {match:{template:'assets/templates/task_3-template.png'}}, {x:976,y:1063,offset_x:14,offset_y:19,interval_seconds:.41,revalidated:true}],
      ['确认结算提示已消失', 'vision.wait_template', {template:'assets/templates/task_3-template.png',present:false,timeout_seconds:6,threshold:.88,roi:[608,943,734,137]}, []],
      ['等待挑战按钮或战斗结算页', 'vision.wait_any', {templates:['assets/templates/task_1-template.png','assets/templates/task_3-template.png'],timeout_seconds:6}, {template:'assets/templates/task_1-template.png'}],
      ['点击挑战按钮', 'input.tap_match', {match:{template:'assets/templates/task_1-template.png'}}, {x:1772,y:943,offset_x:11,offset_y:6,revalidated:true}],
      ['确认挑战按钮已消失', 'vision.wait_template', {template:'assets/templates/task_1-template.png',present:false,timeout_seconds:6,threshold:.88,roi:[1621,796,299,284]}, []],
    ];
    const descriptor = {workflow:'new_workflow.json',sources:[
      {id:'one',instance:'mumu-1',label:'吃鱼',startedAt:start*1000,status:scenario === 'running' ? 'running' : 'succeeded'},
      {id:'two',instance:'mumu-2',label:'扫地工',startedAt:start*1000,status:'failed'},
    ]};
    if (scenario === 'empty') return {type:'init',descriptor:null,events:[],engineOutput:''};
    const events = [];
    for (const source of descriptor.sources) {
      events.push({type:'run_started',log_source:source.id,run_id:source.id,ts:start,status:'running'});
      for (let index = 0; index < 18; index++) {
        const [name,action,params,output] = specs[index % specs.length];
        const failed = source.id === 'two' && index === 16;
        const running = source.id === 'one' && scenario === 'running' && index === 17;
        events.push({type:'step',log_source:source.id,run_id:source.id,step_id:`node_${index}`,ts:start+index*4,
          step:{name,action,params,output:running ? null : output,node_kind:'task',execution_index:index,
            status:running ? 'running' : failed ? 'failed' : 'succeeded',ts:running ? now()-2 : start+index*4,
            started_at:start+index*4,duration_ms:index%6===0 ? 9969 : 432+index*7,
            workflow_depth:1,workflow_path:['new_workflow','战斗循环'],
            error:failed ? '点击前重新匹配失败：目标模板未达到匹配阈值' : '',error_category:failed ? 'not_matched' : '',attempts: index%6===0 ? 2 : 1}});
      }
      if (source.status !== 'running') events.push({type:'run_finished',log_source:source.id,ts:start+80,status:source.status});
    }
    return {type:'init',descriptor,events,engineOutput:'[示例] 工作流启动\n[示例] 模板已加载\n[示例] 详细步骤显示在「步骤」页签'};
  }
  function load() {
    if (!ready) return;
    // Set only the demo instance; don't alter the saved production view preference.
    frame.contentWindow.__runLog.state.view = 'steps';
    frame.contentWindow.postMessage(sampleData(), window.location.origin);
    feedback.textContent = scenario === 'empty' ? '空状态示例' : '示例已加载 · 可点击步骤展开';
  }
  for (const [value,label] of [['completed','已完成'],['running','运行中'],['empty','空状态']]) {
    const button = UI.button({label,className:'ui-segment',onClick:()=>{
      scenario=value; sync(); load();
    }});
    button.dataset.value=value; scenarioButtons.push(button); document.getElementById('scenarios').appendChild(button);
  }
  function sync() { scenarioButtons.forEach(button=>{const selected=button.dataset.value===scenario;button.classList.toggle('active',selected);button.setAttribute('aria-pressed',String(selected));}); }
  sync();
  document.querySelectorAll('[data-width]').forEach(button=>button.addEventListener('click',()=>{
    frame.style.width=`${button.dataset.width}px`; frame.style.height=`${button.dataset.height}px`;
    feedback.textContent=`面板 ${button.dataset.width} × ${button.dataset.height}px`;
  }));
  window.addEventListener('message', event=>{
    if (event.source !== frame.contentWindow || event.data?.source !== 'desktop-run-log') return;
    const type=event.data.message?.type;
    if (type==='ready') { ready=true; load(); }
    else if (type==='clear') { frame.contentWindow.postMessage({type:'cleared'},window.location.origin); feedback.textContent='只清空本页示例；切换场景可恢复。'; }
    else if (type==='stopWorkflow') { feedback.textContent='停止按钮示例，不执行真实停止操作。'; }
  });
  frame.addEventListener('load',()=>{ ready=Boolean(frame.contentWindow.__runLog); load(); });
  if (frame.contentWindow.__runLog) { ready=true; load(); }
})();
