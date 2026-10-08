import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, StatusInstance, UnitState } from '../core/types';
import { createBasicAttackSkill } from './common-skills';
import { attemptDebuff } from '../mechanics/control';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import { passivesEnabled } from '../core/passive-eligibility';
import type { ContentRegistry } from './registry';

export const ghostServantWhiteIds = {
  hero: 210,
  basic: '2101',
  spiritHunt: '2102',
  ultimate: '2103',
  impAttack: '21020',
  healingReduction: 'status.hero.210.healing-reduction',
  poison: 'status.hero.210.poison',
  deathMark: 'status.hero.210.death-mark',
  blockedRevive: 'status.hero.210.imp-occupancy',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.2] as const;
const ultimateHitRatios = [.32, .32, .32, .32, .32] as const;
const deathRatios = [1.58, 1.67, 1.74, 1.82, 1.82] as const;

export function registerGhostServantWhite(registry: ContentRegistry): void {
  registry.registerStatus({ id: ghostServantWhiteIds.healingReduction, mechanicsCoverage: 'partial', category: 'debuff',
    dispellable: true, sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerStatus({ id: ghostServantWhiteIds.poison, mechanicsCoverage: 'partial', category: 'debuff',
    dispellable: true, sealable: true, durationOwner: 'target-turn', refreshPolicy: 'add-stack',
    stackScope: 'source-unit', maxStacks: 20 });
  registry.registerStatus({ id: ghostServantWhiteIds.deathMark, mechanicsCoverage: 'partial', category: 'debuff',
    dispellable: true, sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerStatus({ id: ghostServantWhiteIds.blockedRevive, mechanicsCoverage: 'partial', category: 'other',
    dispellable: false, sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace', preventsRevive: true });
  registry.registerHero(createGhostServantWhiteDefinition());
}

export function createGhostServantWhiteDefinition(): HeroDefinition {
  const basicTemplate = createBasicAttackSkill(ghostServantWhiteIds.basic, basicRatios);
  const basic: SkillDefinition = { ...basicTemplate };
  const spiritHunt: SkillDefinition = {
    id: ghostServantWhiteIds.spiritHunt, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 1 },
    target: 'self', targetRelation: 'ally', levels: [{ hpRatio: .1, attackRatio: .5 }, { hpRatio: .15, attackRatio: .6 },
      { hpRatio: .2, attackRatio: .7 }, { hpRatio: .25, attackRatio: .8 }, { hpRatio: .3, attackRatio: .9 }],
    canUse(state, actor) { return actor.heroId === ghostServantWhiteIds.hero && defeatedEnemySlots(state, actor).length > 0; },
    execute(context, intent) {
      const actor = context.getUnit(intent.actorId);
      if (!actor || actor.hp <= 0) return [];
      return summonImps(context, actor);
    },
  };
  const ultimate: SkillDefinition = {
    id: ghostServantWhiteIds.ultimate, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'all-enemies', targetRelation: 'enemy', useClientDamageData: true,
    levels: [1, 2, 3, 4, 5].map(rank => ({ ratio: .32, deathRatio: deathRatios[rank - 1],
      deathTurns: rank === 5 ? 2 : 1 })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      if (!actor) return [];
      const stats = context.getEffectiveStats(actor.unitId) ?? actor.stats;
      const commands: EffectCommand[] = [];
      for (const targetId of intent.targetIds) {
        const target = context.getUnit(targetId);
        const targetStats = target && (context.getEffectiveStats(target.unitId) ?? target.stats);
        if (!target || target.hp <= 0 || !targetStats) continue;
        for (let hitIndex = 0; hitIndex < 3; hitIndex++) {
          const hit = context.calculateDamage({ attack: stats.attack, defense: targetStats.defense,
            defenseIgnore: effectiveDefenseIgnore(actor), ratio: Number(parameters.ratio ?? .32),
            critChance: stats.crit, critDamage: stats.critDamage }, actor, target);
          commands.push({ type: 'deal-damage', source: whiteSource(ghostServantWhiteIds.ultimate, actor.unitId),
            targetId: target.unitId, amount: hit.amount, ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}),
            isCritical: hit.isCritical });
        }
      }
      return commands;
    },
  };
  const impAttack: SkillDefinition = {
    id: ghostServantWhiteIds.impAttack, actionKind: 'skill', target: 'all-enemies', targetRelation: 'enemy',
    levels: [{ ratio: 1 }], canUse(_state, actor) {
      return actor.heroId === ghostServantWhiteIds.hero && actor.unitKind === 'summon' && actor.displayName === '白色小鬼';
    },
    execute(context, intent) {
      const imp = context.getUnit(intent.actorId);
      if (!imp || imp.unitKind !== 'summon') return [];
      const enemies = context.getLivingUnits(imp.side === 'blue' ? 'red' : 'blue');
      const commands: EffectCommand[] = enemies.map(target => ({ type: 'lose-life',
        source: whiteSource(ghostServantWhiteIds.impAttack, imp.unitId), targetId: target.unitId,
        amount: imp.stats.attack, lifeLossKind: 'indirect' }));
      commands.push({ type: 'lose-life', source: whiteSource(ghostServantWhiteIds.impAttack, imp.unitId),
        targetId: imp.unitId, amount: imp.hp });
      return commands;
    },
  };

  return {
    id: ghostServantWhiteIds.hero,
    skills: [basic, spiritHunt, ultimate, impAttack],
    aiCoverage: 'partial', mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['已按客户端技能数据接入活死人普攻减疗、魂狩敌方非召唤物阵亡推条与阵亡位白色小鬼、鬼手三段攻击/四级中毒/夺命回合末间接伤害；小鬼按技能等级继承属性、出手后牺牲，并给占位阵亡单位加禁止复活标记。召唤物敌我侧的阵位映射、鬼手伤害后中毒逐段叠层、毒伤防御扣除与复活解除占位时序仍需连续帧核验'],
    policy(context, unitId): ActionIntent | undefined {
      const actor = context.getUnit(unitId);
      if (!actor || actor.hp <= 0) return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      if (actor.unitKind === 'summon' && actor.displayName === '白色小鬼')
        return whiteIntent(actor, ghostServantWhiteIds.impAttack, enemies.map(enemy => enemy.unitId), 'all-enemies', 'enemy');
      const defeatedSlots = defeatedEnemySlots(context.state, actor);
      if (defeatedSlots.length && (context.state.resources[actor.side]?.fire ?? 0) >= 1)
        return whiteIntent(actor, ghostServantWhiteIds.spiritHunt, [actor.unitId], 'self', 'ally');
      if (enemies.length >= 2 && (context.state.resources[actor.side]?.fire ?? 0) >= 3)
        return whiteIntent(actor, ghostServantWhiteIds.ultimate, enemies.map(enemy => enemy.unitId), 'all-enemies', 'enemy');
      const target = enemies.slice().sort((a, b) => a.hp / Math.max(1, a.stats.hp) - b.hp / Math.max(1, b.stats.hp))[0]!;
      return whiteIntent(actor, ghostServantWhiteIds.basic, [target.unitId], 'single', 'enemy');
    },
    handlers: {
      hit: { priority: 35, handle(context, event) { return addWhitePoison(context, event); } },
      'unit-defeated': { priority: 35, handle(context, event) { return onUnitDefeated(context, event); } },
      'turn-end': { priority: 35, handle(context, event) { return tickDeathMark(context, event); } },
      'action-end': { priority: 35, handle(context, event) { return applyDeathMark(context, event); } },
    },
  };
}

function addWhitePoison(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage' || ![ghostServantWhiteIds.basic, ghostServantWhiteIds.ultimate].includes(event.source.id as typeof ghostServantWhiteIds.basic | typeof ghostServantWhiteIds.ultimate)
    || !event.source.unitId) return;
  const owner = context.getUnit(event.source.unitId);
  const target = context.getUnit(event.targetId);
  if (!owner || owner.heroId !== ghostServantWhiteIds.hero || !target || target.hp <= 0) return;
  const source = whiteSource(event.source.id, owner.unitId);
  if (event.source.id === ghostServantWhiteIds.basic) return attemptDebuff(context, { source, targetId: target.unitId,
    statusId: ghostServantWhiteIds.healingReduction, baseChance: 1,
    duration: { kind: 'count', remaining: 2, owner: 'target-turn' },
    modifiers: [{ stat: 'healingTaken', operation: 'percent', amount: -.4 }] });
  return attemptDebuff(context, { source, targetId: target.unitId, statusId: ghostServantWhiteIds.poison, baseChance: 1,
    duration: { kind: 'count', remaining: 1, owner: 'target-turn' }, stacks: 1, values: { poisonLevel: 4 },
    modifiers: [{ stat: 'speed', operation: 'percent', amount: -.1, perStack: true },
      { stat: 'defense', operation: 'flat', amount: -40, perStack: true }] });
}

function onUnitDefeated(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'unit-defeated') return;
  const defeated = context.getUnit(event.unitId);
  if (!defeated) return;
  if (defeated.unitKind === 'summon' && defeated.displayName === '白色小鬼') {
    const commands: EffectCommand[] = [];
    for (const unitId of context.state.sides[defeated.side === 'blue' ? 'red' : 'blue']) {
      const unit = context.getUnit(unitId);
      if (!unit) continue;
      const occupancy = unit.statuses.find(status => status.statusId === ghostServantWhiteIds.blockedRevive
        && status.values?.summonId === defeated.unitId);
      if (occupancy) commands.push({ type: 'remove-status-instances', source: whiteSource(ghostServantWhiteIds.spiritHunt,
        String(occupancy.values?.ownerUnitId ?? defeated.summonedByUnitId ?? 'system')), targetId: unit.unitId,
        instanceIds: [occupancy.instanceId], reason: 'consumed', parentEventId: event.eventId });
    }
    return commands;
  }
  if (defeated.unitKind === 'summon') return;
  const owners = context.getLivingUnits(defeated.side === 'blue' ? 'red' : 'blue')
    .filter(unit => unit.heroId === ghostServantWhiteIds.hero && passivesEnabled(unit));
  return owners.map(owner => ({ type: 'change-action-gauge' as const, source: whiteSource(ghostServantWhiteIds.spiritHunt, owner.unitId),
    targetId: owner.unitId, amount: 50, parentEventId: event.eventId }));
}

function applyDeathMark(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'action-ended' || event.skillId !== ghostServantWhiteIds.ultimate || !event.source.unitId || !event.intent) return;
  const owner = context.getUnit(event.source.unitId);
  if (!owner || owner.heroId !== ghostServantWhiteIds.hero) return;
  const rank = skillLevel(owner, ghostServantWhiteIds.ultimate);
  const ratio = deathRatios[rank - 1] ?? deathRatios[0];
  const turns = rank >= 5 ? 2 : 1;
  return event.intent.targetIds.flatMap(targetId => {
    const target = context.getUnit(targetId);
    if (!target || target.hp <= 0) return [];
    const source = whiteSource(ghostServantWhiteIds.ultimate, owner.unitId);
    return [{ type: 'add-status' as const, source, targetId: target.unitId, parentEventId: event.eventId,
      instance: { instanceId: `${ghostServantWhiteIds.deathMark}:${owner.unitId}:${target.unitId}`,
        statusId: ghostServantWhiteIds.deathMark, source, stacks: 1,
        duration: { kind: 'count' as const, remaining: turns, owner: 'target-turn' as const },
        values: { ratio, attack: (context.getEffectiveStats(owner.unitId) ?? owner.stats).attack } } }];
  });
}

function summonImps(context: BattleContext, owner: Readonly<UnitState>): EffectCommand[] {
  const slots = defeatedEnemySlots(context.state, owner);
  if (!slots.length) return [];
  const rank = skillLevel(owner, ghostServantWhiteIds.spiritHunt);
  const hpRatio = [.1, .15, .2, .25, .3][rank - 1]!;
  const attackRatio = [.5, .6, .7, .8, .9][rank - 1]!;
  const commands: EffectCommand[] = [];
  for (const [index, target] of slots.entries()) {
    const unitId = `${ghostServantWhiteIds.hero}-imp-${context.state.counters.action}-${index + 1}`;
    const stat = { ...owner.stats, hp: owner.stats.hp * hpRatio, attack: owner.stats.attack * attackRatio };
    const source = whiteSource(ghostServantWhiteIds.spiritHunt, owner.unitId);
    const status: StatusInstance = { instanceId: `${ghostServantWhiteIds.blockedRevive}:${target.unitId}:${unitId}`,
      statusId: ghostServantWhiteIds.blockedRevive, source, stacks: 1, duration: { kind: 'permanent' },
      values: { summonId: unitId, ownerUnitId: owner.unitId } };
    commands.push({ type: 'add-status', source, targetId: target.unitId, instance: status });
    commands.push({ type: 'summon-unit', source, unit: { unitId, heroId: ghostServantWhiteIds.hero, displayName: '白色小鬼',
      unitKind: 'summon', summonedByUnitId: owner.unitId, skillLevel: 1, side: owner.side, stats: stat, hp: stat.hp,
      shield: 0, actionGauge: 0, statuses: [], resources: {} } });
  }
  return commands;
}

function defeatedEnemySlots(state: BattleContext['state'], owner: Readonly<UnitState>): UnitState[] {
  const side = owner.side === 'blue' ? 'red' : 'blue';
  return state.sides[side].map(unitId => state.units[unitId]).filter((unit): unit is UnitState => Boolean(unit
    && unit.hp <= 0 && unit.unitKind !== 'summon'
    && !unit.statuses.some(status => status.statusId === ghostServantWhiteIds.blockedRevive)));
}

function tickDeathMark(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-ended') return;
  const target = context.getUnit(event.unitId);
  if (!target || target.hp <= 0) return;
  return target.statuses.filter(status => status.statusId === ghostServantWhiteIds.deathMark).flatMap(status => {
    const ownerId = status.source.unitId;
    const owner = ownerId ? context.getUnit(ownerId) : undefined;
    const ratio = Number(status.values?.ratio ?? deathRatios[0]);
    const attack = Number(status.values?.attack ?? owner?.stats.attack);
    if (!owner || owner.heroId !== ghostServantWhiteIds.hero || !Number.isFinite(ratio) || !Number.isFinite(attack)) return [];
    return [{ type: 'lose-life' as const, source: whiteSource(ghostServantWhiteIds.ultimate, owner.unitId), targetId: target.unitId,
      amount: attack * ratio, lifeLossKind: 'indirect' as const, parentEventId: event.eventId }];
  });
}

function whiteIntent(actor: Readonly<UnitState>, skillId: string, targets: readonly string[], shape: ActionIntent['shape'],
  relation: ActionIntent['targetRelation']): ActionIntent {
  return { actorId: actor.unitId, skillId, targetIds: targets, shape, targetRelation: relation };
}
function whiteSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
function skillLevel(unit: Readonly<UnitState>, skillId: string): number { return Math.max(1, Math.min(5, unit.skillLevels?.[skillId] ?? unit.skillLevel)); }
