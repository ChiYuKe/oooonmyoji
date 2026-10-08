import type { HeroDefinition, SkillDefinition, StatusDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { attemptDebuff } from '../mechanics/control';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import type { ContentRegistry } from './registry';

export const shuwengIds = { hero: 291, basic: '2911', cloud: '2912', book: '2913',
  cap: 'status.hero.291.damage-cap', record: 'status.hero.291.damage-record' } as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const markRatios = [.5, .75, 1, 1, 1] as const;
const statusCapRatios = [.15, .12, .09, .31, .3] as const;

export function registerShuweng(registry: ContentRegistry): void {
  registry.registerStatus({ id: shuwengIds.cap, mechanicsCoverage: 'partial', category: 'buff', dispellable: true,
    sealable: false, durationOwner: 'target-turn', refreshPolicy: 'replace' } satisfies StatusDefinition);
  registry.registerStatus({ id: shuwengIds.record, mechanicsCoverage: 'partial', category: 'debuff', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace' });

  const basic: SkillDefinition = { id: shuwengIds.basic, actionKind: 'basic', target: 'single', targetRelation: 'enemy',
    useClientDamageData: true, levels: basicRatios.map(ratio => ({ ratio })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId), target = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || actor.heroId !== shuwengIds.hero || actor.hp <= 0 || !target || target.hp <= 0 || target.side === actor.side) return [];
      return attack(context, actor, target, Number(parameters.ratio ?? basicRatios[rank(actor, basic.id) - 1]), basic.id);
    } };

  const cloud: SkillDefinition = { id: shuwengIds.cloud, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 2 },
    target: 'single', targetRelation: 'ally', levels: [8, 8, 8, 8, 8].map(heal => ({ heal })),
    execute(context, intent, parameters) {
      const owner = context.getUnit(intent.actorId);
      const primary = context.getUnit(intent.targetIds[0] ?? '');
      if (!owner || owner.heroId !== shuwengIds.hero || owner.hp <= 0 || !primary || primary.hp <= 0 || primary.side !== owner.side) return [];
      const isFreeRankOne = intent.kind === 'passive';
      const targets = [primary];
      if (!isFreeRankOne && rank(owner, cloud.id) >= 5) {
        const other = context.getLivingUnits(owner.side).filter(unit => unit.unitId !== primary.unitId && unit.unitKind !== 'summon')
          .sort((a, b) => a.hp / Math.max(1, a.stats.hp) - b.hp / Math.max(1, b.stats.hp))[0];
        if (other) targets.push(other);
      }
      const ref = shuwengSource(cloud.id, owner.unitId);
      const commands: EffectCommand[] = [];
      for (const target of targets) {
        commands.push({ type: 'heal', source: ref, targetId: target.unitId,
          amount: target.stats.hp * Number(parameters.heal ?? .08) });
        commands.push({ type: 'dispel-statuses', source: ref, targetId: target.unitId, filter: 'debuff-or-control', maxCount: 1 });
        commands.push({ type: 'add-status', source: ref, targetId: target.unitId, instance: {
          instanceId: `${shuwengIds.cap}:${owner.unitId}:${target.unitId}`, statusId: shuwengIds.cap,
          source: ref, stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' },
          values: { damageCapRatio: statusCapRatios[isFreeRankOne ? 0 : rank(owner, cloud.id) - 1]! },
        } });
      }
      if (!isFreeRankOne && rank(owner, cloud.id) >= 3) {
        const enemy = lowestRatio(context.getLivingUnits(owner.side === 'blue' ? 'red' : 'blue'));
        if (enemy) commands.push({ type: 'schedule-action', source: shuwengSource(shuwengIds.cloud, owner.unitId),
          scheduling: 'extra-action', freeCast: true,
          intent: { actorId: owner.unitId, skillId: shuwengIds.book, targetIds: [enemy.unitId], shape: 'single',
            targetRelation: 'enemy', kind: 'passive' } });
      }
      return commands;
    } };

  const book: SkillDefinition = { id: shuwengIds.book, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 2 },
    target: 'single', targetRelation: 'enemy', levels: [0.8, 0.8, 0.8, 0.8, 0.8].map(ratio => ({ ratio })),
    execute(context, intent, parameters) {
      const owner = context.getUnit(intent.actorId), primary = context.getUnit(intent.targetIds[0] ?? '');
      if (!owner || owner.heroId !== shuwengIds.hero || owner.hp <= 0 || !primary || primary.hp <= 0 || primary.side === owner.side) return [];
      const isFreeRankOne = intent.kind === 'passive';
      const targets = [primary];
      if (!isFreeRankOne && rank(owner, book.id) >= 5) {
        const other = context.getLivingUnits(primary.side).filter(unit => unit.unitId !== primary.unitId)
          .sort((a, b) => a.hp / Math.max(1, a.stats.hp) - b.hp / Math.max(1, b.stats.hp))[0];
        if (other) targets.push(other);
      }
      const ref = shuwengSource(book.id, owner.unitId);
      const commands: EffectCommand[] = [];
      for (const target of targets) {
        commands.push(...attemptDebuff(context, { source: ref, targetId: target.unitId, statusId: shuwengIds.record,
          baseChance: .99, duration: { kind: 'count', remaining: 1, owner: 'target-turn' },
          values: { recordedDamage: 0, bookRatio: isFreeRankOne ? markRatios[0] : markRatios[rank(owner, book.id) - 1]!,
            capHealth: (context.getEffectiveStats(owner.unitId) ?? owner.stats).hp * 12 } }));
        commands.push(...attack(context, owner, target, Number(parameters.ratio ?? .8), book.id));
      }
      if (!isFreeRankOne && rank(owner, book.id) >= 3) {
        const ally = lowestRatio(context.getLivingUnits(owner.side).filter(unit => unit.unitKind !== 'summon'));
        if (ally) commands.push({ type: 'schedule-action', source: shuwengSource(shuwengIds.book, owner.unitId),
          scheduling: 'extra-action', freeCast: true,
          intent: { actorId: owner.unitId, skillId: shuwengIds.cloud, targetIds: [ally.unitId], shape: 'single',
            targetRelation: 'ally', kind: 'passive' } });
      }
      return commands;
    } };

  const definition: HeroDefinition = { id: shuwengIds.hero, skills: [basic, cloud, book], aiCoverage: 'partial', mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['已接入墨染等级倍率；云游2火、治疗8%生命上限、驱散1个可驱散减益/控制并施加1回合单次伤害上限状态，五级治疗主目标与生命比例最低的另一友方；三级起云游后免费对最低生命比例敌人施放一级万象之书。万象之书2火、80%攻击、施加一回合伤害记录减益并记录实际生命损失，目标回合后按记录比例造成间接伤害，伤害上限为书翁生命上限12倍；五级标记主目标和最低生命比例的另一敌人，三级起随后免费对最低生命比例友方施放一级云游。客户端buff表对记录比例、伤害上限与单次伤害保护比例提供了互相不完全一致的等级行，当前采用状态主行并对比率差异保留部分覆盖；先机自护盾提示、减益基础命中、记录初始万象伤害是否计入、死亡/驱散/复活清算及连续施法顺序仍待帧核。'],
    interceptIncomingDamage(_state, _attacker, target, amount) {
      const cap = target.statuses.find(status => status.statusId === shuwengIds.cap);
      if (!cap || amount <= 0) return;
      const ratio = Number(cap.values?.damageCapRatio ?? .15);
      const maxDamage = Math.max(0, target.stats.hp * ratio);
      if (amount <= maxDamage) return;
      return { amount: maxDamage, effects: [] };
    },
    policy(context, unitId): ActionIntent | undefined {
      const owner = context.getUnit(unitId);
      if (!owner || owner.hp <= 0 || owner.unitKind === 'summon') return undefined;
      const allies = context.getLivingUnits(owner.side).filter(unit => unit.unitKind !== 'summon');
      const enemies = context.getLivingUnits(owner.side === 'blue' ? 'red' : 'blue');
      if (!allies.length || !enemies.length) return undefined;
      const healTarget = lowestRatio(allies);
      if (healTarget && healTarget.hp / Math.max(1, healTarget.stats.hp) < .75
        && (context.state.resources[owner.side]?.fire ?? 0) >= 2)
        return { actorId: owner.unitId, skillId: shuwengIds.cloud, targetIds: [healTarget.unitId], shape: 'single', targetRelation: 'ally' };
      if ((context.state.resources[owner.side]?.fire ?? 0) >= 2)
        return { actorId: owner.unitId, skillId: shuwengIds.book, targetIds: [lowestRatio(enemies)!.unitId], shape: 'single', targetRelation: 'enemy' };
      return { actorId: owner.unitId, skillId: shuwengIds.basic, targetIds: [lowestRatio(enemies)!.unitId], shape: 'single', targetRelation: 'enemy' };
    },
    handlers: {
      hit: { priority: 65, handle(context, event) { return recordTakenDamage(context, event); } },
      'status-expiration': { priority: 66, handle(context, event) { return settleBookRecord(context, event); } },
      'unit-defeated': { priority: 66, handle(context, event) { return removeBookRecord(context, event); } },
    },
  };
  registry.registerHero(definition);
}

function recordTakenDamage(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage' || event.hpLost <= 0) return;
  const target = context.getUnit(event.targetId);
  const marks = target?.statuses.filter(status => status.statusId === shuwengIds.record) ?? [];
  if (!target || !marks.length) return;
  return marks.map(mark => ({ type: 'add-status' as const, source: mark.source, targetId: target.unitId,
    parentEventId: event.eventId, instance: { ...mark, values: { ...mark.values,
      recordedDamage: Math.max(0, Number(mark.values?.recordedDamage ?? 0)) + event.hpLost } } }));
}

function settleBookRecord(_context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'status-removed' || event.statusId !== shuwengIds.record || event.reason !== 'expired') return;
  const targetId = event.targetId;
  const target = _context.getUnit(targetId);
  const ownerId = event.removedSource?.unitId;
  const owner = ownerId ? _context.getUnit(ownerId) : undefined;
  if (!target || target.hp <= 0 || !owner) return;
  const values = event.removedValues;
  const recordedDamage = Math.max(0, Number(values?.recordedDamage ?? 0));
  const ratio = Math.max(0, Number(values?.bookRatio ?? .5));
  const capHealth = Math.max(0, Number(values?.capHealth ?? owner.stats.hp * 12));
  const amount = Math.min(recordedDamage * ratio, capHealth);
  if (amount <= 0) return;
  return [{ type: 'lose-life', source: shuwengSource(shuwengIds.book, owner.unitId), targetId,
    amount, lifeLossKind: 'indirect', parentEventId: event.eventId }];
}

function removeBookRecord(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'unit-defeated') return;
  const target = context.getUnit(event.unitId);
  if (!target) return;
  const marks = target.statuses.filter(status => status.statusId === shuwengIds.record);
  if (!marks.length) return;
  return [{ type: 'remove-status-instances', source: marks[0]!.source, targetId: target.unitId,
    instanceIds: marks.map(status => status.instanceId), reason: 'consumed', parentEventId: event.eventId }];
}

function attack(context: BattleContext, owner: Readonly<UnitState>, target: Readonly<UnitState>, ratio: number, skillId: string): EffectCommand[] {
  const offense = context.getEffectiveStats(owner.unitId) ?? owner.stats;
  const defense = context.getEffectiveStats(target.unitId) ?? target.stats;
  const hit = context.calculateDamage({ attack: offense.attack, defense: defense.defense, ratio,
    defenseIgnore: effectiveDefenseIgnore(owner), dmgFluctuation: .01, critChance: offense.crit, critDamage: offense.critDamage },
  owner as UnitState, target as UnitState);
  return [{ type: 'deal-damage', source: shuwengSource(skillId, owner.unitId), targetId: target.unitId,
    amount: hit.amount, ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}), isCritical: hit.isCritical }];
}
function lowestRatio(units: readonly UnitState[]): UnitState | undefined {
  return units.slice().sort((a, b) => a.hp / Math.max(1, a.stats.hp) - b.hp / Math.max(1, b.stats.hp))[0];
}
function rank(unit: Readonly<UnitState>, skillId: string): number { return Math.max(1, Math.min(5, unit.skillLevels?.[skillId] ?? unit.skillLevel)); }
function shuwengSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
