import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import type { BattleContext, BattleEvent, EffectCommand, SourceRef, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import { attemptDebuff } from '../mechanics/control';
import { createBasicAttackSkill } from './common-skills';
import type { ContentRegistry } from './registry';

export const hannyaIds = { hero: 271, basic: '2711', passive: '2712', ultimate: '2713', claw: '2714',
  seal: 'status.hero.271.seal', frenzy: 'status.hero.271.frenzy' } as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.2] as const;
const clawRatios = [.9, .945, .99, 1.035, 1.08] as const;
const ultimateRatios = [1.1, 1.15, 1.2, 1.25, 1.3] as const;

export function registerHannya(registry: ContentRegistry): void {
  registry.registerStatus({ id: hannyaIds.seal, mechanicsCoverage: 'partial', category: 'debuff', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'refresh-duration' });
  registry.registerStatus({ id: hannyaIds.frenzy, mechanicsCoverage: 'partial', category: 'buff', dispellable: true,
    sealable: false, durationOwner: 'source-turn', refreshPolicy: 'refresh-duration' });
  registry.registerHero(createHannyaDefinition());
}

export function createHannyaDefinition(): HeroDefinition {
  const normalBasic = createBasicAttackSkill(hannyaIds.basic, basicRatios);
  const basic: SkillDefinition = { ...normalBasic, execute(context, intent, parameters) {
    const actor = context.getUnit(intent.actorId);
    if (actor?.statuses.some(status => status.statusId === hannyaIds.frenzy))
      return executeClaw(context, intent.actorId, intent.targetIds[0], skillRank(actor, hannyaIds.basic));
    return normalBasic.execute(context, intent, parameters);
  } };
  const claw: SkillDefinition = { id: hannyaIds.claw, actionKind: 'basic', target: 'single', targetRelation: 'enemy',
    levels: clawRatios.map(ratio => ({ ratio, hits: 2 })), execute(context, intent) {
      const actor = context.getUnit(intent.actorId);
      return actor ? executeClaw(context, actor.unitId, intent.targetIds[0], skillRank(actor, hannyaIds.basic)) : [];
    } };
  const ultimate: SkillDefinition = { id: hannyaIds.ultimate, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'all-enemies', targetRelation: 'enemy', levels: ultimateRatios.map(ratio => ({ ratio })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      if (!actor || actor.hp <= 0) return [];
      const attack = attackTargets(context, actor, intent.targetIds, Number(parameters.ratio ?? ultimateRatios[0]), hannyaIds.ultimate);
      const rank = skillRank(actor, hannyaIds.ultimate);
      attack.push({ type: 'add-status', source: hannyaSource(hannyaIds.ultimate, actor.unitId), targetId: actor.unitId,
        instance: { instanceId: `${hannyaIds.frenzy}:${actor.unitId}`, statusId: hannyaIds.frenzy,
          source: hannyaSource(hannyaIds.ultimate, actor.unitId), stacks: 1,
          duration: { kind: 'count', remaining: 2, owner: 'source-turn' }, values: { skillRank: rank } } });
      return attack;
    } };

  return { id: hannyaIds.hero, skills: [basic, claw, ultimate], aiCoverage: 'partial', mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['鬼之假面和鬼袭倍率按客户端表，鬼袭3火并进入2回合狂暴姿态，期间普攻替换为鬼之爪双段且倍率跟随普攻技能等级；被动攻击命中后按40%基础概率（受效果命中/抵抗影响）封印目标御魂，觉醒后并封印被动，持续2个目标回合。多段触发次数、狂暴能否被驱散和反击/协战交互待帧图核验。'],
    policy(context, unitId) {
      const actor = context.getUnit(unitId);
      if (!actor || actor.hp <= 0 || actor.unitKind === 'summon') return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (enemies.length === 0) return undefined;
      if (actor.statuses.some(status => status.statusId === hannyaIds.frenzy)) {
        const target = lowestHealthEnemy(enemies);
        return { actorId: unitId, skillId: hannyaIds.claw, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
      }
      if ((context.state.resources[actor.side]?.fire ?? 0) >= 3)
        return { actorId: unitId, skillId: hannyaIds.ultimate, targetIds: enemies.map(unit => unit.unitId), shape: 'all-enemies', targetRelation: 'enemy' };
      const target = lowestHealthEnemy(enemies);
      return { actorId: unitId, skillId: hannyaIds.basic, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
    },
    handlers: { hit: { priority: 40, handle(context, event) { return sealAfterHit(context, event); } } },
  };
}

function sealAfterHit(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage' || event.suppressSourcePassiveTriggers || event.amount <= 0) return;
  if (![hannyaIds.basic, hannyaIds.claw, hannyaIds.ultimate].includes(event.source.id as typeof hannyaIds.basic)) return;
  const attacker = event.source.unitId ? context.getUnit(event.source.unitId) : undefined;
  const target = context.getUnit(event.targetId);
  if (!attacker || attacker.heroId !== hannyaIds.hero || attacker.hp <= 0 || !passivesEnabled(attacker)
    || !target || target.hp <= 0 || target.side === attacker.side || target.unitKind === 'summon'
    || target.unitKind === 'monster' || target.unitKind === 'onmyoji') return;
  const source = hannyaSource(hannyaIds.passive, attacker.unitId);
  return attemptDebuff(context, { source, targetId: target.unitId, statusId: hannyaIds.seal, baseChance: .4,
    duration: { kind: 'count', remaining: 2, owner: 'target-turn' },
    values: { sealSouls: true, sealPassives: attacker.awakeFilter === 1 } });
}

function executeClaw(context: BattleContext, actorId: string, targetId: string | undefined, skillLevel: number): EffectCommand[] {
  const actor = context.getUnit(actorId);
  const target = targetId ? context.getUnit(targetId) : undefined;
  if (!actor || actor.hp <= 0 || !target || target.hp <= 0 || target.side === actor.side) return [];
  const actorStats = context.getEffectiveStats(actor.unitId) ?? actor.stats;
  const targetStats = context.getEffectiveStats(target.unitId) ?? target.stats;
  const ratio = clawRatios[Math.max(0, Math.min(clawRatios.length - 1, skillLevel - 1))] ?? clawRatios[0];
  const source = hannyaSource(hannyaIds.claw, actor.unitId);
  const commands: EffectCommand[] = [];
  for (let hitIndex = 0; hitIndex < 2; hitIndex++) {
    const hit = context.calculateDamage({ attack: actorStats.attack, defense: targetStats.defense,
      defenseIgnore: effectiveDefenseIgnore(actor), ratio, critChance: actorStats.crit, critDamage: actorStats.critDamage }, actor, target);
    commands.push({ type: 'deal-damage', source, targetId: target.unitId, amount: hit.amount,
      ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}), isCritical: hit.isCritical });
  }
  return commands;
}

function attackTargets(context: BattleContext, actor: UnitState, targetIds: readonly string[], ratio: number, skillId: string): EffectCommand[] {
  const actorStats = context.getEffectiveStats(actor.unitId) ?? actor.stats;
  const source = hannyaSource(skillId, actor.unitId);
  return targetIds.flatMap(targetId => {
    const target = context.getUnit(targetId);
    if (!target || target.hp <= 0 || target.side === actor.side) return [];
    const targetStats = context.getEffectiveStats(target.unitId) ?? target.stats;
    const hit = context.calculateDamage({ attack: actorStats.attack, defense: targetStats.defense,
      defenseIgnore: effectiveDefenseIgnore(actor), ratio, critChance: actorStats.crit, critDamage: actorStats.critDamage }, actor, target);
    return [{ type: 'deal-damage' as const, source, targetId, amount: hit.amount,
      ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}), isCritical: hit.isCritical }];
  });
}

function skillRank(unit: Readonly<UnitState>, skillId: string): number {
  return Math.max(1, Math.min(5, unit.skillLevels?.[skillId] ?? unit.skillLevel));
}

function lowestHealthEnemy(enemies: readonly UnitState[]): UnitState {
  return enemies.slice().sort((left, right) => left.hp / Math.max(1, left.stats.hp) - right.hp / Math.max(1, right.stats.hp)
    || left.unitId.localeCompare(right.unitId))[0]!;
}

function hannyaSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
