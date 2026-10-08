import type { HeroDefinition, SkillDefinition, StatusDefinition } from '../core/definitions';
import { passivesEnabled } from '../core/passive-eligibility';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, StatusInstance, UnitState } from '../core/types';
import { createBasicAttackSkill } from './common-skills';
import type { ContentRegistry } from './registry';

export const heitongziIds = {
  hero: 277,
  basic: '2771',
  passive: '2772',
  ultimate: '2773',
  reducedUltimate: '27730',
  revenant: 'status.hero.277.revenant',
  shield: 'status.hero.277.revenant-shield',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const passiveChances = [.12, .16, .2, .2, .2] as const;
const ultimateRatios = [.83, .87, .91, .95, .99] as const;

export function registerHeitongzi(registry: ContentRegistry): void {
  const revenant: StatusDefinition = { id: heitongziIds.revenant, mechanicsCoverage: 'partial', category: 'buff',
    dispellable: true, sealable: false, durationOwner: 'target-turn', refreshPolicy: 'refresh-duration',
    preventsLethalDamage: true, requiresPassiveEnabled: true };
  registry.registerStatus(revenant);
  registry.registerStatus({ id: heitongziIds.shield, mechanicsCoverage: 'partial', category: 'shield', dispellable: true,
    sealable: false, durationOwner: 'target-turn', refreshPolicy: 'refresh-duration' });

  const ultimate = makeUltimate(heitongziIds.ultimate, false);
  const reducedUltimate = makeUltimate(heitongziIds.reducedUltimate, true);
  const definition: HeroDefinition = {
    id: heitongziIds.hero, skills: [createBasicAttackSkill(heitongziIds.basic, basicRatios), ultimate, reducedUltimate],
    aiCoverage: 'partial', mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['罪罚·黑普攻倍率、魂之怒火受非传导攻击12%/16%/20%/生命线加成免费施放连斩、回魂两回合致命保护与135%攻击护盾、五级先机回魂、连斩3火/83%至99%群攻/每损失30%生命加1段及击杀后免费减伤40%连斩已接入。普攻原生大幅随机浮动区间、传导伤害客户端判定和连续击杀的逐帧顺序仍待录像核验；重复链受引擎触发预算约束。'],
    initialize(context, unitId) {
      const actor = context.getUnit(unitId);
      if (!actor || actor.hp <= 0 || actor.heroId !== heitongziIds.hero || actor.unitKind === 'summon'
        || skillRank(actor, heitongziIds.passive) < 5 || !passivesEnabled(actor)) return [];
      return [addRevenant(actor.unitId)];
    },
    handlers: {
      hit: { priority: 44, handle(context, event) { return triggerSoulAngerOrShield(context, event); } },
      'action-end': { priority: 44, handle(context, event) { return grantRevenantAfterCast(context, event); } },
      'attack-end': { priority: 44, handle(context, event) { return chainOnDefeat(context, event); } },
    },
    policy(context, unitId) {
      const actor = context.getUnit(unitId);
      const enemies = actor && context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (!actor || actor.hp <= 0 || actor.unitKind === 'summon' || !enemies?.length) return undefined;
      const skillId = (context.state.resources[actor.side]?.fire ?? 0) >= 3 ? heitongziIds.ultimate : heitongziIds.basic;
      return { actorId: unitId, skillId, targetIds: enemies.map(unit => unit.unitId),
        shape: skillId === heitongziIds.ultimate ? 'all-enemies' : 'single', targetRelation: 'enemy' };
    },
  };
  registry.registerHero(definition);
}

function makeUltimate(skillId: string, reduced: boolean): SkillDefinition {
  const ratios = ultimateRatios.map((ratio, index) => ({ ratio: ratio * (reduced ? .6 : 1), rank: index + 1 }));
  return { id: skillId, actionKind: 'skill', ...(reduced ? {} : { resourceCost: { resourceId: 'fire', amount: 3 } }),
    target: 'all-enemies', targetRelation: 'enemy', levels: ratios,
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      if (!actor || actor.heroId !== heitongziIds.hero || actor.hp <= 0) return [];
      const ratio = Number(parameters.ratio ?? ultimateRatios[skillIndex(actor, heitongziIds.ultimate)]! * (reduced ? .6 : 1));
      const baseHitCount = 1 + Math.floor(Math.max(0, 1 - actor.hp / Math.max(1, actor.stats.hp)) / .3 + 1e-9);
      return Array.from({ length: baseHitCount }).flatMap(() => attack(context, actor, intent.targetIds, skillId, ratio));
    } };
}

function triggerSoulAngerOrShield(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage') return;
  if (event.fatalProtectionStatusId === heitongziIds.revenant) {
    const target = context.getUnit(event.targetId);
    if (!target || target.hp <= 0 || target.heroId !== heitongziIds.hero) return;
    const attack = context.getEffectiveStats(target.unitId)?.attack ?? target.stats.attack;
    const source = heitongziSource(heitongziIds.passive, target.unitId);
    const shield: StatusInstance = { instanceId: `${heitongziIds.shield}:${target.unitId}:${event.eventId}`,
      statusId: heitongziIds.shield, source, stacks: 1, duration: { kind: 'count', remaining: 2, owner: 'target-turn' },
      values: { shieldRemaining: attack * 1.35 } };
    return [{ type: 'add-status', source, targetId: target.unitId, instance: shield, parentEventId: event.eventId }];
  }
  if (event.amount <= 0 || event.damageKind !== 'normal' || event.attackId === undefined || event.suppressTargetPassiveTriggers) return;
  const target = context.getUnit(event.targetId);
  if (!target || target.hp <= 0 || target.heroId !== heitongziIds.hero || target.unitKind === 'summon' || !passivesEnabled(target)) return;
  const rank = skillRank(target, heitongziIds.passive);
  const missingRatio = Math.max(0, 1 - target.hp / Math.max(1, target.stats.hp));
  const woundedBonus = rank >= 4 ? Math.floor((missingRatio + 1e-9) / .3) * .03 : 0;
  if (context.random() >= Math.min(1, passiveChances[rank - 1]! + woundedBonus)) return;
  const enemies = context.getLivingUnits(target.side === 'blue' ? 'red' : 'blue');
  if (!enemies.length) return;
  return [{ type: 'schedule-action', source: heitongziSource(heitongziIds.passive, target.unitId),
    intent: { actorId: target.unitId, skillId: heitongziIds.ultimate, targetIds: enemies.map(unit => unit.unitId),
      shape: 'all-enemies', targetRelation: 'enemy' }, scheduling: 'extra-action', freeCast: true, parentEventId: event.eventId },
    addRevenant(target.unitId, event.eventId)];
}

function grantRevenantAfterCast(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'action-ended' || (event.skillId !== heitongziIds.ultimate && event.skillId !== heitongziIds.reducedUltimate)) return;
  const actor = context.getUnit(event.source.unitId ?? event.intent?.actorId ?? '');
  if (!actor || actor.heroId !== heitongziIds.hero || actor.hp <= 0 || !passivesEnabled(actor)) return;
  return [addRevenant(actor.unitId, event.eventId)];
}

function chainOnDefeat(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'attack-ended' || (event.source.id !== heitongziIds.ultimate && event.source.id !== heitongziIds.reducedUltimate)
    || !event.source.unitId || !event.targetHealthChanges?.some(change => change.defeatedByHit)) return;
  const actor = context.getUnit(event.source.unitId);
  if (!actor || actor.heroId !== heitongziIds.hero || actor.hp <= 0 || !passivesEnabled(actor)) return;
  if (!actor.awakeFilter) return;
  const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
  if (!enemies.length) return;
  return [{ type: 'schedule-action', source: heitongziSource(heitongziIds.ultimate, actor.unitId),
    intent: { actorId: actor.unitId, skillId: heitongziIds.reducedUltimate, targetIds: enemies.map(unit => unit.unitId),
      shape: 'all-enemies', targetRelation: 'enemy' }, scheduling: 'extra-action', freeCast: true, parentEventId: event.eventId }];
}

function addRevenant(ownerId: string, eventId?: string): EffectCommand {
  const source = heitongziSource(heitongziIds.passive, ownerId);
  const instance: StatusInstance = { instanceId: `${heitongziIds.revenant}:${ownerId}`, statusId: heitongziIds.revenant,
    source, stacks: 1, duration: { kind: 'count', remaining: 2, owner: 'target-turn' } };
  return { type: 'add-status', source, targetId: ownerId, instance, ...(eventId ? { parentEventId: eventId } : {}) };
}

function attack(context: BattleContext, actor: Readonly<UnitState>, targetIds: readonly string[], skillId: string,
  ratio: number): EffectCommand[] {
  const stats = context.getEffectiveStats(actor.unitId) ?? actor.stats;
  return targetIds.flatMap(targetId => {
    const target = context.getUnit(targetId);
    const defense = context.getEffectiveStats(targetId)?.defense;
    if (!target || target.hp <= 0 || target.side === actor.side || defense === undefined) return [];
    const hit = context.calculateDamage({ attack: stats.attack, defense, ratio, critChance: stats.crit, critDamage: stats.critDamage },
      actor, target);
    return [{ type: 'deal-damage' as const, source: heitongziSource(skillId, actor.unitId), targetId, amount: hit.amount,
      ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}), isCritical: hit.isCritical }];
  });
}

function skillRank(unit: Readonly<UnitState>, skillId: string): number {
  return Math.max(1, Math.min(5, unit.skillLevels?.[skillId] ?? unit.skillLevel));
}
function skillIndex(unit: Readonly<UnitState>, skillId: string): number { return skillRank(unit, skillId) - 1; }
function heitongziSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
