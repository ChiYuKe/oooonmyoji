import { analyzeSoulTarget } from '../shared/soul-target-analysis';
import type { TargetScoreRange } from '../shared/soul-target-analysis';
import { formatPlanScore, OPTIMIZATION_OBJECTIVES, PANEL_LABELS } from '../shared/soul-optimizer';
import type { OptimizationOptions, PanelKey, SearchResult, SoulPlan, SuitProfile } from '../shared/soul-optimizer';
import type { SoulAttribute, SoulRecord } from '../shared/souls';
import { createSoulPositionPortrait } from './soul-position-portrait';
import { appendEffectNumbers } from './effect-text';
import { assessSoulSubstat, summarizeSoulSubstats, substatUsageNote } from '../shared/soul-substat-standard';
import { appendSubstatIndicator, appendSubstatSummary } from './soul-substat-indicator';
import { generateSoulReferences } from '../shared/soul-reference';
import type { Panel } from '../shared/soul-optimizer';
import { SOUL_SLOT_MAIN_ATTRIBUTES } from '../shared/soul-slots';
import { SIX_STAR_SUBSTAT_ROLLS, SIX_STAR_SUBSTAT_MIN_FACTOR, SIX_STAR_SUBSTAT_MAX_ALLOCATIONS, SIX_STAR_SUBSTAT_TOTAL_ALLOCATIONS, REFERENCE_SUBSTAT_MAX_FACTOR } from '../shared/soul-attribute-limits';
const labels:Record<string,string>={attackAdditionRate:'攻击加成',attackAdditionVal:'攻击',maxHpAdditionRate:'生命加成',maxHpAdditionVal:'生命',defenseAdditionRate:'防御加成',defenseAdditionVal:'防御',speedAdditionVal:'速度',critRateAdditionVal:'暴击',critPowerAdditionVal:'暴击伤害',debuffEnhance:'效果命中',debuffResist:'效果抵抗'};
const flat=new Set(['attackAdditionVal','maxHpAdditionVal','defenseAdditionVal','speedAdditionVal']);
const value=(name:string,amount:number):string=>flat.has(name)?amount.toFixed(2):`${(amount*100).toFixed(2)}%`;
const attribute=(attr:SoulAttribute):string=>`${labels[attr.name]??attr.label} ${value(attr.name,attr.value)}`;
export function renderSoulTarget(host:HTMLElement,target:number|TargetScoreRange,plan:SoulPlan,inventory:readonly SoulRecord[],catalog:SuitProfile[],options:OptimizationOptions,status:SearchResult['status'],viewPlan?:(plan:SoulPlan)=>void,heroName?:string):void {
  host.replaceChildren();const doc=host.ownerDocument;
  const text=(parent:HTMLElement,tag:string,content:string,className=''):HTMLElement=>{const node=doc.createElement(tag);node.textContent=content;node.className=className;parent.append(node);return node;};
  const highlighted=(parent:HTMLElement,tag:string,content:string,className=''):HTMLElement=>{const node=text(parent,tag,'',className);appendEffectNumbers(node,content);return node;};
  const analysis=analyzeSoulTarget(plan,inventory,catalog,options,target),score=(amount:number):string=>formatPlanScore(amount,options.objective),objective=OPTIMIZATION_OBJECTIVES[options.objective].label;
  const souls=analysis.souls;
  host.dataset.achieved=String(analysis.achieved);delete host.dataset.routes;
  const stats=text(host,'div','','soul-target-stats');
  const aboveMax=analysis.targetMax!=null&&analysis.currentScore>analysis.targetMax+1e-9;
  const goal=typeof target==='number'?score(target):target.min==null?`≤ ${score(target.max!)}`:target.max==null?`≥ ${score(target.min)}`:`${score(target.min)} ～ ${score(target.max)}`;
  for(const [label,content,kind]of [['目标范围',goal,'goal'],['当前方案评分',score(analysis.currentScore),'current'],[aboveMax?'超过上限':'还差',score(analysis.gap),'gap']]as const){const item=text(stats,'div','');item.dataset.kind=kind;text(item,'small',label);text(item,'strong',content,kind==='goal'&&typeof target!=='number'&&target.min!=null&&target.max!=null?'soul-target-goal-range':'');}
  const overview=text(host,'section','','soul-target-overview'),overviewText=text(overview,'div','','soul-target-overview-text');
  highlighted(overviewText,'p',`评分指标：${objective} · 当前套装：${analysis.preservedSets.map(set=>`${catalog.find(suit=>suit.id===set.suitId)?.name??set.suitId} ${set.count} 件${set.boss?'（首领套）':'（四件套效果）'}`).join('、')||'散件'}。`,'soul-target-constraints');
  highlighted(overviewText,'p',analysis.achieved?'当前方案已达到目标范围。':aboveMax?`当前方案评分超过目标上限 ${score(analysis.gap)}。可选择其他实际方案。`:`当前方案距目标下限还差 ${score(analysis.gap)}。+15 御魂的属性已固定，提高评分需要更换实际御魂。`,analysis.achieved?'soul-target-success':'soul-target-note');
  if(viewPlan){const button=doc.createElement('button');button.type='button';button.className='soul-target-view-original';button.textContent='查看方案详情 ↗';button.addEventListener('click',()=>viewPlan(plan));overview.append(button);}
  const rules=text(host,'details','','soul-target-rules');text(rules,'summary','分析规则与面板限制');
  if(heroName==='不见岳'||heroName==='因幡辉夜姬')text(rules,'p',substatUsageNote(souls[0],{objective:options.objective,heroName}),'soul-target-note');
  text(rules,'p',`指标相关副属性：${analysis.effectiveAttributes.map(name=>labels[name]).join('、')}。${options.objective==='damage'?'伤害输出按攻击 × 期望暴击倍率计算；满暴后的额外暴击不增加普通伤害评分。小攻击按低收益有效处理。':''}`,'soul-target-note');
  if(souls.filter(soul=>soul.suitId===300087).length>=4)text(rules,'p','叠叩四件套的功能条件：初始暴击严格大于 120%，已校验当前方案。','soul-target-note');
  const rangeText=Object.entries(analysis.ranges).map(([key,range])=>{
    const format=(amount:number):string=>['crit','critDamage','hit','resist'].includes(key)?`${(amount*100).toFixed(2)}%`:amount.toFixed(2);
    return `${PANEL_LABELS[key as PanelKey]} ${range.min==null?'不限下限':format(range.min)} ～ ${range.max==null?'不限上限':format(range.max)}`;
  }).join('；');
  if(rangeText)text(rules,'p',`当前面板限制：${rangeText}。`,'soul-target-note');
  text(rules,'p','评分和副词条分类均使用选定方案的实际御魂。+15 属性已固定，分析仅展示当前数值及目标差距；套装触发伤害不另计入所选指标评分。','soul-target-note');
  if(status!=='complete')text(overviewText,'p','配装搜索尚未完成，当前评分只代表选定的实际方案。','soul-target-note');
  const renderDetails=(parent:HTMLElement,gear:readonly SoulRecord[],currentPanel:Panel,reference=false):void=>{
  const context={objective:options.objective,ranges:analysis.ranges,panel:currentPanel,gear};
  const detail=text(parent,'section','','soul-target-plan-detail');text(detail,'h4',reference?'参考御魂配置':'当前方案副词条');
  const slots=text(detail,'div','','soul-target-slots');
  for(const soul of gear){
    const card=text(slots,'article','','soul-target-slot');card.dataset.position=String(soul.position);card.dataset.suitId=String(soul.suitId);card.dataset.soulId=soul.id;
    const head=text(card,'div','','soul-target-slot-head');head.append(createSoulPositionPortrait(doc,soul));const identity=text(head,'div','');text(identity,'strong',soul.name??catalog.find(suit=>suit.id===soul.suitId)?.name??'御魂');text(identity,'small',`${soul.position} 号位 · ${soul.stars} 星 · +${soul.level}`);
    highlighted(card,'p',`主属性 ${attribute(soul.mainAttribute!)}`,'soul-target-main');
    const caption=text(card,'div','','soul-target-caption');text(caption,'small',reference?'参考副属性':'实际副属性');appendSubstatSummary(caption,summarizeSoulSubstats(soul,context));
    const subs=text(card,'ul','','soul-target-attributes');
    for(const attr of soul.subAttributes??[]){
      const row=text(subs,'li','');row.dataset.attribute=attr.name;row.dataset.value=String(attr.value);row.dataset.rolls=String(attr.rolls);
      const assessment=assessSoulSubstat(soul,attr,context);row.dataset.substatStatus=assessment.status;
      const label=text(row,'span','','soul-substat-label');appendSubstatIndicator(label,assessment.status,assessment.reason+(assessment.overflowValue>1e-9?` 溢出 ${value(attr.name,assessment.overflowValue)}。`:''));label.append(labels[attr.name]??attr.label);
      text(row,'strong',value(attr.name,attr.value),'effect-number');
    }
    for(const attr of soul.intrinsicAttributes??[])highlighted(card,'p',`固有属性：${attribute(attr)}`,'soul-target-intrinsic');
    if(reference)text(card,'small',`属性分配：${soul.subAttributes!.map(attr=>`${labels[attr.name]} ${attr.rolls} 次`).join('、')}（含初始属性，共 9 次）`,'soul-target-note');
  }
  const panel=text(detail,'section','','soul-target-panel');text(panel,'h4',reference?'参考属性面板':'当前属性面板');const values=text(panel,'div','','soul-target-panel-values');
  for(const [key,label]of Object.entries(PANEL_LABELS)){const item=text(values,'div','');text(item,'small',label);text(item,'strong',formatPlanScore(currentPanel[key as PanelKey],['crit','critDamage','hit','resist'].includes(key)?key as OptimizationOptions['objective']:undefined));}
  };
  renderDetails(host,souls,analysis.currentPanel);
  const references=text(host,'section','','soul-system-references'),heading=text(references,'div','','soul-system-reference-heading');
  text(heading,'h4','系统参考配置');const generate=doc.createElement('button');generate.type='button';generate.textContent='生成参考配置';generate.dataset.action='generate-references';heading.append(generate);
  text(references,'p','按用户配装条件独立生成，保留原方案四件套与首领套，主属性从各位置勾选的范围中选择，固有属性按指标与面板限制选择。参考御魂需另行获得，供寻找或换装时对照。','soul-target-note');
  text(references,'p','副属性逐次采用浮动收益，参考配置排除每次都取上限的极端数值。','soul-target-note');
  const limits=text(references,'details','','soul-attribute-limits');text(limits,'summary','查看六星御魂属性标准');
  text(limits,'p',`初始四条副属性加五次强化，共 ${SIX_STAR_SUBSTAT_TOTAL_ALLOCATIONS} 次分配；单条最多 ${SIX_STAR_SUBSTAT_MAX_ALLOCATIONS} 次，不能同时将四条堆至上限。参考配置逐次采样上限的 ${SIX_STAR_SUBSTAT_MIN_FACTOR*100}%～${REFERENCE_SUBSTAT_MAX_FACTOR*100}%，理论上限与推荐采样上限分开。`,'soul-target-note');
  const limitTable=text(limits,'table',''),head=text(limitTable,'thead',''),headRow=text(head,'tr','');
  for(const title of ['副属性','单次浮动范围','单条理论上限'])text(headRow,'th',title).setAttribute('scope','col');
  const body=text(limitTable,'tbody','');
  for(const [name,max] of Object.entries(SIX_STAR_SUBSTAT_ROLLS)){
    const row=text(body,'tr','');text(row,'th',labels[name]).setAttribute('scope','row');
    text(row,'td',`${value(name,max*SIX_STAR_SUBSTAT_MIN_FACTOR)}～${value(name,max)}`);text(row,'td',value(name,max*SIX_STAR_SUBSTAT_MAX_ALLOCATIONS));
  }
  text(limits,'p','六星 +15 主属性：攻击 486、防御 104、生命 2052、速度 57；攻击／生命／防御加成、暴击、效果命中、效果抵抗 55%，暴击伤害 89%。','soul-target-note');
  const mainText=[2,4,6].map(position=>`${position} 号位 ${options.mainAttributes[position]?.length?options.mainAttributes[position].map(name=>labels[name]).join('／'):SOUL_SLOT_MAIN_ATTRIBUTES[position].map(name=>labels[name]).join('／')}`).join('；');
  text(references,'p',`参考配置须同时满足：${objective}；目标 ${goal}；${mainText}${rangeText?`；${rangeText}`:''}。`,'soul-target-note');
  const output=text(references,'div','','soul-system-reference-output');output.setAttribute('aria-live','polite');
  generate.addEventListener('click',()=>{
    generate.disabled=true;generate.textContent='正在生成…';
    doc.defaultView?.setTimeout(()=>{
      if(!host.contains(references))return;
      try{
        const result=generateSoulReferences(analysis,options,catalog);output.replaceChildren();
        if(result.reason)text(output,'p',result.reason,'soul-target-note');
        if(result.configs.length){
          text(output,'p',`已生成 ${result.configs.length} 套参考配置 · 六星 +15 · 各件四条副属性 · 已校验目标、套装、主属性及面板限制`,'soul-target-note');
          const tabs=text(output,'div','','soul-system-reference-tabs'),details=text(output,'div','','soul-system-reference-details');
          result.configs.forEach((reference,index)=>{
            const button=doc.createElement('button');button.type='button';button.dataset.reference=String(index);button.dataset.score=String(reference.score);button.dataset.meetsTarget=String(reference.meetsTarget);
            text(button,'strong',`参考配置 ${index+1} · ${score(reference.score)}`);text(button,'small','符合全部限制');
            button.addEventListener('click',()=>{for(const tab of tabs.children)tab.setAttribute('aria-pressed',String(tab===button));details.replaceChildren();renderDetails(details,reference.souls,reference.panel,true);});tabs.append(button);
          });
          (tabs.firstElementChild as HTMLButtonElement).click();
        }
        generate.textContent='重新生成';
      }catch(error){output.replaceChildren();text(output,'p',error instanceof Error?error.message:String(error),'soul-target-error');generate.textContent='生成参考配置';}
      generate.disabled=false;
    },0);
  });
}
