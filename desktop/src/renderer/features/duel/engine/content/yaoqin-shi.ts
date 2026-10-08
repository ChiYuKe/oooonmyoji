import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef } from '../core/types';
import { attemptControl } from '../mechanics/control';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import { createBasicAttackSkill } from './common-skills';
import type { ContentRegistry } from './registry';

export const yaoqinShiIds = {
  hero: 256,
  basic: '2561',
  extraTurn: '2562',
  ultimate: '2563',
  speed: 'status.hero.256.aftertone-speed',
  confusion: 'status.hero.256.madness-confusion',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const ultimateRatios = [.85, .89, .93, .97, 1.01] as const;
const speedBonuses = [8, 11, 14, 17, 20] as const;

export function registerYaoqinShi(registry: ContentRegistry): void {
  registry.registerStatus({ id: yaoqinShiIds.speed, mechanicsCoverage: 'partial', category: 'buff',
    dispellable: true, sealable: true, durationOwner: 'target-turn', refreshPolicy: 'refresh-duration' });
  registry.registerStatus({ id: yaoqinShiIds.confusion, mechanicsCoverage: 'partial', category: 'control',
    dispellable: true, sealable: true, durationOwner: 'target-turn', refreshPolicy: 'refresh-duration' });
  registry.registerHero(createYaoqinShiDefinition());
}

export function createYaoqinShiDefinition(): HeroDefinition {
  const basic = createBasicAttackSkill(yaoqinShiIds.basic, basicRatios);
  const extraTurn: SkillDefinition = {
    id: yaoqinShiIds.extraTurn, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 2 },
    target: 'single', targetRelation: 'ally', levels: speedBonuses.map(speedBonus => ({ speedBonus, duration: 1 })),
    execute(context, intent, parameters) {
      const owner = context.getUnit(intent.actorId);
      const target = context.getUnit(intent.targetIds[0] ?? '');
      if (!owner || !target || target.hp <= 0 || owner.side !== target.side) return [];
      const source = yaoSource(yaoqinShiIds.extraTurn, owner.unitId);
      const commands: EffectCommand[] = context.getLivingUnits(owner.side).map(ally => ({
        type: 'add-status', source, targetId: ally.unitId,
        instance: { instanceId: `${yaoqinShiIds.speed}:${owner.unitId}:${ally.unitId}`, statusId: yaoqinShiIds.speed,
          source, stacks: 1, duration: { kind: 'count', remaining: Number(parameters.duration ?? 1), owner: 'target-turn' },
          modifiers: [{ stat: 'speed', operation: 'flat', amount: Number(parameters.speedBonus ?? 8) }] },
      }));
      commands.push({ type: 'schedule-turn', source, unitId: target.unitId,
        scheduling: 'extra-turn', selection: 'action-gauge' });
      return commands;
    },
  };
  const ultimate: SkillDefinition = {
    id: yaoqinShiIds.ultimate, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'all-enemies', targetRelation: 'enemy', useClientDamageData: true,
    levels: ultimateRatios.map(ratio => ({ ratio, pushbackChance: .2, pushbackAmount: 100, confusionChance: .2, confusionTurns: 1 })),
    execute(context, intent, parameters) {
      const owner = context.getUnit(intent.actorId);
      if (!owner || owner.hp <= 0) return [];
      const attack = context.getEffectiveStats(owner.unitId) ?? owner.stats;
      const source = yaoSource(yaoqinShiIds.ultimate, owner.unitId);
      return intent.targetIds.flatMap(targetId => {
        const target = context.getUnit(targetId);
        if (!target || target.hp <= 0) return [];
        const defense = context.getEffectiveStats(target.unitId)?.defense ?? target.stats.defense;
        const damage = context.calculateDamage({ attack: attack.attack, defense,
          defenseIgnore: effectiveDefenseIgnore(owner), ratio: Number(parameters.ratio ?? .85),
          critChance: attack.crit, critDamage: attack.critDamage }, owner, target);
        return [{ type: 'deal-damage' as const, source, targetId: target.unitId, amount: damage.amount,
          ...(damage.damageOptions ? { damageOptions: damage.damageOptions } : {}), isCritical: damage.isCritical }];
      });
    },
  };
  return {
    id: yaoqinShiIds.hero, skills: [basic, extraTurn, ultimate], aiCoverage: 'partial', mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['已按客户端图鉴接入惊弦等级倍率、余音2火/指定友方额外回合/全队1回合速度提升8至20、疯魔琴心3火/全体等级倍率/每个目标独立20%击退100行动条及20%基础概率混乱1回合；混乱目标分布、行动条免疫、技能等级边界与实战帧仍待核验'],
    handlers: { hit: { priority: 31, handle(context, event) { return onYaoqinHit(context, event); } } },
    policy(context, unitId) {
      const owner = context.getUnit(unitId);
      if (!owner || owner.hp <= 0) return undefined;
      const enemies = context.getLivingUnits(owner.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      const fire = context.state.resources[owner.side]?.fire ?? 0;
      if (enemies.length > 1 && fire >= 3)
        return yaoIntent(owner.unitId, yaoqinShiIds.ultimate, enemies.map(enemy => enemy.unitId), 'all-enemies', 'enemy');
      if (fire >= 2) {
        const allies = context.getLivingUnits(owner.side).slice().sort((a, b) => b.stats.attack - a.stats.attack);
        const target = allies.find(ally => ally.unitId !== owner.unitId) ?? owner;
        return yaoIntent(owner.unitId, yaoqinShiIds.extraTurn, [target.unitId], 'single', 'ally');
      }
      return yaoIntent(owner.unitId, yaoqinShiIds.basic, [enemies[0]!.unitId], 'single', 'enemy');
    },
  };
}

function onYaoqinHit(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage' || event.source.id !== yaoqinShiIds.ultimate || !event.source.unitId) return;
  const owner = context.getUnit(event.source.unitId), target = context.getUnit(event.targetId);
  if (!owner || owner.heroId !== yaoqinShiIds.hero || !target || target.hp <= 0) return;
  const commands: EffectCommand[] = [];
  if (context.random() < .2) commands.push({ type: 'change-action-gauge', source: yaoSource(yaoqinShiIds.ultimate, owner.unitId),
    targetId: target.unitId, amount: -100, parentEventId: event.eventId });
  const confusion = attemptControl(context, { attemptId: `${yaoqinShiIds.confusion}:${event.eventId}`,
    source: yaoSource(yaoqinShiIds.ultimate, owner.unitId), targetId: target.unitId,
    statusId: yaoqinShiIds.confusion, controlType: '混乱', baseChance: .2,
    duration: { kind: 'count', remaining: 1, owner: 'target-turn' }, parentEventId: event.eventId });
  if (confusion) commands.push(confusion);
  return commands;
}

function yaoIntent(actorId: string, skillId: string, targetIds: readonly string[], shape: ActionIntent['shape'],
  targetRelation: ActionIntent['targetRelation']): ActionIntent {
  return { actorId, skillId, targetIds, shape, targetRelation };
}

function yaoSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
