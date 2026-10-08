import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, EffectCommand, SourceRef, UnitState } from '../core/types';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import type { ContentRegistry } from './registry';

export const catManagerIds = {
  hero: 307,
  basic: '3071',
  ride: '3072',
  ultimate: '3073',
  rideStatus: 'status.hero.307.ride',
} as const;

const basicRatios = [.8, .84, .88, .92, 1] as const;
const ultimateRatios = [.42, .44, .46, .48, .5] as const;
const baseCatChance = .6;
const baseCatDamage = .4;
const baseGaugeReduction = 20;

export function registerCatManager(registry: ContentRegistry): void {
  registry.registerStatus({ id: catManagerIds.rideStatus, mechanicsCoverage: 'partial', category: 'buff',
    dispellable: false, sealable: false, durationOwner: 'source-turn', refreshPolicy: 'replace' });
  registry.registerHero(createCatManagerDefinition());
}

export function createCatManagerDefinition(): HeroDefinition {
  const basic: SkillDefinition = {
    id: catManagerIds.basic, actionKind: 'basic', target: 'single', targetRelation: 'enemy', useClientDamageData: true,
    levels: basicRatios.map(ratio => ({ ratio, catFireChance: baseCatChance, catDamageRatio: baseCatDamage,
      catGaugeReduction: baseGaugeReduction })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      const target = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || actor.hp <= 0 || !target || target.hp <= 0) return [];
      const ride = hasRide(actor);
      const source = catManagerSource(catManagerIds.basic, actor.unitId);
      const commands = [makeHit(context, actor, target, source, Number(parameters.ratio ?? basicRatios[0]))];
      appendCatEffects(context, actor, target, source, ride ? 2 : 1, parameters, commands);
      return commands;
    },
  };
  const ride: SkillDefinition = {
    id: catManagerIds.ride, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 2 },
    target: 'self', targetRelation: 'ally', levels: [{ speed: 20, resist: .4, duration: 2 }],
    canUse(_state, actor) { return !hasRide(actor); },
    execute(context, intent) {
      const actor = context.getUnit(intent.actorId);
      if (!actor || actor.hp <= 0) return [];
      const awake = actor.awakeFilter === 1;
      const source = catManagerSource(catManagerIds.ride, actor.unitId);
      return [{ type: 'add-status', source, targetId: actor.unitId, instance: {
        instanceId: `${catManagerIds.rideStatus}:${actor.unitId}`, statusId: catManagerIds.rideStatus,
        source, stacks: 1, duration: { kind: 'count', remaining: 2, owner: 'source-turn' },
        modifiers: [{ stat: 'speed', operation: 'flat', amount: 20 },
          ...(awake ? [{ stat: 'resist' as const, operation: 'percent' as const, amount: .4 }] : [])],
      } }];
    },
  };
  const ultimate: SkillDefinition = {
    id: catManagerIds.ultimate, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'single', targetRelation: 'enemy', useClientDamageData: true,
    levels: ultimateRatios.map(ratio => ({ ratio, hits: 5, catFireChance: baseCatChance,
      catDamageRatio: baseCatDamage, catGaugeReduction: baseGaugeReduction })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      const target = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || actor.hp <= 0 || !target || target.hp <= 0) return [];
      const source = catManagerSource(catManagerIds.ultimate, actor.unitId);
      const commands: EffectCommand[] = [];
      const callsPerHit = hasRide(actor) ? 2 : 1;
      const hits = Number(parameters.hits ?? 5);
      for (let index = 0; index < hits; index++) {
        commands.push(makeHit(context, actor, target, source, Number(parameters.ratio ?? ultimateRatios[0])));
        appendCatEffects(context, actor, target, source, callsPerHit, parameters, commands);
      }
      return commands;
    },
  };

  return {
    id: catManagerIds.hero, skills: [basic, ride, ultimate], aiCoverage: 'partial', mechanicsCoverage: 'partial',
    aiCoverageNotes: ['鬼火不少于3时对优先目标使用猫猫乱斗；否则未骑乘且鬼火不少于2时使用猫合战；其余普攻。客户端官方选招策略未完整提取。'],
    mechanicsCoverageNotes: ['已接入猫猫召来普攻倍率与黑猫减火/白猫追加40%伤害/茶茶击退20%行动条；猫合战消耗2火，骑乘2个自身回合并提高20速度，觉醒后追加40%效果抵抗；猫猫乱斗消耗3火、5段按等级倍率，骑乘时每段额外呼唤一只猫。猫种类抽选按三类等概率处理；召唤表现、满级技能行分支、猫效果的暴击/抵抗及多段鬼火顺序仍需帧核。'],
    policy(context, actorId) {
      const actor = context.getUnit(actorId);
      if (!actor || actor.hp <= 0 || actor.unitKind === 'summon') return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      const target = [...enemies].sort((left, right) => left.hp / Math.max(1, left.stats.hp)
        - right.hp / Math.max(1, right.stats.hp))[0]!;
      const fire = context.state.resources[actor.side]?.fire ?? actor.resources.fire ?? 0;
      const skillId = fire >= 3 ? catManagerIds.ultimate : fire >= 2 && !hasRide(actor) ? catManagerIds.ride : catManagerIds.basic;
      return { actorId, skillId, targetIds: skillId === catManagerIds.ride ? [actorId] : [target.unitId],
        shape: skillId === catManagerIds.ride ? 'self' : 'single', targetRelation: skillId === catManagerIds.ride ? 'ally' : 'enemy' };
    },
  };
}

function appendCatEffects(context: BattleContext, actor: Readonly<UnitState>, target: Readonly<UnitState>, source: SourceRef,
  count: number, parameters: Readonly<Record<string, number | boolean | string>>, commands: EffectCommand[]): void {
  const enemySide = target.side;
  let enemyFire = context.state.resources[enemySide]?.fire ?? target.resources.fire ?? 0;
  const stealFire = hasRide(actor);
  for (let index = 0; index < count; index++) {
    const cat = Math.floor(context.random() * 3);
    if (cat === 0) {
      if (context.random() >= Number(parameters.catFireChance ?? baseCatChance) || enemyFire <= 0) continue;
      enemyFire--;
      commands.push({ type: 'change-resource', source, side: enemySide, resourceId: 'fire', amount: -1 });
      if (stealFire) {
        commands.push({ type: 'change-resource', source, side: actor.side, resourceId: 'fire', amount: 1 });
      }
    } else if (cat === 1) {
      const extra = makeHit(context, actor, target, source, Number(parameters.catDamageRatio ?? baseCatDamage));
      commands.push(extra);
    } else {
      commands.push({ type: 'change-action-gauge', source, targetId: target.unitId,
        amount: -Number(parameters.catGaugeReduction ?? baseGaugeReduction) });
    }
  }
}

function makeHit(context: BattleContext, actor: Readonly<UnitState>, target: Readonly<UnitState>, source: SourceRef,
  ratio: number): EffectCommand {
  const attack = context.getEffectiveStats(actor.unitId) ?? actor.stats;
  const defense = context.getEffectiveStats(target.unitId)?.defense ?? target.stats.defense;
  const result = context.calculateDamage({ attack: attack.attack, defense, defenseIgnore: effectiveDefenseIgnore(actor), ratio,
    critChance: attack.crit, critDamage: attack.critDamage }, actor as UnitState, target as UnitState);
  return { type: 'deal-damage', source, targetId: target.unitId, amount: result.amount,
    ...(result.damageOptions ? { damageOptions: result.damageOptions } : {}),
    ...(result.isCritical ? { criticalBaseAmount: result.amount / Math.max(1, attack.critDamage) } : {}),
    isCritical: result.isCritical };
}

function hasRide(unit: Readonly<UnitState>): boolean {
  return unit.statuses.some(status => status.statusId === catManagerIds.rideStatus);
}

function catManagerSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
