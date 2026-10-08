import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, StatusInstance, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import type { ContentRegistry } from './registry';

export const twoMouthGirlIds = {
  hero: 263,
  basic: '2631',
  bullets: '2632',
  ultimate: '2633',
  bulletStatus: 'status.hero.263.bullet-mark',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.2] as const;
const ultimateRatios = [.51, .54, .57, .6, .63] as const;
const initialBullets = 4;
const maxBullets = 6;

export function registerTwoMouthGirl(registry: ContentRegistry): void {
  registry.registerStatus({ id: twoMouthGirlIds.bulletStatus, mechanicsCoverage: 'partial', category: 'buff',
    dispellable: false, sealable: false, durationOwner: 'permanent', refreshPolicy: 'add-stack', maxStacks: maxBullets,
    stackScope: 'source-unit' });
  registry.registerHero(createTwoMouthGirlDefinition());
}

export function createTwoMouthGirlDefinition(): HeroDefinition {
  const basic = createDamageSkill(twoMouthGirlIds.basic, 'basic', basicRatios);
  const ultimate: SkillDefinition = {
    id: twoMouthGirlIds.ultimate, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'all-enemies', targetRelation: 'enemy', levels: ultimateRatios.map(ratio => ({ ratio })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      if (!actor || actor.hp <= 0) return [];
      const bullets = actor.statuses.filter(status => status.statusId === twoMouthGirlIds.bulletStatus)
        .reduce((sum, status) => sum + status.stacks, 0);
      const targets = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (targets.length === 0) return [];
      const source = twoMouthSource(twoMouthGirlIds.ultimate, actor.unitId);
      const commands: EffectCommand[] = [];
      const bulletInstances = actor.statuses.filter(status => status.statusId === twoMouthGirlIds.bulletStatus)
        .map(status => status.instanceId);
      if (bulletInstances.length) commands.push({ type: 'remove-status-instances', source, targetId: actor.unitId,
        instanceIds: bulletInstances, reason: 'consumed' });
      const ratio = Number(parameters.ratio ?? ultimateRatios[0]);
      for (let shot = 0; shot < 2 + bullets; shot++) {
        const target = targets[Math.min(targets.length - 1, Math.floor(context.random() * targets.length))]!;
        commands.push(twoMouthDamage(context, actor, target, source, ratio));
      }
      return commands;
    },
  };

  return {
    id: twoMouthGirlIds.hero,
    skills: [basic, ultimate],
    aiCoverage: 'partial', mechanicsCoverage: 'partial',
    aiCoverageNotes: ['鬼火不少于3且持有子弹印记时使用歉意，否则使用意外袭击；官方选招权重尚未校准'],
    mechanicsCoverageNotes: ['意外袭击按技能等级造成100%至120%攻击伤害；战斗开始获得4枚子弹印记，最多6枚。每名友方完成一次行动后，按觉醒状态40%/66%基础概率获得1枚；歉意消耗3火和全部印记，基础攻击2次，每枚印记再加1发，单发按技能等级造成51%至63%攻击伤害并随机选择敌方目标。随机选敌时若前发击败目标、子弹状态能否被驱散及召唤物是否触发友方行动被动仍需连续帧核验'],
    initialize(context, unitId) {
      const actor = context.getUnit(unitId);
      if (!actor || actor.heroId !== twoMouthGirlIds.hero || !passivesEnabled(actor)) return [];
      const source = twoMouthSource(twoMouthGirlIds.bullets, actor.unitId);
      const instance: StatusInstance = { instanceId: `${twoMouthGirlIds.bulletStatus}:${actor.unitId}`,
        statusId: twoMouthGirlIds.bulletStatus, source, stacks: initialBullets, duration: { kind: 'permanent' } };
      return [{ type: 'add-status', source, targetId: actor.unitId, instance }];
    },
    policy(context, unitId): ActionIntent | undefined {
      const actor = context.getUnit(unitId);
      if (!actor || actor.hp <= 0 || actor.unitKind === 'summon') return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      const bullets = actor.statuses.filter(status => status.statusId === twoMouthGirlIds.bulletStatus)
        .reduce((sum, status) => sum + status.stacks, 0);
      if (bullets > 0 && (context.state.resources[actor.side]?.fire ?? 0) >= 3) {
        return { actorId: unitId, skillId: twoMouthGirlIds.ultimate, targetIds: enemies.map(unit => unit.unitId),
          shape: 'all-enemies', targetRelation: 'enemy' };
      }
      const target = enemies.slice().sort((left, right) => left.hp / Math.max(1, left.stats.hp)
        - right.hp / Math.max(1, right.stats.hp))[0]!;
      return { actorId: unitId, skillId: twoMouthGirlIds.basic, targetIds: [target.unitId],
        shape: 'single', targetRelation: 'enemy' };
    },
    handlers: { 'action-end': { priority: 30, handle(context, event) { return gainBulletAfterAllyAction(context, event); } } },
  };
}

function createDamageSkill(id: string, actionKind: 'basic' | 'skill', ratios: readonly number[]): SkillDefinition {
  return { id, useClientDamageData: true, actionKind, target: 'single', targetRelation: 'enemy', levels: ratios.map(ratio => ({ ratio })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      const target = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || actor.hp <= 0 || !target || target.hp <= 0) return [];
      return [twoMouthDamage(context, actor, target, twoMouthSource(id, actor.unitId), Number(parameters.ratio ?? 1))];
    } };
}

function gainBulletAfterAllyAction(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'action-ended' || !event.source.unitId) return;
  const actingUnit = context.getUnit(event.source.unitId);
  if (!actingUnit) return;
  const commands: EffectCommand[] = [];
  for (const girl of context.getLivingUnits(actingUnit.side).filter(unit => unit.heroId === twoMouthGirlIds.hero
    && passivesEnabled(unit))) {
    const stacks = girl.statuses.filter(status => status.statusId === twoMouthGirlIds.bulletStatus)
      .reduce((sum, status) => sum + status.stacks, 0);
    if (stacks >= maxBullets) continue;
    const chance = girl.awakeFilter === 0 ? .4 : .66;
    if (context.random() >= chance) continue;
    const source = twoMouthSource(twoMouthGirlIds.bullets, girl.unitId);
    commands.push({ type: 'add-status', source, targetId: girl.unitId, parentEventId: event.eventId,
      instance: { instanceId: `${twoMouthGirlIds.bulletStatus}:${girl.unitId}`, statusId: twoMouthGirlIds.bulletStatus,
        source, stacks: 1, duration: { kind: 'permanent' } } });
  }
  return commands;
}

function twoMouthDamage(context: BattleContext, actor: Readonly<UnitState>, target: Readonly<UnitState>, source: SourceRef,
  ratio: number): EffectCommand {
  const attack = context.getEffectiveStats(actor.unitId) ?? actor.stats;
  const defense = context.getEffectiveStats(target.unitId)?.defense ?? target.stats.defense;
  const result = context.calculateDamage({ attack: attack.attack, defense, defenseIgnore: effectiveDefenseIgnore(actor), ratio,
    critChance: attack.crit, critDamage: attack.critDamage }, actor, target);
  return { type: 'deal-damage', source, targetId: target.unitId, amount: result.amount,
    ...(result.damageOptions ? { damageOptions: result.damageOptions } : {}),
    ...(result.isCritical ? { criticalBaseAmount: result.amount / Math.max(1, attack.critDamage) } : {}),
    isCritical: result.isCritical };
}

function twoMouthSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }

