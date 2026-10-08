import type { DamageInterception, HeroDefinition, SkillDefinition, StatusDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import type { ContentRegistry } from './registry';

export const ichigoIds = { hero: 337, basic: '3371', passive: '3372', ultimate: '3373', finalMoon: '3376',
  pressure: 'status.hero.337.pressure', hollow: 'status.hero.337.hollow', secondHollow: 'status.hero.337.second-hollow',
  finalUnlock: 'status.hero.337.final-unlock', finalReady: 'status.hero.337.final-ready', noRevive: 'status.hero.337.no-revive',
  countered: 'status.hero.337.countered' } as const;

const basicRatios = [.8, .85, .9, .95, 1] as const;
const ultimateRatios = [2.63, 2.76, 2.89, 3.02, 3.15] as const;
const finalCast = '3376-last-moon-cast';
const transformSkill = '3372-hollow-transform';

export function registerIchigo(registry: ContentRegistry): void {
  const statuses: StatusDefinition[] = [
    { id: ichigoIds.pressure, mechanicsCoverage: 'partial', category: 'buff', dispellable: false, sealable: false,
      durationOwner: 'permanent', refreshPolicy: 'add-stack', maxStacks: 4 },
    { id: ichigoIds.hollow, mechanicsCoverage: 'partial', category: 'buff', dispellable: false, sealable: false,
      durationOwner: 'permanent', refreshPolicy: 'keep', maxStacks: 1 },
    { id: ichigoIds.secondHollow, mechanicsCoverage: 'partial', category: 'buff', dispellable: false, sealable: false,
      durationOwner: 'permanent', refreshPolicy: 'keep', maxStacks: 1, controlProtection: 'immune' },
    { id: ichigoIds.finalUnlock, mechanicsCoverage: 'partial', category: 'buff', dispellable: false, sealable: false,
      durationOwner: 'permanent', refreshPolicy: 'keep', maxStacks: 1 },
    { id: ichigoIds.finalReady, mechanicsCoverage: 'partial', category: 'buff', dispellable: false, sealable: false,
      durationOwner: 'permanent', refreshPolicy: 'keep', maxStacks: 1 },
    { id: ichigoIds.noRevive, mechanicsCoverage: 'partial', category: 'debuff', dispellable: false, sealable: false,
      durationOwner: 'permanent', refreshPolicy: 'keep', preventsRevive: true },
    { id: ichigoIds.countered, mechanicsCoverage: 'partial', category: 'buff', dispellable: false, sealable: false,
      durationOwner: 'round', refreshPolicy: 'replace' },
  ];
  statuses.forEach(status => registry.registerStatus(status));

  const basic: SkillDefinition = { id: ichigoIds.basic, actionKind: 'basic', target: 'single', targetRelation: 'enemy',
    levels: basicRatios.map(ratio => ({ ratio })), execute(context, intent, params) {
      return attack(context, intent, ichigoIds.basic, Number(params.ratio ?? basicRatios[rank(context.getUnit(intent.actorId), ichigoIds.basic) - 1]!));
    } };
  const passive: SkillDefinition = { id: ichigoIds.passive, actionKind: 'passive', target: 'self', targetRelation: 'ally',
    levels: [{}], canUse() { return false; }, execute() { return []; } };
  const ultimate: SkillDefinition = { id: ichigoIds.ultimate, actionKind: 'skill', target: 'single', targetRelation: 'enemy',
    resourceCost: { resourceId: 'fire', amount: 3 }, levels: ultimateRatios.map(ratio => ({ ratio })),
    canUse(_state, actor) { return has(actor, ichigoIds.secondHollow) || actor.hp > 0; },
    execute(context, intent, params) { return attack(context, intent, ichigoIds.ultimate,
      Number(params.ratio ?? ultimateRatios[rank(context.getUnit(intent.actorId), ichigoIds.ultimate) - 1]!)); } };
  const transform: SkillDefinition = { id: transformSkill, actionKind: 'skill', target: 'self', targetRelation: 'ally',
    levels: [{}], canUse(_state, actor) { return actor.hp > 0 && has(actor, ichigoIds.hollow) && !has(actor, ichigoIds.secondHollow); },
    execute(context, intent) {
      const actor = context.getUnit(intent.actorId); if (!actor || actor.hp <= 0) return [];
      const source = ichigoSource(ichigoIds.passive, actor.unitId);
      return [{ type: 'remove-statuses', source, targetId: actor.unitId, statusIds: [ichigoIds.hollow], reason: 'replaced' },
        { type: 'add-status', source, targetId: actor.unitId, instance: status(ichigoIds.secondHollow, source) }];
    } };
  const final: SkillDefinition = { id: finalCast, actionKind: 'skill', target: 'single', targetRelation: 'enemy',
    suppressSoulTriggers: true, levels: [{ ratio: 6 }], canUse(_state, actor) { return actor.hp > 0 && has(actor, ichigoIds.finalReady); },
    execute(context, intent) { const actor = context.getUnit(intent.actorId); return attack(context, intent, ichigoIds.finalMoon, 6, true, true); } };

  const definition: HeroDefinition = { id: ichigoIds.hero, skills: [basic, passive, ultimate, transform, final],
    mechanicsCoverage: 'partial', aiCoverage: 'partial', mechanicsCoverageNotes: [
      '按客户端数据接入斩月80%至100%普攻、月牙天冲耗3火并造成263%至315%伤害；觉醒后敌方非召唤单位每次行动结束推进8%行动条。虚化被动按回合开始时自身及低于40%生命比例的队友叠加灵压，4层进入虚化；低血量队友受伤时每回合反击一次。虚化可转入二段，加入增伤、减伤、控制免疫及反击强化，施放斩月或月牙天冲4次后解除。首次获得灵压后解锁最后的月牙天冲：致命伤害触发免死、净化并获得额外行动，随后对优先伤害来源的敌人造成600%伤害并自我击败、防止复活。基础机制据客户端技能/buff表接入；未出现在10点场帧图阵容中，反击窗口、灵压叠层上限转阶段、非直接伤害致死触发与客户端状态时长需用实战帧继续核对。'],
    handlers: {
      'turn-start': { priority: 337, handle(context, event) { return gainPressure(context, event); } },
      hit: { priority: 337, handle(context, event) { return counterLowAlly(context, event); } },
      'action-end': { priority: 337, handle(context, event) { return onActionEnd(context, event); } },
      'turn-end': { priority: 337, handle(context, event) { return enemyGauge(context, event); } },
    },
    interceptIncomingDamage(state, attacker, target, amount, _kind, interception): DamageInterception | undefined {
      if (target.heroId !== ichigoIds.hero || target.hp <= 0 || amount < target.hp || !has(target, ichigoIds.finalUnlock)
        || has(target, ichigoIds.finalReady) || !passivesEnabled(target) || !interception) return;
      const enemies = interception.battle.getLivingUnits(target.side === 'blue' ? 'red' : 'blue');
      const preferred = attacker && attacker.side !== target.side && attacker.hp > 0 ? attacker : undefined;
      const fallback = enemies.length ? enemies[Math.floor(interception.battle.random() * enemies.length)] : undefined;
      const chosen = preferred ?? fallback;
      const source = ichigoSource(ichigoIds.finalMoon, target.unitId);
      const effects: EffectCommand[] = [
        { type: 'remove-statuses', source, targetId: target.unitId,
          statusIds: target.statuses.map(instance => instance.statusId), reason: 'consumed' },
        { type: 'add-status', source, targetId: target.unitId, instance: status(ichigoIds.finalReady, source) },
        { type: 'schedule-action', source, scheduling: 'extra-turn', freeCast: true,
          intent: { actorId: target.unitId, skillId: finalCast, targetIds: chosen ? [chosen.unitId] : [], shape: 'single', targetRelation: 'enemy' } },
      ];
      return { amount: 0, effects };
    },
    policy(context, unitId) {
      const actor = context.getUnit(unitId); if (!actor || actor.hp <= 0 || actor.unitKind === 'summon') return;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue'); if (!enemies.length) return;
      const target = enemies.slice().sort((a, b) => a.hp / Math.max(1, a.stats.hp) - b.hp / Math.max(1, b.stats.hp))[0]!;
      if (has(actor, ichigoIds.hollow) && !has(actor, ichigoIds.secondHollow))
        return { actorId: unitId, skillId: transformSkill, targetIds: [unitId], shape: 'self', targetRelation: 'ally' };
      return { actorId: unitId, skillId: (context.state.resources[actor.side]?.fire ?? 0) >= 3 ? ichigoIds.ultimate : ichigoIds.basic,
        targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
    },
  };
  registry.registerHero(definition);
}

function gainPressure(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-started') return;
  const owner = context.getUnit(event.unitId);
  if (!owner || owner.heroId !== ichigoIds.hero || owner.hp <= 0 || context.isUnitUnableToAct(owner.unitId) || !passivesEnabled(owner)) return;
  const lowAllies = context.getLivingUnits(owner.side).filter(ally => ally.unitId !== owner.unitId && ally.hp / Math.max(1, ally.stats.hp) < .4).length;
  const count = 1 + lowAllies;
  const current = owner.statuses.find(instance => instance.statusId === ichigoIds.pressure)?.stacks ?? 0;
  const source = ichigoSource(ichigoIds.passive, owner.unitId);
  const commands: EffectCommand[] = [{ type: 'add-status', source, targetId: owner.unitId,
    instance: { ...status(ichigoIds.pressure, source), stacks: Math.min(count, Math.max(1, 4 - current)) } },
  ];
  if (!has(owner, ichigoIds.finalUnlock)) commands.push({ type: 'add-status', source, targetId: owner.unitId,
    instance: status(ichigoIds.finalUnlock, source) });
  if (current + count >= 4 && !has(owner, ichigoIds.hollow) && !has(owner, ichigoIds.secondHollow))
    commands.push({ type: 'add-status', source, targetId: owner.unitId, instance: status(ichigoIds.hollow, source) });
  return commands;
}

function counterLowAlly(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage' || !event.source.unitId || event.source.unitId === event.targetId) return;
  const attacker = context.getUnit(event.source.unitId), target = context.getUnit(event.targetId);
  if (!attacker || attacker.hp <= 0 || !target || target.heroId === ichigoIds.hero || target.side === attacker.side) return;
  const ichigo = context.getLivingUnits(target.side).find(unit => unit.heroId === ichigoIds.hero && unit.hp > 0);
  if (!ichigo || !passivesEnabled(ichigo) || target.hp / Math.max(1, target.stats.hp) >= .4
    || has(ichigo, ichigoIds.countered)) return;
  const source = ichigoSource(ichigoIds.passive, ichigo.unitId);
  const counterSkill = has(ichigo, ichigoIds.secondHollow) ? ichigoIds.ultimate : ichigoIds.basic;
  return [
    { type: 'add-status', source, targetId: ichigo.unitId, instance: { ...status(ichigoIds.countered, source),
      duration: { kind: 'count', remaining: 1, owner: 'round' } } },
    { type: 'schedule-action', source, scheduling: 'counter', freeCast: true,
      intent: { actorId: ichigo.unitId, skillId: counterSkill, targetIds: [attacker.unitId], shape: 'single', targetRelation: 'enemy' },
      parentEventId: event.eventId },
  ];
}

function onActionEnd(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'action-ended' || !event.intent) return;
  const actor = context.getUnit(event.intent.actorId); if (!actor || actor.heroId !== ichigoIds.hero) return;
  if (event.skillId === finalCast && has(actor, ichigoIds.finalReady)) {
    const source = ichigoSource(ichigoIds.finalMoon, actor.unitId);
    return [{ type: 'add-status', source, targetId: actor.unitId, instance: status(ichigoIds.noRevive, source) },
      { type: 'lose-life', source, targetId: actor.unitId, amount: actor.hp, lifeLossKind: 'direct' }];
  }
  if (has(actor, ichigoIds.secondHollow) && (event.skillId === ichigoIds.basic || event.skillId === ichigoIds.ultimate)) {
    const used = Number(actor.statuses.find(instance => instance.statusId === ichigoIds.secondHollow)?.values?.used ?? 0) + 1;
    const source = ichigoSource(ichigoIds.passive, actor.unitId);
    if (used >= 4) return [{ type: 'remove-statuses', source, targetId: actor.unitId, statusIds: [ichigoIds.secondHollow], reason: 'expired' }];
    const current = actor.statuses.find(instance => instance.statusId === ichigoIds.secondHollow)!;
    return [{ type: 'remove-status-instances', source: current.source, targetId: actor.unitId,
      instanceIds: [current.instanceId], reason: 'replaced' },
    { type: 'add-status', source, targetId: actor.unitId, instance: { ...current, instanceId: `${ichigoIds.secondHollow}:${actor.unitId}:${used}`,
      source, values: { ...current.values, used } } }];
  }
  return;
}

function enemyGauge(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-ended') return;
  const actor = context.getUnit(event.unitId); if (!actor || actor.heroId === ichigoIds.hero || actor.unitKind === 'summon') return;
  const ichigos = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue').filter(unit => unit.heroId === ichigoIds.hero
    && unit.hp > 0 && unit.awakeFilter === 1 && passivesEnabled(unit));
  return ichigos.map(unit => ({ type: 'change-action-gauge' as const, source: ichigoSource(ichigoIds.passive, unit.unitId),
    targetId: unit.unitId, amount: .08, parentEventId: event.eventId }));
}

function attack(context: BattleContext, intent: ActionIntent, skillId: string, ratio: number, suppress = false, noShare = false): EffectCommand[] {
  const actor = context.getUnit(intent.actorId); if (!actor || actor.hp <= 0) return [];
  const offense = context.getEffectiveStats(actor.unitId) ?? actor.stats;
  return intent.targetIds.flatMap(targetId => {
    const target = context.getUnit(targetId); if (!target || target.hp <= 0 || target.side === actor.side) return [];
    const defense = context.getEffectiveStats(target.unitId) ?? target.stats;
    const result = context.calculateDamage({ attack: offense.attack, defense: defense.defense, defenseIgnore: effectiveDefenseIgnore(actor),
      ratio, critChance: offense.crit, critDamage: offense.critDamage }, actor, target);
    return [{ type: 'deal-damage' as const, source: ichigoSource(skillId, actor.unitId), targetId: target.unitId, amount: result.amount,
      ...(result.damageOptions ? { damageOptions: result.damageOptions } : {}), isCritical: result.isCritical,
      ...(suppress ? { suppressSoulTriggers: true, suppressTargetSoulTriggers: true, suppressTargetPassiveTriggers: true } : {}),
      ...(noShare ? { cannotBeShared: true } : {}) }];
  });
}
function status(statusId: string, source: SourceRef) { return { instanceId: `${statusId}:${source.unitId}`, statusId, source, stacks: 1,
  duration: { kind: 'permanent' as const },
  ...(statusId === ichigoIds.hollow ? { modifiers: [{ stat: 'damage' as const, operation: 'percent' as const, amount: 1 },
    { stat: 'damageTaken' as const, operation: 'percent' as const, amount: -.4 }] } : {}),
  ...(statusId === ichigoIds.secondHollow ? { modifiers: [{ stat: 'damage' as const, operation: 'percent' as const, amount: 1 },
    { stat: 'damageTaken' as const, operation: 'percent' as const, amount: -.8 }] } : {}) }; }
function has(unit: Readonly<UnitState>, statusId: string): boolean { return unit.statuses.some(instance => instance.statusId === statusId); }
function rank(unit: Readonly<UnitState> | undefined, skillId: string): number {
  return Math.max(1, Math.min(5, unit?.skillLevels?.[skillId] ?? unit?.skillLevel ?? 1));
}
function ichigoSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
