import type { HeroDefinition, SkillDefinition, StatusDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, StatusInstance, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { attemptDebuff } from '../mechanics/control';
import { createBasicAttackSkill } from './common-skills';
import type { ContentRegistry } from './registry';

export const yiMuLianIds = {
  hero: 272,
  basic: '2721',
  guard: '2722',
  blessing: '2723',
  attackDown: 'status.hero.272.wind-break-attack-down',
  attackUp: 'status.hero.272.wind-break-attack-up',
  windGuard: 'status.hero.272.wind-guard',
  windBlessing: 'status.hero.272.wind-blessing',
  recastBlessing: 'status.hero.272.recast-blessing',
  guardGaugeCount: 'status.hero.272.guard-gauge-count',
  preemptiveUsed: 'status.hero.272.preemptive-used',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;

/** 一目连's client skill rows 2721–2723 and shield/passive buff rows 2721–2725. */
export function registerYiMuLian(registry: ContentRegistry): void {
  registry.registerStatus({ id: yiMuLianIds.attackDown, mechanicsCoverage: 'partial', category: 'debuff',
    dispellable: true, sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerStatus({ id: yiMuLianIds.attackUp, mechanicsCoverage: 'partial', category: 'buff',
    dispellable: true, sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerStatus({ id: yiMuLianIds.windGuard, mechanicsCoverage: 'partial', category: 'shield',
    dispellable: false, sealable: false, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerStatus({ id: yiMuLianIds.windBlessing, mechanicsCoverage: 'partial', category: 'shield',
    dispellable: false, sealable: false, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerStatus({ id: yiMuLianIds.recastBlessing, mechanicsCoverage: 'partial', category: 'buff',
    dispellable: true, sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerStatus({ id: yiMuLianIds.guardGaugeCount, mechanicsCoverage: 'partial', category: 'other',
    dispellable: false, sealable: false, durationOwner: 'target-turn', refreshPolicy: 'add-stack',
    stackScope: 'source-unit', maxStacks: 3 });
  registry.registerStatus({ id: yiMuLianIds.preemptiveUsed, mechanicsCoverage: 'partial', category: 'other',
    dispellable: false, sealable: false, durationOwner: 'permanent', refreshPolicy: 'keep' });
  registry.registerHero(createYiMuLianDefinition());
}

export function createYiMuLianDefinition(): HeroDefinition {
  const basic = createBasicAttackSkill(yiMuLianIds.basic, basicRatios);
  const guard: SkillDefinition = {
    id: yiMuLianIds.guard, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 2 },
    target: 'single', targetRelation: 'ally', levels: [{ shieldRatio: .16 }, { shieldRatio: .2 },
      { shieldRatio: .2 }, { shieldRatio: .2 }, { shieldRatio: .2 }],
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId), target = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || !target || target.hp <= 0 || target.side !== actor.side) return [];
      return [windGuardCommand(context, actor, target, Number(parameters.shieldRatio ?? .16),
        `${context.state.counters.action + 1}`)];
    },
  };
  const blessing: SkillDefinition = {
    id: yiMuLianIds.blessing, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'all-allies', targetRelation: 'ally', levels: [
      { shieldRatio: .12 }, { shieldRatio: .15 }, { shieldRatio: .18 }, { shieldRatio: .18 }, { shieldRatio: .18 },
    ],
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      if (!actor) return [];
      const rank = skillRank(actor, yiMuLianIds.blessing);
      const source = yiMuLianSource(yiMuLianIds.blessing, actor.unitId);
      const commands: EffectCommand[] = [];
      for (const targetId of intent.targetIds) {
        const target = context.getUnit(targetId), stats = context.getEffectiveStats(targetId);
        if (!target || target.hp <= 0 || target.side !== actor.side || !stats) continue;
        const existing = target.statuses.find(status => status.statusId === yiMuLianIds.windBlessing);
        const remainingShield = Number(existing?.values?.shieldRemaining ?? 0);
        const shieldRatio = Number(parameters.shieldRatio ?? .12);
        commands.push({ type: 'add-status', source, targetId, instance: {
          instanceId: `${yiMuLianIds.windBlessing}:${actor.unitId}:${targetId}`,
          statusId: yiMuLianIds.windBlessing, source, stacks: 1,
          duration: { kind: 'count', remaining: 2, owner: 'target-turn' },
          values: { shieldRemaining: stats.hp * shieldRatio },
          modifiers: [{ stat: 'attack', operation: 'percent', amount: .1 },
            { stat: 'resist', operation: 'flat', amount: .15 }],
        } });
        if (existing && rank >= 4) commands.push({ type: 'add-status', source, targetId, instance: {
          instanceId: `${yiMuLianIds.recastBlessing}:${actor.unitId}:${targetId}`,
          statusId: yiMuLianIds.recastBlessing, source, stacks: 1,
          duration: { kind: 'count', remaining: 1, owner: 'target-turn' },
          modifiers: [{ stat: 'attack', operation: 'percent', amount: .2 },
            { stat: 'resist', operation: 'flat', amount: .3 }],
        } });
        if (existing && rank >= 5 && remainingShield > 0) commands.push({ type: 'heal', source, targetId,
          amount: remainingShield * .8 });
      }
      return commands;
    },
  };
  return {
    id: yiMuLianIds.hero, skills: [basic, guard, blessing], aiCoverage: 'partial', mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['已接入普攻等级倍率与100%基础概率偷取目标20%攻击、转为自身20%攻击2回合；风符·护2火、16%/20%目标生命护盾、破裂/消失时按一目连生命上限12%对敌方造成伤害，三级起击退20点行动条；四级开战免费给最高攻击友方式神上护盾，五级受减益/控制时每回合最多3次击退全敌5点行动条；风神之佑3火、12%/15%/18%群体护盾、攻击与抵抗增益，重复施放的四/五级追加增益和治疗已接入。放逐事件类型缺失，爆盾伤害类型、同队多一目连唯一效果及御魂联动仍需帧核'],
    handlers: {
      'battle-start': { priority: 45, handle(context, event) { return preemptiveGuard(context, event); } },
      hit: { priority: 45, handle(context, event) { return onHit(context, event); } },
      'effect-resolution': { priority: 45, handle(context, event) {
        if (event.type === 'status-added') return [
          ...(event.instance.statusId === yiMuLianIds.attackDown ? grantStolenAttack(context, event) ?? [] : []),
          ...(actionBarOnShieldedAllyDebuff(context, event) ?? []),
        ];
        if (event.type === 'status-removed' && event.statusId === yiMuLianIds.windGuard)
          return windGuardRemoved(context, event);
      } },
      'status-expiration': { priority: 45, handle(context, event) {
        if (event.type === 'status-removed' && event.statusId === yiMuLianIds.windGuard)
          return windGuardRemoved(context, event);
      } },
      'control-application': { priority: 45, handle(context, event) {
        return event.type === 'status-added' ? actionBarOnShieldedAllyDebuff(context, event) : undefined;
      } },
    },
    policy(context, unitId): ActionIntent | undefined {
      const actor = context.getUnit(unitId);
      if (!actor || actor.hp <= 0 || actor.unitKind === 'summon') return undefined;
      const allies = context.getLivingUnits(actor.side);
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      const fire = context.state.resources[actor.side]?.fire ?? 0;
      if (fire >= 3) return { actorId: unitId, skillId: yiMuLianIds.blessing,
        targetIds: allies.map(unit => unit.unitId), shape: 'all-allies', targetRelation: 'ally' };
      const target = allies.filter(unit => unit.unitKind !== 'summon')
        .sort((a, b) => a.hp / Math.max(1, a.stats.hp) - b.hp / Math.max(1, b.stats.hp))[0];
      if (fire >= 2 && target && !target.statuses.some(status => status.statusId === yiMuLianIds.windGuard))
        return { actorId: unitId, skillId: yiMuLianIds.guard, targetIds: [target.unitId], shape: 'single', targetRelation: 'ally' };
      const enemy = enemies.slice().sort((a, b) => a.hp / Math.max(1, a.stats.hp) - b.hp / Math.max(1, b.stats.hp))[0]!;
      return { actorId: unitId, skillId: yiMuLianIds.basic, targetIds: [enemy.unitId], shape: 'single', targetRelation: 'enemy' };
    },
  };
}

function preemptiveGuard(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'battle-started') return;
  const commands: EffectCommand[] = [];
  for (const side of ['blue', 'red'] as const) {
    const eyes = context.getLivingUnits(side).filter(unit => unit.heroId === yiMuLianIds.hero
      && skillRank(unit, yiMuLianIds.guard) >= 4 && passivesEnabled(unit));
    if (eyes.length === 0) continue;
    const owner = eyes[0]!;
    if (owner.statuses.some(status => status.statusId === yiMuLianIds.preemptiveUsed)) continue;
    const target = context.getLivingUnits(side).filter(unit => unit.unitKind !== 'summon')
      .slice().sort((a, b) => (context.getEffectiveStats(b.unitId)?.attack ?? b.stats.attack)
        - (context.getEffectiveStats(a.unitId)?.attack ?? a.stats.attack))[0];
    if (!target) continue;
    const source = yiMuLianSource(yiMuLianIds.guard, owner.unitId);
    commands.push({ type: 'add-status', source, targetId: owner.unitId, instance: {
      instanceId: `${yiMuLianIds.preemptiveUsed}:${owner.unitId}`, statusId: yiMuLianIds.preemptiveUsed,
      source, stacks: 1, duration: { kind: 'permanent' },
    } }, windGuardCommand(context, owner, target, .2, 'battle-start'));
  }
  return commands;
}

function onHit(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage') return;
  if (event.shieldConsumed && event.shieldConsumed > 0) {
    const target = context.getUnit(event.targetId);
    const depleted = target?.statuses.filter(status => status.statusId === yiMuLianIds.windGuard
      && Number(status.values?.shieldRemaining ?? 0) <= 0) ?? [];
    if (depleted.length) return depleted.map(status => ({ type: 'remove-status-instances' as const,
      source: status.source, targetId: event.targetId, instanceIds: [status.instanceId],
      reason: 'consumed' as const, parentEventId: event.eventId }));
  }
  if (event.source.id !== yiMuLianIds.basic || !event.source.unitId) return;
  const actor = context.getUnit(event.source.unitId), target = context.getUnit(event.targetId);
  if (!actor || actor.heroId !== yiMuLianIds.hero || actor.hp <= 0 || !passivesEnabled(actor) || !target || target.hp <= 0) return;
  return attemptDebuff(context, { source: yiMuLianSource(yiMuLianIds.basic, actor.unitId), targetId: target.unitId,
    statusId: yiMuLianIds.attackDown, baseChance: 1,
    duration: { kind: 'count', remaining: 2, owner: 'target-turn' },
    modifiers: [{ stat: 'attack', operation: 'percent', amount: -.2 }] });
}

function grantStolenAttack(context: BattleContext, event: Extract<BattleEvent, { type: 'status-added' }>): EffectCommand[] | undefined {
  const actor = event.source.unitId ? context.getUnit(event.source.unitId) : undefined;
  if (event.instance.statusId !== yiMuLianIds.attackDown || !actor || actor.heroId !== yiMuLianIds.hero
    || !passivesEnabled(actor)) return;
  const source = yiMuLianSource(yiMuLianIds.basic, actor.unitId);
  return [{ type: 'add-status', source, targetId: actor.unitId, parentEventId: event.eventId, instance: {
    instanceId: `${yiMuLianIds.attackUp}:${actor.unitId}:${event.targetId}`,
    statusId: yiMuLianIds.attackUp, source, stacks: 1,
    duration: { kind: 'count', remaining: 2, owner: 'target-turn' },
    modifiers: [{ stat: 'attack', operation: 'percent', amount: .2 }],
  } }];
}

function actionBarOnShieldedAllyDebuff(context: BattleContext, event: Extract<BattleEvent, { type: 'status-added' }>): EffectCommand[] | undefined {
  const target = context.getUnit(event.targetId);
  const applier = event.source.unitId ? context.getUnit(event.source.unitId) : undefined;
  const category = context.getStatusCategory(event.instance.statusId);
  if (!target || !applier || target.side === applier.side || category !== 'debuff' && category !== 'control') return;
  const guards = target.statuses.filter(status => status.statusId === yiMuLianIds.windGuard
    && status.source.unitId && status.source.id === yiMuLianIds.guard);
  const commands: EffectCommand[] = [];
  for (const guard of guards) {
    const owner = guard.source.unitId ? context.getUnit(guard.source.unitId) : undefined;
    if (!owner || owner.heroId !== yiMuLianIds.hero || !passivesEnabled(owner)
      || skillRank(owner, yiMuLianIds.guard) < 5) continue;
    const counter = target.statuses.find(status => status.statusId === yiMuLianIds.guardGaugeCount
      && status.source.unitId === owner.unitId);
    if ((counter?.stacks ?? 0) >= 3) continue;
    const source = yiMuLianSource(yiMuLianIds.guard, owner.unitId);
    commands.push({ type: 'add-status', source, targetId: target.unitId, parentEventId: event.eventId,
      instance: { instanceId: `${yiMuLianIds.guardGaugeCount}:${owner.unitId}:${target.unitId}`,
        statusId: yiMuLianIds.guardGaugeCount, source, stacks: 1,
        duration: { kind: 'count', remaining: 1, owner: 'target-turn' } } });
    for (const enemy of context.getLivingUnits(owner.side === 'blue' ? 'red' : 'blue'))
      commands.push({ type: 'change-action-gauge', source, targetId: enemy.unitId, amount: -5, parentEventId: event.eventId });
  }
  return commands;
}

function windGuardRemoved(context: BattleContext, event: Extract<BattleEvent, { type: 'status-removed' }>): EffectCommand[] | undefined {
  if (event.reason === 'replaced') return;
  const ownerId = event.removedSource?.unitId;
  const owner = ownerId ? context.getUnit(ownerId) : undefined;
  const target = context.getUnit(event.targetId);
  if (!owner || owner.heroId !== yiMuLianIds.hero || !target || target.side !== owner.side) return;
  const source = yiMuLianSource(yiMuLianIds.guard, owner.unitId);
  const commands: EffectCommand[] = context.getLivingUnits(owner.side === 'blue' ? 'red' : 'blue').map(enemy => ({
    type: 'deal-damage', source, targetId: enemy.unitId, amount: owner.stats.hp * .12,
    damageKind: 'true', precalculated: true, isCritical: false, parentEventId: event.eventId,
  }));
  if (skillRank(owner, yiMuLianIds.guard) >= 3) for (const enemy of context.getLivingUnits(owner.side === 'blue' ? 'red' : 'blue'))
    commands.push({ type: 'change-action-gauge', source, targetId: enemy.unitId, amount: -20, parentEventId: event.eventId });
  return commands;
}

function windGuardCommand(context: BattleContext, owner: Readonly<UnitState>, target: Readonly<UnitState>, ratio: number,
  nonce: string): EffectCommand {
  const source = yiMuLianSource(yiMuLianIds.guard, owner.unitId);
  const shield = context.getEffectiveStats(target.unitId)?.hp ?? target.stats.hp;
  return { type: 'add-status', source, targetId: target.unitId, instance: {
    instanceId: `${yiMuLianIds.windGuard}:${owner.unitId}:${target.unitId}`,
    statusId: yiMuLianIds.windGuard, source, stacks: 1,
    duration: { kind: 'count', remaining: 2, owner: 'target-turn' },
    values: { shieldRemaining: shield * ratio, breakDamageRatio: .12, grantToken: nonce },
  } };
}

function skillRank(unit: Readonly<UnitState>, skillId: string): number {
  return Math.max(1, unit.skillLevels?.[skillId] ?? unit.skillLevel ?? 1);
}

function yiMuLianSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
