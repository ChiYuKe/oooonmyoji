import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, StatusInstance, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { attemptDebuff } from '../mechanics/control';
import { calculateIndirectDamage } from '../mechanics/indirect-damage';
import { effectiveDefenseIgnore, effectiveIndirectDamageTakenMultiplier, effectiveStats } from '../mechanics/stats';
import { createBasicAttackSkill } from './common-skills';
import type { ContentRegistry } from './registry';

export const judgeIds = {
  hero: 251,
  basic: '2511',
  passive: '2512',
  ultimate: '2513',
  deathSentence: 'status.hero.251.death-sentence',
  revivedTarget: 'status.hero.251.revived-target',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const ultimateRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const revivedTargetBonuses = [.1, .2, .3, .4, .4] as const;

export function registerJudge(registry: ContentRegistry): void {
  registry.registerStatus({ id: judgeIds.deathSentence, mechanicsCoverage: 'partial', category: 'debuff',
    dispellable: true, sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace', healingAbsorption: true,
    handlers: {
      'turn-start': { priority: 80, handle(context, event) { return tickDeathSentence(context, event); } },
      'unit-defeated': { priority: 80, handle(context, event) { return clearDeathSentence(context, event); } },
    } });
  registry.registerStatus({ id: judgeIds.revivedTarget, mechanicsCoverage: 'partial', category: 'other',
    dispellable: false, sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace' });
  registry.registerHero(createJudgeDefinition());
}

export function createJudgeDefinition(): HeroDefinition {
  const basic = createBasicAttackSkill(judgeIds.basic, basicRatios);
  const ultimate: SkillDefinition = {
    id: judgeIds.ultimate, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'all-enemies', targetRelation: 'enemy', useClientDamageData: true,
    levels: ultimateRatios.map(ratio => ({ ratio })),
    execute(context, intent, parameters) {
      const owner = context.getUnit(intent.actorId);
      if (!owner) return [];
      const attack = context.getEffectiveStats(owner.unitId) ?? owner.stats;
      const source = judgeSource(judgeIds.ultimate, owner.unitId);
      const ratio = Number(parameters.ratio ?? 1);
      return intent.targetIds.flatMap(targetId => {
        const target = context.getUnit(targetId);
        if (!target || target.hp <= 0) return [];
        const defense = context.getEffectiveStats(target.unitId)?.defense ?? target.stats.defense;
        const hit = context.calculateDamage({ attack: attack.attack, defense,
          defenseIgnore: effectiveDefenseIgnore(owner), ratio,
          critChance: attack.crit, critDamage: attack.critDamage }, owner, target);
        return [{ type: 'deal-damage' as const, source, targetId: target.unitId,
          amount: hit.amount, ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}),
          ...(hit.isCritical ? { criticalBaseAmount: hit.amount / Math.max(1, attack.critDamage) } : {}), isCritical: hit.isCritical }];
      });
    },
  };
  return {
    id: judgeIds.hero, skills: [basic, ultimate], aiCoverage: 'partial', mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['已按客户端技能表接入墨笔夺魂等级倍率、死亡宣告3火全体攻击/一回合死亡标记/目标行动前100%攻击间接伤害及等额治疗吸收；无情按目标已损失生命增加暴击率、对复活目标增伤，五级暴击溢出转暴伤。标记抵抗概率、驱散/封印、死亡标记伤害快照与正式斗技帧数值仍需核验'],
    handlers: {
      hit: { priority: 34, handle(context, event) { return applyDeathSentence(context, event); } },
      'effect-resolution': { priority: 86, handle(context, event) { return markRevivedTarget(context, event); } },
    },
    beforeCalculateDamage(input, attacker, target) {
      if (attacker.heroId !== judgeIds.hero || !passivesEnabled(attacker)) return input;
      const lostHpRatio = Math.max(0, 1 - target.hp / Math.max(1, target.stats.hp));
      const critChance = input.critChance + lostHpRatio;
      const passiveRank = skillRank(attacker, judgeIds.passive);
      const excessCritDamage = passiveRank >= 5 ? Math.max(0, critChance - 1) : 0;
      return { ...input, critChance, critDamage: input.critDamage + excessCritDamage };
    },
    modifyOutgoingDamage(attacker, target, amount) {
      if (attacker.heroId !== judgeIds.hero || !passivesEnabled(attacker)
        || !target.statuses.some(status => status.statusId === judgeIds.revivedTarget)) return amount;
      return amount * (1 + revivedTargetBonuses[Math.max(0, Math.min(4, skillRank(attacker, judgeIds.passive) - 1))]!);
    },
    policy(context, unitId) {
      const owner = context.getUnit(unitId);
      if (!owner || owner.hp <= 0) return undefined;
      const enemies = context.getLivingUnits(owner.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      if (enemies.length > 1 && (context.state.resources[owner.side]?.fire ?? 0) >= 3)
        return judgeIntent(owner.unitId, judgeIds.ultimate, enemies.map(enemy => enemy.unitId), 'all-enemies');
      return judgeIntent(owner.unitId, judgeIds.basic, [enemies[0]!.unitId], 'single');
    },
  };
}

function applyDeathSentence(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage' || event.source.id !== judgeIds.ultimate || !event.source.unitId) return;
  const owner = context.getUnit(event.source.unitId), target = context.getUnit(event.targetId);
  if (!owner || owner.heroId !== judgeIds.hero || !target || target.hp <= 0) return;
  return attemptDebuff(context, { source: judgeSource(judgeIds.ultimate, owner.unitId), targetId: target.unitId,
    statusId: judgeIds.deathSentence, baseChance: .99,
    duration: { kind: 'count', remaining: 1, owner: 'target-turn' }, parentEventId: event.eventId,
    values: { healingAbsorptionRemaining: Math.max(0, event.amount) } });
}

function tickDeathSentence(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-started') return;
  const target = context.getUnit(event.unitId);
  if (!target || target.hp <= 0) return;
  const commands: EffectCommand[] = [];
  for (const status of target.statuses.filter(instance => instance.statusId === judgeIds.deathSentence)) {
    const owner = status.source.unitId ? context.getUnit(status.source.unitId) : undefined;
    const ownerStats = owner && context.getEffectiveStats(owner.unitId);
    if (!owner || !ownerStats) continue;
    const targetStats = context.getEffectiveStats(target.unitId) ?? target.stats;
    const result = calculateIndirectDamage({ attack: ownerStats.attack, defense: targetStats.defense,
      ratio: 1, critDamage: ownerStats.critDamage }, context.random);
    let amount = result.amount;
    if (owner.heroId === judgeIds.hero && passivesEnabled(owner)
      && target.statuses.some(instance => instance.statusId === judgeIds.revivedTarget)) {
      amount *= 1 + revivedTargetBonuses[Math.max(0, Math.min(4, skillRank(owner, judgeIds.passive) - 1))]!;
    }
    commands.push({ type: 'lose-life', source: status.source, targetId: target.unitId,
      amount, lifeLossKind: 'indirect', parentEventId: event.eventId });
  }
  return commands;
}

function clearDeathSentence(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'unit-defeated') return;
  const target = context.getUnit(event.unitId);
  const mark = target?.statuses.find(status => status.statusId === judgeIds.deathSentence);
  if (!target || !mark) return;
  return [{ type: 'remove-statuses', source: mark.source, targetId: target.unitId,
    statusIds: [judgeIds.deathSentence], reason: 'consumed', parentEventId: event.eventId }];
}

function markRevivedTarget(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'unit-revived') return;
  const judges = [...context.getLivingUnits('blue'), ...context.getLivingUnits('red')]
    .filter(unit => unit.heroId === judgeIds.hero && passivesEnabled(unit));
  if (!judges.length) return;
  const source: SourceRef = { kind: 'system', id: 'unit-revived' };
  const instance: StatusInstance = { instanceId: `${judgeIds.revivedTarget}:${event.unitId}`,
    statusId: judgeIds.revivedTarget, source, stacks: 1, duration: { kind: 'permanent' } };
  return [{ type: 'add-status', source, targetId: event.unitId, instance, parentEventId: event.eventId }];
}

function skillRank(unit: Readonly<UnitState>, skillId: string): number {
  const rank = unit.skillLevels?.[skillId] ?? unit.skillLevel;
  return Math.max(1, Math.min(5, Math.floor(rank)));
}

function judgeIntent(actorId: string, skillId: string, targetIds: readonly string[], shape: 'single' | 'all-enemies'): ActionIntent {
  return { actorId, skillId, targetIds, shape, targetRelation: 'enemy' };
}

function judgeSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
