import type { DamageInterception, HeroDefinition, SkillDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, StatusInstance, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { attemptDebuff } from '../mechanics/control';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import { createBasicAttackSkill } from './common-skills';
import type { ContentRegistry } from './registry';

export const jinyuhimeIds = { hero: 282, basic: '2821', passive: '2822', summon: '2823', goldfishBasic: '2824',
  goldfishCounter: '2825', goldfish: 'status.hero.282.goldfish', attackGrowth: 'status.hero.282.goldfish-attack',
  enemyActionCount: 'status.hero.282.enemy-action-count', silence: 'status.hero.282.goldfish-silence' } as const;

const basicRatios = [.8, .84, .88, .92, 1] as const;

/** 金鱼姬和金鱼：基础攻击、自动召唤、单体伤害分摊、协战及八次敌方行动后的群攻。 */
export function registerJinyuhime(registry: ContentRegistry): void {
  registry.registerStatus({ id: jinyuhimeIds.goldfish, mechanicsCoverage: 'partial', category: 'other', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'keep' });
  registry.registerStatus({ id: jinyuhimeIds.attackGrowth, mechanicsCoverage: 'partial', category: 'buff', dispellable: true,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace' });
  registry.registerStatus({ id: jinyuhimeIds.enemyActionCount, mechanicsCoverage: 'partial', category: 'other', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace' });
  registry.registerStatus({ id: jinyuhimeIds.silence, mechanicsCoverage: 'partial', category: 'control', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'refresh-duration', preventsSkill: true });

  const basicBase = createBasicAttackSkill(jinyuhimeIds.basic, basicRatios);
  const basic: SkillDefinition = { ...basicBase, execute(context, intent, parameters) {
    const commands = [...basicBase.execute(context, intent, parameters)];
    const owner = context.getUnit(intent.actorId);
    if (!commands.some(command => command.type === 'deal-damage') || !owner || owner.heroId !== jinyuhimeIds.hero
      || owner.unitKind === 'summon' || !passivesEnabled(owner)) return commands;
    const fish = findGoldfish(context, owner);
    if (!fish) return commands;
    const source = jinyuhimeSource(jinyuhimeIds.basic, owner.unitId);
    commands.push({ type: 'heal', source, targetId: fish.unitId, amount: fish.stats.hp * .1 });
    const previous = fish.statuses.find(status => status.statusId === jinyuhimeIds.attackGrowth
      && status.source.unitId === owner.unitId);
    const stacks = Math.min(5, (previous?.stacks ?? 0) + 1);
    commands.push({ type: 'add-status', source, targetId: fish.unitId, instance: {
      instanceId: `${jinyuhimeIds.attackGrowth}:${owner.unitId}:${fish.unitId}`, statusId: jinyuhimeIds.attackGrowth,
      source, stacks, duration: { kind: 'permanent' },
      modifiers: [{ stat: 'attack', operation: 'percent', amount: .2 * stacks }], values: { stacks },
    } });
    return commands;
  } };

  const summon: SkillDefinition = { id: jinyuhimeIds.summon, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 2 },
    target: 'self', targetRelation: 'ally', levels: [{ share: .4 }, { share: .4 }, { share: .4 }, { share: .4 }, { share: .4 }],
    canUse(state, actor) { return actor.heroId === jinyuhimeIds.hero && actor.unitKind !== 'summon'
      && !Object.values(state.units).some(unit => unit.hp > 0 && unit.unitKind === 'summon'
        && unit.heroId === jinyuhimeIds.hero && unit.summonedByUnitId === actor.unitId); },
    execute(context, intent) {
      const owner = context.getUnit(intent.actorId);
      if (!owner || owner.hp <= 0 || owner.unitKind === 'summon' || findGoldfish(context, owner)) return [];
      return [summonGoldfish(owner, context.getEffectiveStats(owner.unitId) ?? owner.stats,
        `summon:jinyuhime:${owner.unitId}:${context.state.counters.action + 1}`, jinyuhimeSource(jinyuhimeIds.summon, owner.unitId))];
    } };

  const goldfishBasic: SkillDefinition = { id: jinyuhimeIds.goldfishBasic, actionKind: 'basic', target: 'single', targetRelation: 'enemy',
    levels: [{ ratio: 1, pushChance: .5, pushAmount: 30 }], canUse(_state, actor) {
      return actor.heroId === jinyuhimeIds.hero && actor.unitKind === 'summon';
    }, execute(context, intent, parameters) {
      const fish = context.getUnit(intent.actorId);
      const target = context.getUnit(intent.targetIds[0] ?? '');
      if (!fish || fish.hp <= 0 || fish.unitKind !== 'summon' || !target || target.hp <= 0 || target.side === fish.side) return [];
      const attack = context.getEffectiveStats(fish.unitId) ?? fish.stats;
      const defense = context.getEffectiveStats(target.unitId) ?? target.stats;
      const hit = context.calculateDamage({ attack: attack.attack, defense: defense.defense,
        defenseIgnore: effectiveDefenseIgnore(fish), ratio: Number(parameters.ratio ?? 1), dmgFluctuation: .01,
        critChance: attack.crit, critDamage: attack.critDamage }, fish, target);
      const source = jinyuhimeSource(jinyuhimeIds.goldfishBasic, fish.summonedByUnitId ?? fish.unitId);
      const commands: EffectCommand[] = [{ type: 'deal-damage', source, targetId: target.unitId, amount: hit.amount,
        ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}), isCritical: hit.isCritical }];
      if (context.random() < Number(parameters.pushChance ?? .5)) commands.push({ type: 'change-action-gauge', source,
        targetId: target.unitId, amount: -Number(parameters.pushAmount ?? 30) });
      return commands;
    } };

  const definition: HeroDefinition = { id: jinyuhimeIds.hero, skills: [basic, summon, goldfishBasic],
    aiCoverage: 'partial', mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['已接入扇舞80%至100%倍率、金鱼在场时治疗其生命上限10%并按层提升攻击（每层20%、上限5层）、开场自动召唤金鱼、金鱼对单体攻击分摊40%（同次攻击首段触发）、金鱼普攻100%伤害及50%概率击退30%行动条、友方普攻后25%概率金鱼协战、敌方累计行动8次时金鱼群体攻击120%并各自25%概率沉默1回合。召唤物具体继承面板、技能状态更新后的触发边界、八次累计是否跨回合、御魂与薙魂的实际竞争顺序仍需录像核验。'],
    initialize(context, unitId) {
      const owner = context.getUnit(unitId);
      if (!owner || owner.heroId !== jinyuhimeIds.hero || owner.unitKind === 'summon' || !passivesEnabled(owner)) return [];
      const source = jinyuhimeSource(jinyuhimeIds.passive, unitId);
      const stats = context.getEffectiveStats(unitId) ?? owner.stats;
      const fishId = `summon:jinyuhime:${unitId}:opening`;
      return [{ type: 'add-status', source, targetId: unitId, instance: { instanceId: `${jinyuhimeIds.goldfish}:${unitId}`,
        statusId: jinyuhimeIds.goldfish, source, stacks: 1, duration: { kind: 'permanent' }, values: { fishId } } },
      summonGoldfish(owner, stats, fishId, source)];
    },
    policy(context, unitId) {
      const actor = context.getUnit(unitId);
      if (!actor || actor.hp <= 0) return undefined;
      if (actor.unitKind === 'summon' && actor.heroId === jinyuhimeIds.hero) {
        const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
        const target = enemies.slice().sort((a, b) => a.hp / Math.max(1, a.stats.hp) - b.hp / Math.max(1, b.stats.hp))[0];
        return target ? { actorId: actor.unitId, skillId: jinyuhimeIds.goldfishBasic, targetIds: [target.unitId],
          shape: 'single', targetRelation: 'enemy' } : undefined;
      }
      if (actor.unitKind === 'summon') return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      if (!findGoldfish(context, actor) && (context.state.resources[actor.side]?.fire ?? 0) >= 2)
        return { actorId: actor.unitId, skillId: jinyuhimeIds.summon, targetIds: [actor.unitId], shape: 'self', targetRelation: 'ally' };
      const target = enemies.slice().sort((a, b) => a.hp / Math.max(1, a.stats.hp) - b.hp / Math.max(1, b.stats.hp))[0]!;
      return { actorId: actor.unitId, skillId: jinyuhimeIds.basic, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
    },
    interceptIncomingDamage(state, attacker, target, amount, _kind, interception): DamageInterception | undefined {
      if (!attacker || attacker.side === target.side || target.side !== 'blue' && target.side !== 'red'
        || target.unitKind === 'summon' || interception?.attackShape !== 'single' || interception.hitIndex !== 1) return undefined;
      const owner = state.sides[target.side].map(id => state.units[id]).find(unit => unit?.heroId === jinyuhimeIds.hero
        && unit.hp > 0 && unit.unitKind !== 'summon' && passivesEnabled(unit) && findGoldfishInState(state, unit));
      const fish = owner && findGoldfishInState(state, owner);
      if (!owner || !fish) return undefined;
      const share = .4;
      const source = jinyuhimeSource(jinyuhimeIds.summon, owner.unitId);
      return { amount: amount * (1 - share), effects: [{ type: 'deal-damage', source, targetId: fish.unitId,
        amount: amount * share, precalculated: true, countsAsHit: false, suppressTargetPassiveTriggers: true }] };
    },
    handlers: {
      'attack-end': { priority: 43, handle(context, event) { return assistOnAllyBasic(context, event); } },
      'action-end': { priority: 43, handle(context, event) { return countEnemyActions(context, event); } },
    },
  };
  registry.registerHero(definition);
}

function assistOnAllyBasic(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'attack-ended' || event.actionKind !== 'basic' || !event.source.unitId || !event.targetHealthChanges?.length) return;
  const attacker = context.getUnit(event.source.unitId);
  if (!attacker || attacker.unitKind === 'summon') return;
  const target = event.targetHealthChanges.map(change => context.getUnit(change.targetId))
    .find(unit => unit && unit.hp > 0 && unit.side !== attacker.side);
  if (!target) return;
  return context.getLivingUnits(attacker.side).filter(unit => unit.heroId === jinyuhimeIds.hero && unit.unitKind !== 'summon'
    && passivesEnabled(unit)).flatMap(owner => {
      const fish = findGoldfish(context, owner);
      if (!fish || context.random() >= .25) return [];
      return [{ type: 'schedule-action' as const, source: jinyuhimeSource(jinyuhimeIds.passive, owner.unitId),
        scheduling: 'assist' as const, parentEventId: event.eventId,
        intent: { actorId: fish.unitId, skillId: jinyuhimeIds.goldfishBasic, targetIds: [target.unitId],
          shape: 'single' as const, targetRelation: 'enemy' as const, kind: 'passive' as const } }];
    });
}

function countEnemyActions(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'action-ended' || !event.source.unitId) return;
  const actor = context.getUnit(event.source.unitId);
  if (!actor || actor.unitKind === 'summon') return;
  const commands: EffectCommand[] = [];
  for (const owner of context.getLivingUnits('blue').concat(context.getLivingUnits('red')).filter(unit => unit.heroId === jinyuhimeIds.hero
    && unit.unitKind !== 'summon' && unit.side !== actor.side && passivesEnabled(unit))) {
    const fish = findGoldfish(context, owner);
    if (!fish) continue;
    const current = Number(fish.statuses.find(status => status.statusId === jinyuhimeIds.enemyActionCount)?.values?.count ?? 0) + 1;
    const source = jinyuhimeSource(jinyuhimeIds.passive, owner.unitId);
    commands.push({ type: 'add-status', source, targetId: fish.unitId, instance: { instanceId: `${jinyuhimeIds.enemyActionCount}:${fish.unitId}`,
      statusId: jinyuhimeIds.enemyActionCount, source, stacks: 1, duration: { kind: 'permanent' }, values: { count: current % 8 } },
      parentEventId: event.eventId });
    if (current % 8 !== 0) continue;
    const attack = context.getEffectiveStats(fish.unitId) ?? fish.stats;
    for (const target of context.getLivingUnits(actor.side)) {
      if (target.unitKind === 'summon') continue;
      const defense = context.getEffectiveStats(target.unitId) ?? target.stats;
      const hit = context.calculateDamage({ attack: attack.attack, defense: defense.defense,
        defenseIgnore: effectiveDefenseIgnore(fish), ratio: 1.2, dmgFluctuation: .01,
        critChance: attack.crit, critDamage: attack.critDamage }, fish, target);
      commands.push({ type: 'deal-damage', source: jinyuhimeSource(jinyuhimeIds.passive, owner.unitId), targetId: target.unitId,
        amount: hit.amount, ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}), isCritical: hit.isCritical,
        parentEventId: event.eventId });
      commands.push(...attemptDebuff(context, { source, targetId: target.unitId, statusId: jinyuhimeIds.silence,
        baseChance: .25, duration: { kind: 'count', remaining: 1, owner: 'target-turn' }, parentEventId: event.eventId }));
    }
  }
  return commands;
}

function summonGoldfish(owner: Readonly<UnitState>, stats: UnitState['stats'], unitId: string, source: SourceRef): EffectCommand {
  // Native summon skill row describes 48% HP, 100% attack and 100% speed inheritance.
  const hp = Math.max(1, stats.hp * .48);
  const fish: UnitState = { unitId, heroId: jinyuhimeIds.hero, displayName: '金鱼', unitKind: 'summon',
    summonedByUnitId: owner.unitId, skillLevel: owner.skillLevel, ...(owner.skillLevels ? { skillLevels: owner.skillLevels } : {}),
    side: owner.side, stats: { ...stats, hp, attack: stats.attack, speed: stats.speed, resist: 1 }, hp,
    shield: 0, actionGauge: 0, statuses: [], resources: {} };
  return { type: 'summon-unit', source, unit: fish };
}

function findGoldfish(context: BattleContext, owner: Readonly<UnitState>): UnitState | undefined {
  return context.getLivingUnits(owner.side).find(unit => unit.heroId === jinyuhimeIds.hero && unit.unitKind === 'summon'
    && unit.summonedByUnitId === owner.unitId && unit.displayName === '金鱼');
}
function findGoldfishInState(state: import('../core/types').BattleState, owner: Readonly<UnitState>): UnitState | undefined {
  return state.sides[owner.side].map(id => state.units[id]).find(unit => unit?.heroId === jinyuhimeIds.hero
    && unit.unitKind === 'summon' && unit.hp > 0 && unit.summonedByUnitId === owner.unitId && unit.displayName === '金鱼');
}
function jinyuhimeSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
