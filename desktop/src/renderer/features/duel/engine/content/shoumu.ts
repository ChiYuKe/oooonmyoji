import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import { createBasicAttackSkill } from './common-skills';
import type { ContentRegistry } from './registry';

export const shoumuIds = {
  hero: 244,
  basic: '2441',
  passive: '2442',
  ultimate: '2443',
  stolenCrit: 'status.hero.244.stolen-crit',
  targetCritReduction: 'status.hero.244.target-crit-reduction',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const ultimateRatios = [2.06, 2.16, 2.26, 2.36, 2.46] as const;

export function registerShoumu(registry: ContentRegistry): void {
  registry.registerStatus({ id: shoumuIds.stolenCrit, mechanicsCoverage: 'partial', category: 'buff',
    dispellable: true, sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerStatus({ id: shoumuIds.targetCritReduction, mechanicsCoverage: 'partial', category: 'debuff',
    dispellable: true, sealable: true, durationOwner: 'target-turn', refreshPolicy: 'refresh-duration' });
  registry.registerHero(createShoumuDefinition());
}

export function createShoumuDefinition(): HeroDefinition {
  const basic = createBasicAttackSkill(shoumuIds.basic, basicRatios);
  const ultimate: SkillDefinition = {
    id: shoumuIds.ultimate, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'single', targetRelation: 'enemy', useClientDamageData: true,
    levels: ultimateRatios.map(ratio => ({ ratio, defenseIgnore: .4 })),
    execute(context, intent, parameters) {
      const owner = context.getUnit(intent.actorId);
      const target = context.getUnit(intent.targetIds[0] ?? '');
      if (!owner || !target) return [];
      const stats = context.getEffectiveStats(owner.unitId) ?? owner.stats;
      const defense = context.getEffectiveStats(target.unitId)?.defense ?? target.stats.defense;
      const effectiveDefense = Math.max(0, defense * (1 - Number(parameters.defenseIgnore ?? .4)) - effectiveDefenseIgnore(owner));
      const hit = context.calculateDamage({ attack: stats.attack,
        defense: effectiveDefense,
        ratio: Number(parameters.ratio ?? 2.06), critChance: stats.crit, critDamage: stats.critDamage }, owner, target);
      return [{ type: 'deal-damage', source: shoumuSource(shoumuIds.ultimate, owner.unitId), targetId: target.unitId,
        amount: hit.amount, ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}), isCritical: hit.isCritical }];
    },
  };
  return {
    id: shoumuIds.hero, skills: [basic, ultimate], aiCoverage: 'partial', mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['已按客户端技能表接入重击技能倍率、虚无技能3火/技能倍率/40%无视防御，以及冥火命中时固定偷取目标40%暴击并让同一时刻仅保留一个目标减暴击标记；被动封印、状态到期、逐帧数值和御魂交互仍需客户端战斗核验'],
    policy(context, unitId): ActionIntent | undefined {
      const owner = context.getUnit(unitId);
      if (!owner || owner.hp <= 0) return undefined;
      const enemies = context.getLivingUnits(owner.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      const target = enemies.slice().sort((left, right) => left.hp / Math.max(1, left.stats.hp)
        - right.hp / Math.max(1, right.stats.hp))[0]!;
      if ((context.state.resources[owner.side]?.fire ?? 0) >= 3)
        return shoumuIntent(owner.unitId, shoumuIds.ultimate, target.unitId);
      return shoumuIntent(owner.unitId, shoumuIds.basic, target.unitId);
    },
    handlers: { hit: { priority: 40, handle(context, event) { return stealCriticalRate(context, event); } } },
  };
}

function stealCriticalRate(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage' || !event.source.unitId
    || event.source.id !== shoumuIds.basic && event.source.id !== shoumuIds.ultimate) return;
  const owner = context.getUnit(event.source.unitId);
  const target = context.getUnit(event.targetId);
  if (!owner || owner.heroId !== shoumuIds.hero || !passivesEnabled(owner) || !target || target.hp <= 0) return;
  const source = shoumuSource(shoumuIds.passive, owner.unitId);
  const previousTargetId = String(owner.statuses.find(status => status.statusId === shoumuIds.stolenCrit)?.values?.targetUnitId ?? '');
  const commands: EffectCommand[] = [];
  if (previousTargetId && previousTargetId !== target.unitId) {
    const previousTarget = context.getUnit(previousTargetId);
    const previousMark = previousTarget?.statuses.find(status => status.statusId === shoumuIds.targetCritReduction
      && status.source.unitId === owner.unitId);
    if (previousMark && previousTarget) commands.push({ type: 'remove-status-instances', source,
      targetId: previousTarget.unitId, instanceIds: [previousMark.instanceId], reason: 'replaced', parentEventId: event.eventId });
  }
  commands.push({ type: 'add-status', source, targetId: owner.unitId, parentEventId: event.eventId,
    instance: { instanceId: `${shoumuIds.stolenCrit}:${owner.unitId}`, statusId: shoumuIds.stolenCrit,
      source, stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' }, values: { targetUnitId: target.unitId },
      modifiers: [{ stat: 'crit', operation: 'flat', amount: .4 }] } });
  commands.push({ type: 'add-status', source, targetId: target.unitId, parentEventId: event.eventId,
    instance: { instanceId: `${shoumuIds.targetCritReduction}:${owner.unitId}:${target.unitId}`,
      statusId: shoumuIds.targetCritReduction, source, stacks: 1,
      duration: { kind: 'count', remaining: 1, owner: 'target-turn' }, modifiers: [{ stat: 'crit', operation: 'flat', amount: -.4 }] } });
  return commands;
}

function shoumuIntent(actorId: string, skillId: string, targetId: string): ActionIntent {
  return { actorId, skillId, targetIds: [targetId], shape: 'single', targetRelation: 'enemy' };
}
function shoumuSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
