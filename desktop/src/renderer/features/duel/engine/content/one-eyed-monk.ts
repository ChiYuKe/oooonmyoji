import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { attemptControl } from '../mechanics/control';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import { createBasicAttackSkill } from './common-skills';
import type { ContentRegistry } from './registry';

export const oneEyedMonkIds = {
  hero: 230,
  basic: '2301',
  passive: '2302',
  impact: '2303',
  vajra: 'status.hero.230.vajra-scripture',
  stun: 'status.hero.230.stone-impact-stun',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const impactRatios = [1.63, 1.71, 1.79, 1.87, 1.95] as const;
const resistBonuses = [.1, .15, .15, .2, .2] as const;
const reflectRatios = [.1, .1, .15, .15, .2] as const;

export function registerOneEyedMonk(registry: ContentRegistry): void {
  registry.registerStatus({ id: oneEyedMonkIds.vajra, mechanicsCoverage: 'partial', category: 'buff', dispellable: false,
    sealable: false, durationOwner: 'target-turn', refreshPolicy: 'refresh-duration' });
  registry.registerStatus({ id: oneEyedMonkIds.stun, mechanicsCoverage: 'partial', category: 'control', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace', preventsAction: true });

  const basic = createBasicAttackSkill(oneEyedMonkIds.basic, basicRatios);
  const impact: SkillDefinition = {
    id: oneEyedMonkIds.impact,
    resourceCost: { resourceId: 'fire', amount: 2 },
    target: 'single',
    targetRelation: 'enemy',
    levels: impactRatios.map(ratio => ({ ratio, stunChance: .25 })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      const attackerStats = context.getEffectiveStats(intent.actorId);
      const targetId = intent.targetIds[0];
      const target = targetId ? context.getUnit(targetId) : undefined;
      const targetStats = target && context.getEffectiveStats(target.unitId);
      if (!actor || !attackerStats || !target || target.hp <= 0 || !targetStats) return [];
      const source = monkSource(oneEyedMonkIds.impact, actor.unitId);
      const hit = context.calculateDamage({ attack: attackerStats.attack, defense: targetStats.defense,
        defenseIgnore: effectiveDefenseIgnore(actor), ratio: Number(parameters.ratio ?? 1.63),
        critChance: attackerStats.crit, critDamage: attackerStats.critDamage }, actor, target);
      const commands: EffectCommand[] = [{ type: 'deal-damage', source, targetId: target.unitId, amount: hit.amount, ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}),
        ...(hit.isCritical ? { criticalBaseAmount: hit.amount / Math.max(1, attackerStats.critDamage) } : {}), isCritical: hit.isCritical }];
      const control = attemptControl(context, { attemptId: `${oneEyedMonkIds.stun}:${actor.unitId}:${target.unitId}:${context.state.counters.action}`,
        source, targetId: target.unitId, statusId: oneEyedMonkIds.stun, controlType: '眩晕',
        baseChance: Number(parameters.stunChance ?? .25), duration: { kind: 'count', remaining: 1, owner: 'target-turn' } });
      if (control) commands.push(control);
      return commands;
    },
  };

  const definition: HeroDefinition = {
    id: oneEyedMonkIds.hero,
    skills: [basic, impact],
    aiCoverage: 'partial',
    mechanicsCoverage: 'partial',
    policy(context: BattleContext, unitId: string): ActionIntent | undefined {
      const actor = context.getUnit(unitId);
      if (!actor || actor.hp <= 0 || actor.unitKind === 'summon') return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (enemies.length === 0) return undefined;
      const target = enemies.slice().sort((left, right) => left.hp / Math.max(1, left.stats.hp)
        - right.hp / Math.max(1, right.stats.hp))[0]!;
      const useImpact = (context.state.resources[actor.side]?.fire ?? 0) >= 2;
      return { actorId: actor.unitId, skillId: useImpact ? oneEyedMonkIds.impact : oneEyedMonkIds.basic,
        targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
    },
    handlers: { hit: { priority: 125, handle(context, event) { return grantVajraAndReflect(context, event); } } },
  };
  registry.registerHero(definition);
}

function grantVajraAndReflect(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage') return;
  const damaged = context.getUnit(event.targetId);
  if (!damaged) return;
  const commands: EffectCommand[] = [];
  if (damaged.heroId === oneEyedMonkIds.hero && damaged.unitKind !== 'summon' && damaged.hp > 0 && passivesEnabled(damaged)) {
    const levelIndex = Math.max(0, Math.min(4, damaged.skillLevel - 1));
    const source = monkSource(oneEyedMonkIds.passive, damaged.unitId);
    for (const ally of context.getLivingUnits(damaged.side)) {
      const resistBonus = resistBonuses[levelIndex]!;
      const reflectRatio = reflectRatios[levelIndex]!;
      commands.push({ type: 'add-status', source, targetId: ally.unitId, instance: {
        instanceId: `${oneEyedMonkIds.vajra}:${damaged.unitId}:${ally.unitId}`,
        statusId: oneEyedMonkIds.vajra, source, stacks: 1,
        duration: { kind: 'count', remaining: 1, owner: 'target-turn' },
        values: { reflectRatio },
        modifiers: [{ stat: 'resist', operation: 'flat', amount: resistBonus }],
      }, parentEventId: event.eventId });
    }
  }

  const attacker = event.source.unitId ? context.getUnit(event.source.unitId) : undefined;
  const vajra = damaged.statuses.find(status => status.statusId === oneEyedMonkIds.vajra);
  const reflectRatio = Number(vajra?.values?.reflectRatio ?? 0);
  if (attacker && attacker.hp > 0 && damaged.hp > 0 && vajra && reflectRatio > 0
    && event.source.id !== oneEyedMonkIds.passive && event.amount > 0) {
    commands.push({ type: 'lose-life', source: vajra.source, targetId: attacker.unitId,
      amount: Math.min(attacker.hp, event.amount * reflectRatio), parentEventId: event.eventId });
  }
  return commands;
}

function monkSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
