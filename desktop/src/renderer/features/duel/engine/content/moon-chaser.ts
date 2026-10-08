import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import type { ActionIntent, EffectCommand, StatusInstance } from '../core/types';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import { battleSkillRow, skillNumber } from '../../../../../shared/game-skill-data';
import type { ContentRegistry } from './registry';

export const moonChaserIds = {
  hero: 295,
  basic: '2951',
  passive: '2952',
  blessingSkill: '2953',
  blessingStatus: 'status.hero.295.moon-blessing',
  protectionStatus: 'status.hero.295.protection',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;

/** AI, baseline attack, resource passive, and team blessing. */
export function registerMoonChaser(registry: ContentRegistry): void {
  registry.registerStatus({ id: moonChaserIds.blessingStatus, mechanicsCoverage: 'verified', dispellable: true,
    sealable: false, durationOwner: 'target-turn', refreshPolicy: 'refresh-duration',
    handlers: { 'turn-end': { priority: 10, handle(context, event) {
      if (event.type !== 'turn-ended') return;
      const actor = context.getUnit(event.unitId);
      const blessing = actor?.statuses.find(status => status.statusId === moonChaserIds.blessingStatus
        && status.source.unitId !== actor.unitId);
      if (!actor || !blessing) return;
      return [{ type: 'advance-resource-meter', source: blessing.source, side: actor.side, resourceId: 'fire', steps: 1,
        parentEventId: event.eventId }];
    } } } });
  registry.registerStatus({ id: moonChaserIds.protectionStatus, mechanicsCoverage: 'verified', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'refresh-duration', controlProtection: 'single-skill' });
  registry.registerHero(createMoonChaserDefinition());
}

export function createMoonChaserDefinition(): HeroDefinition {
  const basic: SkillDefinition = {
    id: moonChaserIds.basic,
    target: 'single',
    targetRelation: 'enemy',
    levels: basicRatios.map(ratio => ({ ratio })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      const actorStats = context.getEffectiveStats(intent.actorId);
      const target = context.getUnit(intent.targetIds[0] ?? '');
      const targetStats = target && context.getEffectiveStats(target.unitId);
      if (!actor || !actorStats || !target || !targetStats) return [];
      const result = context.calculateDamage({ attack: actorStats.attack, defense: targetStats.defense, defenseIgnore: effectiveDefenseIgnore(actor),
        ratio: Number(parameters.ratio ?? 1), critChance: actorStats.crit, critDamage: actorStats.critDamage }, actor, target);
      const source = { kind: 'skill' as const, id: moonChaserIds.basic, unitId: actor.unitId };
      return [
        { type: 'deal-damage', source, targetId: target.unitId, amount: result.amount, ...(result.damageOptions ? { damageOptions: result.damageOptions } : {}), isCritical: result.isCritical },
        { type: 'change-action-gauge', source, targetId: actor.unitId, amount: 20 },
      ];
    },
  };
  const blessing: SkillDefinition = {
    id: moonChaserIds.blessingSkill,
    resourceCost: { resourceId: 'fire', amount: 2 },
    alternatePayment: { resourceId: 'fire', meterResourceId: 'fire', minSkillLevel: 5 },
    target: 'all-allies',
    targetRelation: 'ally',
    levels: [
      { attackBonus: 0, speedBonus: 10, protection: false },
      { attackBonus: .1, speedBonus: 10, protection: false },
      { attackBonus: .1, speedBonus: 20, protection: false },
      { attackBonus: .2, speedBonus: 20, protection: false },
      { attackBonus: .2, speedBonus: 20, protection: true },
    ],
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      if (!actor) return [];
      const commands: EffectCommand[] = [];
      for (const targetId of intent.targetIds) {
        const target = context.getUnit(targetId);
        if (!target || target.hp <= 0 || target.unitId === actor.unitId || target.unitKind === 'summon') continue;
        const modifiers: NonNullable<StatusInstance['modifiers']> = [
          { stat: 'attack', operation: 'percent', amount: Number(parameters.attackBonus ?? 0) },
          { stat: 'speed', operation: 'flat', amount: Number(parameters.speedBonus ?? 10) },
        ];
        const blessing: StatusInstance = {
          instanceId: `${moonChaserIds.blessingStatus}:${actor.unitId}:${target.unitId}:${context.state.counters.action + 1}`,
          statusId: moonChaserIds.blessingStatus,
          source: { kind: 'skill', id: moonChaserIds.blessingSkill, unitId: actor.unitId },
          stacks: 1,
          duration: { kind: 'count', remaining: 1, owner: 'target-turn' },
          modifiers,
        };
        commands.push({ type: 'add-status', source: blessing.source, targetId, instance: blessing });
      }
      if (parameters.protection === true) commands.push({ type: 'add-status', source: { kind: 'skill', id: moonChaserIds.blessingSkill,
        unitId: actor.unitId }, targetId: actor.unitId, instance: {
        instanceId: `${moonChaserIds.protectionStatus}:${actor.unitId}:${context.state.counters.action + 1}`,
        statusId: moonChaserIds.protectionStatus,
        source: { kind: 'skill', id: moonChaserIds.blessingSkill, unitId: actor.unitId },
        stacks: 1,
        duration: { kind: 'count', remaining: 1, owner: 'target-turn' },
        values: { controlImmunity: 'single-skill' },
      } });
      return commands;
    },
  };

  return {
    id: moonChaserIds.hero,
    skills: [basic, blessing],
    aiCoverage: 'verified',
    mechanicsCoverage: 'verified',
    initialize(context, unitId) {
      const unit = context.getUnit(unitId);
      if (!unit) return [];
      const source = { kind: 'skill' as const, id: moonChaserIds.passive, unitId };
      const commands: EffectCommand[] = [];
      const firstMoonChaser = context.getLivingUnits(unit.side).find(ally => ally.heroId === moonChaserIds.hero);
      if (firstMoonChaser?.unitId === unitId) {
        const passiveLevel = skillLevel(unit, moonChaserIds.passive);
        const openingSteps = skillNumber(battleSkillRow(moonChaserIds.passive, passiveLevel, unit.awakeFilter), 'param1') ?? 1;
        if (openingSteps > 0) commands.push({ type: 'advance-resource-meter', source,
          side: unit.side, resourceId: 'fire', steps: openingSteps });
      }
      commands.push(
        { type: 'add-status', source, targetId: unitId, instance: {
          instanceId: `${moonChaserIds.protectionStatus}:opening:${unitId}`,
          statusId: moonChaserIds.protectionStatus,
          source,
          stacks: 1,
          duration: { kind: 'permanent' },
          values: { controlImmunity: 'opening' },
        } },
      );
      return commands;
    },
    handlers: {
      'turn-start': { priority: 0, handle(context, event) {
        if (event.type !== 'turn-started') return;
        const unit = context.getUnit(event.unitId);
        if (!unit || unit.heroId !== moonChaserIds.hero || !unit.statuses.some(status => status.statusId === moonChaserIds.protectionStatus)) return;
        return [{ type: 'remove-statuses', source: { kind: 'skill', id: moonChaserIds.passive, unitId: unit.unitId },
          targetId: unit.unitId, statusIds: [moonChaserIds.protectionStatus], reason: 'consumed', parentEventId: event.eventId }];
      } },
    },
    policy(context, unitId): ActionIntent | undefined {
      const actor = context.getUnit(unitId);
      if (!actor) return undefined;
      const allies = context.getLivingUnits(actor.side);
      const buffRecipients = allies.filter(ally => ally.unitId !== actor.unitId && ally.unitKind !== 'summon');
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (enemies.length === 0) return undefined;
      const fire = context.state.resources[actor.side]?.fire ?? 0;
      const shortage = Math.max(0, 2 - fire);
      const fireMeter = context.state.resourceMeters[actor.side]?.fire?.progress ?? 0;
      const canPay = shortage === 0 || (skillLevel(actor, moonChaserIds.blessingSkill) >= 5 && fireMeter >= shortage);
      if (buffRecipients.length > 0 && canPay) {
        return { actorId: unitId, skillId: moonChaserIds.blessingSkill, targetIds: allies.map(ally => ally.unitId),
          shape: 'all-allies', targetRelation: 'ally' };
      }
      return { actorId: unitId, skillId: moonChaserIds.basic, targetIds: [enemies[0]!.unitId], shape: 'single', targetRelation: 'enemy' };
    },
  };
}

function skillLevel(unit: Readonly<import('../core/types').UnitState>, skillId: string): number {
  return Math.max(1, Math.min(5, unit.skillLevels?.[skillId] ?? unit.skillLevel));
}
