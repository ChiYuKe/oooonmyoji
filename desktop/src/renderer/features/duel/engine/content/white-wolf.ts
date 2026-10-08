import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, StatusInstance, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import { battleSkillRow, skillNumber } from '../../../../../shared/game-skill-data';
import { createBasicAttackSkill } from './common-skills';
import type { ContentRegistry } from './registry';

export const whiteWolfIds = {
  hero: 264,
  basic: '2641',
  passive: '2642',
  ultimate: '2643',
  meditation: 'status.hero.264.meditation',
  recovery: 'status.hero.264.recovery',
  cloneGuard: 'status.hero.264.clone-guard',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const ultimateRatios = [2.37, 2.49, 2.61, 2.73, 2.85] as const;

export function registerWhiteWolf(registry: ContentRegistry): void {
  registry.registerStatus({ id: whiteWolfIds.meditation, mechanicsCoverage: 'partial', category: 'buff', dispellable: true,
    sealable: false, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerStatus({ id: whiteWolfIds.recovery, mechanicsCoverage: 'partial', category: 'debuff', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerStatus({ id: whiteWolfIds.cloneGuard, mechanicsCoverage: 'partial', category: 'other', dispellable: false,
    sealable: false, durationOwner: 'event', refreshPolicy: 'replace' });
  registry.registerHero(createWhiteWolfDefinition());
}

export function createWhiteWolfDefinition(): HeroDefinition {
  const basic = createBasicAttackSkill(whiteWolfIds.basic, basicRatios);
  const ultimate: SkillDefinition = {
    id: whiteWolfIds.ultimate, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'single', targetRelation: 'enemy', levels: ultimateRatios.map(ratio => ({ ratio })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      const target = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || actor.hp <= 0 || !target || target.hp <= 0) return [];
      const actorStats = context.getEffectiveStats(actor.unitId) ?? actor.stats;
      const targetStats = context.getEffectiveStats(target.unitId) ?? target.stats;
      const meditation = actor.statuses.some(status => status.statusId === whiteWolfIds.meditation);
      const row = battleSkillRow(whiteWolfIds.ultimate, skillRank(actor, whiteWolfIds.ultimate), actor.awakeFilter,
        actor.unitKind === 'monster' || actor.unitKind === 'summon');
      const push = meditation ? (skillNumber(row, 'param5') ?? .5) * 100 : Math.abs(skillNumber(row, 'param1') ?? -.2) * 100;
      const gauge = target.turnPos === undefined ? target.actionGauge : target.turnPos / 1.2;
      const reachesEnd = context.actionGaugeChangeAllowed(target.unitId, -push) && gauge > 0 && gauge <= push;
      const ratio = Number(parameters.ratio ?? ultimateRatios[0]) * (reachesEnd ? 1.5 : 1);
      const critBonus = skillNumber(row, 'param2') ?? .3;
      const hit = context.calculateDamage({ attack: actorStats.attack, defense: targetStats.defense,
        defenseIgnore: effectiveDefenseIgnore(actor), ratio, critChance: actorStats.crit + critBonus,
        critDamage: actorStats.critDamage }, actor, target);
      const source = whiteWolfSource(whiteWolfIds.ultimate, actor.unitId);
      const commands: EffectCommand[] = [{ type: 'deal-damage', source, targetId: target.unitId, amount: hit.amount,
        ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}),
        ...(hit.isCritical ? { criticalBaseAmount: hit.amount / Math.max(1, actorStats.critDamage) } : {}), isCritical: hit.isCritical },
      { type: 'change-action-gauge', source, targetId: target.unitId, amount: -push }];
      if (reachesEnd) commands.push({ type: 'add-status', source, targetId: actor.unitId,
        instance: statusInstance(whiteWolfIds.recovery, whiteWolfIds.ultimate, actor, actor.unitId, context.state.counters.action,
          [{ stat: 'speed', operation: 'percent', amount: -.4 }]) });
      return commands;
    },
  };

  return {
    id: whiteWolfIds.hero, skills: [basic, ultimate], aiCoverage: 'partial', mechanicsCoverage: 'partial',
    aiCoverageNotes: ['鬼火不少于3时使用无我，否则使用文射；目标权重和回气状态下的选招仍需校准'],
    mechanicsCoverageNotes: ['文射按等级造成100%至125%攻击伤害；无我消耗3火，按等级造成237%至285%攻击伤害并增加30%暴击，普通状态击退20%行动条、冥想时击退50%；目标行动条被推至末端时伤害乘1.5并使白狼回气1回合、速度降低40%，目标具有推条免疫时不触发末端增伤。觉醒分支击杀后推自身90%行动条。行动结束时按30%概率冥想，增加20%暴击伤害并为下一次单体攻击提供30%影分身抵挡。回气/冥想持续边界以及客户端帧中的完整触发顺序仍待核验'],
    policy(context, unitId): ActionIntent | undefined {
      const actor = context.getUnit(unitId);
      if (!actor || actor.hp <= 0 || actor.unitKind === 'summon') return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      if ((context.state.resources[actor.side]?.fire ?? 0) >= 3
        && !actor.statuses.some(status => status.statusId === whiteWolfIds.recovery)) {
        const target = enemies.slice().sort((left, right) => right.hp / Math.max(1, right.stats.hp)
          - left.hp / Math.max(1, left.stats.hp))[0]!;
        return { actorId: unitId, skillId: whiteWolfIds.ultimate, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
      }
      const target = enemies.slice().sort((left, right) => left.hp / Math.max(1, left.stats.hp)
        - right.hp / Math.max(1, right.stats.hp))[0]!;
      return { actorId: unitId, skillId: whiteWolfIds.basic, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
    },
    handlers: {
      'action-end': { priority: 32, handle(context, event) { return enterMeditation(context, event); } },
      'attack-start': { priority: 32, handle(context, event) { return prepareShadowClone(context, event); } },
      'attack-end': { priority: 32, handle(context, event) { return clearCloneGuard(context, event); } },
      'unit-defeated': { priority: 32, handle(context, event) { return advanceAfterKill(context, event); } },
    },
    interceptIncomingDamage(state, attacker, target, amount, _kind, context) {
      if (!attacker || target.heroId !== whiteWolfIds.hero || !context || amount <= 0) return undefined;
      const guard = attacker.statuses.find(status => status.statusId === whiteWolfIds.cloneGuard
        && Number(status.values?.attackId) === context.attackId && status.values?.targetId === target.unitId);
      if (!guard || guard.values?.blocked !== true) return undefined;
      return { amount: 0, effects: [] };
    },
  };
}

function enterMeditation(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'action-ended' || !event.source.unitId) return;
  const actor = context.getUnit(event.source.unitId);
  if (!actor || actor.heroId !== whiteWolfIds.hero || actor.hp <= 0 || !passivesEnabled(actor)
    || actor.statuses.some(status => status.statusId === whiteWolfIds.recovery) || context.random() >= .3) return;
  const source = whiteWolfSource(whiteWolfIds.passive, actor.unitId);
  const instance = statusInstance(whiteWolfIds.meditation, whiteWolfIds.passive, actor, actor.unitId, context.state.counters.action,
    [{ stat: 'critDamage', operation: 'percent', amount: .2 }]);
  return [{ type: 'add-status', source, targetId: actor.unitId, instance, parentEventId: event.eventId }];
}

function prepareShadowClone(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'attack-start' || event.shape !== 'single' || event.targetIds.length !== 1
    || event.attackId === undefined || !event.source.unitId) return;
  const target = context.getUnit(event.targetIds[0]!);
  const attacker = context.getUnit(event.source.unitId);
  if (!target || target.heroId !== whiteWolfIds.hero || target.hp <= 0 || !attacker || attacker.hp <= 0
    || !passivesEnabled(target) || !target.statuses.some(status => status.statusId === whiteWolfIds.meditation)) return;
  const source = whiteWolfSource(whiteWolfIds.passive, target.unitId);
  const instance: StatusInstance = { instanceId: `${whiteWolfIds.cloneGuard}:${attacker.unitId}:${event.attackId}`,
    statusId: whiteWolfIds.cloneGuard, source, stacks: 1,
    duration: { kind: 'count', remaining: 1, owner: 'event', event: 'attack-end' },
    values: { attackId: event.attackId, targetId: target.unitId, blocked: context.random() < .3 } };
  return [{ type: 'add-status', source, targetId: attacker.unitId, instance, parentEventId: event.eventId }];
}

function clearCloneGuard(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'attack-ended' || !event.source.unitId) return;
  const attacker = context.getUnit(event.source.unitId);
  if (!attacker?.statuses.some(status => status.statusId === whiteWolfIds.cloneGuard
    && Number(status.values?.attackId) === event.attackId)) return;
  return [{ type: 'remove-statuses', source: whiteWolfSource(whiteWolfIds.passive, event.source.unitId),
    targetId: attacker.unitId, statusIds: [whiteWolfIds.cloneGuard], reason: 'consumed', parentEventId: event.eventId }];
}

function advanceAfterKill(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'unit-defeated' || !event.defeatedBy || event.defeatedBy.id !== whiteWolfIds.ultimate
    || !event.defeatedBy.unitId) return;
  const actor = context.getUnit(event.defeatedBy.unitId);
  if (!actor || actor.hp <= 0 || actor.heroId !== whiteWolfIds.hero || !actor.awakeFilter || !passivesEnabled(actor)) return;
  const row = battleSkillRow(whiteWolfIds.ultimate, skillRank(actor, whiteWolfIds.ultimate), actor.awakeFilter,
    actor.unitKind === 'monster' || actor.unitKind === 'summon');
  const amount = (skillNumber(row, 'param3') ?? 0) * 100;
  if (amount <= 0) return;
  return [{ type: 'change-action-gauge', source: whiteWolfSource(whiteWolfIds.ultimate, actor.unitId),
    targetId: actor.unitId, amount, parentEventId: event.eventId }];
}

function statusInstance(statusId: string, sourceId: string, actor: Readonly<UnitState>, targetId: string, actionId: number,
  modifiers: StatusInstance['modifiers']): StatusInstance {
  return { instanceId: `${statusId}:${targetId}:${actionId}`, statusId,
    source: whiteWolfSource(sourceId, actor.unitId), stacks: 1,
    duration: { kind: 'count', remaining: 1, owner: 'target-turn' }, modifiers };
}

function skillRank(actor: Readonly<UnitState>, skillId: string): number {
  return Math.max(1, Math.min(5, actor.skillLevels?.[skillId] ?? actor.skillLevel));
}

function whiteWolfSource(id: string, unitId: string): SourceRef {
  return { kind: 'skill', id, unitId };
}
