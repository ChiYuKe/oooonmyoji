import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, UnitState } from '../core/types';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import type { ContentRegistry } from './registry';

export const daybreakUbumeIds = { hero: 354, basic: '3541', passive: '3542', special: '3543',
  basicCounter: 'status.hero.354.basic-counter', featherGift: 'status.hero.354.feather-gift' } as const;
const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const aoeRatios = [1, 1.1, 1.2, 1.3, 1.3] as const;
const focusRatios = [.62, .66, .7, .74, .74] as const;

export function registerDaybreakUbume(registry: ContentRegistry): void {
  registry.registerStatus({ id: daybreakUbumeIds.basicCounter, mechanicsCoverage: 'partial', category: 'other', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace' });
  registry.registerStatus({ id: daybreakUbumeIds.featherGift, mechanicsCoverage: 'partial', category: 'buff', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'add-stack', maxStacks: 99 });
  const basic: SkillDefinition = { id: daybreakUbumeIds.basic, actionKind: 'basic', target: 'single', targetRelation: 'enemy',
    levels: basicRatios.map(ratio => ({ ratio })),
    execute(context, intent, parameters) {
      const owner = context.getUnit(intent.actorId), picked = context.getUnit(intent.targetIds[0] ?? '');
      if (!owner || owner.hp <= 0 || !picked || picked.hp <= 0 || picked.side === owner.side) return [];
      const counter = owner.statuses.find(status => status.statusId === daybreakUbumeIds.basicCounter);
      const count = Number(counter?.values?.count ?? 2);
      const source = daybreakSource(daybreakUbumeIds.basic, owner.unitId);
      const counterSource = daybreakSource(daybreakUbumeIds.passive, owner.unitId);
      if (count < 3) return [...damage(context, owner, picked, Number(parameters.ratio ?? 1), 1, source),
        counterCommand(owner, counterSource, count + 1)];
      const enemies = context.getLivingUnits(picked.side).filter(unit => unit.hp > 0 && unit.unitId !== picked.unitId);
      const aoeRatio = rank(owner, daybreakUbumeIds.basic) >= 5 ? 1 : .7;
      const focusedRatio = focusRatios[rank(owner, daybreakUbumeIds.special) - 1]!;
      const commands = enemies.flatMap(enemy => damage(context, owner, enemy, aoeRatio, 1, daybreakSource(daybreakUbumeIds.special, owner.unitId)));
      // The selected target is still alive at command generation time; an in-flight kill transfer needs frame-level queue support.
      commands.push(...damage(context, owner, picked, focusedRatio, 3, daybreakSource(daybreakUbumeIds.special, owner.unitId)));
      commands.push(counterCommand(owner, counterSource, 0));
      return commands;
    } };
  const definition: HeroDefinition = { id: daybreakUbumeIds.hero, skills: [basic], aiCoverage: 'partial', mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['已接入墨风普攻等级倍率、战斗开始按已普攻2次处理、每3次普攻后的墨影剑光（未满级削弱30%）、全体攻击和所选目标追加三段攻击；回合开始获得2层羽授。墨影击败目标后剑气改打当前生命最高目标的击杀转火、羽授其他用途及多段中途目标死亡后的队列仍待帧核。'],
    initialize(context, unitId) {
      const owner = context.getUnit(unitId); if (!owner || owner.heroId !== daybreakUbumeIds.hero || owner.hp <= 0) return [];
      const source = daybreakSource(daybreakUbumeIds.passive, unitId);
      return [counterCommand(owner, source, 2)];
    },
    handlers: { 'turn-start': { priority: 40, handle(context, event) {
      if (event.type !== 'turn-started') return;
      const owner = context.getUnit(event.unitId); if (!owner || owner.heroId !== daybreakUbumeIds.hero || owner.hp <= 0) return;
      const source = daybreakSource(daybreakUbumeIds.passive, owner.unitId);
      return [{ type: 'add-status', source, targetId: owner.unitId, instance: { instanceId: `${daybreakUbumeIds.featherGift}:${owner.unitId}`,
        statusId: daybreakUbumeIds.featherGift, source, stacks: (owner.statuses.find(status => status.statusId === daybreakUbumeIds.featherGift)?.stacks ?? 0) + 2,
        duration: { kind: 'permanent' } } }];
    } } },
  };
  registry.registerHero(definition);
}

function counterCommand(owner: Readonly<UnitState>, source: SourceRef, count: number): EffectCommand {
  const previous = owner.statuses.find(status => status.statusId === daybreakUbumeIds.basicCounter);
  return { type: 'add-status', source, targetId: owner.unitId, instance: { instanceId: `${daybreakUbumeIds.basicCounter}:${owner.unitId}`,
    statusId: daybreakUbumeIds.basicCounter, source, stacks: 1, duration: { kind: 'permanent' }, values: { count },
    ...(previous?.appliedByEventId ? { appliedByEventId: previous.appliedByEventId } : {}) } };
}
function damage(context: BattleContext, owner: Readonly<UnitState>, target: Readonly<UnitState>, ratio: number, hits: number,
  source: SourceRef): EffectCommand[] {
  const offense = context.getEffectiveStats(owner.unitId) ?? owner.stats;
  const defense = context.getEffectiveStats(target.unitId) ?? target.stats;
  return Array.from({ length: hits }, () => {
    const result = context.calculateDamage({ attack: offense.attack, defense: defense.defense, ratio,
      defenseIgnore: effectiveDefenseIgnore(owner), critChance: offense.crit, critDamage: offense.critDamage }, owner as UnitState, target as UnitState);
    return { type: 'deal-damage' as const, source, targetId: target.unitId, amount: result.amount, isCritical: result.isCritical,
      ...(result.damageOptions ? { damageOptions: result.damageOptions } : {}) };
  });
}
function rank(owner: Readonly<UnitState>, skillId: string): number { return Math.max(1, Math.min(5, owner.skillLevels?.[skillId] ?? owner.skillLevel)); }
function daybreakSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
