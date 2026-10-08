import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import { attemptDebuff } from '../mechanics/control';
import { createBasicAttackSkill } from './common-skills';
import type { ContentRegistry } from './registry';

export const arakawaIds = {
  hero: 248,
  basic: '2481',
  passive: '2482',
  ultimate: '2483',
  passiveMark: 'status.hero.248.riptide',
  isolated: 'status.hero.248.isolated',
  junlin: 'status.hero.248.junlin',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const ultimateSecondRatios = [2.11, 2.26, 2.41, 2.56, 2.7] as const;

/** Client rows 2481–2483: single-hit basic, two-hit 3-fire ultimate, and the critical passive. */
export function registerArakawa(registry: ContentRegistry): void {
  registry.registerStatus({ id: arakawaIds.passiveMark, mechanicsCoverage: 'partial', category: 'buff',
    dispellable: false, sealable: false, durationOwner: 'permanent', refreshPolicy: 'keep' });
  registry.registerStatus({ id: arakawaIds.isolated, mechanicsCoverage: 'partial', category: 'debuff',
    dispellable: true, sealable: true, durationOwner: 'target-turn', refreshPolicy: 'refresh-duration' });
  registry.registerStatus({ id: arakawaIds.junlin, mechanicsCoverage: 'partial', category: 'buff',
    dispellable: false, sealable: false, durationOwner: 'source-turn', refreshPolicy: 'refresh-duration' });
  registry.registerHero(createArakawaDefinition());
}

export function createArakawaDefinition(): HeroDefinition {
  const basic = createBasicAttackSkill(arakawaIds.basic, basicRatios);
  const ultimate: SkillDefinition = {
    id: arakawaIds.ultimate, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'single', targetRelation: 'enemy', useClientDamageData: true,
    levels: ultimateSecondRatios.map(ratio => ({ firstRatio: .53, secondRatio: ratio, isolatedChance: 1 })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      const target = intent.targetIds.map(id => context.getUnit(id)).find((unit): unit is UnitState => Boolean(unit && unit.hp > 0));
      if (!actor || !target) return [];
      const attack = context.getEffectiveStats(actor.unitId) ?? actor.stats;
      const defense = context.getEffectiveStats(target.unitId)?.defense ?? target.stats.defense;
      const source = arakawaSource(arakawaIds.ultimate, actor.unitId);
      const makeHit = (ratio: number): EffectCommand => {
        const hit = context.calculateDamage({ attack: attack.attack, defense,
          defenseIgnore: effectiveDefenseIgnore(actor), ratio,
          critChance: attack.crit, critDamage: attack.critDamage }, actor, target);
        return { type: 'deal-damage', source, targetId: target.unitId, amount: hit.amount,
          ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}),
          ...(hit.isCritical ? { criticalBaseAmount: hit.amount / Math.max(1, attack.critDamage) } : {}),
          isCritical: hit.isCritical };
      };
      const commands: EffectCommand[] = [makeHit(Number(parameters.firstRatio ?? .53))];
      commands.push(...attemptDebuff(context, { source, targetId: target.unitId, statusId: arakawaIds.isolated,
        baseChance: Number(parameters.isolatedChance ?? 1), duration: { kind: 'count', remaining: 2, owner: 'target-turn' } }));
      commands.push(makeHit(Number(parameters.secondRatio ?? 2.11)));
      commands.push({ type: 'add-status', source: arakawaSource(arakawaIds.passive, actor.unitId), targetId: actor.unitId,
        instance: { instanceId: `${arakawaIds.junlin}:${actor.unitId}`, statusId: arakawaIds.junlin,
          source: arakawaSource(arakawaIds.passive, actor.unitId), stacks: 1,
          duration: { kind: 'count', remaining: 2, owner: 'source-turn' } } });
      return commands;
    },
  };
  return {
    id: arakawaIds.hero,
    skills: [basic, ultimate],
    aiCoverage: 'partial',
    mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['已接入游鱼等级倍率、吞噬3火双段伤害/首段孤立/二段倍率及施放后2回合君临标记；逐流开局印记、暴击增伤与四级暴击吸血已接入。孤立对友方选敌/分担伤害的全局拦截、逐流低血线行为、五级受推条转自身推条与君临效果仍需客户端帧核。'],
    initialize(context, unitId) {
      const unit = context.getUnit(unitId);
      if (!unit || unit.heroId !== arakawaIds.hero || unit.unitKind === 'summon' || !passivesEnabled(unit)) return [];
      const source = arakawaSource(arakawaIds.passive, unitId);
      return [{ type: 'add-status', source, targetId: unitId, instance: {
        instanceId: `${arakawaIds.passiveMark}:${unitId}`, statusId: arakawaIds.passiveMark,
        source, stacks: 1, duration: { kind: 'permanent' },
      } }];
    },
    modifyCriticalDamage(attacker, _target, amount, criticalBaseAmount) {
      if (attacker.heroId !== arakawaIds.hero || attacker.unitKind === 'summon' || !passivesEnabled(attacker)) return amount;
      return amount + criticalBaseAmount * .2;
    },
    handlers: {
      hit: { priority: 130, handle(context, event) { return healCriticalDamage(context, event); } },
    },
    policy(context, actorId) {
      const actor = context.getUnit(actorId);
      if (!actor || actor.heroId !== arakawaIds.hero || actor.hp <= 0) return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      const target = [...enemies].sort((a, b) => a.hp / a.stats.hp - b.hp / b.stats.hp)[0];
      const skillId = (actor.resources.fire ?? context.state.resources[actor.side].fire ?? 0) >= 3
        ? arakawaIds.ultimate : arakawaIds.basic;
      return { actorId, skillId, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
    },
  };
}

function healCriticalDamage(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage' || !event.isCritical || !event.source.unitId || event.hpLost <= 0) return;
  const attacker = context.getUnit(event.source.unitId);
  if (!attacker || attacker.heroId !== arakawaIds.hero || attacker.unitKind === 'summon'
    || (attacker.skillLevels?.[arakawaIds.passive] ?? attacker.skillLevel) < 4 || !passivesEnabled(attacker)) return;
  return [{ type: 'heal', source: arakawaSource(arakawaIds.passive, attacker.unitId), targetId: attacker.unitId,
    amount: event.hpLost * .2, parentEventId: event.eventId }];
}

function arakawaSource(skillId: string, unitId: string): SourceRef {
  return { kind: 'skill', id: skillId, unitId };
}
