(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const make = (tag, cls, text) => { const node = document.createElement(tag); node.className = cls; if (text !== undefined) node.textContent = text; return node; };
  const report = text => { $('demo-feedback').textContent = text; };
  const themeControl = UI.segmented({value:window.StudioTheme.get(), label:'预览主题', options:[{value:'dark',label:'深色'},{value:'light',label:'浅色'}],onChange:theme=>window.StudioTheme.set(theme)});
  $('demo-theme').appendChild(themeControl);
  window.StudioTheme.subscribe(theme=>themeControl.set(theme));
  const choices = [{ value: 'literal', label: '固定值' }, { value: 'binding', label: '变量' }];
  ['浏览', '截取', '替换'].forEach(label => $('demo-buttons').appendChild(UI.button({ label, onClick: () => report(`点击了「${label}」`) })));
  $('demo-buttons').appendChild(UI.button({ label: '删除', variant: 'danger', onClick: () => report('删除按钮示例，不删除数据') }));
  $('demo-buttons').appendChild(UI.button({ label: '不可用', disabled: true }));
  $('demo-inputs').appendChild(UI.input({ value: '等待挑战按钮消失', label: '显示名称', onChange: value => report(`名称：${value}`) }));
  $('demo-inputs').appendChild(UI.input({ placeholder: '输入模板路径', label: '模板路径' }));
  $('demo-inputs').appendChild(UI.input({ value: '只读字段', readOnly: true, label: '只读示例' }));
  $('demo-inputs').appendChild(UI.input({ value: '禁用字段', disabled: true, label: '禁用示例' }));
  [false, true].forEach(checked => $('demo-checks').appendChild(UI.checkField({ checked, label: checked ? '已启用' : '可选项', onChange: next => report(`复选框：${next}`) })));
  $('demo-checks').appendChild(UI.checkField({ checked: true, disabled: true, label: '不可用' }));
  ['literal', 'binding'].forEach(value => $('demo-segments').appendChild(UI.segmented({ value, options: choices, onChange: next => report(`值来源：${next === 'literal' ? '固定值' : '变量'}`) })));
  const actions = [{ value: 'vision.wait_template', label: '等待模板', detail: 'vision.wait_template' }, { value: 'vision.wait_any', label: '等待任一模板', detail: 'vision.wait_any' }, { value: 'core.sleep', label: '等待', detail: 'core.sleep' }];
  $('demo-dropdowns').appendChild(UI.dropdown({ value: actions[0].value, options: actions, searchable: true, label: '选择动作', onChange: value => report(`动作：${value}`) }));
  $('demo-dropdowns').appendChild(UI.dropdown({ value: 'off', options: [{value:'off', label:'不可用'}], disabled: true }));
  Object.keys(UI.ICON_SVG).forEach(name => $('demo-icons').appendChild(UI.iconButton('', name, name, () => report(`图标：${name}`))));
  $('demo-rect').appendChild(UI.rect({ value: [708,958,491,122], onChange: value => report(`区域：${value.join(', ')}`), onPick: () => report('框选入口示例') }));
  $('demo-rect-disabled').appendChild(UI.rect({value:[0,0,100,100],disabled:true}));
  $('demo-dropdowns').appendChild(UI.dropdown({value:'ready',label:'含禁用选项的搜索列表',searchable:true,options:[{value:'ready',label:'可用选项'},{value:'locked',label:'禁用选项',disabled:true},{value:'next',label:'下一项',detail:'搜索后可按方向键选择'}],onChange:value=>report(`选择：${value}`)}));
  for (const [token, label] of [['bg','背景'], ['panel','面板'], ['surface','控件'], ['selected','选中']]) {
    const row = make('div', 'swatch'); const color = make('i',''); color.style.background = `var(--ui-${token})`;
    row.append(color, make('span','',label)); $('demo-swatches').appendChild(row);
  }
  $('preview-width').addEventListener('input', event => { $('inspector').style.width = `${event.target.value}px`; $('preview-width-label').textContent = `${event.target.value}px`; });
  const data = { template: 'assets/templates/task_1-template.png', timeout: 6, present: false, roi: [1621,796,299,284], threshold: .88, scale: false };
  const modes = {}; const folded = new Set();
  function section(title, action) {
    const header = UI.sectionHeader({ title, action, className: 'section-header' });
    const body = make('div','section-content');
    const sync = () => { header.classList.toggle('collapsed', folded.has(title)); body.classList.toggle('collapsed', folded.has(title)); header.setAttribute('aria-expanded', String(!folded.has(title))); };
    const toggle = () => { if (folded.has(title)) folded.delete(title); else folded.add(title); sync(); };
    header.tabIndex = 0; header.setAttribute('role','button');
    header.addEventListener('click', e => { if (!e.target.closest('button')) toggle(); });
    header.addEventListener('keydown', e => { if (e.target === header && ['Enter',' '].includes(e.key)) { e.preventDefault(); toggle(); } });
    sync(); $('inspector-body').append(header,body); return body;
  }
  function field(body, label, control) { const row = make('label','field'); row.append(make('span','field-label',label),control); body.appendChild(row); }
  function parameter(body, key, title, description, control) {
    const block = make('div','parameter-block'); const head = make('div','parameter-heading'); const actions = make('div','parameter-heading-actions');
    actions.appendChild(UI.segmented({ value: modes[key] || 'literal', options: choices, onChange: next => { modes[key] = next; render(); } }));
    actions.appendChild(UI.checkField({ label: '输入' }));
    head.append(make('span','',title),actions); block.append(head,make('div','field-hint',description));
    if (modes[key] === 'binding') block.appendChild(UI.dropdown({ value:'input', options:[{value:'input',label:'输入 · 示例变量'}], label: `${title}引用` }));
    else block.appendChild(control());
    body.appendChild(block);
  }
  function render() {
    UI.closeDropdowns(); $('inspector-body').replaceChildren();
    const basic = section('节点');
    field(basic,'ID',UI.input({value:'confirm_challenge_disappeared',label:'节点 ID'}));
    field(basic,'显示名称',UI.input({value:'等待挑战按钮消失',label:'显示名称'}));
    field(basic,'类型',UI.dropdown({value:'task',options:[{value:'task',label:'任务'}],label:'节点类型'}));
    const action = section('动作'); field(action,'实现',UI.dropdown({value:actions[0].value,options:actions,searchable:true,label:'动作实现'}));
    action.appendChild(make('div','description','等待模板出现或消失，超时前满足即成功。'));
    const params = section('参数');
    parameter(params,'template','模板 *','模板图片路径',() => { const row = make('div','inline-control'); const path = UI.input({value:data.template,label:'模板路径',onChange:v=>{data.template=v;}}); path.dataset.assetPreview = 'true'; row.appendChild(path); ['浏览','截取','替换'].forEach(label=>row.appendChild(UI.button({label,onClick:()=>report(`${label}入口示例`)}))); return row; });
    parameter(params,'timeout','超时（秒）*','等待超时秒数，超时即失败',()=>UI.input({value:data.timeout,type:'number',min:0,label:'超时秒数',onChange:v=>{data.timeout=Number(v);}}));
    parameter(params,'present','存在性','开启等待出现；关闭等待消失',()=>UI.checkField({checked:data.present,label:'开启',onChange:v=>{data.present=v;}}));
    parameter(params,'roi','识别区域','以参考分辨率为准，单位：像素',()=>UI.rect({value:data.roi,onChange:v=>{data.roi=v;},onPick:()=>report('框选入口示例')}));
    parameter(params,'threshold','匹配阈值','匹配置信度，默认 0.85',()=>UI.input({value:data.threshold,type:'number',step:.01,label:'匹配阈值',onChange:v=>{data.threshold=Number(v);}}));
    parameter(params,'scale','多尺度搜索','启用多种缩放比例匹配',()=>UI.checkField({checked:data.scale,label:'开启',onChange:v=>{data.scale=v;}}));
    const nested = section('消失状态列表 · 对齐示例');
    const card = make('div','object-array-card');
    card.appendChild(make('div','object-array-head','#1 challenge'));
    const fields = make('div','object-array-body'); card.appendChild(fields); nested.appendChild(card);
    const structured = (label, control) => {
      const row = make('div','structured-field'), caption = make('div','structured-field-caption');
      caption.append(make('span','structured-field-label',label), UI.iconButton('field-binding-toggle','绑定父级引用','引用',()=>report('引用入口示例，不修改项目')));
      row.append(caption,control); fields.appendChild(row);
    };
    structured('名称 *',UI.input({value:'challenge',label:'状态名称'}));
    const asset = make('div','inline-control');
    asset.appendChild(UI.input({value:data.template,label:'状态模板路径'}));
    ['浏览','截取','替换'].forEach(label=>asset.appendChild(UI.button({label,onClick:()=>report(`${label}入口示例`)})));
    structured('模板',asset);
    const rect = make('div','rect-control');
    data.roi.forEach((value,index)=>rect.appendChild(UI.input({value,type:'number',label:['X','Y','宽','高'][index]})));
    rect.appendChild(UI.iconButton('rect-pick','框选区域','crop',()=>report('框选入口示例')));
    structured('识别区域',rect);
    structured('匹配阈值',UI.input({value:.88,type:'number',step:.01,label:'状态匹配阈值'}));
    const variableSection = section('变量详情 · 对齐示例');
    const variableDetails = make('div','variable-details'); variableSection.appendChild(variableDetails);
    field(variableDetails,'名称',UI.input({value:'结界突破阈值',label:'变量名称'}));
    field(variableDetails,'类型',UI.dropdown({value:'integer',options:[{value:'integer',label:'integer'}],label:'变量类型'}));
    const meta = make('div','variable-detail-meta');
    meta.append(UI.checkField({label:'必填'}),make('div','variable-usage','1 处节点引用')); variableDetails.appendChild(meta);
    const variableOptions = make('div','variable-options'); variableDetails.appendChild(variableOptions);
    field(variableOptions,'描述',UI.input({placeholder:'说明这个变量的用途',label:'变量描述'}));
    const defaultHead = make('div','variable-option-heading','默认值');
    const defaultBox = make('div','definition-default');
    const defaultInput = UI.input({value:30,type:'number',label:'变量默认值'});
    defaultBox.appendChild(defaultInput);
    defaultHead.appendChild(UI.checkField({checked:true,label:'启用',onChange:checked=>{defaultInput.disabled=!checked;}}));
    variableOptions.append(defaultHead,defaultBox,make('div','variable-option-heading','约束'));
    const shape = make('div','definition-shape'); variableOptions.appendChild(shape);
    field(shape,'最小值',UI.input({value:1,type:'number',label:'最小值'}));
    field(shape,'最大值',UI.input({placeholder:'不限',type:'number',label:'最大值'}));
    const decorators = section('装饰器',UI.button({label:'+ 添加',onClick:()=>report('添加装饰器入口示例')})); decorators.appendChild(make('div','empty-section','无装饰器'));
    decorators.appendChild(UI.button({label:'删除节点',variant:'danger',className:'danger full-command',onClick:()=>report('删除入口示例，不删除数据')}));
  }
  render();
})();
