import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import { passivesEnabled } from '../core/passive-eligibility';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, UnitState } from '../core/types';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import type { ContentRegistry } from './registry';

export const yatagarasuIds = {
  hero: 218,
  basic: '2181',
  passive: '2182',
  ultimate: '2183',
} as const;

const basicRatios = [.8, .9, .9, 1, 1] as const;
const ultimateRatios = [1.19, 1.31, 1.31, 1.43, 1.43] as const;
const inviteChances = [.3, .3, .4, .4, .5] as const;
const cleanseChances = [.5, .7, 1, 1, 1] as const;

export function registerYatagarasu(registry: ContentRegistry): void {
  const definition: HeroDefinition = {
    id: yatagarasuIds.hero,
    skills: [createBasic(), createUltimate()],
    aiCoverage: 'verified',
    mechanicsCoverage: 'partial',
    handlers: {
      'turn-start': { priority: 67, handle(context, event) { return cleanseControls(context, event); } },
      'action-end': { priority: 73, handle(context, event) { return gainGaugeOnAllyBasic(context, event); } },
      'attack-end': { priority: 142, handle(context, event) { return inviteAllies(context, event, registry); } },
    },
    policy(context, unitId) {
      const actor = context.getUnit(unitId);
      if (!actor) return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      const fire = context.state.resources[actor.side]?.fire ?? 0;
      if ((enemies.length >= 2 || fire > 5) && fire >= 3) {
        const ordered = enemies.slice().sort((left, right) => left.hp / left.stats.hp - right.hp / right.stats.hp);
        return { actorId: unitId, skillId: yatagarasuIds.ultimate, targetIds: ordered.map(unit => unit.unitId),
          shape: 'all-enemies', targetRelation: 'enemy' };
      }
      const target = enemies.slice().sort((left, right) => left.hp / left.stats.hp - right.hp / right.stats.hp)[0]!;
      return { actorId: unitId, skillId: yatagarasuIds.basic, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
    },
  };
  registry.registerHero(definition);
}

function createBasic(): SkillDefinition {
  return { id: yatagarasuIds.basic, actionKind: 'basic', target: 'single', targetRelation: 'enemy',
    levels: basicRatios.map((ratio, index) => ({ ratio, inviteChance: inviteChances[index]! })),
    execute(context, intent, parameters) { return damage(context, intent.actorId, intent.targetIds.slice(0, 1), yatagarasuIds.basic,
      Number(parameters.ratio ?? .8)); } };
}

function createUltimate(): SkillDefinition {
  return { id: yatagarasuIds.ultimate, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'all-enemies', targetRelation: 'enemy',
    levels: ultimateRatios.map((ratio, index) => ({ ratio, inviteChance: inviteChances[index]! })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      if (!actor) return [];
      const enemySide = actor.side === 'blue' ? 'red' : 'blue';
      const initialEnemyCount = context.state.sides[enemySide].filter(unitId => context.getUnit(unitId)?.unitKind !== 'summon').length;
      const currentEnemyCount = context.getLivingUnits(enemySide).length;
      const ratio = Number(parameters.ratio ?? 1.19) * (1 + Math.min(1, Math.max(0, initialEnemyCount - currentEnemyCount) * .2));
      const orderedTargets = intent.targetIds.slice().sort((leftId, rightId) => {
        const left = context.getUnit(leftId)!;
        const right = context.getUnit(rightId)!;
        return left.hp / left.stats.hp - right.hp / right.stats.hp;
      });
      return damage(context, intent.actorId, orderedTargets, yatagarasuIds.ultimate, ratio);
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

function cleanseControls(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-started') return;
  const actor = context.getUnit(event.unitId);
  if (!actor || actor.heroId !== yatagarasuIds.hero || actor.unitKind === 'summon' || !passivesEnabled(actor)) return;
  const chance = cleanseChances[Math.max(0, Math.min(4, actor.skillLevel - 1))]!;
  if (context.random() >= chance) return;
  const commands: EffectCommand[] = [];
  const ownControls = actor.statuses.filter(status => context.getStatusCategory(status.statusId) === 'control');
  if (ownControls.length) {
    const selected = ownControls[Math.floor(context.random() * ownControls.length)]!;
    commands.push({ type: 'remove-statuses', source: source(yatagarasuIds.passive, actor.unitId), targetId: actor.unitId,
      statusIds: [selected.statusId], reason: 'consumed', parentEventId: event.eventId });
  }
  if (actor.skillLevel >= 5) {
    const allies = context.getLivingUnits(actor.side).filter(ally => ally.statuses.some(status =>
      context.getStatusCategory(status.statusId) === 'control'));
    if (allies.length) {
      const ally = allies[Math.floor(context.random() * allies.length)]!;
      const controls = ally.statuses.filter(status => context.getStatusCategory(status.statusId) === 'control');
      const selected = controls[Math.floor(context.random() * controls.length)]!;
      commands.push({ type: 'remove-statuses', source: source(yatagarasuIds.passive, actor.unitId), targetId: ally.unitId,
        statusIds: [selected.statusId], reason: 'consumed', parentEventId: event.eventId });
    }
  }
  return commands;
}

function gainGaugeOnAllyBasic(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'action-ended' || event.actionKind !== 'basic' || !event.source.unitId) return;
  const attacker = context.getUnit(event.source.unitId);
  if (!attacker) return;
  return context.getLivingUnits(attacker.side)
    .filter(unit => unit.heroId === yatagarasuIds.hero && unit.unitKind !== 'summon' && passivesEnabled(unit))
    .map(unit => ({ type: 'change-action-gauge' as const, source: source(yatagarasuIds.passive, unit.unitId),
      targetId: unit.unitId, amount: 5, parentEventId: event.eventId }));
}

function inviteAllies(context: BattleContext, event: BattleEvent, registry: ContentRegistry): EffectCommand[] | undefined {
  if (event.type !== 'attack-ended' || !event.source.unitId || ![yatagarasuIds.basic, yatagarasuIds.ultimate].includes(event.source.id as
    typeof yatagarasuIds.basic | typeof yatagarasuIds.ultimate) || event.actionKind === 'passive') return;
  const actor = context.getUnit(event.source.unitId);
  if (!actor || actor.heroId !== yatagarasuIds.hero || actor.unitKind === 'summon' || !passivesEnabled(actor)) return;
  const chance = inviteChances[Math.max(0, Math.min(4, actor.skillLevel - 1))]!;
  const allies = context.getLivingUnits(actor.side).filter(unit => unit.unitId !== actor.unitId && unit.unitKind !== 'summon');
  const invited = allies.slice().sort((left, right) => right.stats.attack - left.stats.attack)[0];
  if (!invited) return;
  const hero = registry.getHero(invited.heroId);
  const basic = hero?.skills.find(skill => skill.actionKind === 'basic')
    ?? hero?.skills.find(skill => skill.id === `${invited.heroId}1`);
  if (!basic) return;
  const commands: EffectCommand[] = [];
  for (const change of event.targetHealthChanges ?? []) {
    if (context.random() >= chance) continue;
    const currentTarget = context.getUnit(change.targetId);
    const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
    if (!enemies.length) break;
    const target = currentTarget && currentTarget.hp > 0 && currentTarget.side !== actor.side
      ? currentTarget : enemies[Math.floor(context.random() * enemies.length)]!;
    const intent: ActionIntent = { actorId: invited.unitId, skillId: basic.id, targetIds: [target.unitId],
      shape: basic.target, targetRelation: basic.targetRelation ?? 'enemy', kind: 'passive' };
    if (actor.skillLevel >= 4) {
      const controls = invited.statuses.filter(status => context.getStatusCategory(status.statusId) === 'control');
      if (controls.length) commands.push({ type: 'remove-statuses', source: source(yatagarasuIds.passive, actor.unitId),
        targetId: invited.unitId, statusIds: [...new Set(controls.map(status => status.statusId))], reason: 'consumed', parentEventId: event.eventId });
    }
    commands.push({ type: 'schedule-action', source: source(yatagarasuIds.passive, actor.unitId), intent,
      scheduling: 'assist', parentEventId: event.eventId });
  }
  return commands;
}

function source(id: string, unitId: string) { return { kind: 'skill' as const, id, unitId }; }
