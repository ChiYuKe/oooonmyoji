import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, StatusInstance, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { attemptDebuff } from '../mechanics/control';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import type { ContentRegistry } from './registry';

export const jiaoTuIds = {
  hero: 234,
  basic: '2341',
  passive: '2342',
  ultimate: '2343',
  bind: 'status.hero.234.water-bind',
  nourishment: 'status.hero.234.nourishment',
  drizzle: 'status.hero.234.drizzle',
  lifeLink: 'status.hero.234.life-link',
  lifeLinkOnce: 'status.hero.234.life-link-once',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const bindChances = [.3, .3, .3, .3, .3] as const;
const nourishmentCritDamage = [.05, .1, .15, .2, .2, .2] as const;
const linkDurations = [1, 2, 2, 2, 2, 2] as const;

export function registerJiaoTu(registry: ContentRegistry): void {
  registry.registerStatus({ id: jiaoTuIds.bind, mechanicsCoverage: 'partial', category: 'debuff', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'refresh-duration' });
  registry.registerStatus({ id: jiaoTuIds.nourishment, mechanicsCoverage: 'partial', category: 'buff', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'refresh-duration' });
  registry.registerStatus({ id: jiaoTuIds.drizzle, mechanicsCoverage: 'partial', category: 'other', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'refresh-duration' });
  registry.registerStatus({ id: jiaoTuIds.lifeLink, mechanicsCoverage: 'partial', category: 'buff', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'refresh-duration' });
  registry.registerStatus({ id: jiaoTuIds.lifeLinkOnce, mechanicsCoverage: 'partial', category: 'other', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace' });

  const basic: SkillDefinition = {
    id: jiaoTuIds.basic,
    actionKind: 'basic',
    target: 'single',
    targetRelation: 'enemy',
    levels: basicRatios.map((ratio, index) => ({ ratio, bindChance: bindChances[index]! })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      const actorStats = context.getEffectiveStats(intent.actorId);
      const targetId = intent.targetIds[0];
      const target = targetId ? context.getUnit(targetId) : undefined;
      const targetStats = target && context.getEffectiveStats(target.unitId);
      if (!actor || actor.hp <= 0 || !actorStats || !target || target.hp <= 0 || !targetStats) return [];
      const source = jiaoTuSource(jiaoTuIds.basic, actor.unitId);
      const hit = context.calculateDamage({ attack: actorStats.attack, defense: targetStats.defense,
        defenseIgnore: effectiveDefenseIgnore(actor), ratio: Number(parameters.ratio ?? 1),
        critChance: actorStats.crit, critDamage: actorStats.critDamage }, actor, target);
      const commands: EffectCommand[] = [{ type: 'deal-damage', source, targetId: target.unitId, amount: hit.amount, ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}), isCritical: hit.isCritical }];
      commands.push(...attemptDebuff(context, { source, targetId: target.unitId, statusId: jiaoTuIds.bind,
        baseChance: Number(parameters.bindChance ?? .3), duration: { kind: 'count', remaining: 2, owner: 'target-turn' } }));
      return commands;
    },
  };

  const link: SkillDefinition = {
    id: jiaoTuIds.ultimate,
    actionKind: 'skill',
    resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'all-allies',
    targetRelation: 'ally',
    levels: linkDurations.map((duration, index) => ({ duration, damageReduction: index >= 2 ? .05 : 0 })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      if (!actor || actor.hp <= 0) return [];
      const duration = Math.max(1, Number(parameters.duration ?? 1));
      const reduction = Math.max(0, Number(parameters.damageReduction ?? 0));
      const source = jiaoTuSource(jiaoTuIds.ultimate, actor.unitId);
      return intent.targetIds.flatMap(targetId => {
        const target = context.getUnit(targetId);
        if (!target || target.hp <= 0 || target.side !== actor.side || target.unitKind === 'summon' || target.unitKind === 'monster') return [];
        return [linkCommand(actor, target, source, duration, reduction)];
      });
    },
  };

  const definition: HeroDefinition = {
    id: jiaoTuIds.hero,
    skills: [basic, link],
    aiCoverage: 'partial',
    mechanicsCoverage: 'partial',
    policy(context: BattleContext, unitId: string): ActionIntent | undefined {
      const actor = context.getUnit(unitId);
      if (!actor || actor.hp <= 0 || actor.unitKind === 'summon') return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      const allies = context.getLivingUnits(actor.side).filter(unit => unit.unitKind !== 'summon' && unit.unitKind !== 'monster');
      const linked = allies.filter(unit => unit.statuses.some(status => status.statusId === jiaoTuIds.lifeLink));
      const fire = context.state.resources[actor.side]?.fire ?? 0;
      if (fire >= 3 && linked.length < allies.length) {
        return { actorId: unitId, skillId: jiaoTuIds.ultimate, targetIds: allies.map(unit => unit.unitId),
          shape: 'all-allies', targetRelation: 'ally' };
      }
      const target = enemies.slice().sort((left, right) => left.hp / Math.max(1, left.stats.hp)
        - right.hp / Math.max(1, right.stats.hp))[0]!;
      return { actorId: unitId, skillId: jiaoTuIds.basic, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
    },
    interceptIncomingDamage(state, attacker, target, amount, _kind, context) {
      if (context?.cannotBeShared) return undefined;
      if (!attacker || attacker.side === target.side || target.unitKind === 'summon' || target.unitKind === 'monster') return undefined;
      const marker = target.statuses.find(status => status.statusId === jiaoTuIds.lifeLink);
      const ownerId = marker?.values?.ownerUnitId;
      if (!marker || typeof ownerId !== 'string') return undefined;
      const owner = state.units[ownerId];
      if (!owner || owner.hp <= 0 || owner.side !== target.side) return undefined;
      const participants = state.sides[target.side].map(id => state.units[id]).filter((unit): unit is UnitState => Boolean(unit
        && unit.hp > 0 && unit.unitKind !== 'summon' && unit.unitKind !== 'monster'
        && unit.statuses.some(status => status.statusId === jiaoTuIds.lifeLink && status.values?.ownerUnitId === ownerId)));
      if (participants.length < 2) return undefined;
      const ratio = Math.max(0, Math.min(.05, Number(marker.values?.damageReduction ?? 0)));
      const shared = amount * (1 - ratio) / participants.length;
      const source = jiaoTuSource(jiaoTuIds.lifeLink, ownerId);
      return { amount: shared, effects: participants.filter(unit => unit.unitId !== target.unitId).map(unit => ({
        type: 'lose-life' as const, source, targetId: unit.unitId, amount: shared, lifeLossKind: 'direct' as const,
      })) };
    },
    handlers: {
      hit: { priority: 140, handle(context, event) { return jiaoTuPassiveOnHit(context, event); } },
      'action-end': { priority: 50, handle(context, event) { return healFromLinkedAllyAction(context, event); } },
    },
  };
  registry.registerHero(definition);
}

function jiaoTuPassiveOnHit(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage' || !event.source.unitId) return;
  const attacker = context.getUnit(event.source.unitId);
  const target = context.getUnit(event.targetId);
  const commands: EffectCommand[] = [];
  if (attacker?.heroId === jiaoTuIds.hero && attacker.hp > 0 && passivesEnabled(attacker)) {
    const drizzleSource = jiaoTuSource(jiaoTuIds.passive, attacker.unitId);
    commands.push({ type: 'add-status', source: drizzleSource, targetId: attacker.unitId, parentEventId: event.eventId,
      instance: { instanceId: `${jiaoTuIds.drizzle}:${attacker.unitId}`, statusId: jiaoTuIds.drizzle, source: drizzleSource,
        stacks: 1, duration: { kind: 'count', remaining: 2, owner: 'target-turn' } } });
  }
  if (target?.heroId === jiaoTuIds.hero && target.hp > 0 && passivesEnabled(target)) {
    const amount = nourishmentCritDamage[Math.max(0, Math.min(nourishmentCritDamage.length - 1, target.skillLevel - 1))]!;
    for (const ally of context.getLivingUnits(target.side).filter(unit => unit.unitKind !== 'summon' && unit.unitKind !== 'monster')) {
      if (context.random() >= .5) continue;
      const source = jiaoTuSource(jiaoTuIds.passive, target.unitId);
      commands.push({ type: 'add-status', source, targetId: ally.unitId, parentEventId: event.eventId,
        instance: { instanceId: `${jiaoTuIds.nourishment}:${target.unitId}:${ally.unitId}`, statusId: jiaoTuIds.nourishment,
          source, stacks: 1, duration: { kind: 'count', remaining: 2, owner: 'target-turn' },
          modifiers: [{ stat: 'critDamage', operation: 'flat', amount }] } });
    }
  }
  const crossedThreshold = typeof event.hpBefore === 'number' && typeof event.hpAfter === 'number'
    && event.hpBefore / Math.max(1, target?.stats.hp ?? 1) >= .7
    && event.hpAfter / Math.max(1, target?.stats.hp ?? 1) < .7;
  if (!target || target.heroId === jiaoTuIds.hero || target.hp <= 0 || !crossedThreshold) return commands;
  const owner = context.getLivingUnits(target.side).find(unit => unit.heroId === jiaoTuIds.hero && unit.unitKind !== 'summon'
    && passivesEnabled(unit) && !unit.statuses.some(status => status.statusId === jiaoTuIds.lifeLinkOnce));
  if (!owner) return commands;
  const sideUnits = context.getLivingUnits(target.side).filter(unit => unit.unitKind !== 'summon' && unit.unitKind !== 'monster');
  if (sideUnits.some(unit => unit.statuses.some(status => status.statusId === jiaoTuIds.lifeLink))) return commands;
  const source = jiaoTuSource(jiaoTuIds.passive, owner.unitId);
  commands.push({ type: 'add-status', source, targetId: owner.unitId, parentEventId: event.eventId,
    instance: { instanceId: `${jiaoTuIds.lifeLinkOnce}:${owner.unitId}`, statusId: jiaoTuIds.lifeLinkOnce, source,
      stacks: 1, duration: { kind: 'permanent' } } });
  commands.push(linkCommand(owner, target, source, 1, 0, event.eventId));
  commands.push(linkCommand(owner, owner, source, 1, 0, event.eventId));
  return commands;
}

function healFromLinkedAllyAction(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'action-ended' || !event.source.unitId) return;
  const actor = context.getUnit(event.source.unitId);
  if (!actor || actor.hp <= 0 || actor.unitKind === 'summon' || actor.unitKind === 'monster') return;
  const link = actor.statuses.find(status => status.statusId === jiaoTuIds.lifeLink);
  const ownerId = link?.values?.ownerUnitId;
  if (typeof ownerId !== 'string' || ownerId === actor.unitId) return;
  const owner = context.getUnit(ownerId);
  if (!owner || owner.hp <= 0 || owner.heroId !== jiaoTuIds.hero) return;
  return [{ type: 'heal', source: jiaoTuSource(jiaoTuIds.ultimate, owner.unitId), targetId: owner.unitId,
    amount: owner.stats.hp * .05, parentEventId: event.eventId }];
}

function linkCommand(owner: Readonly<UnitState>, target: Readonly<UnitState>, source: SourceRef, duration: number,
  damageReduction: number, parentEventId?: string): EffectCommand {
  const instance: StatusInstance = { instanceId: `${jiaoTuIds.lifeLink}:${owner.unitId}:${target.unitId}`,
    statusId: jiaoTuIds.lifeLink, source, stacks: 1, duration: { kind: 'count', remaining: duration, owner: 'target-turn' },
    values: { ownerUnitId: owner.unitId, damageReduction } };
  return { type: 'add-status', source, targetId: target.unitId, instance, ...(parentEventId ? { parentEventId } : {}) };
}

function jiaoTuSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
