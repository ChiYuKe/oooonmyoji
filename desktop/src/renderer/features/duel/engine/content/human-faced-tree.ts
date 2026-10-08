import type { HeroDefinition, SkillDefinition, StatusDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { attemptDebuff } from '../mechanics/control';
import type { ContentRegistry } from './registry';

export const humanFacedTreeIds = { hero: 317, basic: '3171', passive: '3172', ultimate: '3173', flower: 'status.hero.317.disaster-flower',
  resist: 'status.hero.317.resist', defenseAwaken: 'status.hero.317.awaken-defense' } as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const flowerRatios = [.9, .95, 1, 1.05, 1.05] as const;
const ultimateRatios = [2.16, 2.27, 2.38, 2.48, 2.48, 2.48] as const;

export function registerHumanFacedTree(registry: ContentRegistry): void {
  const statuses: StatusDefinition[] = [
    { id: humanFacedTreeIds.flower, mechanicsCoverage: 'partial', category: 'debuff', dispellable: true, sealable: true,
      durationOwner: 'target-turn', refreshPolicy: 'add-stack', stackScope: 'source-unit', maxStacks: 3 },
    { id: humanFacedTreeIds.resist, mechanicsCoverage: 'partial', category: 'buff', dispellable: true, sealable: false,
      durationOwner: 'target-turn', refreshPolicy: 'replace' },
    { id: humanFacedTreeIds.defenseAwaken, mechanicsCoverage: 'partial', category: 'buff', dispellable: true, sealable: false,
      durationOwner: 'target-turn', refreshPolicy: 'replace' },
  ];
  statuses.forEach(status => registry.registerStatus(status));

  const basic: SkillDefinition = { id: humanFacedTreeIds.basic, actionKind: 'basic', target: 'single', targetRelation: 'enemy',
    levels: basicRatios.map(ratio => ({ ratio })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId), target = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || actor.heroId !== humanFacedTreeIds.hero || actor.hp <= 0 || !target || target.hp <= 0 || target.side === actor.side) return [];
      return damage(context, actor, target, humanFacedTreeIds.basic, Number(parameters.ratio ?? basicRatios[rank(actor, basic.id) - 1]!));
    } };
  const ultimate: SkillDefinition = { id: humanFacedTreeIds.ultimate, actionKind: 'skill', target: 'all-enemies', targetRelation: 'enemy',
    resourceCostsByLevel: [{ resourceId: 'fire', amount: 3 }, { resourceId: 'fire', amount: 3 }, { resourceId: 'fire', amount: 3 },
      { resourceId: 'fire', amount: 3 }, { resourceId: 'fire', amount: 3 }, { resourceId: 'fire', amount: 2 }],
    levels: ultimateRatios.map((ratio, index) => ({ ratio, resist: .2, duration: 3, defenseBonus: index >= 4 ? .06 : 0 })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      if (!actor || actor.heroId !== humanFacedTreeIds.hero || actor.hp <= 0) return [];
      const level = rank(actor, ultimate.id), src = source(ultimate.id, actor.unitId), commands: EffectCommand[] = [];
      const resist = Number(parameters.resist ?? .2), duration = Number(parameters.duration ?? 3);
      const defenseBonus = Number(parameters.defenseBonus ?? (level >= 5 ? .06 : 0));
      commands.push({ type: 'add-status', source: src, targetId: actor.unitId, instance: { instanceId: `${humanFacedTreeIds.resist}:${actor.unitId}`,
        statusId: humanFacedTreeIds.resist, source: src, stacks: 1, duration: { kind: 'count', remaining: duration, owner: 'target-turn' },
        modifiers: [{ stat: 'resist', operation: 'flat', amount: resist }, ...(defenseBonus > 0 ? [{ stat: 'defense' as const, operation: 'percent' as const, amount: defenseBonus }] : [])],
        values: { resist, defenseBonus } } });
      const targets = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      const ratio = Number(parameters.ratio ?? ultimateRatios[level - 1]!);
      for (const target of targets) {
        const mark = target.statuses.find(status => status.statusId === humanFacedTreeIds.flower && status.source.unitId === actor.unitId);
        if (!mark || mark.stacks <= 0) continue;
        commands.push({ type: 'remove-status-instances', source: src, targetId: target.unitId,
          instanceIds: [mark.instanceId], reason: 'consumed' });
        commands.push({ type: 'lose-life', source: src, targetId: target.unitId,
          amount: (context.getEffectiveStats(actor.unitId)?.defense ?? actor.stats.defense) * ratio * mark.stacks,
          lifeLossKind: 'indirect' });
      }
      return commands;
    } };

  const definition: HeroDefinition = { id: humanFacedTreeIds.hero, skills: [basic, ultimate], mechanicsCoverage: 'partial', aiCoverage: 'partial',
    mechanicsCoverageNotes: ['已按客户端表接入神木防御属性普攻（100%至125%），灾厄花每层上限3；敌方回合结束时叠层，满3层后再次触发按层造成防御90%间接伤害；自身回合结束消耗所有层并按防御差提高伤害（每1%差额增1%、最多+100%，四级起倍率105%）；五级起灾厄花被驱散时获2回合5%防御；祸根耗3火（六级2火）、加20%效果抵抗持续3回合并消耗全体敌方灾厄花，伤害按等级216%至248%防御/层，五级起附加6%初始防御。灾厄花抵抗、持续计数与实战御魂/帧顺序仍需核对。'],
    handlers: {
      'turn-end': { priority: 36, handle(context, event) { return onTurnEnd(context, event); } },
      'effect-resolution': { priority: 36, handle(context, event) { return onFlowerRemoved(context, event); } },
    },
    policy(context, unitId) {
      const actor = context.getUnit(unitId); if (!actor || actor.hp <= 0 || actor.unitKind === 'summon') return;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return;
      const fireCost = rank(actor, ultimate.id) >= 6 ? 2 : 3;
      if ((context.state.resources[actor.side]?.fire ?? 0) >= fireCost
        && enemies.some(enemy => enemy.statuses.some(status => status.statusId === humanFacedTreeIds.flower && status.source.unitId === actor.unitId)))
        return { actorId: unitId, skillId: ultimate.id, targetIds: enemies.map(enemy => enemy.unitId), shape: 'all-enemies', targetRelation: 'enemy' };
      const target = enemies.slice().sort((a, b) => a.hp / Math.max(1, a.stats.hp) - b.hp / Math.max(1, b.stats.hp))[0]!;
      return { actorId: unitId, skillId: basic.id, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
    },
  };
  registry.registerHero(definition);
}

function onTurnEnd(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-ended') return;
  const owner = context.getUnit(event.unitId);
  if (!owner || owner.hp <= 0) return;
  const trees = Object.values(context.state.units).filter(unit => unit.hp > 0 && unit.heroId === humanFacedTreeIds.hero && passivesEnabled(unit));
  const commands: EffectCommand[] = [];
  for (const tree of trees) {
    if (owner.side !== tree.side) {
      const mark = owner.statuses.find(status => status.statusId === humanFacedTreeIds.flower && status.source.unitId === tree.unitId);
      if ((mark?.stacks ?? 0) < 3) {
        commands.push(...attemptDebuff(context, { source: source(humanFacedTreeIds.basic, tree.unitId), targetId: owner.unitId,
          statusId: humanFacedTreeIds.flower, baseChance: 1, stacks: 1,
          duration: { kind: 'count', remaining: 99, owner: 'target-turn' } }));
      } else {
        commands.push(indirectDefenseHit(context, tree, owner, flowerRatios[rank(tree, humanFacedTreeIds.passive) - 1]!, mark!.stacks,
          humanFacedTreeIds.basic, false));
      }
    } else if (tree.unitId === owner.unitId) {
      const ratio = flowerRatios[rank(tree, humanFacedTreeIds.passive) - 1]!;
      for (const enemy of context.getLivingUnits(tree.side === 'blue' ? 'red' : 'blue')) {
        const mark = enemy.statuses.find(status => status.statusId === humanFacedTreeIds.flower && status.source.unitId === tree.unitId);
        if (!mark || mark.stacks <= 0) continue;
        const useDefenseGap = Number(tree.awakeFilter ?? 0) > 0;
        const hit = indirectDefenseHit(context, tree, enemy, ratio, mark.stacks, humanFacedTreeIds.passive, useDefenseGap);
        commands.push({ type: 'remove-status-instances', source: source(humanFacedTreeIds.passive, tree.unitId), targetId: enemy.unitId,
          instanceIds: [mark.instanceId], reason: 'consumed' }, hit);
      }
    }
  }
  return commands;
}

function onFlowerRemoved(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'status-removed' || event.statusId !== humanFacedTreeIds.flower || event.reason !== 'dispelled') return;
  const owner = event.removedSource?.unitId ? context.getUnit(event.removedSource.unitId) : undefined;
  if (!owner || owner.heroId !== humanFacedTreeIds.hero || rank(owner, humanFacedTreeIds.passive) < 5 || !passivesEnabled(owner)) return;
  const src = source(humanFacedTreeIds.passive, owner.unitId);
  return [{ type: 'add-status', source: src, targetId: owner.unitId, instance: { instanceId: `${humanFacedTreeIds.defenseAwaken}:${owner.unitId}`,
    statusId: humanFacedTreeIds.defenseAwaken, source: src, stacks: 1,
    duration: { kind: 'count', remaining: 2, owner: 'target-turn' }, modifiers: [{ stat: 'defense', operation: 'percent', amount: .05 }] } }];
}

function indirectDefenseHit(context: BattleContext, actor: Readonly<UnitState>, target: Readonly<UnitState>, ratio: number,
  stacks: number, skillId: string, useDefenseGap: boolean): EffectCommand {
  const offense = context.getEffectiveStats(actor.unitId) ?? actor.stats;
  const defense = context.getEffectiveStats(target.unitId) ?? target.stats;
  const gapBonus = useDefenseGap && offense.defense > defense.defense
    ? Math.min(1, (offense.defense / Math.max(1, defense.defense)) - 1) : 0;
  return { type: 'lose-life', source: source(skillId, actor.unitId), targetId: target.unitId,
    amount: offense.defense * ratio * stacks * (1 + gapBonus), lifeLossKind: 'indirect' };
}

function damage(context: BattleContext, actor: Readonly<UnitState>, target: Readonly<UnitState>, skillId: string, ratio: number): EffectCommand[] {
  const offense = context.getEffectiveStats(actor.unitId) ?? actor.stats, defense = context.getEffectiveStats(target.unitId) ?? target.stats;
  const result = context.calculateDamage({ attack: offense.defense, defense: defense.defense, ratio,
    dmgFluctuation: .01, critChance: offense.crit, critDamage: offense.critDamage }, actor as UnitState, target as UnitState);
  return [{ type: 'deal-damage', source: source(skillId, actor.unitId), targetId: target.unitId, amount: result.amount,
    ...(result.damageOptions ? { damageOptions: result.damageOptions } : {}), isCritical: result.isCritical }];
}
function rank(unit: Readonly<UnitState>, skillId: string): number { return Math.max(1, Math.min(6, unit.skillLevels?.[skillId] ?? unit.skillLevel)); }
function source(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
