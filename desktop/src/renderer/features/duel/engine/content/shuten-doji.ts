import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import { passivesEnabled } from '../core/passive-eligibility';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, StatusInstance, UnitState } from '../core/types';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import type { ContentRegistry } from './registry';

export const shutenDojiIds = {
  hero: 219,
  basic: '2191',
  passive: '2192',
  ultimate: '2193',
  rage: 'status.hero.219.rage',
  stance: 'status.hero.219.oni-king',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const rageDamageReduction = [0, .05, .1, .15, .15] as const;
const stanceLifestealRatios = [.1, .15, .2, .25, .3] as const;

export function registerShutenDoji(registry: ContentRegistry): void {
  registry.registerStatus({ id: shutenDojiIds.rage, mechanicsCoverage: 'partial', category: 'buff', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'add-stack', maxStacks: 4 });
  registry.registerStatus({ id: shutenDojiIds.stance, mechanicsCoverage: 'partial', category: 'buff', dispellable: false,
    sealable: false, durationOwner: 'target-turn', refreshPolicy: 'replace' });

  const definition: HeroDefinition = {
    id: shutenDojiIds.hero,
    skills: [createBasic(), createUltimate()],
    aiCoverage: 'verified',
    mechanicsCoverage: 'partial',
    initialize(context, unitId) {
      const unit = context.getUnit(unitId);
      return unit && (unit.skillLevel ?? 1) >= 5 ? addRage(unit, 2, 'initialization') : [];
    },
    modifyIncomingDamage(_attacker, target, amount) {
      if (!passivesEnabled(target)) return amount * .9;
      const rage = target.statuses.find(status => status.statusId === shutenDojiIds.rage)?.stacks ?? 0;
      const perStack = rageDamageReduction[Math.max(0, Math.min(4, target.skillLevel - 1))]!;
      return amount * .9 * (1 - perStack * rage);
    },
    handlers: {
      'turn-start': { priority: 60, handle(context, event) { return clearControlAtTurnStart(context, event); } },
      hit: { priority: 135, handle(context, event) {
        return [...(gainRageWhenHit(context, event) ?? []), ...(lifestealOnHit(context, event) ?? [])];
      } },
      'action-end': { priority: 78, handle(context, event) { return actionEndRage(context, event); } },
      'turn-end': { priority: 48, handle(context, event) { return autoUltimateBelowThreshold(context, event); } },
    },
    policy(context, unitId) {
      const actor = context.getUnit(unitId);
      if (!actor) return undefined;
      if (actor.hp / Math.max(1, actor.stats.hp) <= .25 && (context.state.resources[actor.side]?.fire ?? 0) >= 3) {
        return { actorId: unitId, skillId: shutenDojiIds.ultimate, targetIds: [unitId], shape: 'self', targetRelation: 'ally' };
      }
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      const aboveForty = enemies.filter(enemy => enemy.hp / Math.max(1, enemy.stats.hp) > .4)
        .sort((left, right) => right.hp / right.stats.hp - left.hp / left.stats.hp)[0];
      const target = aboveForty ?? enemies.slice().sort((left, right) => left.hp / left.stats.hp - right.hp / right.stats.hp)[0]!;
      return { actorId: unitId, skillId: shutenDojiIds.basic, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
    },
  };
  registry.registerHero(definition);
}

function createBasic(): SkillDefinition {
  return { id: shutenDojiIds.basic, actionKind: 'basic', target: 'single', targetRelation: 'enemy',
    levels: basicRatios.map(ratio => ({ ratio })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      if (!actor) return [];
      const rage = actor.statuses.find(status => status.statusId === shutenDojiIds.rage)?.stacks ?? 0;
      // Counter-style passive actions only use one hit; ordinary basics add one hit per Rage layer.
      const hitCount = intent.kind === 'passive' ? 1 : 1 + rage;
      return damage(context, intent.actorId, intent.targetIds.slice(0, 1), shutenDojiIds.basic,
        Number(parameters.ratio ?? 1), hitCount);
    } };
}

function createUltimate(): SkillDefinition {
  return { id: shutenDojiIds.ultimate, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'self', targetRelation: 'ally', levels: stanceLifestealRatios.map(lifesteal => ({ lifesteal, healRatio: .3, gauge: 50,
      duration: 3 })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      if (!actor) return [];
      const source = shutenSource(shutenDojiIds.ultimate, actor.unitId);
      const commands: EffectCommand[] = [
        { type: 'heal', source, targetId: actor.unitId, amount: actor.stats.hp * Number(parameters.healRatio ?? .3) },
        { type: 'change-action-gauge', source, targetId: actor.unitId, amount: Number(parameters.gauge ?? 50) },
        { type: 'add-status', source, targetId: actor.unitId, instance: {
          instanceId: `${shutenDojiIds.stance}:${actor.unitId}`, statusId: shutenDojiIds.stance, source, stacks: 1,
          duration: { kind: 'count', remaining: Number(parameters.duration ?? 3), owner: 'target-turn' },
          values: { lifesteal: Number(parameters.lifesteal ?? .1) },
        } },
      ];
      return commands;
    } };
}

function damage(context: BattleContext, actorId: string, targetIds: readonly string[], skillId: string, ratio: number,
  hitCount: number): EffectCommand[] {
  const actor = context.getUnit(actorId);
  const attack = context.getEffectiveStats(actorId);
  if (!actor || !attack) return [];
  const commands: EffectCommand[] = [];
  for (let hitIndex = 0; hitIndex < hitCount; hitIndex++) for (const targetId of targetIds) {
    const target = context.getUnit(targetId);
    const defense = target && context.getEffectiveStats(targetId);
    if (!target || !defense || target.hp <= 0) continue;
    const hit = context.calculateDamage({ attack: attack.attack, defense: defense.defense, defenseIgnore: effectiveDefenseIgnore(actor),
      ratio, critChance: attack.crit, critDamage: attack.critDamage }, actor, target);
    commands.push({ type: 'deal-damage', source: shutenSource(skillId, actor.unitId), targetId,
      amount: hit.amount, ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}), isCritical: hit.isCritical });
  }
  return commands;
}

function clearControlAtTurnStart(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-started') return;
  const actor = context.getUnit(event.unitId);
  if (!actor || actor.heroId !== shutenDojiIds.hero || actor.unitKind === 'summon' || !passivesEnabled(actor)) return;
  const controls = actor.statuses.filter(status => context.getStatusCategory(status.statusId) === 'control');
  if (controls.length === 0) return;
  return [
    { type: 'remove-statuses', source: shutenSource(shutenDojiIds.passive, actor.unitId), targetId: actor.unitId,
      statusIds: [...new Set(controls.map(status => status.statusId))], reason: 'consumed', parentEventId: event.eventId },
    ...addRage(actor, 1, event.eventId),
  ];
}

function gainRageWhenHit(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage' || !event.targetId) return;
  const target = context.getUnit(event.targetId);
  if (!target || target.heroId !== shutenDojiIds.hero || target.unitKind === 'summon' || !passivesEnabled(target)
    || context.random() >= .25) return;
  return addRage(target, 1, event.eventId);
}

function actionEndRage(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'action-ended' || !event.source.unitId) return;
  const actor = context.getUnit(event.source.unitId);
  if (!actor || actor.heroId !== shutenDojiIds.hero || actor.unitKind === 'summon' || actor.hp <= 0 || !passivesEnabled(actor)
    || context.random() >= .5) return;
  return addRage(actor, 1, event.eventId);
}

function autoUltimateBelowThreshold(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-ended') return;
  const commands: EffectCommand[] = [];
  for (const unit of Object.values(context.state.units)) {
    if (unit.heroId !== shutenDojiIds.hero || unit.unitKind === 'summon' || unit.hp <= 0
      || unit.hp / Math.max(1, unit.stats.hp) >= .3 || unit.statuses.some(status => status.statusId === shutenDojiIds.stance)
      || !passivesEnabled(unit)) continue;
    const controls = unit.statuses.filter(status => context.getStatusCategory(status.statusId) === 'control');
    if (controls.length) commands.push({ type: 'remove-statuses', source: shutenSource(shutenDojiIds.passive, unit.unitId),
      targetId: unit.unitId, statusIds: [...new Set(controls.map(status => status.statusId))], reason: 'consumed', parentEventId: event.eventId });
    const intent: ActionIntent = { actorId: unit.unitId, skillId: shutenDojiIds.ultimate,
      targetIds: [unit.unitId], shape: 'self', targetRelation: 'ally' };
    commands.push({ type: 'schedule-action', source: shutenSource(shutenDojiIds.passive, unit.unitId), intent,
      scheduling: 'extra-action', freeCast: true, parentEventId: event.eventId });
  }
  return commands;
}

function lifestealOnHit(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage' || !event.source.unitId || event.hpLost <= 0) return;
  const actor = context.getUnit(event.source.unitId);
  const stance = actor?.statuses.find(status => status.statusId === shutenDojiIds.stance);
  if (!actor || actor.heroId !== shutenDojiIds.hero || !stance) return;
  const lifesteal = typeof stance.values?.lifesteal === 'number' ? stance.values.lifesteal
    : stanceLifestealRatios[Math.max(0, Math.min(4, (actor.skillLevel ?? 1) - 1))]!;
  return [{ type: 'heal', source: stance.source, targetId: actor.unitId, amount: event.hpLost * lifesteal, parentEventId: event.eventId }];
}

function addRage(actor: UnitState, amount: number, parentEventId: string): EffectCommand[] {
  const stacks = actor.statuses.find(status => status.statusId === shutenDojiIds.rage)?.stacks ?? 0;
  if (stacks >= 4) return [];
  const source = shutenSource(shutenDojiIds.passive, actor.unitId);
  const instance: StatusInstance = { instanceId: `${shutenDojiIds.rage}:${actor.unitId}`, statusId: shutenDojiIds.rage,
    source, stacks: Math.min(amount, 4 - stacks), duration: { kind: 'permanent' } };
  return [{ type: 'add-status', source, targetId: actor.unitId, instance, ...(parentEventId !== 'initialization' ? { parentEventId } : {}) }];
}

function shutenSource(id: string, unitId: string) { return { kind: 'skill' as const, id, unitId }; }
