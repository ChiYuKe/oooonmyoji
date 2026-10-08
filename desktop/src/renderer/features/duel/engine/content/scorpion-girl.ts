import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, StatusInstance, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { calculateIndirectDamage } from '../mechanics/indirect-damage';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import { createBasicAttackSkill } from './common-skills';
import type { ContentRegistry } from './registry';

export const scorpionGirlIds = { hero: 350, basic: '3501', passive: '3502', skill: '3503', poison: 'status.hero.350.scorpion-poison' } as const;
const basicRatios = [.5, .52, .54, .56, .6] as const;
const detonationRatios = [.75, .8, .85, .9, .9] as const;

export function registerScorpionGirl(registry: ContentRegistry): void {
  registry.registerStatus({ id: scorpionGirlIds.poison, mechanicsCoverage: 'partial', category: 'debuff', dispellable: false,
    sealable: true, durationOwner: 'permanent', refreshPolicy: 'add-stack', maxStacks: 5, stackScope: 'source-unit' });
  registry.registerHero(createScorpionGirlDefinition());
}

export function createScorpionGirlDefinition(): HeroDefinition {
  const basicBase = createBasicAttackSkill(scorpionGirlIds.basic, basicRatios);
  const basic: SkillDefinition = { ...basicBase, execute(context, intent, parameters) {
    const actor = context.getUnit(intent.actorId), target = context.getUnit(intent.targetIds[0] ?? '');
    if (!actor || actor.hp <= 0 || !target || target.hp <= 0) return [];
    const ratio = Number(parameters.ratio ?? .5);
    return repeatedDirect(context, actor, target, scorpionGirlIds.basic, ratio, 2);
  } };
  const sting: SkillDefinition = { id: scorpionGirlIds.skill, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 2 },
    target: 'single', targetRelation: 'enemy', levels: detonationRatios.map(ratio => ({ ratio, hitRatio: .5 })),
    execute(context, intent, parameters) {
      const owner = context.getUnit(intent.actorId), target = context.getUnit(intent.targetIds[0] ?? '');
      if (!owner || owner.hp <= 0 || !target || target.hp <= 0) return [];
      const source = scorpionSource(scorpionGirlIds.skill, owner.unitId);
      const offense = context.getEffectiveStats(owner.unitId) ?? owner.stats;
      const attack = scorpionAttack(context, owner);
      const defense = context.getEffectiveStats(target.unitId) ?? target.stats;
      const direct = context.calculateDamage({ attack, defense: defense.defense,
        defenseIgnore: effectiveDefenseIgnore(owner), ratio: Number(parameters.hitRatio ?? .5),
        critChance: offense.crit, critDamage: offense.critDamage }, owner, target);
      const commands: EffectCommand[] = [{ type: 'deal-damage', source, targetId: target.unitId, amount: direct.amount,
        ...(direct.damageOptions ? { damageOptions: direct.damageOptions } : {}), isCritical: direct.isCritical }];
      const ownedPoison = target.statuses.find(status => status.statusId === scorpionGirlIds.poison
        && status.source.unitId === owner.unitId);
      if (!ownedPoison) {
        for (const other of context.getLivingUnits(target.side)) {
          if (other.unitId === target.unitId) continue;
          const previous = other.statuses.find(status => status.statusId === scorpionGirlIds.poison
            && status.source.unitId === owner.unitId);
          if (previous) commands.push({ type: 'remove-status-instances', source, targetId: other.unitId,
            instanceIds: [previous.instanceId], reason: 'replaced' });
        }
        commands.push(addPoison(owner, target, source, 1));
        return commands;
      }

      const indirectRatio = Number(parameters.ratio ?? .75);
      const indirect = calculateIndirectDamage({ attack, defense: defense.defense,
        defenseIgnore: effectiveDefenseIgnore(owner), ratio: indirectRatio, critDamage: offense.critDamage }, context.random);
      commands.push({ type: 'lose-life', source, targetId: target.unitId, amount: indirect.amount, lifeLossKind: 'indirect' });
      const healRatio = skillRank(owner, scorpionGirlIds.passive) >= 3 ? .3 : .2;
      commands.push(...detonationHealing(context, owner, source, indirect.amount * healRatio));
      commands.push(addPoison(owner, target, source, 1));
      return commands;
    } };
  return {
    id: scorpionGirlIds.hero, skills: [basic, sting], aiCoverage: 'partial', mechanicsCoverage: 'partial',
    aiCoverageNotes: ['鬼火不少于2时优先对已有蝎毒目标施放以毒攻毒分支，否则施放百蝎之毒；客户端自动选招完整优先级仍需核验。'],
    mechanicsCoverageNotes: ['已实现蝎刺两段等级倍率；百蝎之毒2火、50%直伤、对新目标施加唯一蝎毒、对已有蝎毒目标造成75%至90%间接伤害并叠加蝎毒；引爆时恢复伤害的20%（被动三级30%），溢出治疗分给其他友方；蝎毒每层降低80防御、最多5层，二级起减疗40%，四级起额外按层减疗。五级技能目标回合末90%间接伤害、被动五级的五层溅射60%已接入。蝎毒转移、多名蝎女、净化/封印时点和溅射层级仍需客户端战斗帧核验。'],
    policy(context, unitId) {
      const owner = context.getUnit(unitId);
      if (!owner || owner.hp <= 0 || owner.unitKind === 'summon') return undefined;
      const enemies = context.getLivingUnits(owner.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      const fire = context.state.resources[owner.side]?.fire ?? 0;
      const poisoned = enemies.find(target => target.statuses.some(status => status.statusId === scorpionGirlIds.poison
        && status.source.unitId === owner.unitId));
      const target = poisoned ?? [...enemies].sort((left, right) => left.hp / Math.max(1, left.stats.hp)
        - right.hp / Math.max(1, right.stats.hp))[0]!;
      return fire >= 2 ? { actorId: unitId, skillId: scorpionGirlIds.skill, targetIds: [target.unitId],
        shape: 'single', targetRelation: 'enemy' }
        : { actorId: unitId, skillId: scorpionGirlIds.basic, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
    },
    handlers: {
      'turn-end': { priority: 30, handle(context, event) { return scorpionPoisonTick(context, event); } },
      'effect-resolution': { priority: 30, handle(context, event) { return scorpionPoisonSplash(context, event); } },
    },
  };
}

function repeatedDirect(context: BattleContext, owner: Readonly<UnitState>, target: Readonly<UnitState>, skillId: string,
  ratio: number, hits: number): EffectCommand[] {
  const offense = context.getEffectiveStats(owner.unitId) ?? owner.stats;
  const attack = scorpionAttack(context, owner);
  const defense = context.getEffectiveStats(target.unitId) ?? target.stats;
  const source = scorpionSource(skillId, owner.unitId);
  return Array.from({ length: hits }, () => {
    const hit = context.calculateDamage({ attack, defense: defense.defense, defenseIgnore: effectiveDefenseIgnore(owner), ratio,
      critChance: offense.crit, critDamage: offense.critDamage }, owner, target);
    return { type: 'deal-damage' as const, source, targetId: target.unitId, amount: hit.amount,
      ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}), isCritical: hit.isCritical };
  });
}

function addPoison(owner: Readonly<UnitState>, target: Readonly<UnitState>, source: SourceRef, stacks: number): EffectCommand {
  const passiveRank = skillRank(owner, scorpionGirlIds.passive), skillRankValue = skillRank(owner, scorpionGirlIds.skill);
  const modifiers: import('../core/types').StatModifier[] = [{ stat: 'defense', operation: 'flat', amount: -80, perStack: true }];
  if (passiveRank >= 2) modifiers.push({ stat: 'healingTaken', operation: 'percent', amount: -.4 });
  if (passiveRank >= 4) {
    modifiers[1] = { stat: 'healingTaken', operation: 'percent', amount: -.3 };
    modifiers.push({ stat: 'healingTaken', operation: 'percent', amount: -.1, perStack: true });
  }
  return { type: 'add-status', source, targetId: target.unitId, instance: {
    instanceId: `${scorpionGirlIds.poison}:${owner.unitId}:${target.unitId}`, statusId: scorpionGirlIds.poison, source,
    stacks: Math.max(1, Math.min(5, stacks)), duration: { kind: 'permanent' },
    values: { ownerUnitId: owner.unitId, skillRank: skillRankValue }, modifiers,
  } };
}

function detonationHealing(context: BattleContext, owner: Readonly<UnitState>, source: SourceRef, amount: number): EffectCommand[] {
  if (!passivesEnabled(owner)) return [];
  const missing = Math.max(0, owner.stats.hp - owner.hp);
  const selfHealing = Math.min(missing, Math.max(0, amount));
  const overflow = Math.max(0, amount - selfHealing);
  const allies = context.getLivingUnits(owner.side).filter(unit => unit.unitId !== owner.unitId);
  const commands: EffectCommand[] = [{ type: 'heal', source, targetId: owner.unitId, amount: selfHealing }];
  if (overflow > 0 && allies.length > 0) for (const ally of allies)
    commands.push({ type: 'heal', source, targetId: ally.unitId, amount: overflow / allies.length });
  return commands;
}

function scorpionPoisonTick(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-ended') return;
  const target = context.getUnit(event.unitId); if (!target || target.hp <= 0) return;
  const commands: EffectCommand[] = [];
  for (const poison of target.statuses.filter(status => status.statusId === scorpionGirlIds.poison && status.stacks > 0)) {
    const owner = poison.source.unitId ? context.getUnit(poison.source.unitId) : undefined;
    if (!owner || owner.hp <= 0 || skillRank(owner, scorpionGirlIds.skill) < 5) continue;
    const attack = scorpionAttack(context, owner), offense = context.getEffectiveStats(owner.unitId) ?? owner.stats;
    const defense = context.getEffectiveStats(target.unitId) ?? target.stats;
    const result = calculateIndirectDamage({ attack, defense: defense.defense, defenseIgnore: effectiveDefenseIgnore(owner),
      ratio: .9, critDamage: offense.critDamage }, context.random);
    commands.push({ type: 'lose-life', source: scorpionSource(scorpionGirlIds.skill, owner.unitId), targetId: target.unitId,
      amount: result.amount, lifeLossKind: 'indirect', parentEventId: event.eventId });
  }
  return commands.length ? commands : undefined;
}

function scorpionPoisonSplash(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'life-lost' || event.lifeLossKind !== 'indirect' || event.hpLost <= 0 || !event.source.unitId
    || event.source.id !== scorpionGirlIds.skill) return;
  const owner = context.getUnit(event.source.unitId), target = context.getUnit(event.targetId);
  const poison = target?.statuses.find(status => status.statusId === scorpionGirlIds.poison && status.source.unitId === event.source.unitId);
  if (!owner || owner.hp <= 0 || !passivesEnabled(owner) || !target || !poison || poison.stacks < 5
    || skillRank(owner, scorpionGirlIds.passive) < 5) return;
  const amount = Math.min(event.hpLost * .6, scorpionAttack(context, owner) * 8);
  const enemies = context.getLivingUnits(owner.side === 'blue' ? 'red' : 'blue').filter(enemy => enemy.unitId !== target.unitId);
  return enemies.map(enemy => ({ type: 'lose-life' as const, source: scorpionSource(scorpionGirlIds.passive, owner.unitId),
    targetId: enemy.unitId, amount, lifeLossKind: 'indirect' as const, parentEventId: event.eventId }));
}

function scorpionAttack(context: BattleContext, owner: Readonly<UnitState>): number {
  const base = context.getEffectiveStats(owner.unitId)?.attack ?? owner.stats.attack;
  if (!passivesEnabled(owner)) return base;
  const layers = context.getLivingUnits(owner.side === 'blue' ? 'red' : 'blue').reduce((total, target) => total
    + target.statuses.filter(status => status.statusId === scorpionGirlIds.poison && status.source.unitId === owner.unitId)
      .reduce((sum, status) => sum + status.stacks, 0), 0);
  return base * (1 + layers * .2);
}

function skillRank(unit: Readonly<UnitState>, skillId: string): number {
  return Math.max(1, Math.min(5, unit.skillLevels?.[skillId] ?? unit.skillLevel));
}
function scorpionSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
