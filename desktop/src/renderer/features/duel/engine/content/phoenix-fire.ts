import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, StatusInstance, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { attemptControl, attemptDebuff } from '../mechanics/control';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import { createBasicAttackSkill } from './common-skills';
import type { ContentRegistry } from './registry';

export const phoenixFireIds = {
  hero: 252,
  basic: '2521',
  passive: '2522',
  ultimate: '2523',
  stolenCrit: 'status.hero.252.stolen-crit',
  gainedCrit: 'status.hero.252.gained-crit',
  stun: 'status.hero.252.stun',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.2] as const;
const ultimateRatios = [.99, 1.04, 1.09, 1.14, 1.19] as const;

export function registerPhoenixFire(registry: ContentRegistry): void {
  registry.registerStatus({ id: phoenixFireIds.stolenCrit, mechanicsCoverage: 'partial', category: 'debuff',
    dispellable: true, sealable: true, durationOwner: 'target-turn', refreshPolicy: 'add-stack', stackScope: 'source-unit',
  });
  registry.registerStatus({ id: phoenixFireIds.gainedCrit, mechanicsCoverage: 'partial', category: 'buff',
    dispellable: true, sealable: true, durationOwner: 'source-turn', refreshPolicy: 'add-stack', stackScope: 'source-unit' });
  registry.registerStatus({ id: phoenixFireIds.stun, mechanicsCoverage: 'partial', category: 'control',
    dispellable: true, sealable: true, durationOwner: 'target-turn', refreshPolicy: 'refresh-duration', preventsAction: true });
  registry.registerHero(createPhoenixFireDefinition());
}

export function createPhoenixFireDefinition(): HeroDefinition {
  const basic = createBasicAttackSkill(phoenixFireIds.basic, basicRatios);
  const ultimate: SkillDefinition = {
    id: phoenixFireIds.ultimate, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'all-enemies', targetRelation: 'enemy', useClientDamageData: true,
    levels: ultimateRatios.map(ratio => ({ ratio, extraTurnChance: .25 })),
    execute(context, intent, parameters) {
      const owner = context.getUnit(intent.actorId);
      if (!owner) return [];
      const stats = context.getEffectiveStats(owner.unitId) ?? owner.stats;
      const source = phoenixSource(phoenixFireIds.ultimate, owner.unitId);
      const ratio = Number(parameters.ratio ?? .99);
      return intent.targetIds.flatMap(targetId => {
        const target = context.getUnit(targetId);
        if (!target || target.hp <= 0) return [];
        const defense = context.getEffectiveStats(target.unitId)?.defense ?? target.stats.defense;
        const hit = context.calculateDamage({ attack: stats.attack, defense,
          defenseIgnore: effectiveDefenseIgnore(owner), ratio,
          critChance: stats.crit, critDamage: stats.critDamage }, owner, target);
        return [{ type: 'deal-damage' as const, source, targetId: target.unitId,
          amount: hit.amount, ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}),
          ...(hit.isCritical ? { criticalBaseAmount: hit.amount / Math.max(1, stats.critDamage) } : {}), isCritical: hit.isCritical }];
      });
    },
  };
  return {
    id: phoenixFireIds.hero, skills: [basic, ultimate], aiCoverage: 'partial', mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['已按客户端参数接入凤火等级倍率/50%概率偷取10%暴击并转为自身暴击、烈焰攻击同时带减益和控制的敌人时50%判晕、凤凰业火3火/等级倍率/暴击后25%概率获得额外回合；暴击触发是逐目标还是单次群攻、偷取叠层上限和具体御魂插队时序仍需连续帧核验'],
    handlers: {
      hit: { priority: 36, handle(context, event) { return handlePhoenixHit(context, event); } },
      'effect-resolution': { priority: 37, handle(context, event) { return gainCritAfterSteal(context, event); } },
    },
    policy(context, unitId) {
      const owner = context.getUnit(unitId);
      if (!owner || owner.hp <= 0) return undefined;
      const enemies = context.getLivingUnits(owner.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      if (enemies.length > 1 && (context.state.resources[owner.side]?.fire ?? 0) >= 3)
        return phoenixIntent(owner.unitId, phoenixFireIds.ultimate, enemies.map(enemy => enemy.unitId), 'all-enemies');
      return phoenixIntent(owner.unitId, phoenixFireIds.basic, [enemies[0]!.unitId], 'single');
    },
  };
}

function handlePhoenixHit(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage' || !event.source.unitId) return;
  const owner = context.getUnit(event.source.unitId), target = context.getUnit(event.targetId);
  if (!owner || owner.heroId !== phoenixFireIds.hero || !target || target.hp <= 0) return;
  const commands: EffectCommand[] = [];
  if (event.source.id === phoenixFireIds.basic) {
    const steal = attemptDebuff(context, { source: phoenixSource(phoenixFireIds.basic, owner.unitId), targetId: target.unitId,
      statusId: phoenixFireIds.stolenCrit, baseChance: .5,
      duration: { kind: 'count', remaining: 2, owner: 'target-turn' }, parentEventId: event.eventId,
      values: { stealOwnerId: owner.unitId }, modifiers: [{ stat: 'crit', operation: 'flat', amount: -.1, perStack: true }] });
    commands.push(...steal);
  }
  if (passivesEnabled(owner) && hasDebuffAndControl(context, target)
    && [phoenixFireIds.basic, phoenixFireIds.ultimate].includes(event.source.id as typeof phoenixFireIds.basic | typeof phoenixFireIds.ultimate)) {
    const stun = attemptControl(context, { attemptId: `${phoenixFireIds.stun}:${event.eventId}`,
      source: phoenixSource(phoenixFireIds.passive, owner.unitId), targetId: target.unitId,
      statusId: phoenixFireIds.stun, controlType: 'stun', baseChance: .5,
      duration: { kind: 'count', remaining: 1, owner: 'target-turn' }, parentEventId: event.eventId });
    if (stun) commands.push(stun);
  }
  if (event.source.id === phoenixFireIds.ultimate && event.isCritical && context.random() < .25 && owner.hp > 0) {
    commands.push({ type: 'schedule-turn', source: phoenixSource(phoenixFireIds.ultimate, owner.unitId), unitId: owner.unitId,
      scheduling: 'extra-turn', selection: 'action-gauge', parentEventId: event.eventId });
  }
  return commands;
}

function gainCritAfterSteal(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'status-added' || event.instance.statusId !== phoenixFireIds.stolenCrit) return;
  const ownerId = event.instance.values?.stealOwnerId;
  const owner = typeof ownerId === 'string' ? context.getUnit(ownerId) : undefined;
  if (!owner || owner.heroId !== phoenixFireIds.hero || owner.hp <= 0) return;
  const source = phoenixSource(phoenixFireIds.basic, owner.unitId);
  const instance: StatusInstance = { instanceId: `${phoenixFireIds.gainedCrit}:${owner.unitId}:${event.instance.instanceId}`,
    statusId: phoenixFireIds.gainedCrit, source, stacks: 1,
    duration: { kind: 'count', remaining: 2, owner: 'source-turn' },
    modifiers: [{ stat: 'crit', operation: 'flat', amount: .1, perStack: true }] };
  return [{ type: 'add-status', source, targetId: owner.unitId, instance, parentEventId: event.eventId }];
}

function hasDebuffAndControl(context: BattleContext, target: Readonly<UnitState>): boolean {
  let hasDebuff = false, hasControl = false;
  for (const status of target.statuses) {
    const category = context.getStatusCategory(status.statusId);
    if (category === 'debuff') hasDebuff = true;
    else if (category === 'control') hasControl = true;
    if (hasDebuff && hasControl) return true;
  }
  return false;
}

function phoenixIntent(actorId: string, skillId: string, targetIds: readonly string[], shape: 'single' | 'all-enemies'): ActionIntent {
  return { actorId, skillId, targetIds, shape, targetRelation: 'enemy' };
}

function phoenixSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
