import type { DamageInterception, HeroDefinition, SkillDefinition, StatusDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, StatusInstance, UnitState } from '../core/types';
import { passivesEnabled, passiveSuppressionStatusId } from '../core/passive-eligibility';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import { createBasicAttackSkill } from './common-skills';
import type { ContentRegistry } from './registry';

export const xunIds = {
  hero: 298,
  basic: '2981',
  passive: '2982',
  protect: '2983',
  guard: 'status.hero.298.guard',
  mode: 'status.hero.298.mode',
  alert: 'status.hero.298.alert',
  calmDamage: 'status.hero.298.calm-damage',
  speed: 'status.hero.298.speed',
  freeCast: 'status.hero.298.free-cast-used',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.15] as const;
const protectCosts = [2, 2, 1, 1, 1] as const;
const alertSpeed = [10, 10, 10, 15, 15] as const;
const alertResist = [.4, .5, .6, .6, .6] as const;

export function registerXun(registry: ContentRegistry): void {
  registry.registerStatus({ id: xunIds.guard, mechanicsCoverage: 'partial', category: 'shield', dispellable: true,
    sealable: false, durationOwner: 'target-turn', refreshPolicy: 'replace', handlers: {
      'status-expiration': { priority: 38, handle(context, event) { return settleGuard(context, event); } },
    } } satisfies StatusDefinition);
  registry.registerStatus({ id: xunIds.mode, mechanicsCoverage: 'partial', dispellable: false, sealable: false,
    durationOwner: 'permanent', refreshPolicy: 'replace', category: 'other' });
  registry.registerStatus({ id: xunIds.alert, mechanicsCoverage: 'partial', dispellable: false, sealable: false,
    durationOwner: 'permanent', refreshPolicy: 'replace', category: 'buff' });
  registry.registerStatus({ id: xunIds.calmDamage, mechanicsCoverage: 'partial', dispellable: false, sealable: false,
    durationOwner: 'permanent', refreshPolicy: 'replace', category: 'buff' });
  registry.registerStatus({ id: xunIds.speed, mechanicsCoverage: 'partial', dispellable: true, sealable: true,
    durationOwner: 'target-turn', refreshPolicy: 'refresh-duration', category: 'buff' });
  registry.registerStatus({ id: xunIds.freeCast, mechanicsCoverage: 'partial', dispellable: false, sealable: false,
    durationOwner: 'permanent', refreshPolicy: 'keep', category: 'other' });

  const basic = createBasicAttackSkill(xunIds.basic, basicRatios);
  const protect: SkillDefinition = {
    id: xunIds.protect, actionKind: 'skill', resourceCostsByLevel: protectCosts.map(amount => ({ resourceId: 'fire', amount })),
    resolveResourceCost(_state, actor) { return { resourceId: 'fire', amount: protectCosts[skillRank(actor, xunIds.protect) - 1]! }; },
    target: 'single', targetRelation: 'ally', useClientDamageData: false,
    levels: Array.from({ length: 5 }, (_, index) => ({ lifeCostRatio: index >= 2 ? .3 : .25,
      guardRestoreRatio: .8, guardCapRatio: 2, fireGain: 4, dispelCount: 1, speed: 50,
      speedDuration: 2, chooseLowest: index >= 4 })),
    execute(context, intent, parameters) {
      const owner = context.getUnit(intent.actorId);
      if (!owner || owner.heroId !== xunIds.hero || owner.hp <= 0) return [];
      const allies = context.getLivingUnits(owner.side).filter(unit => unit.unitKind !== 'summon');
      const target = Number(parameters.chooseLowest) ? lowestRatio(allies) : allies.find(unit => unit.unitId === intent.targetIds[0]);
      if (!target) return [];
      const source = xunSource(xunIds.protect, owner.unitId);
      const commands: EffectCommand[] = [{ type: 'lose-life', source, targetId: owner.unitId,
        amount: owner.hp * Number(parameters.lifeCostRatio ?? .3), lifeLossKind: 'direct' },
      { type: 'add-status', source, targetId: target.unitId, instance: guardStatus(owner, target, parameters) }];
      for (const ally of allies) commands.push({ type: 'dispel-statuses', source, targetId: ally.unitId,
        filter: 'debuff-or-control', maxCount: 1 });
      const mode = owner.statuses.find(status => status.statusId === xunIds.mode)?.values?.mode;
      if (mode === 'alert') {
        for (const ally of allies) {
          if (!hasRetainedControlAfterOneDispel(ally, context)) continue;
          commands.push({ type: 'add-status', source, targetId: ally.unitId,
            instance: timedBuff(xunIds.speed, owner, ally, { speed: Number(parameters.speed ?? 50) }, Number(parameters.speedDuration ?? 2)) });
        }
      } else commands.push({ type: 'change-resource', source, side: owner.side, resourceId: 'fire',
        amount: Number(parameters.fireGain ?? 4) });
      return commands;
    },
  };

  const definition: HeroDefinition = {
    id: xunIds.hero, skills: [basic, protect], aiCoverage: 'partial', mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['已接入干扰投掷等级倍率，五级攻击目标若有至少4个增益则击退15%行动条；鸮之警惕在回合开始时根据受控友方数量切换常态/警戒态，警戒态提高薰速度与效果抵抗，常态下自身回合结束给全队增伤。温柔的守护随等级消耗2火或1火，牺牲当前生命25%/30%，指定友方获得1回合守护印记，全队各驱散1个减益/控制；常态返4火，警戒态给仍受控友方加50速度2回合；五级改护佑生命比例最低友方。守护印记吸收伤害并记录，移除时返还薰最大生命值2倍上限内记录量的80%。五级被动在薰控制解除时、薰下个回合开始前至多一次，免费对最低生命友方施放守护。专项回归覆盖攻击推条、守护伤害拦截/到期返命、治疗外生命恢复、状态切换、群体驱散、鬼火、警戒加速与被动免费施法。状态切换对“每个回合”的客户端术语解释、守护印记被驱散/目标阵亡时结算、多个薰的守护上限归属以及帧图实战顺序仍需连续录像校准。'],
    initialize(context, unitId) {
      const owner = context.getUnit(unitId);
      if (!owner || owner.heroId !== xunIds.hero || owner.hp <= 0 || owner.unitKind === 'summon') return [];
      return [{ type: 'add-status', source: xunSource(xunIds.passive, owner.unitId), targetId: owner.unitId,
        instance: modeStatus(owner, 'calm') }];
    },
    interceptIncomingDamage(state, _attacker, target, amount, _kind): DamageInterception | undefined {
      if (target.hp <= 0 || amount <= 0) return;
      const guard = target.statuses.find(status => status.statusId === xunIds.guard);
      if (!guard) return;
      const source = guard.source;
      const owner = source.unitId ? state.units[source.unitId] : undefined;
      if (!owner || owner.hp <= 0) return;
      const cap = Math.max(0, Number(guard.values?.capHp ?? (owner?.stats.hp ?? 0) * 2));
      const recorded = Math.max(0, Number(guard.values?.recordedDamage ?? 0));
      const nextRecorded = Math.min(cap, recorded + amount);
      const effects: EffectCommand[] = [{ type: 'add-status', source, targetId: target.unitId,
        instance: { ...guard, values: { ...guard.values, recordedDamage: nextRecorded, capHp: cap } } }];
      if (nextRecorded >= cap) effects.push({ type: 'remove-statuses', source, targetId: target.unitId,
        statusIds: [xunIds.guard], reason: 'consumed' });
      return { amount: 0, effects };
    },
    handlers: {
      hit: { priority: 37, handle(context, event) { return onBasicHit(context, event); } },
      'effect-resolution': { priority: 37, handle(context, event) { return clearSealedPassiveStatuses(context, event); } },
      'turn-start': { priority: 37, handle(context, event) { return updateModeOnTurnStart(context, event); } },
      'turn-end': { priority: 37, handle(context, event) { return addCalmAura(context, event); } },
      'status-expiration': { priority: 37, handle(context, event) { return freeCastOnControlEnd(context, event); } },
    },
    policy(context, unitId): ActionIntent | undefined {
      const owner = context.getUnit(unitId);
      if (!owner || owner.heroId !== xunIds.hero || owner.hp <= 0) return undefined;
      const allies = context.getLivingUnits(owner.side).filter(unit => unit.unitKind !== 'summon');
      const enemies = context.getLivingUnits(owner.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      const fire = context.state.resources[owner.side]?.fire ?? 0;
      if (fire >= protectCosts[skillRank(owner, xunIds.protect) - 1]!
        && (allies.some(ally => hasControl(ally, context)) || allies.some(ally => ally.hp / Math.max(1, ally.stats.hp) < .75))) {
        const target = lowestRatio(allies)!;
        return { actorId: owner.unitId, skillId: xunIds.protect, targetIds: [target.unitId], shape: 'single', targetRelation: 'ally' };
      }
      return { actorId: owner.unitId, skillId: xunIds.basic, targetIds: [lowestRatio(enemies)!.unitId], shape: 'single', targetRelation: 'enemy' };
    },
  };
  registry.registerHero(definition);
}

function onBasicHit(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage' || event.source.id !== xunIds.basic || !event.source.unitId) return;
  const owner = context.getUnit(event.source.unitId), target = context.getUnit(event.targetId);
  if (!owner || owner.heroId !== xunIds.hero || !target || target.hp <= 0 || skillRank(owner, xunIds.basic) < 5) return;
  const buffs = target.statuses.filter(status => ['buff', 'shield'].includes(context.getStatusCategory(status.statusId) ?? '')).length;
  if (buffs < 4) return;
  return [{ type: 'change-action-gauge', source: xunSource(xunIds.basic, owner.unitId), targetId: target.unitId,
    amount: -15, parentEventId: event.eventId, checkImmunity: true }];
}

function updateModeOnTurnStart(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-started') return;
  const commands: EffectCommand[] = [];
  const owners = [...context.getLivingUnits('blue'), ...context.getLivingUnits('red')]
    .filter(unit => unit.heroId === xunIds.hero && unit.unitKind !== 'summon' && passivesEnabled(unit));
  for (const owner of owners) {
    const allies = context.getLivingUnits(owner.side).filter(unit => unit.unitKind !== 'summon');
    const controlled = allies.filter(ally => hasControl(ally, context)).length;
    const mode: 'calm' | 'alert' = controlled >= 2 ? 'alert' : 'calm';
    const previous = owner.statuses.find(status => status.statusId === xunIds.mode)?.values?.mode;
    if (previous !== mode) {
      commands.push({ type: 'add-status', source: xunSource(xunIds.passive, owner.unitId), targetId: owner.unitId,
        instance: modeStatus(owner, mode) });
      if (mode === 'alert') {
        for (const ally of allies) commands.push({ type: 'remove-statuses', source: xunSource(xunIds.passive, owner.unitId),
          targetId: ally.unitId, statusIds: [xunIds.calmDamage], reason: 'replaced' });
        commands.push({ type: 'add-status', source: xunSource(xunIds.passive, owner.unitId), targetId: owner.unitId,
          instance: alertStatus(owner) });
      } else {
        commands.push({ type: 'remove-statuses', source: xunSource(xunIds.passive, owner.unitId), targetId: owner.unitId,
          statusIds: [xunIds.alert], reason: 'replaced' });
      }
    }
    if (event.unitId === owner.unitId) commands.push({ type: 'remove-statuses', source: xunSource(xunIds.passive, owner.unitId),
      targetId: owner.unitId, statusIds: [xunIds.freeCast], reason: 'consumed' });
  }
  return commands.length ? commands : undefined;
}

function addCalmAura(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-ended') return;
  const owner = context.getUnit(event.unitId);
  if (!owner || owner.heroId !== xunIds.hero || owner.hp <= 0 || !passivesEnabled(owner)
    || owner.statuses.find(status => status.statusId === xunIds.mode)?.values?.mode !== 'calm') return;
  return context.getLivingUnits(owner.side).filter(unit => unit.unitKind !== 'summon').map(ally => ({
    type: 'add-status' as const, source: xunSource(xunIds.passive, owner.unitId), targetId: ally.unitId,
    instance: { instanceId: `${xunIds.calmDamage}:${owner.unitId}:${ally.unitId}`, statusId: xunIds.calmDamage,
      source: xunSource(xunIds.passive, owner.unitId), stacks: 1, duration: { kind: 'permanent' as const },
      modifiers: [{ stat: 'damage' as const, operation: 'percent' as const, amount: .15 }] },
  }));
}

function freeCastOnControlEnd(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'status-removed' || event.statusCategory !== 'control' || event.reason === 'replaced') return;
  const owner = context.getUnit(event.targetId);
  if (!owner || owner.heroId !== xunIds.hero || owner.hp <= 0 || skillRank(owner, xunIds.passive) < 5
    || !passivesEnabled(owner) || owner.statuses.some(status => status.statusId === xunIds.freeCast)) return;
  const target = lowestRatio(context.getLivingUnits(owner.side).filter(unit => unit.unitKind !== 'summon'));
  if (!target) return;
  const source = xunSource(xunIds.passive, owner.unitId);
  return [{ type: 'add-status', source, targetId: owner.unitId, instance: { instanceId: `${xunIds.freeCast}:${owner.unitId}`,
      statusId: xunIds.freeCast, source, stacks: 1, duration: { kind: 'permanent' } } },
    { type: 'schedule-action', source, scheduling: 'extra-action', freeCast: true,
      intent: { actorId: owner.unitId, skillId: xunIds.protect, targetIds: [target.unitId], shape: 'single',
        targetRelation: 'ally', kind: 'passive' } }];
}

function settleGuard(_context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'status-removed' || event.statusId !== xunIds.guard || !event.removedSource?.unitId) return;
  const owner = _context.getUnit(event.removedSource.unitId), target = _context.getUnit(event.targetId);
  if (!owner || !target || target.hp <= 0) return;
  const recorded = Math.max(0, Number(event.removedValues?.recordedDamage ?? 0));
  const restoreRatio = Math.max(0, Number(event.removedValues?.restoreRatio ?? .8));
  const amount = Math.min(recorded * restoreRatio, Math.max(0, Number(event.removedValues?.capHp ?? owner.stats.hp * 2)));
  return amount > 0 ? [{ type: 'restore-health', source: xunSource(xunIds.protect, owner.unitId), targetId: target.unitId,
    amount, parentEventId: event.eventId }] : undefined;
}

function guardStatus(owner: UnitState, target: UnitState, parameters: Readonly<Record<string, number | boolean | string>>): StatusInstance {
  const source = xunSource(xunIds.protect, owner.unitId);
  return { instanceId: `${xunIds.guard}:${owner.unitId}:${target.unitId}`, statusId: xunIds.guard,
    source, stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' },
    values: { recordedDamage: 0, capHp: owner.stats.hp * Number(parameters.guardCapRatio ?? 2),
      restoreRatio: Number(parameters.guardRestoreRatio ?? .8) } };
}

function modeStatus(owner: UnitState, mode: 'calm' | 'alert'): StatusInstance {
  const source = xunSource(xunIds.passive, owner.unitId);
  return { instanceId: `${xunIds.mode}:${owner.unitId}`, statusId: xunIds.mode, source, stacks: 1,
    duration: { kind: 'permanent' }, values: { mode } };
}

function alertStatus(owner: UnitState): StatusInstance {
  const level = skillRank(owner, xunIds.passive);
  const source = xunSource(xunIds.passive, owner.unitId);
  return { instanceId: `${xunIds.alert}:${owner.unitId}`, statusId: xunIds.alert, source, stacks: 1,
    duration: { kind: 'permanent' }, modifiers: [
      { stat: 'speed', operation: 'flat', amount: alertSpeed[level - 1]! },
      { stat: 'resist', operation: 'flat', amount: alertResist[level - 1]! },
    ] };
}

function timedBuff(statusId: string, owner: UnitState, target: UnitState, values: Readonly<Record<string, number>>,
  duration: number): StatusInstance {
  return { instanceId: `${statusId}:${owner.unitId}:${target.unitId}`, statusId,
    source: xunSource(xunIds.protect, owner.unitId), stacks: 1,
    duration: { kind: 'count', remaining: duration, owner: 'target-turn' },
    modifiers: [{ stat: 'speed', operation: 'flat', amount: values.speed ?? 0 }] };
}

function hasControl(unit: UnitState, context: BattleContext): boolean {
  return unit.statuses.some(status => context.getStatusCategory(status.statusId) === 'control' || typeof status.values?.controlType === 'string');
}
function hasRetainedControlAfterOneDispel(unit: UnitState, context: BattleContext): boolean {
  const controls = unit.statuses.filter(status => context.getStatusCategory(status.statusId) === 'control'
    || typeof status.values?.controlType === 'string');
  return controls.length >= 2 || controls.some(status => !context.isStatusDispellable(status.statusId));
}

function clearSealedPassiveStatuses(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'status-added' || (event.instance.statusId !== passiveSuppressionStatusId
    && event.instance.values?.sealPassives !== true)) return;
  const owner = context.getUnit(event.targetId);
  if (!owner || owner.heroId !== xunIds.hero) return;
  const source = xunSource(xunIds.passive, owner.unitId);
  const commands: EffectCommand[] = [{ type: 'remove-statuses', source, targetId: owner.unitId,
    statusIds: [xunIds.mode, xunIds.alert, xunIds.freeCast], reason: 'consumed', parentEventId: event.eventId }];
  for (const ally of context.getLivingUnits(owner.side)) commands.push({ type: 'remove-statuses', source,
    targetId: ally.unitId, statusIds: [xunIds.calmDamage], reason: 'consumed', parentEventId: event.eventId });
  return commands;
}
function skillRank(unit: UnitState, skillId: string): number {
  return Math.max(1, Math.min(5, unit.skillLevels?.[skillId] ?? unit.skillLevel));
}
function lowestRatio(units: readonly UnitState[]): UnitState | undefined {
  return [...units].sort((a, b) => a.hp / Math.max(1, a.stats.hp) - b.hp / Math.max(1, b.stats.hp))[0];
}
function xunSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
