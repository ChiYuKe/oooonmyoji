import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, StatusInstance, UnitState } from '../core/types';
import { passiveSuppressionStatusId, passivesEnabled } from '../core/passive-eligibility';
import { createBasicAttackSkill } from './common-skills';
import type { ContentRegistry } from './registry';

export const tenjukkaIds = {
  hero: 323,
  basic: '3231',
  passive: '3232',
  awaken: '3233',
  resistance: 'status.hero.323.resistance-aura',
  joy: 'status.hero.323.joyful-mark',
  awake: 'status.hero.323.awake-damage',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.2] as const;
const resistanceByLevel = [.1, .15, .2, .25, .25] as const;
const joyStacksByLevel = [2, 2, 2, 2, 3] as const;
const awakeDamageByLevel = [.1, .15, .15, .2, .2] as const;

export function registerTenjukka(registry: ContentRegistry): void {
  registry.registerStatus({ id: tenjukkaIds.resistance, mechanicsCoverage: 'partial', category: 'buff', dispellable: true,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace' });
  registry.registerStatus({ id: tenjukkaIds.joy, mechanicsCoverage: 'partial', category: 'buff', dispellable: true,
    sealable: false, durationOwner: 'source-turn', refreshPolicy: 'replace', maxStacks: 3, controlProtection: 'immune' });
  registry.registerStatus({ id: tenjukkaIds.awake, mechanicsCoverage: 'partial', category: 'buff', dispellable: true,
    sealable: false, durationOwner: 'source-turn', refreshPolicy: 'replace' });
  registry.registerHero(createTenjukkaDefinition());
}

export function createTenjukkaDefinition(): HeroDefinition {
  const basic = createBasicAttackSkill(tenjukkaIds.basic, basicRatios);
  const awaken: SkillDefinition = {
    id: tenjukkaIds.awaken,
    target: 'self',
    targetRelation: 'ally',
    levels: joyStacksByLevel.map(stacks => ({ stacks })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      if (!actor || actor.hp <= 0 || actor.heroId !== tenjukkaIds.hero) return [];
      const source = tenjukkaSource(tenjukkaIds.awaken, actor.unitId);
      return [{ type: 'add-status', source, targetId: actor.unitId, instance: {
        instanceId: `${tenjukkaIds.joy}:${actor.unitId}`,
        statusId: tenjukkaIds.joy,
        source,
        stacks: Number(parameters.stacks ?? 2),
        duration: { kind: 'count', remaining: 1, owner: 'source-turn' },
      } }];
    },
  };

  return {
    id: tenjukkaIds.hero,
    skills: [basic, awaken],
    aiCoverage: 'verified',
    mechanicsCoverage: 'verified',
    mechanicsCoverageNotes: ['客户端技能行对应的抵抗光环、封印/解封、五级治疗、清醒效果及欢愉消耗均有独立回归；每层欢愉只在持有者自身或其他非召唤友方回合结束时供1火，三级起为对应行动者推进25%行动条，驱散后的空状态不会误供火。'],
    initialize(context, unitId) {
      const owner = context.getUnit(unitId);
      if (!owner || owner.heroId !== tenjukkaIds.hero || !passivesEnabled(owner)) return [];
      const level = skillLevel(owner, tenjukkaIds.passive);
      const resist = resistanceByLevel[Math.max(0, Math.min(4, level - 1))]!;
      const commands: EffectCommand[] = [];
      for (const ally of context.getLivingUnits(owner.side)) {
        if (ally.unitKind === 'summon') continue;
        const own = ally.unitId === owner.unitId;
        commands.push({ type: 'add-status', source: tenjukkaSource(tenjukkaIds.passive, owner.unitId), targetId: ally.unitId,
          instance: resistanceAura(owner, ally, resist * (own ? 2 : 1)) });
      }
      return commands;
    },
    policy(context, unitId): ActionIntent | undefined {
      const actor = context.getUnit(unitId);
      if (!actor || actor.hp <= 0 || actor.unitKind === 'summon') return undefined;
      const allies = context.getLivingUnits(actor.side).filter(ally => ally.unitKind !== 'summon');
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (enemies.length === 0) return undefined;
      if (allies.length >= 2) return { actorId: unitId, skillId: tenjukkaIds.awaken, targetIds: [unitId], shape: 'self', targetRelation: 'ally' };
      const target = enemies.filter(enemy => enemy.hp / Math.max(1, enemy.stats.hp) < .1)
        .sort((left, right) => left.hp / Math.max(1, left.stats.hp)
          - right.hp / Math.max(1, right.stats.hp))[0]
        ?? enemies.slice().sort((left, right) => left.hp / Math.max(1, left.stats.hp)
        - right.hp / Math.max(1, right.stats.hp))[0]!;
      return { actorId: unitId, skillId: tenjukkaIds.basic, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
    },
    handlers: {
      'effect-resolution': { priority: 20, handle(context, event) { return handleTenjukkaPassiveSeal(context, event); } },
      'turn-start': { priority: 20, handle(context, event) { return handleTenjukkaTurnStart(context, event); } },
      'turn-end': { priority: 20, handle(context, event) { return handleTenjukkaTurnEnd(context, event); } },
      'unit-defeated': { priority: 20, handle(context, event) { return removeTenjukkaAuras(context, event); } },
    },
  };
}

function handleTenjukkaPassiveSeal(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  const suppressionAdded = event.type === 'status-added'
    && (event.instance.statusId === passiveSuppressionStatusId || event.instance.values?.sealPassives === true);
  const suppressionRemoved = event.type === 'status-removed'
    && (event.statusId === passiveSuppressionStatusId || event.removedValues?.sealPassives === true);
  if (!suppressionAdded && !suppressionRemoved) return;
  const owner = context.getUnit(event.targetId);
  if (!owner || owner.heroId !== tenjukkaIds.hero || owner.hp <= 0) return;
  const source = tenjukkaSource(tenjukkaIds.passive, owner.unitId);
  if (suppressionAdded) {
    const commands: EffectCommand[] = [];
    for (const allyId of context.state.sides[owner.side]) {
      const ally = context.getUnit(allyId);
      if (!ally) continue;
      const ids = ally.statuses.filter(status => status.statusId === tenjukkaIds.resistance
        && status.source.unitId === owner.unitId).map(status => status.instanceId);
      if (ids.length) commands.push({ type: 'remove-status-instances', source, targetId: ally.unitId,
        instanceIds: ids, reason: 'consumed', parentEventId: event.eventId });
    }
    return commands;
  }
  if (!passivesEnabled(owner)) return;
  const level = skillLevel(owner, tenjukkaIds.passive);
  const resist = resistanceByLevel[Math.max(0, Math.min(4, level - 1))]!;
  const commands: EffectCommand[] = [];
  for (const ally of context.getLivingUnits(owner.side)) {
    if (ally.unitKind === 'summon' || ally.statuses.some(status => status.statusId === tenjukkaIds.resistance
      && status.source.unitId === owner.unitId)) continue;
    const own = ally.unitId === owner.unitId;
    commands.push({ type: 'add-status', source, targetId: ally.unitId,
      instance: resistanceAura(owner, ally, resist * (own ? 2 : 1)), parentEventId: event.eventId });
  }
  return commands;
}

function handleTenjukkaTurnStart(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-started') return;
  const actor = context.getUnit(event.unitId);
  if (!actor || actor.hp <= 0 || actor.unitKind === 'summon') return;
  const owner = context.getLivingUnits(actor.side).find(ally => ally.heroId === tenjukkaIds.hero && passivesEnabled(ally));
  if (!owner) return;
  const commands: EffectCommand[] = [];
  if (skillLevel(owner, tenjukkaIds.passive) >= 5) {
    commands.push({ type: 'heal', source: tenjukkaSource(tenjukkaIds.passive, owner.unitId), targetId: actor.unitId,
      amount: actor.stats.hp * .05, parentEventId: event.eventId });
  }
  if (actor.heroId === tenjukkaIds.hero) {
    const damageBonus = awakeDamageByLevel[Math.max(0, Math.min(4, skillLevel(actor, tenjukkaIds.awaken) - 1))]!;
    for (const ally of context.getLivingUnits(actor.side)) {
      if (ally.unitKind === 'summon') continue;
      const self = ally.unitId === actor.unitId;
      commands.push({ type: 'add-status', source: tenjukkaSource(tenjukkaIds.awaken, actor.unitId), targetId: ally.unitId,
        instance: awakeStatus(actor, ally, self ? 0 : damageBonus, self ? .75 : 0, event.eventId) });
    }
  }
  return commands;
}

function handleTenjukkaTurnEnd(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-ended') return;
  const ending = context.getUnit(event.unitId);
  if (!ending) return;
  if (ending.heroId === tenjukkaIds.hero) {
    const source = tenjukkaSource(tenjukkaIds.awaken, ending.unitId);
    const commands: EffectCommand[] = [];
    for (const allyId of context.state.sides[ending.side]) {
      const ally = context.getUnit(allyId);
      if (!ally) continue;
      const ids = ally.statuses.filter(status => status.statusId === tenjukkaIds.awake
        && status.source.unitId === ending.unitId).map(status => status.instanceId);
      if (ids.length) commands.push({ type: 'remove-status-instances', source, targetId: ally.unitId, instanceIds: ids,
        reason: 'consumed', parentEventId: event.eventId });
    }
    const mark = ending.statuses.find(status => status.statusId === tenjukkaIds.joy && status.stacks > 0);
    if (!mark || !passivesEnabled(ending)) return commands.length ? commands : undefined;
    commands.push({ type: 'remove-status-instances', source, targetId: ending.unitId,
      instanceIds: [mark.instanceId], reason: 'consumed', parentEventId: event.eventId });
    if (mark.stacks > 1) commands.push({ type: 'add-status', source, targetId: ending.unitId,
      instance: { ...mark, stacks: mark.stacks - 1, appliedByEventId: event.eventId } });
    commands.push({ type: 'change-resource', source, side: ending.side, resourceId: 'fire', amount: 1, parentEventId: event.eventId });
    if (skillLevel(ending, tenjukkaIds.awaken) >= 3) commands.push({ type: 'change-action-gauge', source,
      targetId: ending.unitId, amount: 25, parentEventId: event.eventId });
    return commands;
  }
  if (ending.unitKind === 'summon' || ending.hp <= 0) return;
  const owner = context.getLivingUnits(ending.side).find(ally => ally.heroId === tenjukkaIds.hero && passivesEnabled(ally));
  const mark = owner?.statuses.find(status => status.statusId === tenjukkaIds.joy && status.stacks > 0);
  if (!owner || !mark) return;
  const source = tenjukkaSource(tenjukkaIds.awaken, owner.unitId);
  const commands: EffectCommand[] = [{ type: 'remove-status-instances', source, targetId: owner.unitId,
    instanceIds: [mark.instanceId], reason: 'consumed', parentEventId: event.eventId }];
  if (mark.stacks > 1) commands.push({ type: 'add-status', source, targetId: owner.unitId,
    instance: { ...mark, stacks: mark.stacks - 1, appliedByEventId: event.eventId } });
  commands.push({ type: 'change-resource', source, side: owner.side, resourceId: 'fire', amount: 1, parentEventId: event.eventId });
  if (skillLevel(owner, tenjukkaIds.awaken) >= 3) commands.push({ type: 'change-action-gauge', source, targetId: ending.unitId,
    amount: 25, parentEventId: event.eventId });
  return commands;
}

function removeTenjukkaAuras(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'unit-defeated') return;
  const owner = context.getUnit(event.unitId);
  if (!owner || owner.heroId !== tenjukkaIds.hero) return;
  const source = tenjukkaSource(tenjukkaIds.passive, owner.unitId);
  const commands: EffectCommand[] = [];
  for (const allyId of context.state.sides[owner.side]) {
    const ally = context.getUnit(allyId);
    if (!ally) continue;
    const ids = ally.statuses.filter(status => status.source.unitId === owner.unitId
      && (status.statusId === tenjukkaIds.resistance || status.statusId === tenjukkaIds.awake
        || status.statusId === tenjukkaIds.joy)).map(status => status.instanceId);
    if (ids.length) commands.push({ type: 'remove-status-instances', source, targetId: ally.unitId, instanceIds: ids,
      reason: 'consumed', parentEventId: event.eventId });
  }
  return commands;
}

function resistanceAura(owner: Readonly<UnitState>, ally: Readonly<UnitState>, amount: number): StatusInstance {
  const source = tenjukkaSource(tenjukkaIds.passive, owner.unitId);
  return { instanceId: `${tenjukkaIds.resistance}:${owner.unitId}:${ally.unitId}`, statusId: tenjukkaIds.resistance,
    source, stacks: 1, duration: { kind: 'permanent' }, modifiers: [{ stat: 'resist', operation: 'flat', amount }] };
}

function awakeStatus(owner: Readonly<UnitState>, ally: Readonly<UnitState>, damage: number, resist: number, eventId: string): StatusInstance {
  const source = tenjukkaSource(tenjukkaIds.awaken, owner.unitId);
  return { instanceId: `${tenjukkaIds.awake}:${owner.unitId}:${ally.unitId}:${eventId}`, statusId: tenjukkaIds.awake,
    source, stacks: 1, duration: { kind: 'permanent' },
    modifiers: [...(damage ? [{ stat: 'damage' as const, operation: 'percent' as const, amount: damage }] : []),
      ...(resist ? [{ stat: 'resist' as const, operation: 'flat' as const, amount: resist }] : [])] };
}

function tenjukkaSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
function skillLevel(unit: Readonly<UnitState>, skillId: string): number {
  return Math.max(1, Math.min(5, unit.skillLevels?.[skillId] ?? unit.skillLevel));
}
