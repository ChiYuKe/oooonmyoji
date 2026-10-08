import type { HeroDefinition, SkillDefinition, StatusDefinition, DamageInterceptionContext } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, BattleState, EffectCommand, SourceRef, StatusInstance, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import { attemptDebuff } from '../mechanics/control';
import { ContentRegistry } from './registry';

export const haishinIds = { hero: 329, basic: '3291', passive: '3292', ultimate: '3293', weakness: 'status.hero.329.weakness',
  shadow: 'status.hero.329.shadow', protectedAlly: 'status.hero.329.protected-ally', confusion: 'status.hero.329.confusion',
  repeatCounter: 'status.hero.329.repeat-counter', consumedWeakness: 'status.hero.329.consumed-weakness' } as const;

const basicRatios = [.8, .85, .9, .95, 1] as const;
const stealthResist = [.1, .2, .2, .3, .3] as const;
const stealthSpeed = [10, 20, 20, 30, 30] as const;

export function registerHaishin(registry: ContentRegistry): void {
  const statuses: StatusDefinition[] = [
    { id: haishinIds.weakness, mechanicsCoverage: 'partial', category: 'other', dispellable: false, sealable: false,
      durationOwner: 'permanent', refreshPolicy: 'add-stack', maxStacks: 3 },
    { id: haishinIds.shadow, mechanicsCoverage: 'partial', category: 'buff', dispellable: true, sealable: false,
      durationOwner: 'source-turn', refreshPolicy: 'replace' },
    { id: haishinIds.protectedAlly, mechanicsCoverage: 'partial', category: 'buff', dispellable: true, sealable: false,
      durationOwner: 'source-turn', refreshPolicy: 'replace' },
    { id: haishinIds.confusion, mechanicsCoverage: 'partial', category: 'control', dispellable: true, sealable: true,
      durationOwner: 'target-turn', refreshPolicy: 'replace', preventsAction: true },
    { id: haishinIds.repeatCounter, mechanicsCoverage: 'partial', category: 'other', dispellable: false, sealable: false,
      durationOwner: 'permanent', refreshPolicy: 'replace' },
    { id: haishinIds.consumedWeakness, mechanicsCoverage: 'partial', category: 'other', dispellable: false, sealable: false,
      durationOwner: 'permanent', refreshPolicy: 'add-stack' },
  ];
  for (const status of statuses) registry.registerStatus(status);

  const basic: SkillDefinition = { id: haishinIds.basic, actionKind: 'basic', target: 'single', targetRelation: 'enemy',
    levels: basicRatios.map(ratio => ({ ratio })), execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId), target = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || !target || actor.heroId !== haishinIds.hero || actor.hp <= 0 || target.hp <= 0 || target.side === actor.side) return [];
      const weak = target.statuses.find(status => status.statusId === haishinIds.weakness);
      const commands: EffectCommand[] = [];
      if (weak && weak.stacks >= 3) {
        const sourceRef = source(haishinIds.basic, actor.unitId);
        commands.push({ type: 'remove-status-instances', source: sourceRef, targetId: target.unitId,
          instanceIds: [weak.instanceId], reason: 'consumed' });
        commands.push({ type: 'add-status', source: sourceRef, targetId: actor.unitId,
          instance: { instanceId: `${haishinIds.consumedWeakness}:${actor.unitId}:${context.state.counters.action}:${target.unitId}`,
            statusId: haishinIds.consumedWeakness, source: sourceRef, stacks: 1, duration: { kind: 'permanent' },
            values: { actionId: context.state.counters.action, targetUnitId: target.unitId } } });
      for (const enemy of context.getLivingUnits(target.side)) {
          const attack = makeHit(context, actor, enemy, haishinIds.basic, 1.2, .4);
          Object.assign(attack, { suppressTargetPassiveTriggers: true, suppressTargetSoulTriggers: true });
          commands.push(attack);
        }
        const otherTargets = context.getLivingUnits(target.side).filter(enemy => enemy.unitId !== target.unitId);
        if (otherTargets.length && passivesEnabled(actor)) {
          const follow = otherTargets[Math.min(otherTargets.length - 1, Math.floor(context.random() * otherTargets.length))]!;
          commands.push({ type: 'schedule-action', source: sourceRef, scheduling: 'counter', freeCast: true,
            intent: basicIntent(actor.unitId, follow.unitId), parentEventId: `${haishinIds.basic}:${context.state.counters.action}:weakness` });
        }
        return commands;
      }
      const ratio = Number(parameters.ratio ?? basicRatios[rank(actor, basic.id) - 1]!);
      commands.push(makeHit(context, actor, target, basic.id, ratio, .4));
      const weakSource = sharedWeaknessSource();
      commands.push({ type: 'add-status', source: source(basic.id, actor.unitId), targetId: target.unitId,
        instance: { instanceId: `${haishinIds.weakness}:${target.unitId}`, statusId: haishinIds.weakness,
          source: weakSource, stacks: 1, duration: { kind: 'permanent' } } });
      return commands;
    } };

  const ultimate: SkillDefinition = { id: haishinIds.ultimate, actionKind: 'skill', target: 'single', targetRelation: 'ally',
    levels: stealthResist.map((resist, index) => ({ resist, speed: stealthSpeed[index]! })), execute(context, intent) {
      const actor = context.getUnit(intent.actorId), ally = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || actor.heroId !== haishinIds.hero || actor.hp <= 0 || !ally || ally.hp <= 0 || ally.side !== actor.side) return [];
      const sourceRef = source(ultimate.id, actor.unitId), level = rank(actor, ultimate.id);
      return [
        { type: 'add-status', source: sourceRef, targetId: actor.unitId, instance: { instanceId: `${haishinIds.shadow}:${actor.unitId}`,
          statusId: haishinIds.shadow, source: sourceRef, stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'source-turn' },
          values: { extraBasicChance: level >= 5 ? .5 : 0 },
          modifiers: [{ stat: 'resist', operation: 'percent', amount: stealthResist[level - 1]! },
            { stat: 'speed', operation: 'flat', amount: stealthSpeed[level - 1]! }] } },
        { type: 'add-status', source: sourceRef, targetId: ally.unitId, instance: { instanceId: `${haishinIds.protectedAlly}:${actor.unitId}:${ally.unitId}`,
          statusId: haishinIds.protectedAlly, source: sourceRef, stacks: 1,
          duration: { kind: 'count', remaining: 1, owner: 'source-turn' }, values: { ownerUnitId: actor.unitId } } },
      ] as EffectCommand[];
    } };

  const definition: HeroDefinition = { id: haishinIds.hero, skills: [basic, ultimate], mechanicsCoverage: 'partial', aiCoverage: 'partial',
    mechanicsCoverageNotes: ['已按客户端技能行接入影出80%至100%、忽略40%防御、弱点叠至3层并转为120%群攻（该次不触发目标御魂/被动）；消耗弱点后对另一随机敌人免费普攻。影回普攻追加率10%/30%，同目标上限1/2/3次，换目标重置；五级在敌方回合结束30%附弱点。潜影无鬼火消耗，保护友方并给自身持续1回合的抵抗/速度增益；受保护友方首次受攻击时海忍偷袭攻击来源，造成100%攻击伤害、按实际生命损失治疗自身并100%基础概率混乱，三级起推50%行动条；五级潜影给影回额外50%概率至下一次攻击结束。不同来源弱点唯一叠层、追加普攻链的随机次数边界、保护状态被驱散/封印和御魂实战仍需帧核；10点场阵容不含海忍，缺少直接触发帧。'],
    handlers: {
      'attack-end': { priority: 68, handle(context, event) {
        return [...(repeatBasic(context, event) ?? []), ...(consumeShadowBonus(context, event) ?? [])];
      } },
      'action-end': { priority: 68, handle(context, event) { return clearActionMarkers(context, event); } },
      'turn-end': { priority: 68, handle(context, event) { return seedWeaknessOnEnemyTurn(context, event); } },
      hit: { priority: 68, handle(context, event) { return resolveAmbushHealing(context, event); } },
    },
    interceptIncomingDamage(state, attacker, target, amount, _kind, interception) {
      return resolveProtectedAmbush(state, attacker, target, amount, interception);
    },
    policy(context, unitId) {
      const actor = context.getUnit(unitId); if (!actor || actor.heroId !== haishinIds.hero || actor.hp <= 0) return;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue'); if (!enemies.length) return;
      const allies = context.getLivingUnits(actor.side);
      const unguarded = allies.filter(ally => !ally.statuses.some(status => status.statusId === haishinIds.protectedAlly))
        .sort((a, b) => a.hp / Math.max(1, a.stats.hp) - b.hp / Math.max(1, b.stats.hp))[0];
      if (!actor.statuses.some(status => status.statusId === haishinIds.shadow) && unguarded && unguarded.unitId !== actor.unitId
        && actor.hp / Math.max(1, actor.stats.hp) > .25)
        return { actorId: unitId, skillId: ultimate.id, targetIds: [unguarded.unitId], shape: 'single', targetRelation: 'ally' };
      const target = [...enemies].sort((a, b) => a.hp / Math.max(1, a.stats.hp) - b.hp / Math.max(1, b.stats.hp))[0]!;
      return { actorId: unitId, skillId: basic.id, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
    },
  };
  registry.registerHero(definition);
}

function repeatBasic(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'attack-ended' || event.actionKind !== 'basic' || event.source.id !== haishinIds.basic || !event.source.unitId) return;
  const actor = context.getUnit(event.source.unitId), targetId = event.selectedTargetIds?.[0];
  if (!actor || actor.heroId !== haishinIds.hero || actor.hp <= 0 || !targetId || !passivesEnabled(actor)) return;
  const consumed = actor.statuses.find(status => status.statusId === haishinIds.consumedWeakness
    && Number(status.values?.actionId) === Number(event.actionId) && status.values?.targetUnitId === targetId);
  if (consumed) return;
  const prior = actor.statuses.find(status => status.statusId === haishinIds.repeatCounter);
  const sameChain = prior && Number(prior.values?.actionId) === Number(event.actionId);
  const previousTarget = sameChain ? String(prior.values?.targetUnitId ?? '') : '';
  const repeats = previousTarget === targetId ? Number(prior?.values?.repeats ?? 0) : 0;
  const rankLevel = rank(actor, haishinIds.passive), repeatLimit = rankLevel >= 4 ? 3 : rankLevel >= 3 ? 2 : 1;
  if (repeats >= repeatLimit) return;
  const shadow = actor.statuses.find(status => status.statusId === haishinIds.shadow);
  const probability = (rankLevel >= 2 ? .3 : .1) + Number(shadow?.values?.extraBasicChance ?? 0);
  if (context.random() >= probability) return;
  const sourceRef = source(haishinIds.passive, actor.unitId);
  return [{ type: 'add-status', source: sourceRef, targetId: actor.unitId, parentEventId: event.eventId,
    instance: { instanceId: `${haishinIds.repeatCounter}:${actor.unitId}`, statusId: haishinIds.repeatCounter,
      source: sourceRef, stacks: 1, duration: { kind: 'permanent' },
      values: { actionId: event.actionId ?? 0, targetUnitId: targetId, repeats: repeats + 1 } } },
  { type: 'schedule-action', source: sourceRef, scheduling: 'counter', freeCast: true,
    intent: basicIntent(actor.unitId, targetId), parentEventId: event.eventId }];
}

function clearActionMarkers(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'action-ended' || event.actionKind !== 'basic' || event.scheduling === 'counter' || !event.source.unitId) return;
  const actor = context.getUnit(event.source.unitId);
  if (!actor || actor.heroId !== haishinIds.hero) return;
  const markerIds: readonly string[] = [haishinIds.repeatCounter, haishinIds.consumedWeakness];
  const instances = actor.statuses.filter(status => markerIds.includes(status.statusId))
    .map(status => status.instanceId);
  return instances.length ? [{ type: 'remove-status-instances', source: source(haishinIds.passive, actor.unitId),
    targetId: actor.unitId, instanceIds: instances, reason: 'consumed', parentEventId: event.eventId }] : undefined;
}

function consumeShadowBonus(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'attack-ended' || !event.source.unitId) return;
  const owner = context.getUnit(event.source.unitId), shadow = owner?.statuses.find(status => status.statusId === haishinIds.shadow);
  if (!owner || owner.heroId !== haishinIds.hero || !shadow || Number(shadow.values?.extraBasicChance ?? 0) <= 0) return;
  return [{ type: 'add-status', source: source(haishinIds.ultimate, owner.unitId), targetId: owner.unitId, parentEventId: event.eventId,
    instance: { ...shadow, values: { ...shadow.values, extraBasicChance: 0 } } }];
}

function seedWeaknessOnEnemyTurn(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-ended' || !event.unitId) return;
  const enemy = context.getUnit(event.unitId); if (!enemy || enemy.hp <= 0) return;
  const owner = context.getLivingUnits(enemy.side === 'blue' ? 'red' : 'blue').find(unit => unit.heroId === haishinIds.hero
    && rank(unit, haishinIds.passive) >= 5 && passivesEnabled(unit));
  if (!owner || context.random() >= .3) return;
  const current = enemy.statuses.find(status => status.statusId === haishinIds.weakness);
  if (current && current.stacks >= 3) return;
  return [{ type: 'add-status', source: source(haishinIds.passive, owner.unitId), targetId: enemy.unitId, parentEventId: event.eventId,
    instance: { instanceId: `${haishinIds.weakness}:${enemy.unitId}`, statusId: haishinIds.weakness,
      source: sharedWeaknessSource(), stacks: 1, duration: { kind: 'permanent' } } }];
}

function resolveProtectedAmbush(state: BattleState, attacker: Readonly<UnitState> | undefined, target: Readonly<UnitState>, amount: number,
  interception: DamageInterceptionContext | undefined) {
  if (!attacker || !interception) return;
  const guard = target.statuses.find(status => status.statusId === haishinIds.protectedAlly);
  const owner = guard ? state.units[String(guard.values?.ownerUnitId ?? '')] : undefined;
  if (!guard || !owner || owner.heroId !== haishinIds.hero || owner.hp <= 0) return;
  const sourceRef = source(haishinIds.ultimate, owner.unitId), commands: EffectCommand[] = [
    { type: 'remove-status-instances', source: sourceRef, targetId: target.unitId, instanceIds: [guard.instanceId], reason: 'consumed' },
    makeHit(interception.battle, owner, attacker, haishinIds.ultimate, 1, 0),
    ...attemptDebuff(interception.battle, { source: sourceRef, targetId: attacker.unitId, statusId: haishinIds.confusion,
      baseChance: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' } }),
  ];
  if (rank(owner, haishinIds.ultimate) >= 3) commands.push({ type: 'change-action-gauge', source: sourceRef,
    targetId: owner.unitId, amount: 50, checkImmunity: true });
  return { amount, effects: commands };
}

function resolveAmbushHealing(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage' || event.source.id !== haishinIds.ultimate || !event.source.unitId || event.hpLost <= 0) return;
  const owner = context.getUnit(event.source.unitId);
  return owner?.heroId === haishinIds.hero ? [{ type: 'heal', source: source(haishinIds.ultimate, owner.unitId),
    targetId: owner.unitId, amount: event.hpLost, parentEventId: event.eventId }] : undefined;
}

function source(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
function sharedWeaknessSource(): SourceRef { return { kind: 'skill', id: haishinIds.basic }; }
function rank(unit: Readonly<UnitState>, skillId: string): number { return Math.max(1, Math.min(5, unit.skillLevels?.[skillId] ?? unit.skillLevel)); }
function basicIntent(actorId: string, targetId: string): ActionIntent {
  return { actorId, skillId: haishinIds.basic, targetIds: [targetId], shape: 'single', targetRelation: 'enemy' };
}
function makeHit(context: BattleContext, actor: Readonly<UnitState>, target: Readonly<UnitState>, skillId: string, ratio: number,
  defenseIgnoreRatio: number): EffectCommand {
  const offense = context.getEffectiveStats(actor.unitId) ?? actor.stats, defense = context.getEffectiveStats(target.unitId) ?? target.stats;
  const result = context.calculateDamage({ attack: offense.attack, defense: Math.max(0, defense.defense * (1 - defenseIgnoreRatio)),
    defenseIgnore: effectiveDefenseIgnore(actor), ratio, dmgFluctuation: .01,
    critChance: offense.crit, critDamage: offense.critDamage }, actor as UnitState, target as UnitState);
  return { type: 'deal-damage', source: source(skillId, actor.unitId), targetId: target.unitId, amount: result.amount,
    ...(result.damageOptions ? { damageOptions: result.damageOptions } : {}), isCritical: result.isCritical,
    ...(result.isCritical ? { criticalBaseAmount: result.amount / Math.max(1, offense.critDamage) } : {}) };
}
