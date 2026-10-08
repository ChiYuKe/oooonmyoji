import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import { passivesEnabled } from '../core/passive-eligibility';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, UnitState } from '../core/types';
import { attemptDebuff } from '../mechanics/control';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import type { ContentRegistry } from './registry';

export const wuguShiIds = {
  hero: 216,
  basic: '2161',
  passive: '2162',
  ultimate: '2163',
  mark: 'status.hero.216.gu-eclipse',
} as const;

const puppetHpByLevel = [.2, .25, .25, .3, .3] as const;
const puppetAttackByLevel = [.3, .3, .4, .4, .5] as const;

export function registerWuguShi(registry: ContentRegistry): void {
  registry.registerStatus({ id: wuguShiIds.mark, mechanicsCoverage: 'partial', category: 'debuff', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'refresh-duration' });
  const definition: HeroDefinition = {
    id: wuguShiIds.hero,
    skills: [createBasic(), createUltimate()],
    aiCoverage: 'verified',
    mechanicsCoverage: 'partial',
    handlers: {
      hit: { priority: 142, handle(context, event) { return markOnUltimateHit(context, event); } },
      'unit-defeated': { priority: 110, handle(context, event) { return summonPuppet(context, event); } },
    },
    policy(context, unitId) {
      const actor = context.getUnit(unitId);
      if (!actor) return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      if (actor.unitKind !== 'summon' && (context.state.resources[actor.side]?.fire ?? 0) >= 2) {
        return { actorId: unitId, skillId: wuguShiIds.ultimate, targetIds: enemies.map(unit => unit.unitId),
          shape: 'all-enemies', targetRelation: 'enemy' };
      }
      const target = enemies.slice().sort((left, right) => left.hp / left.stats.hp - right.hp / right.stats.hp)[0]!;
      return { actorId: unitId, skillId: wuguShiIds.basic, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
    },
  };
  registry.registerHero(definition);
}

function createBasic(): SkillDefinition {
  return { id: wuguShiIds.basic, actionKind: 'basic', target: 'single', targetRelation: 'enemy',
    levels: [1, 1.05, 1.1, 1.15, 1.2].map(ratio => ({ ratio })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      const target = context.getUnit(intent.targetIds[0] ?? '');
      const ratio = Number(parameters.ratio ?? 1) * (target?.statuses.some(status => status.statusId === wuguShiIds.mark) ? 1.2 : 1);
      return hit(context, intent.actorId, intent.targetIds.slice(0, 1), wuguShiIds.basic, ratio, actor);
    } };
}

function createUltimate(): SkillDefinition {
  return { id: wuguShiIds.ultimate, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 2 },
    target: 'all-enemies', targetRelation: 'enemy', levels: [1.09, 1.15, 1.2, 1.25, 1.31].map(ratio => ({ ratio })),
    execute(context, intent, parameters) { return hit(context, intent.actorId, intent.targetIds, wuguShiIds.ultimate, Number(parameters.ratio ?? 1.09)); } };
}

function hit(context: BattleContext, actorId: string, targetIds: readonly string[], skillId: string, ratio: number,
  actorOverride?: UnitState): EffectCommand[] {
  const actor = actorOverride ?? context.getUnit(actorId);
  const actorStats = context.getEffectiveStats(actorId);
  if (!actor || !actorStats) return [];
  return targetIds.flatMap(targetId => {
    const target = context.getUnit(targetId);
    const targetStats = context.getEffectiveStats(targetId);
    if (!target || !targetStats || target.hp <= 0) return [];
    const hit = context.calculateDamage({ attack: actorStats.attack, defense: targetStats.defense, defenseIgnore: effectiveDefenseIgnore(actor),
      ratio, critChance: actorStats.crit, critDamage: actorStats.critDamage }, actor, target);
    return [{ type: 'deal-damage' as const, source: source(skillId, actor.unitId), targetId,
      amount: hit.amount, ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}), isCritical: hit.isCritical }];
  });
}

function markOnUltimateHit(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage' || event.source.id !== wuguShiIds.ultimate || !event.source.unitId) return;
  const attacker = context.getUnit(event.source.unitId);
  const target = context.getUnit(event.targetId);
  if (!attacker || attacker.heroId !== wuguShiIds.hero || attacker.unitKind === 'summon' || !passivesEnabled(attacker)
    || !target || target.hp <= 0) return;
  return attemptDebuff(context, { source: source(wuguShiIds.ultimate, attacker.unitId), targetId: target.unitId,
    statusId: wuguShiIds.mark, baseChance: .4,
    duration: { kind: 'count', remaining: 3, owner: 'target-turn' }, parentEventId: event.eventId });
}

function summonPuppet(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'unit-defeated') return;
  const defeated = context.getUnit(event.unitId);
  const mark = defeated?.statuses.find(status => status.statusId === wuguShiIds.mark);
  const owner = mark?.source.unitId ? context.getUnit(mark.source.unitId) : undefined;
  if (!defeated || !mark || !owner || owner.hp <= 0 || owner.heroId !== wuguShiIds.hero || owner.unitKind === 'summon'
    || !passivesEnabled(owner)) return;
  const levelIndex = Math.max(0, Math.min(4, owner.skillLevel - 1));
  const stats = context.getEffectiveStats(owner.unitId) ?? owner.stats;
  const maxHp = Math.max(1, stats.hp * puppetHpByLevel[levelIndex]!);
  const unitId = `summon:${owner.unitId}:${defeated.unitId}:${event.eventId}`;
  const puppet: UnitState = { unitId, heroId: wuguShiIds.hero, unitKind: 'summon', summonedByUnitId: owner.unitId,
    skillLevel: owner.skillLevel, side: owner.side,
    stats: { ...stats, hp: maxHp, attack: stats.attack * puppetAttackByLevel[levelIndex]! },
    hp: maxHp, shield: 0, actionGauge: 0, statuses: [], resources: {} };
  return [{ type: 'summon-unit', source: source(wuguShiIds.passive, owner.unitId), unit: puppet, parentEventId: event.eventId }];
}

function source(id: string, unitId: string) { return { kind: 'skill' as const, id, unitId }; }
