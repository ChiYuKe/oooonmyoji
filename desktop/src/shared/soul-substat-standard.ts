import type { OptimizationObjective, OptimizationOptions, Panel, PanelKey } from './soul-optimizer';
import type { SoulAttribute, SoulRecord } from './souls';

export const SUBSTAT_STATUS = { core: '核心有效', conditional: '条件有效', low: '低收益', overflow: '已溢出', invalid: '用途无效', pending: '待确认' } as const;
export type SubstatStatus = keyof typeof SUBSTAT_STATUS;
export const SOUL_USAGES = {
  auto: '按套装默认用途', damage: '普通攻击型输出', attack: '攻击指标', speed: '一速 / 速度',
  control: '控制 / 减益', hp: '生命指标', defense: '防御指标', resist: '抵抗指标',
  crit: '暴击指标', critDamage: '暴击伤害指标', shield: '生命护盾（可暴击）',
  healHp: '生命治疗（可暴击）', healAttack: '攻击治疗（可暴击）', healDefense: '防御治疗（可暴击）',
  counter: '抵抗反击输出', critThreshold: '叠叩暴击门槛保护',
  survival: '生存 / 保护', utility: '功能辅助（需指定职责）', mixed: '多种用途（需指定职责）', boss: '首领套（随完整方案）',
} as const;
export type SoulUsage = keyof typeof SOUL_USAGES;
export interface SubstatContext {
  usage?: SoulUsage; objective?: OptimizationObjective; ranges?: OptimizationOptions['ranges'];
  panel?: Panel; gear?: readonly SoulRecord[]; heroName?: string;
}
export interface SubstatAssessment {
  status: SubstatStatus; reason: string; effectiveValue: number; overflowValue: number;
}
export const OBJECTIVE_SUBSTATS: Record<OptimizationObjective, readonly string[]> = {
  damage: ['attackAdditionRate', 'critPowerAdditionVal', 'critRateAdditionVal', 'attackAdditionVal'],
  attack: ['attackAdditionRate', 'attackAdditionVal'], hp: ['maxHpAdditionRate', 'maxHpAdditionVal'],
  defense: ['defenseAdditionRate', 'defenseAdditionVal'], speed: ['speedAdditionVal'],
  crit: ['critRateAdditionVal'], critDamage: ['critPowerAdditionVal'], hit: ['debuffEnhance'], resist: ['debuffResist'],
};
const definitions: Array<[number, string, SoulUsage]> = [
  [300032,"珍珠","mixed"],
  [300033,"骰子鬼","counter"],
  [300034,"蚌精","shield"],
  [300035,"魅妖","control"],
  [300036,"针女","damage"],
  [300039,"返魂香","control"],
  [300048,"狂骨","damage"],
  [300049,"幽谷响","survival"],
  [300050,"土蜘蛛","boss"],
  [300051,"胧车","boss"],
  [300052,"荒骷髅","boss"],
  [300053,"地震鲶","boss"],
  [300054,"蜃气楼","boss"],
  [300055,"片叶之苇","damage"],
  [300056,"尘冢","damage"],
  [300057,"油赤子","utility"],
  [300058,"夜啼石","mixed"],
  [300059,"夜送犬","survival"],
  [300060,"雨降","survival"],
  [300073,"飞缘魔","control"],
  [300074,"兵主部","damage"],
  [300075,"青女房","mixed"],
  [300076,"涂佛","utility"],
  [300077,"鬼灵歌伎","boss"],
  [300079,"遗念火","utility"],
  [300080,"共潜","utility"],
  [300081,"恶楼","mixed"],
  [300082,"贝吹坊","damage"],
  [300083,"海月火玉","damage"],
  [300084,"出世螺","survival"],
  [300085,"火之车","utility"],
  [300086,"隐念","damage"],
  [300087,"叠叩","critThreshold"],
  [300088,"应声虫","mixed"],
  [300089,"元兴寺","control"],
  [300090,"钓瓶火","defense"],
  [300091,"夜荒魂","boss"],
  [300092,"无刀取","damage"],
  [300093,"奉海图","survival"],
  [300094,"八咫镜","boss"],
  [300095,"天羽羽斩","boss"],
  [300096,"预言星盘","boss"],
  [300097,"月之石","boss"],
  [300098,"纺缘锤","boss"],
  [300099,"稻荷穗箭","boss"],
  [300002,"雪幽魂","control"],
  [300003,"地藏像","survival"],
  [300004,"蝠翼","mixed"],
  [300006,"涅槃之火","survival"],
  [300007,"三味","utility"],
  [300008,"魍魉之匣","control"],
  [300009,"被服","survival"],
  [300010,"招财猫","utility"],
  [300011,"反枕","control"],
  [300012,"轮入道","mixed"],
  [300013,"日女巳时","survival"],
  [300014,"镜姬","survival"],
  [300015,"钟灵","control"],
  [300018,"狰","mixed"],
  [300019,"火灵","utility"],
  [300020,"鸣屋","damage"],
  [300021,"薙魂","survival"],
  [300022,"心眼","damage"],
  [300023,"木魅","utility"],
  [300024,"树妖","mixed"],
  [300026,"网切","damage"],
  [300027,"阴摩罗","mixed"],
  [300029,"伤魂鸟","mixed"],
  [300030,"破势","damage"],
  [300031,"镇墓兽","damage"],
];
export const SUIT_DEFAULT_USAGES: Readonly<Record<number, SoulUsage>> = Object.fromEntries(definitions.map(([id,,usage])=>[id,usage]));
const statPanels: Record<string, PanelKey> = { attackAdditionRate:'attack',attackAdditionVal:'attack',maxHpAdditionRate:'hp',maxHpAdditionVal:'hp',defenseAdditionRate:'defense',defenseAdditionVal:'defense',speedAdditionVal:'speed',critRateAdditionVal:'crit',critPowerAdditionVal:'critDamage',debuffEnhance:'hit',debuffResist:'resist' };
const low = new Set(['attackAdditionVal','maxHpAdditionVal','defenseAdditionVal']);
const conditional = ['speedAdditionVal','maxHpAdditionRate','maxHpAdditionVal','defenseAdditionRate','defenseAdditionVal','debuffResist'];
const templates: Partial<Record<SoulUsage, readonly string[]>> = {
  control: ['debuffEnhance'], shield: ['maxHpAdditionRate','maxHpAdditionVal','critRateAdditionVal','critPowerAdditionVal'],
  healHp: ['maxHpAdditionRate','maxHpAdditionVal','critRateAdditionVal','critPowerAdditionVal'],
  healAttack: ['attackAdditionRate','attackAdditionVal','critRateAdditionVal','critPowerAdditionVal'],
  healDefense: ['defenseAdditionRate','defenseAdditionVal','critRateAdditionVal','critPowerAdditionVal'], survival: [],
  counter: ['attackAdditionRate','attackAdditionVal','critRateAdditionVal','critPowerAdditionVal','debuffResist'], critThreshold: ['critRateAdditionVal'],
};
const names = new Map(definitions.map(([id,name])=>[id,name]));
export function resolvedSoulUsage(soul: SoulRecord, context: SubstatContext = {}): SoulUsage {
  if(context.objective) return context.objective==='hit'?'control':context.objective;
  if(context.usage && context.usage!=='auto') return context.usage;
  if(context.heroName==='不见岳') return 'defense';
  if(context.heroName==='因幡辉夜姬') return 'mixed'; // PVE/PVP duties differ; never silently choose one.
  return SUIT_DEFAULT_USAGES[soul.suitId??-1] ?? 'mixed';
}
export function substatUsageNote(soul: SoulRecord, context: SubstatContext = {}): string {
  const usage=resolvedSoulUsage(soul,context), suit=names.get(soul.suitId??-1)??soul.name;
  const source=context.objective?'用户指标':context.usage && context.usage!=='auto'?'指定用途':context.heroName==='不见岳'?'式神防御收益':'套装默认用途';
  const special=suit==='日女巳时'?'日女自身推条不吃命中。':suit==='蚌精'?'开场护盾看生命与有效暴击，不由两件套命中决定。':suit==='钓瓶火'?'套装治疗随防御提高。':suit==='叠叩'?'四件套须初始暴击严格超过 120%。':suit==='骰子鬼'?'抵抗反击用途需要另设抵抗条件。':'';
  const hero=context.heroName==='不见岳' && context.objective && context.objective!=='defense'?'不见岳的增伤收益需用防御指标另评。':context.heroName==='因幡辉夜姬' && context.objective==='damage'?'其爆伤增益辅助用途应选择暴击伤害指标，不用普通输出分衡量。':'';
  return `${source}：${SOUL_USAGES[usage]}。${special}${hero}${['mixed','utility','boss'].includes(usage)?'未指定职责，暂不判断核心与无效。':''}`;
}
/** Only known mandatory panel triggers, never infer all combat conditions from prose. */
export function suitMechanicRanges(gear: readonly Pick<SoulRecord,'suitId'>[], ranges: OptimizationOptions['ranges']): OptimizationOptions['ranges'] {
  const id=300087;
  if(gear.filter(soul=>soul.suitId===id).length<4) return ranges;
  return {...ranges,crit:{...ranges.crit,min:Math.max(ranges.crit?.min??0,1.20000001)}};
}
/** Classifies a substat in this usage; values remain actual values and never add a pollution penalty. */
export function assessSoulSubstat(soul: SoulRecord, attr: SoulAttribute, context: SubstatContext = {}): SubstatAssessment {
  const result=(status:SubstatStatus,reason:string,effectiveValue=attr.value,overflowValue=0):SubstatAssessment=>({status,reason,effectiveValue,overflowValue});
  const usage=resolvedSoulUsage(soul,context), key=statPanels[attr.name], ranges=context.gear?suitMechanicRanges(context.gear,context.ranges??{}):context.ranges, range=key?ranges?.[key]:undefined;
  const core=context.objective?OBJECTIVE_SUBSTATS[context.objective]:templates[usage] ?? OBJECTIVE_SUBSTATS[usage as OptimizationObjective] ?? [];
  if(!key) return result('pending','尚未识别此属性的机制。',0);
  if(core.includes(attr.name)) {
    if(attr.name==='critRateAdditionVal' && usage==='critThreshold' && !context.panel)return result('conditional','叠叩需要完整方案初始暴击严格超过 120%，此处尚无完整面板。');
    if(attr.name==='critRateAdditionVal' && ['damage','counter','critThreshold','shield','healHp','healAttack','healDefense'].includes(usage) && context.panel) {
      const cap=Math.max(usage==='critThreshold'?1.20000001:1,range?.min??0), gear=context.gear;
      const totalSubCrit=gear?gear.reduce((sum,item)=>sum+(item.subAttributes??[]).filter(a=>a.name===attr.name).reduce((v,a)=>v+a.value,0),0):attr.value;
      const fixedCrit=context.panel.crit-totalSubCrit;
      let remaining=Math.max(0,cap-fixedCrit), remainingCore=usage==='critThreshold'?0:Math.max(0,1-fixedCrit);
      if(gear) for(const item of [...gear].sort((a,b)=>(a.position??0)-(b.position??0)||a.id.localeCompare(b.id))) {
        if(item.id===soul.id)break;
        const allocated=(item.subAttributes??[]).filter(a=>a.name===attr.name).reduce((v,a)=>v+a.value,0);
        remaining=Math.max(0,remaining-allocated);remainingCore=Math.max(0,remainingCore-allocated);
      }
      const useful=Math.min(attr.value,remaining), excess=Math.max(0,attr.value-useful);
      if(useful<1e-9)return result('overflow','当前完整方案已满足有效暴击与指定暴击门槛，此部分不再提高所选指标。',0,attr.value);
      if(remainingCore<1e-9)return result('conditional','普通满暴已满足，此部分用于用户指定的暴击门槛或叠叩触发条件。',useful,excess);
      if(excess>1e-9)return result('core','部分用于满暴或指定门槛，其余已溢出；按号位分摊，避免重复计数。',useful,excess);
    }
    return result(low.has(attr.name)?'low':'core',low.has(attr.name)?'确实提升所选指标，但属于固定数值属性；收益按实际基础面板计算。':'直接提升当前所选指标或用途。');
  }
  if(range && (range.min!=null||range.max!=null))return result('conditional',`需符合用户设置的${range.max!=null?'上下限':'下限'}，不直接增加主要指标评分。`);
  if(['mixed','utility','boss'].includes(usage))return result('pending','套装可承担不同职责，需选择用途后才能判断。',0);
  if(!context.objective && ['control','survival','counter','critThreshold','shield','healHp','healAttack','healDefense'].includes(usage) && conditional.includes(attr.name))return result('conditional','可能承担配速、生存或抗控条件；未提供完整方案，需按实际职责确认。');
  if(!context.objective && usage==='damage' && attr.name==='speedAdditionVal')return result('conditional','输出配速需要时有效；未设配速时不计入输出收益。');
  return result('invalid','不提升当前指标，也未承担指定属性条件。',0);
}
export function summarizeSoulSubstats(soul: SoulRecord, context: SubstatContext = {}): Record<SubstatStatus,number> {
  const totals={core:0,conditional:0,low:0,overflow:0,invalid:0,pending:0};
  for(const attr of soul.subAttributes??[])totals[assessSoulSubstat(soul,attr,context).status]++;
  return totals;
}
