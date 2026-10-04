import { evaluatePlan, planScore } from './soul-optimizer';
import type { OptimizationOptions, Panel, PanelKey, SoulPlan, SuitProfile } from './soul-optimizer';
import type { SoulRecord } from './souls';
import { OBJECTIVE_SUBSTATS, suitMechanicRanges } from './soul-substat-standard';

export { SIX_STAR_SUBSTAT_ROLLS } from './soul-attribute-limits';
export interface TargetSet { suitId: number; count: number; boss: boolean }
export interface TargetScoreRange { min?: number; max?: number }
export interface SoulTargetAnalysis {
  target: number; targetMax?: number; currentScore: number; currentPanel: Panel;
  gap: number; achieved: boolean; preservedSets: TargetSet[];
  effectiveAttributes: string[]; souls: readonly SoulRecord[]; ranges: OptimizationOptions['ranges'];
}

/** Read-only evaluation of the actual chosen scheme. Max-level stats are fixed. */
export function analyzeSoulTarget(plan: SoulPlan, inventory: readonly SoulRecord[], catalog: SuitProfile[], options: OptimizationOptions, requested: number | TargetScoreRange): SoulTargetAnalysis {
  const target=typeof requested==='number'?requested:requested.min??0, targetMax=typeof requested==='number'?undefined:requested.max;
  if(!Number.isFinite(target)||target<0||(typeof requested==='number'&&target===0)
    ||(typeof requested!=='number'&&requested.min==null&&requested.max==null)
    ||(targetMax!=null&&(!Number.isFinite(targetMax)||targetMax<target)))throw Error('目标评分范围需填写非负数，且下限不能大于上限。');
  const byId=new Map(inventory.map(soul=>[soul.id,soul])), gear=plan.ids.map(id=>byId.get(id));
  if(gear.length!==6||new Set(plan.ids).size!==6||gear.some((soul,index)=>!soul||soul.position!==index+1||!soul.attributesComplete||!soul.mainAttribute))throw Error('分析需要当前方案完整的六件御魂，请重新计算。');
  const originals=gear as SoulRecord[], ranges=suitMechanicRanges(originals,options.ranges);
  const panel=evaluatePlan(originals,options.base,catalog),currentScore=planScore(panel,options.objective);
  if(!Object.entries(ranges).every(([key,range])=>(range.min==null||panel[key as PanelKey]+1e-9>=range.min)&&(range.max==null||panel[key as PanelKey]-1e-9<=range.max)))throw Error('当前方案已不满足属性限制，请重新计算。');
  const counts=new Map<number,number>();for(const soul of originals)counts.set(soul.suitId!, (counts.get(soul.suitId!)??0)+1);
  const preservedSets=[...counts].flatMap(([suitId,count])=>{
    const boss=Boolean(catalog.find(s=>s.id===suitId)?.boss);
    return (boss?count>=2:count>=4)?[{suitId,count:boss?2:4,boss}]:[];
  });
  const aboveMax=targetMax!=null&&currentScore>targetMax+1e-9;
  return {target,targetMax,currentScore,currentPanel:panel,
    gap:aboveMax?currentScore-targetMax!:Math.max(0,target-currentScore),
    achieved:currentScore+1e-9>=target&&!aboveMax,preservedSets,
    effectiveAttributes:[...OBJECTIVE_SUBSTATS[options.objective]],souls:originals,ranges};
}
