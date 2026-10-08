import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, StatusInstance, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { effectiveDefenseIgnore, effectiveStats } from '../mechanics/stats';
import { createBasicAttackSkill } from './common-skills';
import type { ContentRegistry } from './registry';

export const inuyashaIds = {
  hero: 313,
  basic: '3131',
  counter: '3132',
  ultimate: '3133',
  wind: 'status.hero.313.wind-power',
  evolution: 'status.hero.313.tetsusaiga-evolution',
  dragonScaleCrit: 'status.hero.313.dragon-scale-critical-damage',
  maxHpReduction: 'status.hero.313.black-tetsusaiga-max-hp-reduction',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const ultimateRatios = [.4, .42, .44, .46, .5] as const;

export function registerInuyasha(registry: ContentRegistry): void {
  registry.registerStatus({ id: inuyashaIds.wind, mechanicsCoverage: 'partial', category: 'buff', dispellable: true,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'add-stack', stackScope: 'source-unit', maxStacks: 5 });
  registry.registerStatus({ id: inuyashaIds.evolution, mechanicsCoverage: 'partial', category: 'buff', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace' });
  registry.registerStatus({ id: inuyashaIds.dragonScaleCrit, mechanicsCoverage: 'partial', category: 'buff', dispellable: true,
    sealable: false, durationOwner: 'source-turn', refreshPolicy: 'add-stack', stackScope: 'source-unit', maxStacks: 7 });
  registry.registerStatus({ id: inuyashaIds.maxHpReduction, mechanicsCoverage: 'partial', category: 'debuff', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace' });
  registry.registerHero(createInuyashaDefinition());
}

export function createInuyashaDefinition(): HeroDefinition {
  const basic = createBasicAttackSkill(inuyashaIds.basic, basicRatios);
  const counter: SkillDefinition = {
    id: inuyashaIds.counter, actionKind: 'passive', target: 'single', targetRelation: 'enemy', levels: [{}],
    execute(context, intent) {
      const actor = context.getUnit(intent.actorId);
      const target = context.getUnit(intent.targetIds[0] ?? '');
      const actorStats = actor && context.getEffectiveStats(actor.unitId);
      const targetStats = target && context.getEffectiveStats(target.unitId);
      if (!actor || !target || !actorStats || !targetStats || target.hp <= 0) return [];
      const wind = actor.statuses.find(status => status.statusId === inuyashaIds.wind);
      const stacks = wind?.stacks ?? 0;
      const stage = evolutionStage(actor);
      const source = inuyashaSource(inuyashaIds.counter, actor.unitId);
      const defenseIgnore = stage >= 2 ? targetStats.defense * .4 : 0;
      const ratio = 1.76 * (1 + stacks * .1);
      const hit = context.calculateDamage({ attack: actorStats.attack, defense: targetStats.defense,
        defenseIgnore: effectiveDefenseIgnore(actor) + defenseIgnore, ratio,
        critChance: actorStats.crit, critDamage: actorStats.critDamage }, actor, target);
      const commands: EffectCommand[] = [];
      if (stage >= 3) commands.push({ type: 'dispel-statuses', source, targetId: target.unitId, maxCount: 1 });
      commands.push({ type: 'deal-damage', source, targetId: target.unitId, amount: hit.amount,
        ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}),
        ...(hit.isCritical ? { criticalBaseAmount: hit.amount / Math.max(1, actorStats.critDamage) } : {}),
        isCritical: hit.isCritical, ignoreShield: stage >= 1 });
      if (wind && stage < 4) commands.push({ type: 'remove-status-instances', source, targetId: actor.unitId,
        instanceIds: [wind.instanceId], reason: 'consumed' });
      if (stage < 4) commands.push(evolutionCommand(actor, stage + 1, source));
      return commands;
    },
  };
  const ultimate: SkillDefinition = {
    id: inuyashaIds.ultimate, resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'single', targetRelation: 'enemy', levels: ultimateRatios.map(ratio => ({ ratio, hitCount: 7, extraChance: .8 })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      const actorStats = actor && context.getEffectiveStats(actor.unitId);
      if (!actor || !actorStats) return [];
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (enemies.length === 0) return [];
      const ratio = Number(parameters.ratio ?? .4);
      const hitCount = Number(parameters.hitCount ?? 7);
      const extraChance = Number(parameters.extraChance ?? .8);
      const source = inuyashaSource(inuyashaIds.ultimate, actor.unitId);
      const commands: EffectCommand[] = [];
      for (let index = 0; index < hitCount; index += 1) {
        const primary = enemies[Math.floor(context.random() * enemies.length)]!;
        if (evolutionStage(actor) >= 3) commands.push({ type: 'dispel-statuses', source, targetId: primary.unitId, maxCount: 1 });
        commands.push(...attackOne(context, actor, actorStats, primary, source, ratio, evolutionStage(actor)));
        if (context.random() < extraChance) {
          const extra = enemies[Math.floor(context.random() * enemies.length)]!;
          if (evolutionStage(actor) >= 3) commands.push({ type: 'dispel-statuses', source, targetId: extra.unitId, maxCount: 1 });
          commands.push(...attackOne(context, actor, actorStats, extra, source, ratio, evolutionStage(actor)));
        }
      }
      return commands;
    },
  };

  return {
    id: inuyashaIds.hero,
    skills: [basic, counter, ultimate],
    aiCoverage: 'verified',
    mechanicsCoverage: 'verified',
    mechanicsCoverageNotes: ['按客户端3131逐级文本，所有技能等级下风之伤命中后均有10%概率获得风劲、每个回合结束固定获得1层；风劲提供速度/增伤并提高鬼火反击率和伤害。铁碎牙前三阶段反击消耗全部风劲并推进进化，最终漆黑铁碎牙保留风劲与逐层增伤、不再进化；各阶段无视护盾、部分防御和攻击前驱散均按客户端效果结算，漆黑伤害降低目标生命上限。铁碎牙大招按七段及80%追加概率随机选敌。专项回归覆盖各阶段、最终层数保留、驱散后即时暴伤、生命上限下限和风劲等级触发边界'],
    modifyCriticalDamage(attacker, _target, amount, criticalBaseAmount) {
      if (attacker?.heroId !== inuyashaIds.hero
        || !attacker.statuses.some(status => status.statusId === inuyashaIds.dragonScaleCrit)) return amount;
      return criticalBaseAmount * effectiveStats(attacker).critDamage;
    },
    policy(context, unitId): ActionIntent | undefined {
      const actor = context.getUnit(unitId);
      if (!actor || actor.hp <= 0 || actor.unitKind === 'summon') return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      const target = enemies.filter(enemy => enemy.hp / Math.max(1, enemy.stats.hp) < .3)
        .sort((left, right) => left.hp / Math.max(1, left.stats.hp) - right.hp / Math.max(1, right.stats.hp))[0]
        ?? enemies.slice().sort((left, right) => left.hp / Math.max(1, left.stats.hp)
        - right.hp / Math.max(1, right.stats.hp))[0]!;
      const skillId = (context.state.resources[actor.side]?.fire ?? 0) >= 3 ? inuyashaIds.ultimate : inuyashaIds.basic;
      return { actorId: unitId, skillId, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
    },
    handlers: {
      'resource-payment': { priority: 40, handle(context, event) { return counterOnEnemyFireSpend(context, event); } },
      'attack-end': { priority: 40, handle(context, event) { return gainWindOnBasic(context, event); } },
      'turn-end': { priority: 40, handle(context, event) { return gainWindAtTurnEnd(context, event); } },
      'effect-resolution': { priority: 40, handle(context, event) { return dragonScaleDispelBonus(context, event); } },
      hit: { priority: 40, handle(context, event) { return blackTetsusaigaMaxHpCut(context, event); } },
    },
  };
}

function counterOnEnemyFireSpend(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'resource-changed' || event.resourceId !== 'fire' || event.after >= event.before) return;
  const spender = event.source.unitId ? context.getUnit(event.source.unitId) : undefined;
  if (!spender) return;
  const opposingSide = spender.side === 'blue' ? 'red' : 'blue';
  const commands: EffectCommand[] = [];
  for (const actor of context.getLivingUnits(opposingSide)) {
    if (actor.heroId !== inuyashaIds.hero || !passivesEnabled(actor) || context.isUnitUnableToAct(actor.unitId)) continue;
    const stacks = actor.statuses.find(status => status.statusId === inuyashaIds.wind)?.stacks ?? 0;
    if (context.random() >= .1 + stacks * .16) continue;
    commands.push({ type: 'schedule-action', source: inuyashaSource(inuyashaIds.counter, actor.unitId), scheduling: 'counter',
      freeCast: true, parentEventId: event.eventId,
      intent: { actorId: actor.unitId, skillId: inuyashaIds.counter, targetIds: [spender.unitId], shape: 'single',
        targetRelation: 'enemy', kind: 'passive' } });
  }
  return commands;
}

function gainWindOnBasic(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'attack-ended' || event.actionKind !== 'basic' || !event.source.unitId
    || event.source.id !== inuyashaIds.basic) return;
  const actor = context.getUnit(event.source.unitId);
  if (!actor || actor.heroId !== inuyashaIds.hero || actor.hp <= 0 || context.random() >= .1) return;
  return [windCommand(actor, 1, inuyashaIds.basic)];
}

function gainWindAtTurnEnd(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-ended') return;
  const actor = context.getUnit(event.unitId);
  if (!actor || actor.heroId !== inuyashaIds.hero || actor.hp <= 0) return;
  return [windCommand(actor, 1, inuyashaIds.basic)];
}

function dragonScaleDispelBonus(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'status-removed' || ![inuyashaIds.counter, inuyashaIds.ultimate].includes(event.source.id as typeof inuyashaIds.counter)
    || event.reason !== 'dispelled'
    || !event.source.unitId) return;
  const actor = context.getUnit(event.source.unitId);
  if (!actor || actor.heroId !== inuyashaIds.hero || evolutionStage(actor) < 3) return;
  const source = inuyashaSource(inuyashaIds.counter, actor.unitId);
  return [{ type: 'add-status', source, targetId: actor.unitId, parentEventId: event.eventId, instance: {
    instanceId: `${inuyashaIds.dragonScaleCrit}:${actor.unitId}`, statusId: inuyashaIds.dragonScaleCrit,
    source, stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'source-turn' },
    modifiers: [{ stat: 'critDamage', operation: 'flat', amount: .1, perStack: true }],
  } }];
}

function blackTetsusaigaMaxHpCut(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage' || !event.source.unitId || event.suppressSourcePassiveTriggers) return;
  const actor = context.getUnit(event.source.unitId);
  if (!actor || actor.heroId !== inuyashaIds.hero || evolutionStage(actor) < 4 || !passivesEnabled(actor)) return;
  return [{ type: 'reduce-max-health', source: inuyashaSource(event.source.id, actor.unitId), targetId: event.targetId,
    amount: event.amount * .5, minimumRatio: .2, statusId: inuyashaIds.maxHpReduction, parentEventId: event.eventId }];
}

function attackOne(context: BattleContext, actor: Readonly<UnitState>, actorStats: UnitState['stats'],
  target: Readonly<UnitState>, source: SourceRef, ratio: number, stage = 0): EffectCommand[] {
  const targetStats = context.getEffectiveStats(target.unitId);
  if (!targetStats || target.hp <= 0) return [];
  const damage = context.calculateDamage({ attack: actorStats.attack, defense: targetStats.defense,
    defenseIgnore: effectiveDefenseIgnore(actor) + (stage >= 2 ? targetStats.defense * .4 : 0),
    ratio, critChance: actorStats.crit, critDamage: actorStats.critDamage }, actor, target);
  return [{ type: 'deal-damage', source, targetId: target.unitId, amount: damage.amount,
    ...(damage.damageOptions ? { damageOptions: damage.damageOptions } : {}),
    ...(damage.isCritical ? { criticalBaseAmount: damage.amount / Math.max(1, actorStats.critDamage) } : {}),
    isCritical: damage.isCritical, ignoreShield: stage >= 1 }];
}

function windCommand(actor: Readonly<UnitState>, stacks: number, sourceId: string): EffectCommand {
  const source = inuyashaSource(sourceId, actor.unitId);
  return { type: 'add-status', source, targetId: actor.unitId, instance: {
    instanceId: `${inuyashaIds.wind}:${actor.unitId}`, statusId: inuyashaIds.wind, source, stacks,
    duration: { kind: 'permanent' },
    modifiers: [{ stat: 'speed', operation: 'flat', amount: 10, perStack: true },
      { stat: 'damage', operation: 'percent', amount: .05, perStack: true }],
  } };
}

function evolutionCommand(actor: Readonly<UnitState>, stage: number, source: SourceRef): EffectCommand {
  return { type: 'add-status', source, targetId: actor.unitId, instance: {
    instanceId: `${inuyashaIds.evolution}:${actor.unitId}`, statusId: inuyashaIds.evolution, source, stacks: 1,
    duration: { kind: 'permanent' }, values: { stage: Math.min(4, stage) },
  } };
}

function evolutionStage(actor: Readonly<UnitState>): number {
  return Math.max(0, Math.min(4, Number(actor.statuses.find(status => status.statusId === inuyashaIds.evolution)?.values?.stage ?? 0)));
}

function inuyashaSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }

function skillLevel(unit: Readonly<UnitState>, skillId: string): number {
  return Math.max(1, Math.min(5, unit.skillLevels?.[skillId] ?? unit.skillLevel));
}
