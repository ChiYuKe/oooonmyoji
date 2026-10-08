import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import { passivesEnabled } from '../core/passive-eligibility';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, StatusInstance, UnitState } from '../core/types';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import type { ContentRegistry } from './registry';

export const greatTenguIds = {
  hero: 217,
  basic: '2171',
  passive: '2172',
  ultimate: '2173',
  shelter: 'status.hero.217.shelter',
  fierce: 'status.hero.217.fierce',
  attackTarget: 'status.core.attack-target-visited',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const ultimateRatios = [.65, .67, .69, .71, .75] as const;
const fierceCaps = [10, 30, 50, 80, 80] as const;

export function registerGreatTengu(registry: ContentRegistry): void {
  registry.registerStatus({ id: greatTenguIds.shelter, mechanicsCoverage: 'partial', category: 'buff', dispellable: true,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace', controlProtection: 'single-application' });
  registry.registerStatus({ id: greatTenguIds.fierce, mechanicsCoverage: 'partial', category: 'buff', dispellable: true,
    sealable: false, durationOwner: 'round', refreshPolicy: 'add-stack', maxStacks: 80 });
  registry.registerStatus({ id: greatTenguIds.attackTarget, mechanicsCoverage: 'verified', category: 'other', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'keep' });

  const definition: HeroDefinition = {
    id: greatTenguIds.hero,
    skills: [createBasic(), createUltimate()],
    aiCoverage: 'verified',
    mechanicsCoverage: 'partial',
    initialize(_context, unitId) { return [shelterEffect(unitId)]; },
    handlers: {
      hit: { priority: 138, handle(context, event) { return onDamage(context, event); } },
      'attack-end': { priority: 125, handle(context, event) { return finishAttack(context, event); } },
      'control-application': { priority: 92, handle(context, event) { return freeUltimateAfterShelter(context, event); } },
      'turn-end': { priority: 38, handle(context, event) { return renewShelter(context, event); } },
    },
    policy(context, unitId) {
      const actor = context.getUnit(unitId);
      if (!actor) return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      if ((context.state.resources[actor.side]?.fire ?? 0) >= 3) {
        return { actorId: unitId, skillId: greatTenguIds.ultimate, targetIds: enemies.map(unit => unit.unitId),
          shape: 'all-enemies', targetRelation: 'enemy' };
      }
      const target = enemies.slice().sort((left, right) => left.hp / left.stats.hp - right.hp / right.stats.hp)[0]!;
      return { actorId: unitId, skillId: greatTenguIds.basic, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
    },
  };
  registry.registerHero(definition);
}

function createBasic(): SkillDefinition {
  return { id: greatTenguIds.basic, actionKind: 'basic', target: 'single', targetRelation: 'enemy',
    levels: basicRatios.map(ratio => ({ ratio })),
    execute(context, intent, parameters) { return damage(context, intent.actorId, intent.targetIds.slice(0, 1), greatTenguIds.basic,
      Number(parameters.ratio ?? 1)); } };
}

function createUltimate(): SkillDefinition {
  return { id: greatTenguIds.ultimate, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'all-enemies', targetRelation: 'enemy', levels: ultimateRatios.map(ratio => ({ ratio })),
    execute(context, intent, parameters) {
      const commands: EffectCommand[] = [];
      for (let hitIndex = 0; hitIndex < 4; hitIndex++) {
        commands.push(...damage(context, intent.actorId, intent.targetIds, greatTenguIds.ultimate, Number(parameters.ratio ?? .65)));
      }
      return commands;
    } };
}

function damage(context: BattleContext, actorId: string, targetIds: readonly string[], skillId: string, ratio: number): EffectCommand[] {
  const actor = context.getUnit(actorId);
  const attack = context.getEffectiveStats(actorId);
  if (!actor || !attack) return [];
  return targetIds.flatMap(targetId => {
    const target = context.getUnit(targetId);
    const defense = target && context.getEffectiveStats(targetId);
    if (!target || !defense || target.hp <= 0) return [];
    const result = context.calculateDamage({ attack: attack.attack, defense: defense.defense, defenseIgnore: effectiveDefenseIgnore(actor),
      ratio, critChance: attack.crit, critDamage: attack.critDamage }, actor, target);
    return [{ type: 'deal-damage' as const, source: source(skillId, actor.unitId), targetId,
      amount: result.amount, ...(result.damageOptions ? { damageOptions: result.damageOptions } : {}), isCritical: result.isCritical }];
  });
}

function onDamage(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage' || !event.source.unitId) return;
  const attacker = context.getUnit(event.source.unitId);
  if (!attacker || attacker.heroId !== greatTenguIds.hero || attacker.unitKind === 'summon' || !passivesEnabled(attacker)) return;
  const commands: EffectCommand[] = [];
  let pendingFierce = 0;
  if (context.random() < .5) {
    const gained = addFierce(attacker, event.eventId, pendingFierce);
    commands.push(...gained);
    pendingFierce += gained.length;
  }
  if (event.source.id !== greatTenguIds.ultimate || event.attackId === undefined) return commands;
  const key = `${event.attackId}:${event.targetId}`;
  const targetSeen = attacker.statuses.some(status => status.statusId === greatTenguIds.attackTarget && status.values?.key === key);
  const seenCount = attacker.statuses.filter(status => status.statusId === greatTenguIds.attackTarget
    && status.values?.attackId === event.attackId).length;
  if (targetSeen || seenCount >= 6) return commands;
  const markerSource = { kind: 'status' as const, id: `${greatTenguIds.attackTarget}:${event.attackId}:${event.targetId}`,
    unitId: attacker.unitId };
  const marker: StatusInstance = { instanceId: `${greatTenguIds.attackTarget}:${attacker.unitId}:${key}`,
    statusId: greatTenguIds.attackTarget, source: markerSource, stacks: 1,
    duration: { kind: 'permanent' }, values: { key, attackId: event.attackId } };
  commands.push({ type: 'add-status', source: markerSource, targetId: attacker.unitId, instance: marker, parentEventId: event.eventId });
  commands.push(...addFierce(attacker, event.eventId, pendingFierce));
  commands.push({ type: 'change-action-gauge', source: source(greatTenguIds.ultimate, attacker.unitId),
    targetId: attacker.unitId, amount: 5, parentEventId: event.eventId });
  return commands;
}

function addFierce(actor: UnitState, parentEventId: string, pendingStacks = 0): EffectCommand[] {
  const current = actor.statuses.find(status => status.statusId === greatTenguIds.fierce);
  const cap = fierceCaps[Math.max(0, Math.min(4, actor.skillLevel - 1))]!;
  if ((current?.stacks ?? 0) + pendingStacks >= cap) return [];
  const instance: StatusInstance = { instanceId: `${greatTenguIds.fierce}:${actor.unitId}`, statusId: greatTenguIds.fierce,
    source: source(greatTenguIds.passive, actor.unitId), stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'round' } };
  return [{ type: 'add-status', source: instance.source, targetId: actor.unitId, instance, parentEventId }];
}

function finishAttack(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'attack-ended' || event.source.id !== greatTenguIds.ultimate || !event.source.unitId || event.attackId === undefined) return;
  const actor = context.getUnit(event.source.unitId);
  if (!actor || actor.heroId !== greatTenguIds.hero) return;
  const statusIds = actor.statuses.filter(status => status.statusId === greatTenguIds.attackTarget
    && status.values?.attackId === event.attackId).map(status => status.statusId);
  return statusIds.length ? [{ type: 'remove-statuses', source: source(greatTenguIds.passive, actor.unitId),
    targetId: actor.unitId, statusIds: [greatTenguIds.attackTarget], reason: 'consumed', parentEventId: event.eventId }] : undefined;
}

function freeUltimateAfterShelter(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'control-blocked' || event.protectionStatusId !== greatTenguIds.shelter) return;
  const actor = context.getUnit(event.targetId);
  if (!actor || actor.heroId !== greatTenguIds.hero || actor.skillLevel < 5 || actor.hp <= 0 || !passivesEnabled(actor)) return;
  const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
  if (!enemies.length) return;
  const intent: ActionIntent = { actorId: actor.unitId, skillId: greatTenguIds.ultimate, targetIds: enemies.map(unit => unit.unitId),
    shape: 'all-enemies', targetRelation: 'enemy' };
  return [{ type: 'schedule-action', source: source(greatTenguIds.passive, actor.unitId), intent,
    scheduling: 'extra-action', freeCast: true, parentEventId: event.eventId }];
}

function renewShelter(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-ended') return;
  const actor = context.getUnit(event.unitId);
  if (!actor || actor.heroId !== greatTenguIds.hero || actor.unitKind === 'summon' || actor.hp <= 0
    || actor.statuses.some(status => status.statusId === greatTenguIds.shelter)) return;
  return [shelterEffect(actor.unitId, event.eventId)];
}

function shelterEffect(unitId: string, parentEventId?: string): EffectCommand {
  const shelter: StatusInstance = { instanceId: `${greatTenguIds.shelter}:${unitId}`, statusId: greatTenguIds.shelter,
    source: source(greatTenguIds.passive, unitId), stacks: 1, duration: { kind: 'permanent' } };
  return { type: 'add-status', source: shelter.source, targetId: unitId, instance: shelter, ...(parentEventId ? { parentEventId } : {}) };
}

function source(id: string, unitId: string) { return { kind: 'skill' as const, id, unitId }; }
