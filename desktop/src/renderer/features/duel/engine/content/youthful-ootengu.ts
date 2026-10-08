import type { HeroDefinition, SkillDefinition, StatusDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import { battleSkillRow, skillNumber } from '../../../../../shared/game-skill-data';
import type { ContentRegistry } from './registry';

export const youthfulOotenguIds = {
  hero: 315,
  basic: '3151',
  passive: '3152',
  ultimate: '3153',
  multiHitSpeed: 'status.hero.315.young-feather-speed',
  chasingWind: 'status.hero.315.chasing-wind',
  receivedHitCounter: 'status.hero.315.received-hit-counter',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const ultimateRatios = [.4, .42, .44, .5, .5] as const;

export function registerYouthfulOotengu(registry: ContentRegistry): void {
  const statuses: StatusDefinition[] = [
    { id: youthfulOotenguIds.multiHitSpeed, mechanicsCoverage: 'partial', category: 'buff', dispellable: true,
      sealable: true, durationOwner: 'target-turn', refreshPolicy: 'refresh-duration' },
    { id: youthfulOotenguIds.chasingWind, mechanicsCoverage: 'partial', category: 'mark', dispellable: false,
      sealable: false, durationOwner: 'permanent', refreshPolicy: 'add-stack', stackScope: 'source-unit', maxStacks: 80 },
    { id: youthfulOotenguIds.receivedHitCounter, mechanicsCoverage: 'partial', category: 'other', dispellable: false,
      sealable: false, durationOwner: 'permanent', refreshPolicy: 'add-stack', stackScope: 'source-unit', maxStacks: 2 },
  ];
  statuses.forEach(status => registry.registerStatus(status));
  registry.registerHero(createYouthfulOotenguDefinition());
}

export function createYouthfulOotenguDefinition(): HeroDefinition {
  const basic: SkillDefinition = {
    id: youthfulOotenguIds.basic, actionKind: 'basic', target: 'single', targetRelation: 'enemy',
    levels: basicRatios.map(ratio => ({ ratio })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      const target = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || actor.heroId !== youthfulOotenguIds.hero || actor.hp <= 0 || !target || target.hp <= 0 || target.side === actor.side) return [];
      const ratio = skillNumber(skillRow(actor, youthfulOotenguIds.basic), 'addDmg')
        ?? Number(parameters.ratio ?? basicRatios[skillRank(actor, youthfulOotenguIds.basic) - 1]);
      return [damageCommand(context, actor, target, ootenguSource(youthfulOotenguIds.basic, actor.unitId), ratio)];
    },
  };

  const ultimate: SkillDefinition = {
    id: youthfulOotenguIds.ultimate, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'single', targetRelation: 'enemy', levels: ultimateRatios.map(ratio => ({ ratio, baseHits: 5, splitLimit: 2 })),
    resolveResourceCost(_state, actor) {
      if (!passivesEnabled(actor)) return { resourceId: 'fire', amount: 3 };
      const stacks = actor.statuses.filter(status => status.statusId === youthfulOotenguIds.chasingWind)
        .reduce((total, status) => total + status.stacks, 0);
      return { resourceId: 'fire', amount: Math.max(1, 3 - Math.floor(stacks / 40)) };
    },
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      const primary = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || actor.heroId !== youthfulOotenguIds.hero || actor.hp <= 0 || !primary || primary.hp <= 0
        || primary.side === actor.side) return [];
      const row = skillRow(actor, youthfulOotenguIds.ultimate);
      const ratio = skillNumber(row, 'addDmg') ?? Number(parameters.ratio ?? ultimateRatios[skillRank(actor, youthfulOotenguIds.ultimate) - 1]);
      const baseHits = Math.max(1, Math.floor(skillNumber(row, 'param1') ?? Number(parameters.baseHits ?? 5)));
      const splitLimit = Math.max(0, Math.floor(skillNumber(row, 'param2') ?? Number(parameters.splitLimit ?? 2)));
      const attackIncrease = Math.max(0, Math.floor(skillNumber(row, 'param3') ?? 0));
      const attackIncreaseCap = Math.max(0, Math.floor(skillNumber(row, 'param4') ?? 0));
      const enemySide = oppositeSide(actor.side);
      const enemies = context.getLivingUnits(enemySide);
      const nonSummonDeaths = context.state.sides[enemySide].map(id => context.getUnit(id))
        .filter((unit): unit is UnitState => Boolean(unit && unit.hp <= 0 && unit.unitKind !== 'summon')).length;
      const addedHits = attackIncrease > 0 && attackIncreaseCap > 0
        ? Math.min(attackIncreaseCap, nonSummonDeaths * attackIncrease) : 0;
      const offense = context.getEffectiveStats(actor.unitId) ?? actor.stats;
      const counts = new Map<string, number>();
      const commands: EffectCommand[] = [];
      const count = baseHits + addedHits;
      for (let index = 0; index < count; index++) {
        appendHit(context, actor, primary, offense, youthfulOotenguIds.ultimate, ratio, counts, commands);
        const branches = enemies.filter(enemy => enemy.unitId !== primary.unitId);
        const branchCount = Math.min(splitLimit, branches.length);
        for (let branch = 0; branch < branchCount; branch++) {
          const choice = Math.min(branches.length - 1, Math.floor(context.random() * branches.length));
          const target = branches.splice(choice, 1)[0];
          if (target) appendHit(context, actor, target, offense, youthfulOotenguIds.ultimate, ratio, counts, commands);
        }
      }
      return commands;
    },
  };

  return {
    id: youthfulOotenguIds.hero, skills: [basic, ultimate], aiCoverage: 'partial', mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['风缠按等级造成100%至125%伤害；羽刃之风3火，5段主风刃、每段按其他存活敌方数量至多分裂2个随机小风刃，伤害按同一技能对相同目标的重复命中逐次提高10%。每有1名已阵亡的非召唤敌方增加2段主风刃，最多4段；造成伤害逐次获得逐风，最多80层、每层加1速度且每40层降低1火；承受多段攻击获得2回合速度提升已接入。准确的随机分裂抽样、重复伤害增幅口径与实战技能选择仍待帧核。'],
    policy(context, unitId): ActionIntent | undefined {
      const actor = context.getUnit(unitId);
      if (!actor || actor.hp <= 0 || actor.unitKind === 'summon') return undefined;
      const enemies = context.getLivingUnits(oppositeSide(actor.side));
      if (!enemies.length) return undefined;
      const target = enemies.slice().sort((left, right) => left.hp / Math.max(1, left.stats.hp)
        - right.hp / Math.max(1, right.stats.hp))[0]!;
      const stacks = passivesEnabled(actor) ? actor.statuses.filter(status => status.statusId === youthfulOotenguIds.chasingWind)
        .reduce((total, status) => total + status.stacks, 0) : 0;
      const fireCost = Math.max(1, 3 - Math.floor(stacks / 40));
      const skillId = (context.state.resources[actor.side]?.fire ?? 0) >= fireCost
        ? youthfulOotenguIds.ultimate : youthfulOotenguIds.basic;
      return { actorId: unitId, skillId, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
    },
    handlers: {
      hit: { priority: 47, handle(context, event) { return gainChasingWind(context, event); } },
      'attack-end': { priority: 47, handle(context, event) { return speedOnMultiHit(context, event); } },
    },
  };
}

function gainChasingWind(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage') return;
  const commands: EffectCommand[] = [];
  if (event.source.unitId && event.amount > 0) {
    const attacker = context.getUnit(event.source.unitId);
    if (attacker?.heroId === youthfulOotenguIds.hero && passivesEnabled(attacker)) {
      const stacks = attacker.statuses.filter(status => status.statusId === youthfulOotenguIds.chasingWind)
        .reduce((total, status) => total + status.stacks, 0);
      if (stacks < 80) {
        const source = ootenguSource(youthfulOotenguIds.passive, attacker.unitId);
        commands.push({ type: 'add-status', source, targetId: attacker.unitId, parentEventId: event.eventId, instance: {
          instanceId: `${youthfulOotenguIds.chasingWind}:${attacker.unitId}`, statusId: youthfulOotenguIds.chasingWind,
          source, stacks: 1, duration: { kind: 'permanent' },
          modifiers: [{ stat: 'speed', operation: 'flat', amount: 1, perStack: true }],
        } });
      }
    }
  }
  const target = context.getUnit(event.targetId);
  const sourceUnit = event.source.unitId ? context.getUnit(event.source.unitId) : undefined;
  if (target?.heroId === youthfulOotenguIds.hero && passivesEnabled(target) && !event.suppressTargetPassiveTriggers
    && sourceUnit && sourceUnit.side !== target.side && event.attackId !== undefined) {
    const source = ootenguSource(youthfulOotenguIds.passive, target.unitId);
    commands.push({ type: 'add-status', source, targetId: target.unitId, parentEventId: event.eventId, instance: {
      instanceId: `${youthfulOotenguIds.receivedHitCounter}:${target.unitId}:${event.attackId}`,
      statusId: youthfulOotenguIds.receivedHitCounter, source, stacks: 1, duration: { kind: 'permanent' },
      values: { attackId: event.attackId },
    } });
  }
  return commands.length ? commands : undefined;
}

function speedOnMultiHit(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'attack-ended' || event.attackId === undefined || !event.targetHealthChanges?.length) return;
  const attacker = event.source.unitId ? context.getUnit(event.source.unitId) : undefined;
  if (!attacker) return;
  const commands: EffectCommand[] = [];
  for (const change of event.targetHealthChanges) {
    const target = context.getUnit(change.targetId);
    if (!target || target.heroId !== youthfulOotenguIds.hero || !passivesEnabled(target) || target.side === attacker.side) continue;
    const source = ootenguSource(youthfulOotenguIds.passive, target.unitId);
    const hitCounter = target.statuses.find(status => status.statusId === youthfulOotenguIds.receivedHitCounter
      && Number(status.values?.attackId) === event.attackId);
    if (hitCounter && hitCounter.stacks >= 2 && !event.suppressTargetPassiveTriggers) {
      commands.push({ type: 'add-status', source, targetId: target.unitId, parentEventId: event.eventId, instance: {
        instanceId: `${youthfulOotenguIds.multiHitSpeed}:${target.unitId}`, statusId: youthfulOotenguIds.multiHitSpeed,
        source, stacks: 1, duration: { kind: 'count', remaining: 2, owner: 'target-turn' },
        modifiers: [{ stat: 'speed', operation: 'percent', amount: 1 }],
      } });
    }
    if (hitCounter) commands.push({ type: 'remove-status-instances', source, targetId: target.unitId,
      instanceIds: [hitCounter.instanceId], reason: 'consumed', parentEventId: event.eventId });
  }
  return commands;
}

function appendHit(context: BattleContext, actor: Readonly<UnitState>, target: Readonly<UnitState>, offense: UnitState['stats'],
  skillId: string, baseRatio: number, counts: Map<string, number>, commands: EffectCommand[]): void {
  const targetHits = counts.get(target.unitId) ?? 0;
  const ratio = baseRatio * (1 + targetHits * .1);
  commands.push(damageCommand(context, actor, target, ootenguSource(skillId, actor.unitId), ratio, offense));
  counts.set(target.unitId, targetHits + 1);
}

function damageCommand(context: BattleContext, actor: Readonly<UnitState>, target: Readonly<UnitState>, source: SourceRef,
  ratio: number, offense = context.getEffectiveStats(actor.unitId) ?? actor.stats): EffectCommand {
  const defense = context.getEffectiveStats(target.unitId) ?? target.stats;
  const hit = context.calculateDamage({ attack: offense.attack, defense: defense.defense,
    defenseIgnore: effectiveDefenseIgnore(actor), ratio, critChance: offense.crit, critDamage: offense.critDamage }, actor, target);
  return { type: 'deal-damage', source, targetId: target.unitId, amount: hit.amount,
    ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}), isCritical: hit.isCritical,
    ...(hit.isCritical ? { criticalBaseAmount: hit.amount / Math.max(1, offense.critDamage) } : {}) };
}

function skillRow(actor: Readonly<UnitState>, skillId: string) {
  return battleSkillRow(skillId, skillRank(actor, skillId), actor.awakeFilter,
    actor.unitKind === 'monster' || actor.unitKind === 'summon');
}

function skillRank(actor: Readonly<UnitState>, skillId: string): number {
  return Math.max(1, Math.min(5, actor.skillLevels?.[skillId] ?? actor.skillLevel));
}

function oppositeSide(side: UnitState['side']): UnitState['side'] { return side === 'blue' ? 'red' : 'blue'; }
function ootenguSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
