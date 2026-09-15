/* Stable storage keys, display names and reusable value definitions. No DOM/runtime side effects. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.VariableSystem=api;})(globalThis,()=>{
  const copy=value=>JSON.parse(JSON.stringify(value));
  const own=(value,key)=>Object.prototype.hasOwnProperty.call(value||{},key);
  const binding=value=>!!value&&typeof value==='object'&&Object.keys(value).length===1&&typeof value.ref==='string';
  const presets={
    retry:{type:'object',properties:{attempts:{type:'integer',min:1,required:true,default:2},delay_seconds:{type:'number',min:0,required:true,default:0}},default:{attempts:2,delay_seconds:0}},
    vector2:{type:'object',properties:{x:{type:'number',required:true,default:0},y:{type:'number',required:true,default:0}},default:{x:0,y:0}},
    match:{type:'object',properties:{x:{type:'integer',required:true,default:0},y:{type:'integer',required:true,default:0},width:{type:'integer',min:0,required:true,default:0},height:{type:'integer',min:0,required:true,default:0},confidence:{type:'number',min:0,max:1,required:true,default:0}},default:{x:0,y:0,width:0,height:0,confidence:0}}
  };
  function label(raw,scope,id){return raw?.[scope]?.[id]?.display_name||id;}
  function create(raw,scope,name,definition,value){
    if(!['inputs','variables'].includes(scope))throw Error('Invalid variable scope');
    raw[scope] ||= {};
    let id;do{id='v_'+(globalThis.crypto?.randomUUID?.().replace(/-/g,'')||Math.random().toString(36).slice(2)+Date.now().toString(36));}while(own(raw.inputs,id)||own(raw.variables,id));
    const entry=copy(definition);entry.display_name=name;
    delete entry.required;delete entry.owner;delete entry.initial_from;
    if(value!==undefined)entry.default=copy(value);
    raw[scope][id]=entry;return id;
  }
  function rename(raw,scope,id,name){
    if(!name.trim())throw Error('名称不能为空');
    if(Object.entries(raw[scope]||{}).some(([key])=>key!==id&&label(raw,scope,key)===name))throw Error('名称已存在');
    raw[scope][id].display_name=name;
  }
  function references(raw,scope,id){
    const prefix=`${scope}.${id}`,found=[];
    function walk(value,path,nodeId){
      if(!value||typeof value!=='object')return;
      if(binding(value)&&(value.ref===prefix||value.ref.startsWith(prefix+'.')))found.push({nodeId,path,ref:value.ref});
      for(const [key,child] of Object.entries(value))walk(child,path+'.'+key,nodeId);
    }
    for(const node of raw.nodes||[])walk(node,'nodes.'+node.id,node.id);
    for(const [key,definition] of Object.entries(raw.variables||{}))if(definition.initial_from===id&&scope==='inputs')found.push({path:`variables.${key}.initial_from`,initializer:true});
    return found;
  }
  function expose(raw,id){
    const definition=raw.variables[id];
    if(definition.initial_from&&own(raw.inputs,definition.initial_from)){
      const existing=raw.inputs[definition.initial_from];
      if(own(definition,'default'))existing.default=copy(definition.default);else delete existing.default;
      return definition.initial_from;
    }
    const input=copy(definition);delete input.initial_from;input._autoPublished=true;
    const inputId=create(raw,'inputs',label(raw,'variables',id),input,definition.default);
    definition.initial_from=inputId;return inputId;
  }
  function referenceLabel(raw,ref){
    const [scope,id,...tail]=ref.split('.');
    if(scope==='inputs'||scope==='variables')return `变量 · ${label(raw,scope,id)}${tail.length?' › '+tail.join(' › '):''}`;
    return ref;
  }
  function visible(raw,owner,nodeId){
    if(!owner)return true;
    const seen=new Set(),pending=[owner];
    while(pending.length){const id=pending.pop();if(id===nodeId)return true;if(seen.has(id))continue;seen.add(id);pending.push(...(raw.nodes.find(node=>node.id===id)?.children||[]));}
    return false;
  }
  function defaultAt(raw,ref){
    const [scope,id,...parts]=ref.split('.');let value=raw[scope]?.[id]?.default;
    for(const part of parts)value=value?.[part];
    return value===undefined?undefined:copy(value);
  }
  function containsBinding(value){return binding(value)||!!value&&typeof value==='object'&&Object.values(value).some(containsBinding);}
  function cleanupReleased(raw, before){
    const removed=[];
    for(const [id,definition] of Object.entries(before.inputs||{})){
      if(!definition._autoPublished || !raw.inputs?.[id]?._autoPublished)continue;
      if(!references(before,'inputs',id).length || references(raw,'inputs',id).length)continue;
      // A manually placed Get card remains a user-owned use of the input.
      if(Object.values(raw._variableCards||{}).some(card=>card.scope!=='variables'&&card.name===id))continue;
      delete raw.inputs[id];removed.push(id);
    }
    return removed;
  }
  return {create,rename,label,references,expose,referenceLabel,presets,copy,visible,defaultAt,containsBinding,cleanupReleased};
});
