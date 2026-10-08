import type { DamageInterception, HeroDefinition, SkillDefinition } from '../core/definitions';
import { passiveSuppressionStatusId, passivesEnabled } from '../core/passive-eligibility';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, StatusInstance, UnitState } from '../core/types';
import { attemptControl } from '../mechanics/control';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import { createBasicAttackSkill } from './common-skills';
import type { ContentRegistry } from './registry';

export const yanyanluoIds = {
  hero: 281,
  basic: '2811',
  passive: '2812',
  ultimate: '2813',
  smokeGhoul: 'status.hero.281.smoke-ghoul',
  critTracker: 'status.hero.281.crit-tracker',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const damageReductionChances = [.3, .35, .35, .4, .4] as const;
const damageReductionRates = [.2, .2, .25, .25, .3] as const;
const firstHitRatios = [.19, .2, .21, .22, .23] as const;
const finalHitRatios = [.44, .46, .48, .51, .53] as const;
const ultimateCosts = [3, 3, 3, 3, 3, 2] as const;

/** 烟烟罗的受击减伤、攻击变形，以及烟之鬼五段暴击累积后的群体终击。 */
export function registerYanyanluo(registry: ContentRegistry): void {
  registry.registerStatus({ id: yanyanluoIds.smokeGhoul, mechanicsCoverage: 'partial', category: 'control',
    dispellable: true, sealable: true, durationOwner: 'target-turn', refreshPolicy: 'refresh-duration', preventsAction: true });
  registry.registerStatus({ id: yanyanluoIds.critTracker, mechanicsCoverage: 'partial', category: 'other',
    dispellable: false, sealable: false, durationOwner: 'event', refreshPolicy: 'replace' });

  const basic = createBasicAttackSkill(yanyanluoIds.basic, basicRatios);
  const ultimate: SkillDefinition = {
    id: yanyanluoIds.ultimate, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    resourceCostsByLevel: ultimateCosts.map(amount => ({ resourceId: 'fire', amount })),
    target: 'single', targetRelation: 'enemy',
    levels: firstHitRatios.map((ratio, index) => ({ ratio, finalRatio: finalHitRatios[index]!, critBonusPerHit: .3, hits: 5 })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      const target = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || actor.hp <= 0 || actor.heroId !== yanyanluoIds.hero || !target || target.hp <= 0 || target.side === actor.side) return [];
      const actorStats = context.getEffectiveStats(actor.unitId) ?? actor.stats;
      const targetStats = context.getEffectiveStats(target.unitId) ?? target.stats;
      const source = yanyanluoSource(yanyanluoIds.ultimate, actor.unitId);
      const ratio = Number(parameters.ratio ?? firstHitRatios[skillIndex(actor, yanyanluoIds.ultimate)]!);
      const hit = context.calculateDamage({ attack: actorStats.attack, defense: targetStats.defense,
        defenseIgnore: effectiveDefenseIgnore(actor), ratio, dmgFluctuation: Number(parameters.dmgFluctuation ?? .01),
        critChance: actorStats.crit, critDamage: actorStats.critDamage }, actor, target);
      return Array.from({ length: 5 }, () => ({ type: 'deal-damage' as const, source, targetId: target.unitId,
        amount: hit.amount, ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}), isCritical: hit.isCritical }));
    },
  };

  const definition: HeroDefinition = {
    id: yanyanluoIds.hero, skills: [basic, ultimate], aiCoverage: 'partial', mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['已接入蹂躏普攻倍率、扑朔迷离按等级概率/比例降低单次受击伤害、攻击命中时按10%基础概率并计入效果命中尝试变形一回合且封锁被动、烟之鬼3火（六级觉醒2火）五段攻击和按前五段暴击次数提高的全体终击。客户端只描述烟鬼“无法攻击”，当前映射为无法行动；烟之鬼按多段共用一次攻击序列、终击暴击累积与变形/被动封锁顺序仍需帧核。'],
    interceptIncomingDamage(state, _attacker, target, amount, _kind, interception): DamageInterception | undefined {
      if (target.heroId !== yanyanluoIds.hero || target.hp <= 0 || !passivesEnabled(target) || !interception) return;
      const index = skillIndex(target, yanyanluoIds.passive);
      if (interception.battle.random() >= damageReductionChances[index]!) return;
      return { amount: amount * (1 - damageReductionRates[index]!), effects: [] };
    },
    handlers: {
      hit: { priority: 40, handle(context, event) { return resolvePassiveAndCriticalHits(context, event); } },
      'attack-end': { priority: 40, handle(context, event) { return finishSmokeUltimate(context, event); } },
      'effect-resolution': { priority: 40, handle(_context, event) {
        if (event.type !== 'status-added' || event.instance.statusId !== yanyanluoIds.smokeGhoul || !event.source.unitId) return;
        const source = yanyanluoSource(yanyanluoIds.passive, event.source.unitId);
        return [{ type: 'add-status', source, targetId: event.targetId, parentEventId: event.eventId,
          instance: { instanceId: `${passiveSuppressionStatusId}:${event.targetId}:${event.eventId}`,
            statusId: passiveSuppressionStatusId, source, stacks: 1,
            duration: { kind: 'count', remaining: 1, owner: 'target-turn' } } }];
      } },
    },
    policy(context, unitId) {
      const actor = context.getUnit(unitId);
      if (!actor || actor.hp <= 0 || actor.unitKind === 'summon') return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      const cost = ultimateCosts[Math.min(5, Math.max(0, (actor.skillLevels?.[yanyanluoIds.ultimate] ?? actor.skillLevel) - 1))]!;
      if ((context.state.resources[actor.side]?.fire ?? 0) >= cost)
        return yanyanluoIntent(actor.unitId, yanyanluoIds.ultimate, [enemies[0]!.unitId], 'single', 'enemy');
      return yanyanluoIntent(actor.unitId, yanyanluoIds.basic, [enemies[0]!.unitId], 'single', 'enemy');
    },
  };
  registry.registerHero(definition);
}

function resolvePassiveAndCriticalHits(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage' || !event.source.unitId) return;
  const attacker = context.getUnit(event.source.unitId);
  const target = context.getUnit(event.targetId);
  if (!attacker || attacker.heroId !== yanyanluoIds.hero || !passivesEnabled(attacker) || !target || target.hp <= 0
    || target.side === attacker.side) return;
  const commands: EffectCommand[] = [];
  if (event.source.id === yanyanluoIds.ultimate && event.attackId !== undefined && (event.hitIndex ?? 0) <= 5) {
    const tracker = attacker.statuses.find(status => status.statusId === yanyanluoIds.critTracker
      && Number(status.values?.attackId) === event.attackId);
    const crits = Number(tracker?.values?.crits ?? 0) + (event.isCritical ? 1 : 0);
    if (tracker) commands.push({ type: 'remove-status-instances', source: tracker.source, targetId: attacker.unitId,
      instanceIds: [tracker.instanceId], reason: 'consumed', parentEventId: event.eventId });
    commands.push({ type: 'add-status', source: yanyanluoSource(yanyanluoIds.ultimate, attacker.unitId), targetId: attacker.unitId,
      instance: { instanceId: `${yanyanluoIds.critTracker}:${attacker.unitId}:${event.attackId}`,
        statusId: yanyanluoIds.critTracker, source: yanyanluoSource(yanyanluoIds.ultimate, attacker.unitId), stacks: 1,
        duration: { kind: 'count', remaining: 1, owner: 'event', event: 'attack-end' }, values: { attackId: event.attackId, crits } },
      parentEventId: event.eventId });
  }
  const transform = attemptControl(context, { attemptId: `${yanyanluoIds.smokeGhoul}:${event.eventId}`,
    source: yanyanluoSource(yanyanluoIds.passive, attacker.unitId), targetId: target.unitId,
    statusId: yanyanluoIds.smokeGhoul, controlType: '变形', baseChance: .1,
    duration: { kind: 'count', remaining: 1, owner: 'target-turn' }, parentEventId: event.eventId });
  if (transform) commands.push(transform);
  return commands.length ? commands : undefined;
}

function finishSmokeUltimate(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'attack-ended' || event.source.id !== yanyanluoIds.ultimate || !event.source.unitId || event.attackId === undefined) return;
  const attacker = context.getUnit(event.source.unitId);
  if (!attacker || attacker.heroId !== yanyanluoIds.hero || attacker.hp <= 0) return;
  const tracker = attacker.statuses.find(status => status.statusId === yanyanluoIds.critTracker
    && Number(status.values?.attackId) === event.attackId);
  const commands: EffectCommand[] = [];
  if (tracker) commands.push({ type: 'remove-status-instances', source: tracker.source, targetId: attacker.unitId,
    instanceIds: [tracker.instanceId], reason: 'consumed', parentEventId: event.eventId });
  const crits = Math.min(5, Math.max(0, Number(tracker?.values?.crits ?? 0)));
  const rank = skillIndex(attacker, yanyanluoIds.ultimate);
  const ratio = finalHitRatios[rank]! * (1 + crits * .3);
  const attack = context.getEffectiveStats(attacker.unitId) ?? attacker.stats;
  const source = yanyanluoSource(yanyanluoIds.ultimate, attacker.unitId);
  for (const target of context.getLivingUnits(attacker.side === 'blue' ? 'red' : 'blue')) {
    const defense = context.getEffectiveStats(target.unitId)?.defense ?? target.stats.defense;
    const hit = context.calculateDamage({ attack: attack.attack, defense, defenseIgnore: effectiveDefenseIgnore(attacker),
      ratio, dmgFluctuation: .01, critChance: attack.crit, critDamage: attack.critDamage }, attacker, target);
    commands.push({ type: 'deal-damage', source, targetId: target.unitId, amount: hit.amount,
      ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}), isCritical: hit.isCritical, parentEventId: event.eventId });
  }
  return commands;
}

function skillIndex(unit: Readonly<UnitState>, skillId: string): number {
  return Math.max(0, Math.min(4, (unit.skillLevels?.[skillId] ?? unit.skillLevel) - 1));
}
function yanyanluoIntent(actorId: string, skillId: string, targetIds: readonly string[], shape: ActionIntent['shape'],
  targetRelation: ActionIntent['targetRelation']): ActionIntent {
  return { actorId, skillId, targetIds, shape, targetRelation };
}
function yanyanluoSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
