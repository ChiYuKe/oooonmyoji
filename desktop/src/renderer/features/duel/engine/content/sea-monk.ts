import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, StatusInstance, UnitState } from '../core/types';
import { createBasicAttackSkill } from './common-skills';
import type { ContentRegistry } from './registry';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import { battleSkillRow, skillNumber } from '../../../../../shared/game-skill-data';

export const seaMonkIds = {
  hero: 247,
  basic: '2471',
  passive: '2472',
  ultimate: '2473',
  healingWindow: 'status.hero.247.healing-window',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const waveRatios = [.33, .36, .39, .42, .45] as const;

export function registerSeaMonk(registry: ContentRegistry): void {
  registry.registerStatus({ id: seaMonkIds.healingWindow, mechanicsCoverage: 'partial', category: 'other',
    dispellable: false, sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace' });
  const ultimate: SkillDefinition = {
    id: seaMonkIds.ultimate, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'all-enemies', targetRelation: 'enemy', levels: waveRatios.map(ratio => ({ ratio, hits: 3 })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      const actorStats = actor && context.getEffectiveStats(actor.unitId);
      if (!actor || !actorStats) return [];
      const source = seaMonkSource(seaMonkIds.ultimate, actor.unitId);
      const ratio = Number(parameters.ratio ?? .33);
      const commands: EffectCommand[] = [];
      for (let hit = 0; hit < Number(parameters.hits ?? 3); hit++) {
        for (const targetId of intent.targetIds) {
          const target = context.getUnit(targetId);
          const targetStats = target && context.getEffectiveStats(target.unitId);
          if (!target || target.hp <= 0 || target.side === actor.side || !targetStats) continue;
          const result = context.calculateDamage({ attack: actorStats.attack, defense: targetStats.defense,
            defenseIgnore: effectiveDefenseIgnore(actor), ratio, critChance: actorStats.crit,
            critDamage: actorStats.critDamage }, actor, target);
          commands.push({ type: 'deal-damage', source, targetId: target.unitId, amount: result.amount, ...(result.damageOptions ? { damageOptions: result.damageOptions } : {}), isCritical: result.isCritical });
        }
      }
      return commands;
    },
  };
  registry.registerHero({
    id: seaMonkIds.hero,
    skills: [createBasicAttackSkill(seaMonkIds.basic, basicRatios), ultimate],
    aiCoverage: 'partial',
    mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['祝福之水的觉醒治疗比例已按客户端技能参数区分；全盾吸收、致死命中及间接伤害的触发边界仍缺少实战事件样本核验'],
    policy(context, unitId) {
      const actor = context.getUnit(unitId);
      if (!actor || actor.hp <= 0) return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      if ((context.state.resources[actor.side]?.fire ?? 0) >= 3) {
        return { actorId: unitId, skillId: seaMonkIds.ultimate, targetIds: enemies.map(enemy => enemy.unitId),
          shape: 'all-enemies', targetRelation: 'enemy' };
      }
      const target = enemies.slice().sort((left, right) => left.hp / Math.max(1, left.stats.hp)
        - right.hp / Math.max(1, right.stats.hp))[0]!;
      return { actorId: unitId, skillId: seaMonkIds.basic, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
    },
    handlers: {
      hit: { priority: 120, handle(context, event) { return healLowestAlly(context, event); } },
      'action-end': { priority: 120, handle(context, event) {
        if (event.type !== 'action-ended' || !event.source.unitId || event.actionId === undefined) return;
        const actor = context.getUnit(event.source.unitId);
        const window = actor?.statuses.find(status => status.statusId === seaMonkIds.healingWindow
          && Number(status.values?.actionId) === event.actionId);
        if (!actor || actor.heroId !== seaMonkIds.hero || !window) return;
        return [{ type: 'remove-statuses', source: seaMonkSource(seaMonkIds.passive, actor.unitId), targetId: actor.unitId,
          statusIds: [seaMonkIds.healingWindow], reason: 'consumed', parentEventId: event.eventId }];
      } },
    },
  });
}

function healLowestAlly(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage' || event.hpLost <= 0 || (event.source.id !== seaMonkIds.basic && event.source.id !== seaMonkIds.ultimate)
    || !event.source.unitId) return;
  const healer = context.getUnit(event.source.unitId);
  if (!healer || healer.heroId !== seaMonkIds.hero || healer.hp <= 0) return;
  const target = context.getLivingUnits(healer.side).filter(unit => unit.unitKind !== 'summon')
    .slice().sort((left, right) => left.hp / Math.max(1, left.stats.hp) - right.hp / Math.max(1, right.stats.hp)
      || left.unitId.localeCompare(right.unitId))[0];
  if (!target) return;
  const current = healer.statuses.find(status => status.statusId === seaMonkIds.healingWindow
    && status.source.unitId === healer.unitId);
  const actionId = event.actionId ?? context.state.counters.action;
  const previousActionId = Number(current?.values?.actionId ?? -1);
  const previousCount = previousActionId === actionId ? Number(current?.values?.[`target:${target.unitId}`] ?? 0) : 0;
  const counts: Record<string, number | string | boolean> = previousActionId === actionId
    ? Object.fromEntries(Object.entries(current?.values ?? {}).filter(([key, value]) => key.startsWith('target:') && typeof value === 'number'))
    : {};
  counts[`target:${target.unitId}`] = previousCount + 1;
  const source = seaMonkSource(seaMonkIds.passive, healer.unitId);
  const passiveRatio = skillNumber(battleSkillRow(seaMonkIds.passive, 1, healer.awakeFilter,
    healer.unitKind === 'monster' || healer.unitKind === 'summon'), 'param1') ?? 1;
  const instance: StatusInstance = { instanceId: `${seaMonkIds.healingWindow}:${healer.unitId}`, statusId: seaMonkIds.healingWindow,
    source, stacks: 1, duration: { kind: 'permanent' }, values: { actionId, ...counts } };
  const diminish = Math.max(0, 1 - .15 * previousCount);
  return [{ type: 'add-status', source, targetId: healer.unitId, instance, parentEventId: event.eventId },
    { type: 'heal', source, targetId: target.unitId, amount: event.hpLost * passiveRatio * diminish, parentEventId: event.eventId }];
}

function seaMonkSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
