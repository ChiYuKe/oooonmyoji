import type { HeroDefinition, SkillDefinition, StatusDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, StatusInstance, UnitState } from '../core/types';
import { attemptControl } from '../mechanics/control';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import { createBasicAttackSkill } from './common-skills';
import type { ContentRegistry } from './registry';

export const tamamoIds = {
  hero: 300,
  basic: '3001',
  foxfire: '3002',
  heavenFall: '3003',
  confusion: 'status.hero.300.confusion',
  chain: 'status.hero.300.chain',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const foxfireRatios = [2.63, 2.76, 2.76, 2.89, 2.89, 2.89] as const;
const heavenFallRatios = [1.31, 1.38, 1.38, 1.45, 1.45, 1.45] as const;
const skillCosts = [3, 3, 3, 3, 3, 2] as const;

export function registerTamamo(registry: ContentRegistry): void {
  registry.registerStatus({ id: tamamoIds.confusion, mechanicsCoverage: 'partial', category: 'control',
    dispellable: true, sealable: true, durationOwner: 'target-turn', refreshPolicy: 'refresh-duration' });
  registry.registerStatus({ id: tamamoIds.chain, mechanicsCoverage: 'partial', category: 'other',
    dispellable: false, sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace' } satisfies StatusDefinition);

  const basic = createBasicAttackSkill(tamamoIds.basic, basicRatios);
  const foxfire: SkillDefinition = {
    id: tamamoIds.foxfire, actionKind: 'skill', resourceCostsByLevel: skillCosts.map(amount => ({ resourceId: 'fire', amount })),
    target: 'single', targetRelation: 'enemy', useClientDamageData: false,
    resolveResourceCost(_state, actor) { return { resourceId: 'fire', amount: skillRank(actor, tamamoIds.foxfire) >= 6 ? 2 : 3 }; },
    levels: foxfireRatios.map((ratio, index) => ({ ratio, highHpThreshold: .8, highHpDamage: -.15,
      lowHpThreshold: .5, lowHpDamage: index >= 2 ? .15 : 0, chainEnabled: index >= 4 })),
    execute(context, intent, parameters) {
      const owner = context.getUnit(intent.actorId), target = context.getUnit(intent.targetIds[0] ?? '');
      if (!owner || owner.heroId !== tamamoIds.hero || owner.hp <= 0 || !target || target.hp <= 0 || target.side === owner.side) return [];
      return [makeHit(context, owner, target, Number(parameters.ratio ?? 2.63),
        damageAdjustment(target, parameters), tamamoIds.foxfire)];
    },
  };
  const heavenFall: SkillDefinition = {
    id: tamamoIds.heavenFall, actionKind: 'skill', resourceCostsByLevel: skillCosts.map(amount => ({ resourceId: 'fire', amount })),
    target: 'all-enemies', targetRelation: 'enemy', useClientDamageData: false,
    resolveResourceCost(_state, actor) { return { resourceId: 'fire', amount: skillRank(actor, tamamoIds.heavenFall) >= 6 ? 2 : 3 }; },
    levels: heavenFallRatios.map((ratio, index) => ({ ratio, lowHpThreshold: .5, lowHpDamage: -.15,
      highHpThreshold: .8, highHpDamage: index >= 2 ? .15 : 0, chainEnabled: index >= 4 })),
    execute(context, intent, parameters) {
      const owner = context.getUnit(intent.actorId);
      if (!owner || owner.heroId !== tamamoIds.hero || owner.hp <= 0) return [];
      const targets = context.getLivingUnits(owner.side === 'blue' ? 'red' : 'blue');
      return targets.map(target => makeHit(context, owner, target, Number(parameters.ratio ?? 1.31),
        damageAdjustment(target, parameters), tamamoIds.heavenFall));
    },
  };

  const definition: HeroDefinition = {
    id: tamamoIds.hero, skills: [basic, foxfire, heavenFall], aiCoverage: 'partial', mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['已按客户端技能行接入灵击等级倍率与10%基础概率混乱1回合；狐火按技能等级造成263%至289%伤害，对生命比例高于80%的目标降低15%，三级起对低于50%的目标提高15%；堕天攻击全体并按等级造成131%至145%伤害，对低于50%目标降低15%，三级起对高于80%目标提高15%。狐火与堕天五级击败目标后交替免费施放另一妖术技能，后续连锁伤害每次递减20%；技能六级时两个妖术消耗均降至2火。专项回归核对倍率/血线修正、混乱抵抗、击杀后的免费交替施法与连锁衰减。技能等级分支与客户端旧行的非觉醒倍率存在差异，当前采用战斗描述中的妖术倍率；连续连锁的精确伤害衰减、击杀事件与目标复活插入顺序、御魂协战边界以及本场帧图均待核验。'],
    modifyOutgoingDamage(attacker, _target, amount) {
      if (attacker.heroId !== tamamoIds.hero) return amount;
      const chain = attacker.statuses.find(status => status.statusId === tamamoIds.chain);
      const step = Math.max(0, Number(chain?.values?.step ?? 0));
      return amount * Math.pow(.8, step);
    },
    handlers: {
      hit: { priority: 32, handle(context, event) { return applyBasicConfusion(context, event); } },
      'attack-end': { priority: 33, handle(context, event) { return scheduleKillChain(context, event); } },
    },
    policy(context, unitId): ActionIntent | undefined {
      const owner = context.getUnit(unitId);
      if (!owner || owner.hp <= 0 || owner.heroId !== tamamoIds.hero) return undefined;
      const enemies = context.getLivingUnits(owner.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      const fire = context.state.resources[owner.side]?.fire ?? 0;
      const rank = skillRank(owner, tamamoIds.heavenFall);
      if (enemies.length > 1 && fire >= skillCosts[Math.min(rank - 1, 5)]!)
        return { actorId: unitId, skillId: tamamoIds.heavenFall, targetIds: enemies.map(enemy => enemy.unitId),
          shape: 'all-enemies', targetRelation: 'enemy' };
      const foxfireRank = skillRank(owner, tamamoIds.foxfire);
      if (fire >= skillCosts[Math.min(foxfireRank - 1, 5)]!)
        return { actorId: unitId, skillId: tamamoIds.foxfire, targetIds: [lowestRatio(enemies)!.unitId],
          shape: 'single', targetRelation: 'enemy' };
      return { actorId: unitId, skillId: tamamoIds.basic, targetIds: [lowestRatio(enemies)!.unitId],
        shape: 'single', targetRelation: 'enemy' };
    },
  };
  registry.registerHero(definition);
}

function makeHit(context: BattleContext, owner: UnitState, target: UnitState, ratio: number, modifier: number, skillId: string): EffectCommand {
  const attack = context.getEffectiveStats(owner.unitId) ?? owner.stats;
  const defense = context.getEffectiveStats(target.unitId)?.defense ?? target.stats.defense;
  const result = context.calculateDamage({ attack: attack.attack, defense,
    defenseIgnore: effectiveDefenseIgnore(owner), ratio: ratio * modifier,
    critChance: attack.crit, critDamage: attack.critDamage }, owner, target);
  return { type: 'deal-damage', source: tamamoSource(skillId, owner.unitId), targetId: target.unitId,
    amount: result.amount, ...(result.damageOptions ? { damageOptions: result.damageOptions } : {}), isCritical: result.isCritical };
}

function damageAdjustment(target: UnitState, parameters: Readonly<Record<string, number | boolean | string>>): number {
  const hpRatio = target.hp / Math.max(1, target.stats.hp);
  if (parameters.highHpThreshold !== undefined && hpRatio > Number(parameters.highHpThreshold))
    return 1 + Number(parameters.highHpDamage ?? 0);
  if (parameters.lowHpThreshold !== undefined && hpRatio < Number(parameters.lowHpThreshold))
    return 1 + Number(parameters.lowHpDamage ?? 0);
  return 1;
}

function applyBasicConfusion(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage' || event.source.id !== tamamoIds.basic || !event.source.unitId) return;
  const owner = context.getUnit(event.source.unitId), target = context.getUnit(event.targetId);
  if (!owner || owner.heroId !== tamamoIds.hero || owner.hp <= 0 || !target || target.hp <= 0) return;
  const result = attemptControl(context, { attemptId: `${tamamoIds.confusion}:${event.eventId}`,
    source: tamamoSource(tamamoIds.basic, owner.unitId), targetId: target.unitId, statusId: tamamoIds.confusion,
    controlType: '混乱', baseChance: .1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' }, parentEventId: event.eventId });
  return result ? [result] : undefined;
}

function scheduleKillChain(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'attack-ended' || (event.source.id !== tamamoIds.foxfire && event.source.id !== tamamoIds.heavenFall)
    || !event.source.unitId) return;
  const owner = context.getUnit(event.source.unitId);
  if (!owner || owner.heroId !== tamamoIds.hero) return;
  const removeChain: EffectCommand = { type: 'remove-statuses', source: tamamoSource(tamamoIds.heavenFall, owner.unitId),
    targetId: owner.unitId, statusIds: [tamamoIds.chain], reason: 'consumed', parentEventId: event.eventId };
  const killed = event.targetHealthChanges?.some(change => change.defeatedByHit) ?? false;
  const skillId = event.source.id;
  const rank = skillRank(owner, skillId);
  if (!killed || rank < 5 || owner.hp <= 0) return [removeChain];
  const enemySide = owner.side === 'blue' ? 'red' : 'blue';
  const enemies = context.getLivingUnits(enemySide);
  if (!enemies.length) return [removeChain];
  const nextSkillId = skillId === tamamoIds.foxfire ? tamamoIds.heavenFall : tamamoIds.foxfire;
  const nextTargetIds = nextSkillId === tamamoIds.heavenFall ? enemies.map(enemy => enemy.unitId) : [lowestRatio(enemies)!.unitId];
  const previousStep = Math.max(0, Number(owner.statuses.find(status => status.statusId === tamamoIds.chain)?.values?.step ?? 0));
  const source = tamamoSource(tamamoIds.heavenFall, owner.unitId);
  const chainStatus: StatusInstance = { instanceId: `${tamamoIds.chain}:${owner.unitId}`, statusId: tamamoIds.chain,
    source, stacks: 1, duration: { kind: 'permanent' }, values: { step: previousStep + 1 } };
  return [removeChain, { type: 'add-status', source, targetId: owner.unitId, instance: chainStatus, parentEventId: event.eventId },
    { type: 'schedule-action', source, scheduling: 'extra-action', freeCast: true, parentEventId: event.eventId,
      intent: { actorId: owner.unitId, skillId: nextSkillId, targetIds: nextTargetIds,
        shape: nextSkillId === tamamoIds.heavenFall ? 'all-enemies' : 'single', targetRelation: 'enemy', kind: 'passive' } }];
}

function skillRank(unit: UnitState, skillId: string): number {
  return Math.max(1, Math.min(skillId === tamamoIds.basic ? 5 : 6, unit.skillLevels?.[skillId] ?? unit.skillLevel));
}
function tamamoSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
function lowestRatio(units: readonly UnitState[]): UnitState | undefined {
  return [...units].sort((a, b) => a.hp / Math.max(1, a.stats.hp) - b.hp / Math.max(1, b.stats.hp))[0];
}
