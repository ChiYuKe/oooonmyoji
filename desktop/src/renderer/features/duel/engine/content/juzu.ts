import type { HeroDefinition, SkillDefinition, StatusDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, StatusInstance, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { attemptDebuff } from '../mechanics/control';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import { createBasicAttackSkill } from './common-skills';
import type { ContentRegistry } from './registry';

export const juzuIds = {
  hero: 301,
  basic: '3011',
  passive: '3012',
  meditationSkill: '3013',
  hitDown: 'status.hero.301.hit-down',
  beads: 'status.hero.301.beads',
  meditation: 'status.hero.301.meditation',
  effectResist: 'status.hero.301.meditation-resist',
  delayedGauge: 'status.hero.301.meditation-gauge',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const beadDamageRatios = [1.36, 1.43, 1.43, 1.5, 1.5] as const;
const beadPushChances = [.3, .3, .4, .4, .5] as const;
const cleanseHealing = [.03, .04, .04, .05, .05] as const;
const cleanseMaxCounts = [1, 1, 2, 2, 3] as const;

export function registerJuzu(registry: ContentRegistry): void {
  const statuses: StatusDefinition[] = [
    { id: juzuIds.hitDown, mechanicsCoverage: 'partial', category: 'debuff', dispellable: true, sealable: true,
      durationOwner: 'target-turn', refreshPolicy: 'replace' },
    { id: juzuIds.beads, mechanicsCoverage: 'partial', category: 'other', dispellable: false, sealable: false,
      durationOwner: 'permanent', refreshPolicy: 'replace', maxStacks: 6 },
    { id: juzuIds.meditation, mechanicsCoverage: 'partial', category: 'buff', dispellable: true, sealable: true,
      durationOwner: 'source-turn', refreshPolicy: 'replace' },
    { id: juzuIds.effectResist, mechanicsCoverage: 'partial', category: 'buff', dispellable: true, sealable: true,
      durationOwner: 'target-turn', refreshPolicy: 'replace' },
    { id: juzuIds.delayedGauge, mechanicsCoverage: 'partial', category: 'other', dispellable: false, sealable: false,
      durationOwner: 'target-turn', refreshPolicy: 'replace' },
  ];
  for (const status of statuses) registry.registerStatus(status);
  registry.registerHero(createJuzuDefinition());
}

export function createJuzuDefinition(): HeroDefinition {
  const basic = createBasicAttackSkill(juzuIds.basic, basicRatios);
  const meditation: SkillDefinition = {
    id: juzuIds.meditationSkill,
    actionKind: 'skill',
    resourceCost: { resourceId: 'fire', amount: 2 },
    target: 'self',
    targetRelation: 'ally',
    levels: cleanseHealing.map((healRatio, index) => ({ healRatio, maxCleanses: cleanseMaxCounts[index]! })),
    canUse(_state, actor) { return actor.heroId === juzuIds.hero && actor.hp > 0
      && !actor.statuses.some(status => status.statusId === juzuIds.meditation); },
    execute(context, intent) {
      const actor = context.getUnit(intent.actorId);
      if (!actor || actor.heroId !== juzuIds.hero || actor.hp <= 0) return [];
      const source = juzuSource(juzuIds.meditationSkill, actor.unitId);
      return [{ type: 'add-status', source, targetId: actor.unitId, instance: {
        instanceId: `${juzuIds.meditation}:${actor.unitId}`, statusId: juzuIds.meditation, source, stacks: 1,
        duration: { kind: 'count', remaining: 2, owner: 'source-turn' },
      } }];
    },
  };
  return {
    id: juzuIds.hero,
    skills: [basic, meditation],
    aiCoverage: 'partial',
    mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['已按主线客户端技能表接入普攻命中降低效果、敌方行动累积6颗佛珠后的群体攻击及等级推条率、禅意2火/2回合、友方回合前概率驱散/治疗/回合后拉条或未驱散时增加效果抵抗。数珠分支表中的醒目筛选变体、具体回合边界及驱散成功率无可用帧图核验；目标选取与AI策略仍为简化实现。'],
    handlers: {
      hit: { priority: 56, handle(context, event) { return applyHitDown(context, event); } },
      'action-end': { priority: 56, handle(context, event) { return gainBeadAfterEnemyAction(context, event); } },
      'turn-start': { priority: 56, handle(context, event) { return meditateBeforeAllyTurn(context, event); } },
      'turn-end': { priority: 56, handle(context, event) { return finishMeditationTurn(context, event); } },
    },
    policy(context, unitId) {
      const actor = context.getUnit(unitId);
      if (!actor || actor.heroId !== juzuIds.hero || actor.hp <= 0) return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      const beads = actor.statuses.find(status => status.statusId === juzuIds.beads)?.stacks ?? 0;
      const meditating = actor.statuses.some(status => status.statusId === juzuIds.meditation);
      const fire = context.state.resources[actor.side]?.fire ?? 0;
      if (!meditating && fire >= 2 && beads >= 2) return juzuIntent(actor.unitId, juzuIds.meditationSkill, [actor.unitId], 'self', 'ally');
      const target = enemies.slice().sort((a, b) => a.hp / Math.max(1, a.stats.hp) - b.hp / Math.max(1, b.stats.hp))[0]!;
      return juzuIntent(actor.unitId, juzuIds.basic, [target.unitId], 'single', 'enemy');
    },
  };
}

function applyHitDown(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage' || event.source.id !== juzuIds.basic || !event.source.unitId) return;
  const actor = context.getUnit(event.source.unitId);
  const target = context.getUnit(event.targetId);
  if (!actor || actor.heroId !== juzuIds.hero || actor.hp <= 0 || !target || target.hp <= 0) return;
  const source = juzuSource(juzuIds.basic, actor.unitId);
  return attemptDebuff(context, { source, targetId: target.unitId, statusId: juzuIds.hitDown, baseChance: 1,
    duration: { kind: 'count', remaining: 2, owner: 'target-turn' },
    modifiers: [{ stat: 'hit', operation: 'flat', amount: -.1 }], parentEventId: event.eventId });
}

function gainBeadAfterEnemyAction(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'action-ended' || !event.source.unitId) return;
  const actingUnit = context.getUnit(event.source.unitId);
  if (!actingUnit) return;
  const commands: EffectCommand[] = [];
  for (const juzu of livingJuzu(context, actingUnit.side === 'blue' ? 'red' : 'blue')) {
    if (!passivesEnabled(juzu) || juzu.statuses.some(status => status.statusId === juzuIds.meditation)) continue;
    const current = juzu.statuses.find(status => status.statusId === juzuIds.beads)?.stacks ?? 0;
    const next = Math.min(6, current + 1);
    const source = juzuSource(juzuIds.passive, juzu.unitId);
    commands.push({ type: 'add-status', source, targetId: juzu.unitId, parentEventId: event.eventId,
      instance: { instanceId: `${juzuIds.beads}:${juzu.unitId}`, statusId: juzuIds.beads, source, stacks: next,
        duration: { kind: 'permanent' } } });
    if (next < 6) continue;
    commands.push({ type: 'remove-status-instances', source, targetId: juzu.unitId,
      instanceIds: [`${juzuIds.beads}:${juzu.unitId}`], reason: 'consumed', parentEventId: event.eventId });
    const attack = context.getEffectiveStats(juzu.unitId) ?? juzu.stats;
    const rank = skillRank(juzu, juzuIds.passive);
    for (const target of context.getLivingUnits(actingUnit.side)) {
      const defense = context.getEffectiveStats(target.unitId) ?? target.stats;
      const hit = context.calculateDamage({ attack: attack.attack, defense: defense.defense,
        defenseIgnore: effectiveDefenseIgnore(juzu), ratio: beadDamageRatios[rank - 1]!,
        critChance: attack.crit, critDamage: attack.critDamage }, juzu, target);
      commands.push({ type: 'deal-damage', source, targetId: target.unitId, amount: hit.amount,
        ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}),
        ...(hit.isCritical ? { criticalBaseAmount: hit.amount / Math.max(1, attack.critDamage) } : {}),
        isCritical: hit.isCritical, parentEventId: event.eventId });
      if (context.random() < beadPushChances[rank - 1]!) commands.push({ type: 'change-action-gauge', source,
        targetId: target.unitId, amount: -30, parentEventId: event.eventId });
    }
  }
  return commands;
}

function meditateBeforeAllyTurn(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-started') return;
  const target = context.getUnit(event.unitId);
  if (!target || target.hp <= 0) return;
  const commands: EffectCommand[] = [];
  for (const juzu of livingJuzu(context, target.side)) {
    if (!passivesEnabled(juzu)) continue;
    const meditation = juzu.statuses.find(status => status.statusId === juzuIds.meditation);
    if (!meditation) continue;
    const source = juzuSource(juzuIds.meditationSkill, juzu.unitId);
    let beads = juzu.statuses.find(status => status.statusId === juzuIds.beads)?.stacks ?? 0;
    if (beads === 0) {
      beads = 1;
      commands.push(beadCommand(juzu, 1, source, event.eventId));
    }
    const chance = Math.min(1, .4 + beads * .1);
    const success = context.random() < chance;
    const removable = target.statuses.filter(status => {
      const category = context.getStatusCategory(status.statusId);
      return context.isStatusDispellable(status.statusId) && (category === 'debuff' || category === 'control');
    }).slice(0, cleanseMaxCounts[skillRank(juzu, juzuIds.meditationSkill) - 1]!);
    if (!success || removable.length === 0) {
      commands.push({ type: 'add-status', source, targetId: target.unitId, parentEventId: event.eventId, instance: {
        instanceId: `${juzuIds.effectResist}:${juzu.unitId}:${target.unitId}`, statusId: juzuIds.effectResist, source,
        stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' },
        modifiers: [{ stat: 'resist', operation: 'flat', amount: .4 }],
      } });
      continue;
    }
    commands.push({ type: 'dispel-statuses', source, targetId: target.unitId,
      instanceIds: removable.map(status => status.instanceId), parentEventId: event.eventId });
    commands.push({ type: 'heal', source, targetId: target.unitId,
      amount: target.stats.hp * cleanseHealing[skillRank(juzu, juzuIds.meditationSkill) - 1]! * removable.length,
      parentEventId: event.eventId });
    commands.push(beadCommand(juzu, Math.max(0, beads - 1), source, event.eventId));
    commands.push({ type: 'add-status', source, targetId: target.unitId, parentEventId: event.eventId, instance: {
      instanceId: `${juzuIds.delayedGauge}:${juzu.unitId}:${target.unitId}`, statusId: juzuIds.delayedGauge, source,
      stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' }, values: { amount: 30 },
    } });
  }
  return commands;
}

function finishMeditationTurn(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-ended') return;
  const target = context.getUnit(event.unitId);
  if (!target) return;
  return target.statuses.filter(status => status.statusId === juzuIds.delayedGauge).map(status => ({
    type: 'change-action-gauge' as const, source: status.source, targetId: target.unitId,
    amount: Number(status.values?.amount ?? 30), parentEventId: event.eventId,
  }));
}

function beadCommand(juzu: Readonly<UnitState>, stacks: number, source: SourceRef, parentEventId: string): EffectCommand {
  const beadSource = juzuSource(juzuIds.passive, juzu.unitId);
  return stacks > 0 ? { type: 'add-status', source: beadSource, targetId: juzu.unitId, parentEventId, instance: {
    instanceId: `${juzuIds.beads}:${juzu.unitId}`, statusId: juzuIds.beads, source: beadSource, stacks, duration: { kind: 'permanent' },
  } } : { type: 'remove-status-instances', source, targetId: juzu.unitId,
    instanceIds: [`${juzuIds.beads}:${juzu.unitId}`], reason: 'consumed', parentEventId };
}

function livingJuzu(context: BattleContext, side: UnitState['side']): UnitState[] {
  return context.getLivingUnits(side).filter(unit => unit.heroId === juzuIds.hero && unit.unitKind !== 'summon');
}

function skillRank(unit: Readonly<UnitState>, skillId: string): number {
  return Math.max(1, Math.min(5, unit.skillLevels?.[skillId] ?? unit.skillLevel));
}

function juzuIntent(actorId: string, skillId: string, targetIds: readonly string[], shape: ActionIntent['shape'], targetRelation: NonNullable<ActionIntent['targetRelation']>): ActionIntent {
  return { actorId, skillId, targetIds, shape, targetRelation };
}

function juzuSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
