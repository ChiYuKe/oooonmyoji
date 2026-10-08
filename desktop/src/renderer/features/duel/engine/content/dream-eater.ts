import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { attemptControl } from '../mechanics/control';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import { createBasicAttackSkill } from './common-skills';
import { createSleepStatusDefinition, dreamEaterRetainsSleep } from './common-statuses';
import type { ContentRegistry } from './registry';

export const dreamEaterIds = {
  hero: 257,
  basic: '2571',
  passive: '2572',
  ultimate: '2573',
  sleep: 'status.hero.257.sleep',
} as const;

const basicRatios = [.8, .85, .9, .95, 1] as const;
const ultimateSleepChances = [.3, .35, .4, .45, .5] as const;

export function registerDreamEater(registry: ContentRegistry): void {
  registry.registerStatus(createSleepStatusDefinition(dreamEaterIds.sleep, 'partial', dreamEaterRetainsSleep));
  registry.registerHero(createDreamEaterDefinition());
}

export function createDreamEaterDefinition(): HeroDefinition {
  const basic = createBasicAttackSkill(dreamEaterIds.basic, basicRatios);
  const ultimate: SkillDefinition = {
    id: dreamEaterIds.ultimate, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'all-enemies', targetRelation: 'enemy', levels: ultimateSleepChances.map(chance => ({ chance, minTurns: 1, maxTurns: 2 })),
    execute(context, intent, parameters) {
      const owner = context.getUnit(intent.actorId);
      if (!owner || owner.hp <= 0) return [];
      const source = dreamSource(dreamEaterIds.ultimate, owner.unitId);
      const commands: EffectCommand[] = [];
      for (const targetId of intent.targetIds) {
        const target = context.getUnit(targetId);
        if (!target || target.hp <= 0 || target.side === owner.side) continue;
        const control = attemptControl(context, { attemptId: `${dreamEaterIds.sleep}:${owner.unitId}:${target.unitId}:${context.state.counters.hit}`,
          source, targetId: target.unitId, statusId: dreamEaterIds.sleep, controlType: '睡眠',
          baseChance: Number(parameters.chance ?? .3),
          duration: { kind: 'count', remaining: 1, owner: 'target-turn' } });
        if (!control) continue;
        if (control.type === 'apply-control') {
          const remaining = 1 + Math.floor(context.random() * 2);
          commands.push({ ...control, instance: { ...control.instance,
            duration: { kind: 'count', remaining, owner: 'target-turn' } } });
        } else commands.push(control);
      }
      return commands;
    },
  };
  return {
    id: dreamEaterIds.hero, skills: [basic, ultimate], aiCoverage: 'partial', mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['已按客户端技能数据接入入眠等级倍率/20%概率驱散可驱散增益及20%基础概率睡眠、沉睡被动令食梦貘伤害不唤醒目标并在觉醒形态下睡眠触发时治疗生命比例最低的非召唤友方5%生命上限、食梦者3火群体睡眠30%至50%基础概率/随机1至2回合；不同来源睡眠保留、全体概率与时长帧、治疗归属和御魂交互仍需连续帧核验'],
    handlers: {
      hit: { priority: 30, handle(context, event) { return onDreamEaterHit(context, event); } },
      'effect-resolution': { priority: 30, handle(context, event) { return healOnSleepApplied(context, event); } },
    },
    policy(context, unitId) {
      const owner = context.getUnit(unitId);
      if (!owner || owner.hp <= 0) return undefined;
      const enemies = context.getLivingUnits(owner.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      if ((context.state.resources[owner.side]?.fire ?? 0) >= 3)
        return dreamIntent(owner.unitId, dreamEaterIds.ultimate, enemies.map(enemy => enemy.unitId), 'all-enemies');
      const target = enemies.slice().sort((a, b) => a.hp / Math.max(1, a.stats.hp) - b.hp / Math.max(1, b.stats.hp))[0]!;
      return dreamIntent(owner.unitId, dreamEaterIds.basic, [target.unitId], 'single');
    },
  };
}

function onDreamEaterHit(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage' || !event.source.unitId) return;
  const owner = context.getUnit(event.source.unitId), target = context.getUnit(event.targetId);
  if (!owner || owner.heroId !== dreamEaterIds.hero || !target || target.hp <= 0) return;
  if (event.source.id === dreamEaterIds.basic) {
    const commands: EffectCommand[] = [];
    if (context.random() < .2) {
      const buffs = target.statuses.filter(status => context.isStatusDispellable(status.statusId)
        && ['buff', 'shield'].includes(context.getStatusCategory(status.statusId) ?? ''))
        .map(status => status.statusId);
      commands.push({ type: 'dispel-statuses', source: dreamSource(dreamEaterIds.basic, owner.unitId),
        targetId: target.unitId, statusIds: buffs, parentEventId: event.eventId });
    }
    const sleep = attemptControl(context, { attemptId: `${dreamEaterIds.sleep}:${event.eventId}`,
      source: dreamSource(dreamEaterIds.basic, owner.unitId), targetId: target.unitId,
      statusId: dreamEaterIds.sleep, controlType: '睡眠', baseChance: .2,
      duration: { kind: 'count', remaining: 1, owner: 'target-turn' }, parentEventId: event.eventId });
    if (sleep) commands.push(sleep);
    return commands;
  }
  return;
}

function healOnSleepApplied(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'status-added' || event.instance.values?.controlType !== '睡眠') return;
  const commands: EffectCommand[] = [];
  for (const owner of [...context.getLivingUnits('blue'), ...context.getLivingUnits('red')]) {
    if (owner.heroId !== dreamEaterIds.hero || !passivesEnabled(owner) || owner.awakeFilter === 0) continue;
    const target = context.getLivingUnits(owner.side).filter(ally => ally.unitKind !== 'summon')
      .slice().sort((a, b) => a.hp / Math.max(1, a.stats.hp) - b.hp / Math.max(1, b.stats.hp))[0];
    if (!target) continue;
    commands.push({ type: 'heal', source: dreamSource(dreamEaterIds.passive, owner.unitId), targetId: target.unitId,
      amount: target.stats.hp * .05, parentEventId: event.eventId });
  }
  return commands;
}

function dreamIntent(actorId: string, skillId: string, targetIds: readonly string[], shape: ActionIntent['shape']): ActionIntent {
  return { actorId, skillId, targetIds, shape, targetRelation: 'enemy' };
}

function dreamSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
