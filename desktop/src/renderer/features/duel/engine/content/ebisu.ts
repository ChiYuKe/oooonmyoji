import type { HeroDefinition, SkillDefinition, StatusDefinition } from '../core/definitions';
import type { BattleContext, BattleEvent, EffectCommand, SourceRef, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { battleSkillRow, skillNumber } from '../../../../../shared/game-skill-data';
import { createBasicAttackSkill } from './common-skills';
import type { ContentRegistry } from './registry';

export const ebisuIds = {
  hero: 268, basic: '2681', passive: '2682', summon: '2683', flagBasic: '2684', flagAction: '2685',
  flag: 'status.hero.268.flag', speedAura: 'status.hero.268.flag-speed', lowHealthSpeedAura: 'status.hero.268.flag-low-health-speed',
} as const;

export function registerEbisu(registry: ContentRegistry): void {
  registry.registerStatus({ id: ebisuIds.flag, mechanicsCoverage: 'partial', category: 'other', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'keep' } satisfies StatusDefinition);
  registry.registerStatus({ id: ebisuIds.speedAura, mechanicsCoverage: 'partial', category: 'buff', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace' });
  registry.registerStatus({ id: ebisuIds.lowHealthSpeedAura, mechanicsCoverage: 'partial', category: 'buff', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace' });
  registry.registerHero(createEbisuDefinition());
}

function createEbisuDefinition(): HeroDefinition {
  const basicBase = createBasicAttackSkill(ebisuIds.basic, [1, 1.05, 1.1, 1.2, 1.25]);
  const basic: SkillDefinition = { ...basicBase, execute(context, intent, parameters) {
    const commands = [...basicBase.execute(context, intent, parameters)];
    const actor = context.getUnit(intent.actorId);
    if (actor && skillRank(actor, ebisuIds.basic) >= 5) {
      const flag = findFlag(context, actor);
      if (flag) commands.push({ type: 'change-action-gauge', source: ebisuSource(ebisuIds.basic, actor.unitId),
        targetId: flag.unitId, amount: 30 });
    }
    return commands;
  } };
  const summon: SkillDefinition = { id: ebisuIds.summon, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 2 },
    target: 'self', targetRelation: 'ally', levels: [{}, {}, {}, {}, {}],
    canUse(state, actor) {
      const currentFlag = actor.statuses.find(status => status.statusId === ebisuIds.flag)?.values?.flagUnitId;
      return actor.unitKind !== 'summon' && !(typeof currentFlag === 'string' && state.units[currentFlag]?.hp > 0);
    },
    execute(context, intent) {
      const owner = context.getUnit(intent.actorId);
      if (!owner || owner.hp <= 0 || owner.unitKind === 'summon' || findFlag(context, owner)) return [];
      const stats = context.getEffectiveStats(owner.unitId) ?? owner.stats;
      const rank = skillRank(owner, ebisuIds.summon);
      const unitId = `summon:ebisu:${owner.unitId}:${context.state.counters.action + 1}`;
      // Direct skill text confirms 40% inheritance at base rank. Later inheritance values are runtime-only.
      const hp = Math.max(1, stats.hp * .4);
      const flag: UnitState = { unitId, heroId: ebisuIds.hero, displayName: '鲤鱼旗', unitKind: 'summon',
        summonedByUnitId: owner.unitId, skillLevel: owner.skillLevel, ...(owner.skillLevels ? { skillLevels: owner.skillLevels } : {}),
        side: owner.side, stats: { ...stats, hp, attack: 0, speed: stats.speed * (rank >= 4 ? 1.4 : 1) }, hp,
        shield: 0, actionGauge: 0, statuses: [], resources: {} };
      const source = ebisuSource(ebisuIds.summon, owner.unitId);
      const commands: EffectCommand[] = [{ type: 'add-status', source, targetId: owner.unitId, instance: { instanceId: `${ebisuIds.flag}:${owner.unitId}`,
        statusId: ebisuIds.flag, source, stacks: 1, duration: { kind: 'permanent' }, values: { flagUnitId: unitId } } }];
      if (rank >= 4) for (const ally of context.getLivingUnits(owner.side).filter(unit => unit.unitKind !== 'summon')) {
        commands.push({ type: 'add-status', source, targetId: ally.unitId, instance: speedAura(ally, owner, false) });
        commands.push({ type: 'add-status', source, targetId: ally.unitId, instance: speedAura(ally, owner, true) });
      }
      commands.push({ type: 'summon-unit', source, unit: flag });
      return commands;
    } };
  const flagAction: SkillDefinition = { id: ebisuIds.flagAction, actionKind: 'skill', target: 'all-allies', targetRelation: 'ally',
    levels: [{}, {}, {}, {}, {}], execute(context, intent) {
      const flag = context.getUnit(intent.actorId);
      if (!flag || flag.unitKind !== 'summon' || flag.heroId !== ebisuIds.hero) return [];
      const owner = flag.summonedByUnitId ? context.getUnit(flag.summonedByUnitId) : undefined;
      if (!owner || owner.hp <= 0) return [];
      const source = ebisuSource(ebisuIds.flagAction, owner.unitId);
      const commands: EffectCommand[] = [];
      const allies = context.getLivingUnits(flag.side).filter(ally => ally.unitKind !== 'summon' && ally.unitKind !== 'onmyoji');
      const candidates = allies.flatMap(ally => ally.statuses.filter(status => {
        const category = context.getStatusCategory(status.statusId);
        return context.isStatusDispellable(status.statusId) && (category === 'debuff' || category === 'control');
      }).map(status => ({ ally, status })));
      // Choose up to two status instances uniformly from the eligible team-wide pool.
      for (let count = 0; count < 2 && candidates.length > 0; count++) {
        const index = Math.min(candidates.length - 1, Math.floor(context.random() * candidates.length));
        const { ally, status } = candidates.splice(index, 1)[0]!;
        commands.push({ type: 'dispel-statuses', source, targetId: ally.unitId, instanceIds: [status.instanceId] });
      }
      if (skillRank(owner, ebisuIds.summon) >= 5) commands.push({ type: 'change-resource', source,
        side: owner.side, resourceId: 'fire', amount: 1 });
      return commands;
    } };
  const flagBasic = createBasicAttackSkill(ebisuIds.flagBasic, [1, 1.05, 1.1, 1.2, 1.25]);

  return { id: ebisuIds.hero, skills: [basic, summon, flagBasic, flagAction], aiCoverage: 'partial', mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['赐福普攻倍率及五级鲤鱼旗推条、转祸为福受击回火（20%/25%/30%）、鲤鱼旗召唤/行动随机驱散/五级行动回火和友方行动前40%旗帜生命治疗已接入。技能四级起全队+20速度、生命比例低于30%时额外+30速度已建模；客户端技能行中的继承生命/速度等级参数引用仍缺具体数值，需录像或运行时参数表核实。'],
    policy(context, unitId) {
      const actor = context.getUnit(unitId);
      if (!actor || actor.hp <= 0) return undefined;
      if (actor.unitKind === 'summon' && actor.heroId === ebisuIds.hero) return { actorId: unitId, skillId: ebisuIds.flagAction,
        targetIds: context.getLivingUnits(actor.side).filter(ally => ally.unitKind !== 'summon').map(ally => ally.unitId),
        shape: 'all-allies', targetRelation: 'ally' };
      if (actor.unitKind === 'summon') return undefined;
      const flag = findFlag(context, actor);
      if (!flag && (context.state.resources[actor.side]?.fire ?? 0) >= 2) return { actorId: unitId, skillId: ebisuIds.summon,
        targetIds: [unitId], shape: 'self', targetRelation: 'ally' };
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      const target = enemies.slice().sort((a, b) => a.hp / Math.max(1, a.stats.hp) - b.hp / Math.max(1, b.stats.hp))[0];
      return target ? { actorId: unitId, skillId: ebisuIds.basic, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' } : undefined;
    },
    handlers: {
      'turn-start': { priority: 75, handle(context, event) { return flagHealBeforeAction(context, event); } },
      hit: { priority: 35, handle(context, event) { return restoreFireWhenHit(context, event); } },
      'unit-defeated': { priority: 75, handle(context, event) {
        if (event.type !== 'unit-defeated') return;
        const flag = context.getUnit(event.unitId);
        if (!flag || flag.heroId !== ebisuIds.hero || flag.unitKind !== 'summon' || !flag.summonedByUnitId) return;
        const owner = context.getUnit(flag.summonedByUnitId);
        if (!owner?.statuses.some(status => status.statusId === ebisuIds.flag && status.values?.flagUnitId === flag.unitId)) return;
        return [{ type: 'remove-statuses', source: ebisuSource(ebisuIds.summon, owner.unitId), targetId: owner.unitId,
          statusIds: [ebisuIds.flag], reason: 'consumed', parentEventId: event.eventId },
        ...context.getLivingUnits(owner.side).filter(unit => unit.unitKind !== 'summon').flatMap(ally => [
          { type: 'remove-statuses' as const, source: ebisuSource(ebisuIds.summon, owner.unitId), targetId: ally.unitId,
            statusIds: [ebisuIds.speedAura, ebisuIds.lowHealthSpeedAura], reason: 'consumed' as const, parentEventId: event.eventId },
        ])];
      } },
    },
  };
}

function speedAura(ally: Readonly<UnitState>, owner: Readonly<UnitState>, lowHealth: boolean): import('../core/types').StatusInstance {
  const statusId = lowHealth ? ebisuIds.lowHealthSpeedAura : ebisuIds.speedAura;
  return { instanceId: `${statusId}:${owner.unitId}:${ally.unitId}`, statusId, source: ebisuSource(ebisuIds.summon, owner.unitId),
    stacks: 1, duration: { kind: 'permanent' }, modifiers: [{ stat: 'speed', operation: 'flat', amount: lowHealth ? 30 : 20,
      ...(lowHealth ? { condition: { healthRatioBelow: .3 } } : {}) }] };
}

function flagHealBeforeAction(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-started') return;
  const ally = context.getUnit(event.unitId);
  if (!ally || ally.hp <= 0 || ally.unitKind === 'summon') return;
  const flags = context.getLivingUnits(ally.side).filter(unit => unit.heroId === ebisuIds.hero && unit.unitKind === 'summon'
    && unit.summonedByUnitId && context.getUnit(unit.summonedByUnitId)?.hp! > 0);
  return flags.flatMap(flag => [{ type: 'heal' as const, source: ebisuSource(ebisuIds.summon, flag.summonedByUnitId!),
    targetId: ally.unitId, amount: flag.stats.hp * .4, parentEventId: event.eventId }]);
}

function restoreFireWhenHit(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage' || event.hpLost <= 0 || event.suppressTargetPassiveTriggers) return;
  const target = context.getUnit(event.targetId);
  if (!target || target.hp <= 0 || target.heroId !== ebisuIds.hero || target.unitKind === 'summon' || !passivesEnabled(target)) return;
  const row = battleSkillRow(ebisuIds.passive, skillRank(target, ebisuIds.passive), target.awakeFilter,
    target.unitKind === 'monster');
  const chance = Math.max(0, Math.min(1, skillNumber(row, 'successRate') ?? .2));
  if (context.random() >= chance) return;
  return [{ type: 'change-resource', source: ebisuSource(ebisuIds.passive, target.unitId), side: target.side,
    resourceId: 'fire', amount: 1, parentEventId: event.eventId }];
}

function findFlag(context: BattleContext, owner: Readonly<UnitState>): UnitState | undefined {
  const marker = owner.statuses.find(status => status.statusId === ebisuIds.flag);
  const id = marker?.values?.flagUnitId;
  const flag = typeof id === 'string' ? context.getUnit(id) : undefined;
  return flag && flag.hp > 0 && flag.unitKind === 'summon' && flag.summonedByUnitId === owner.unitId ? flag : undefined;
}

function skillRank(unit: Readonly<UnitState>, skillId: string): number {
  return Math.max(1, Math.min(5, unit.skillLevels?.[skillId] ?? unit.skillLevel));
}

function ebisuSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
