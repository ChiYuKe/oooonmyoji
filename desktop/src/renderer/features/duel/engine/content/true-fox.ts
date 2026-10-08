import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import type { ActionIntent, BattleEvent, EffectCommand, StatusInstance, UnitState } from '../core/types';
import { createBasicAttackSkill } from './common-skills';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import type { ContentRegistry } from './registry';

export const trueFoxIds = {
  hero: 559,
  basic: '5591',
  passive: '5592',
  skill: '5593',
  followUp: '55921',
  guard: 'status.hero.559.fox-guard',
  flames: 'status.hero.559.heart-flames',
  seal: 'status.hero.559.fox-seal',
  hitProgress: 'status.hero.559.hit-progress',
} as const;

/** 本真三尾狐 migration. Reactive threshold hits use the attack event window. */
export function registerTrueFox(registry: ContentRegistry): void {
  registry.registerStatus({ id: trueFoxIds.guard, mechanicsCoverage: 'verified', category: 'shield', dispellable: false,
    sealable: false, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerStatus({ id: trueFoxIds.flames, mechanicsCoverage: 'partial', category: 'mark', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace', maxStacks: 3 });
  registry.registerStatus({ id: trueFoxIds.seal, mechanicsCoverage: 'verified', category: 'debuff', dispellable: true,
    sealable: false, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerStatus({ id: trueFoxIds.hitProgress, mechanicsCoverage: 'partial', category: 'other', dispellable: false,
    sealable: false, durationOwner: 'event', refreshPolicy: 'replace' });
  registry.registerHero(createTrueFoxDefinition());
}

export function createTrueFoxDefinition(): HeroDefinition {
  const basic = createBasicAttackSkill(trueFoxIds.basic, [1, 1.05, 1.1, 1.15, 1.25]);
  const skill: SkillDefinition = {
    id: trueFoxIds.skill,
    resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'all-enemies',
    targetRelation: 'enemy',
    levels: [1.05, 1.25, 1.35, 1.45, 1.45].map(ratio => ({ ratio })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      const actorStats = context.getEffectiveStats(intent.actorId);
      if (!actor || !actorStats) return [];
      const ratio = Number(parameters.ratio ?? 1.05);
      const primaryId = intent.targetIds[0];
      const source = { kind: 'skill' as const, id: trueFoxIds.skill, unitId: actor.unitId };
      return intent.targetIds.flatMap(targetId => {
        const target = context.getUnit(targetId);
        const targetStats = target && context.getEffectiveStats(targetId);
        if (!target || !targetStats) return [];
        const result = context.calculateDamage({ attack: actorStats.attack, defense: targetStats.defense,
          defenseIgnore: effectiveDefenseIgnore(actor), ratio,
          critChance: actorStats.crit, critDamage: actorStats.critDamage }, actor, target);
        return [{ type: 'deal-damage' as const, source, targetId, amount: result.amount, ...(result.damageOptions ? { damageOptions: result.damageOptions } : {}),
          ...(result.isCritical ? { criticalBaseAmount: result.amount / Math.max(1, actorStats.critDamage) } : {}), isCritical: result.isCritical }];
      });
    },
  };

  return {
    id: trueFoxIds.hero,
    skills: [basic, skill],
    aiCoverage: 'verified',
    mechanicsCoverage: 'partial',
    initialize(context, unitId) {
      const unit = context.getUnit(unitId);
      if (!unit || unit.skillLevel < 5) return [];
      return [guardCommand(unit, context.getEffectiveStats(unitId)?.attack ?? unit.stats.attack, unit.skillLevel, 'opening'),
        flamesCommand(unit, 3, trueFoxIds.passive)];
    },
    handlers: {
      'turn-start': { priority: 10, handle(context, event) {
        if (event.type !== 'turn-started') return;
        const unit = context.getUnit(event.unitId);
        if (!unit) return;
        const seal = unit.statuses.find(status => status.statusId === trueFoxIds.seal);
        if (!seal) return;
        const attack = Number(seal.values?.attack ?? 0);
        const missing = Math.max(0, unit.stats.hp - unit.hp);
        const damage = Math.min(attack * 10, missing * .5);
        return [
          { type: 'lose-life', source: { kind: 'status', id: trueFoxIds.seal, unitId: seal.source.unitId },
            targetId: unit.unitId, amount: damage, parentEventId: event.eventId },
          { type: 'remove-statuses', source: { kind: 'status', id: trueFoxIds.seal, unitId: seal.source.unitId },
            targetId: unit.unitId, statusIds: [trueFoxIds.seal], reason: 'consumed', parentEventId: event.eventId },
        ];
      } },
      'hit': { priority: 20, handle(context, event) {
        if (event.type !== 'damage' || event.damageKind !== 'normal' || !event.source.unitId) return;
        const attacker = context.getUnit(event.source.unitId);
        const target = context.getUnit(event.targetId);
        if (!attacker || attacker.hp <= 0 || attacker.heroId !== trueFoxIds.hero || !target) return;
        const commands: EffectCommand[] = [];
        if (event.source.id === trueFoxIds.basic || event.source.id === trueFoxIds.followUp) {
          if (event.source.id === trueFoxIds.basic && event.hpLost > 0) commands.push({ type: 'heal',
            source: { kind: 'skill', id: trueFoxIds.passive, unitId: attacker.unitId }, targetId: attacker.unitId, amount: event.hpLost * .2,
            parentEventId: event.eventId });
          if (target.hp > 0) commands.push(foxSealCommand(attacker, target, context.getEffectiveStats(attacker.unitId)?.attack ?? attacker.stats.attack,
            `${event.eventId}:mark`));
        }
        if (event.source.id !== trueFoxIds.skill || target.hp <= 0) return commands;
        const before = event.hpBefore ?? target.hp;
        const maxHp = Math.max(1, target.stats.hp);
        const instanceKey = `${trueFoxIds.hitProgress}:${attacker.unitId}:${event.attackId}:${target.unitId}`;
        const previous = attacker.statuses.find(status => status.statusId === trueFoxIds.hitProgress
          && status.source.id === instanceKey);
        const hits = Number(previous?.values?.hits ?? 1);
        const nextThreshold = Number(previous?.values?.nextThreshold ?? (Math.floor(before / maxHp * 4) / 4 - .25));
        const updated: StatusInstance = { instanceId: instanceKey, statusId: trueFoxIds.hitProgress,
          source: { kind: 'status', id: instanceKey, unitId: attacker.unitId }, stacks: 1,
          duration: { kind: 'count', remaining: 1, owner: 'event', event: 'attack-end' },
          values: { hits, nextThreshold } };
        commands.push({ type: 'add-status', source: updated.source, targetId: attacker.unitId, instance: updated,
          parentEventId: event.eventId });
        if (hits < 5 && target.hp > 0 && target.hp / maxHp <= nextThreshold) {
          const actorStats = context.getEffectiveStats(attacker.unitId) ?? attacker.stats;
          const targetStats = context.getEffectiveStats(target.unitId) ?? target.stats;
          const ratios = [1.05, 1.25, 1.35, 1.45, 1.45];
          const result = context.calculateDamage({ attack: actorStats.attack, defense: targetStats.defense,
            defenseIgnore: effectiveDefenseIgnore(attacker),
            ratio: ratios[Math.max(0, Math.min(4, attacker.skillLevel - 1))]!, critChance: actorStats.crit, critDamage: actorStats.critDamage }, attacker, target);
          commands.push({ type: 'add-status', source: updated.source, targetId: attacker.unitId,
            instance: { ...updated, values: { hits: hits + 1, nextThreshold: nextThreshold - .25 } }, parentEventId: event.eventId });
          commands.push({ type: 'deal-damage', source: { kind: 'skill', id: trueFoxIds.skill, unitId: attacker.unitId },
            targetId: target.unitId, amount: result.amount, ...(result.damageOptions ? { damageOptions: result.damageOptions } : {}),
            ...(result.isCritical ? { criticalBaseAmount: result.amount / Math.max(1, actorStats.critDamage) } : {}),
            isCritical: result.isCritical, parentEventId: event.eventId });
        }
        return commands;
      } },
      'attack-end': { priority: 20, handle(context, event) {
        if (event.type !== 'attack-ended') return;
        const commands: EffectCommand[] = [];
        if (event.source.unitId && event.source.id === trueFoxIds.skill) {
          const actor = context.getUnit(event.source.unitId);
          const primary = event.targetHealthChanges?.[0] && context.getUnit(event.targetHealthChanges[0].targetId);
          if (actor?.skillLevel === 5 && primary && primary.hp > 0) commands.push(foxSealCommand(actor, primary,
            context.getEffectiveStats(actor.unitId)?.attack ?? actor.stats.attack, `${event.eventId}:primary-mark`));
          if (actor) commands.push({ type: 'remove-statuses', source: { kind: 'system', id: 'fox-hit-sequence', unitId: actor.unitId },
            targetId: actor.unitId, statusIds: [trueFoxIds.hitProgress], reason: 'consumed', parentEventId: event.eventId });
        }

        for (const side of ['blue', 'red'] as const) for (const fox of context.getLivingUnits(side).filter(unit => unit.heroId === trueFoxIds.hero)) {
          const flames = fox.statuses.find(status => status.statusId === trueFoxIds.flames);
          if (!flames || flames.stacks <= 0 || fox.statuses.some(status => context.getStatusCategory(status.statusId) === 'control')) continue;
          let remaining = flames.stacks;
          let lastTarget = String(flames.values?.lastTargetId ?? '');
          let sameTargetCount = Number(flames.values?.sameTargetCount ?? 0);
          for (const change of event.targetHealthChanges ?? []) {
            const target = context.getUnit(change.targetId);
            if (!target || target.side === fox.side || target.hp <= 0 || change.hpBefore <= 0
              || change.hpLost < target.stats.hp * .1 || change.hpLost / change.hpBefore <= .25 || remaining <= 0) continue;
            const count = lastTarget === target.unitId ? sameTargetCount + 1 : 0;
            lastTarget = target.unitId;
            sameTargetCount = count;
            remaining--;
            const foxStats = context.getEffectiveStats(fox.unitId) ?? fox.stats;
            const targetStats = context.getEffectiveStats(target.unitId) ?? target.stats;
            const result = context.calculateDamage({ attack: foxStats.attack, defense: targetStats.defense,
              defenseIgnore: effectiveDefenseIgnore(fox),
              ratio: .168 * Math.pow(.7, count), critChance: foxStats.crit, critDamage: foxStats.critDamage }, fox, target);
            commands.push({ type: 'schedule-attack', source: { kind: 'skill', id: trueFoxIds.followUp, unitId: fox.unitId },
              intent: { actorId: fox.unitId, skillId: trueFoxIds.followUp, targetIds: [target.unitId], shape: 'single',
                targetRelation: 'enemy', kind: 'passive' },
              scheduling: 'assist', hits: [{ targetId: target.unitId, amount: result.amount, ...(result.damageOptions ? { damageOptions: result.damageOptions } : {}),
                ...(result.isCritical ? { criticalBaseAmount: result.amount / Math.max(1, foxStats.critDamage) } : {}), isCritical: result.isCritical }],
              parentEventId: event.eventId });
            if (fox.skillLevel >= 3) commands.push({ type: 'change-action-gauge', source: { kind: 'skill', id: trueFoxIds.followUp,
              unitId: fox.unitId }, targetId: fox.unitId, amount: 10, parentEventId: event.eventId });
            if (target.hp > 0) commands.push(foxSealCommand(fox, target, foxStats.attack, `${event.eventId}:follow-mark:${target.unitId}`));
          }
          if (remaining !== flames.stacks) {
            if (remaining > 0) commands.push(flamesCommand(fox, remaining, trueFoxIds.passive, { lastTargetId: lastTarget, sameTargetCount }));
            else commands.push({ type: 'remove-statuses', source: { kind: 'skill', id: trueFoxIds.passive, unitId: fox.unitId },
              targetId: fox.unitId, statusIds: [trueFoxIds.flames], reason: 'consumed', parentEventId: event.eventId });
          }
        }
        return commands;
      } },
      'turn-end': { priority: 10, handle(context, event) {
        if (event.type !== 'turn-ended') return;
        const fox = context.getUnit(event.unitId);
        if (!fox || fox.heroId !== trueFoxIds.hero) return;
        const commands: EffectCommand[] = [];
        const guard = fox.statuses.find(status => status.statusId === trueFoxIds.guard);
        const oldShield = Number(guard?.values?.shieldRemaining ?? 0);
        if (guard) commands.push({ type: 'remove-statuses', source: { kind: 'skill', id: trueFoxIds.passive, unitId: fox.unitId },
          targetId: fox.unitId, statusIds: [trueFoxIds.guard], reason: 'consumed', parentEventId: event.eventId });
        if (oldShield > 0 && fox.skillLevel >= 4) commands.push({ type: 'heal',
          source: { kind: 'skill', id: trueFoxIds.passive, unitId: fox.unitId }, targetId: fox.unitId, amount: oldShield * .8,
          parentEventId: event.eventId });
        const attack = context.getEffectiveStats(fox.unitId)?.attack ?? fox.stats.attack;
        commands.push(guardCommand(fox, attack, fox.skillLevel, String(context.state.counters.action)), flamesCommand(fox, 3, trueFoxIds.passive));
        return commands;
      } },
      'status-expiration': { priority: 10, handle(context, event) {
        if (event.type !== 'status-removed' || event.reason !== 'expired' || event.statusId !== trueFoxIds.guard) return;
        const target = context.getUnit(event.targetId);
        const remaining = Number(event.removedValues?.shieldRemaining ?? 0);
        if (!target || target.heroId !== trueFoxIds.hero || target.skillLevel < 4 || remaining <= 0) return;
        return [{ type: 'heal', source: { kind: 'skill', id: trueFoxIds.passive, unitId: target.unitId }, targetId: target.unitId,
          amount: remaining * .8, parentEventId: event.eventId }];
      } },
    },
    policy(context, unitId): ActionIntent | undefined {
      const actor = context.getUnit(unitId);
      if (!actor) return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue').slice().sort((a, b) => a.hp - b.hp || a.unitId.localeCompare(b.unitId));
      if (enemies.length === 0) return undefined;
      if ((context.state.resources[actor.side]?.fire ?? 0) >= 3) return { actorId: unitId, skillId: trueFoxIds.skill,
        targetIds: enemies.map(enemy => enemy.unitId), shape: 'all-enemies', targetRelation: 'enemy' };
      return { actorId: unitId, skillId: trueFoxIds.basic, targetIds: [enemies[0]!.unitId], shape: 'single', targetRelation: 'enemy' };
    },
  };
}

function guardCommand(unit: Readonly<UnitState>, attack: number, skillLevel: number, nonce: string): EffectCommand {
  const ratio = skillLevel >= 2 ? 1.4 : .9;
  const source = { kind: 'skill' as const, id: trueFoxIds.passive, unitId: unit.unitId };
  return { type: 'add-status', source, targetId: unit.unitId, instance: {
    instanceId: `${trueFoxIds.guard}:${unit.unitId}:${nonce}`,
    statusId: trueFoxIds.guard, source, stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' },
    values: { shieldRemaining: Math.max(0, attack * ratio) },
  } };
}

function flamesCommand(unit: Readonly<UnitState>, stacks: number, sourceId: string,
  values: Readonly<Record<string, number | string | boolean>> = {}): EffectCommand {
  const source = { kind: 'skill' as const, id: sourceId, unitId: unit.unitId };
  return { type: 'add-status', source, targetId: unit.unitId, instance: {
    instanceId: `${trueFoxIds.flames}:${unit.unitId}:${unit.statuses.length}:${Math.round(unit.hp)}`,
    statusId: trueFoxIds.flames, source, stacks: Math.max(0, Math.min(3, stacks)), duration: { kind: 'permanent' },
    modifiers: [{ stat: 'defense', operation: 'percent', amount: Math.max(0, Math.min(3, stacks)) * .15 }], values,
  } };
}

function foxSealCommand(fox: Readonly<UnitState>, target: Readonly<UnitState>, attack: number, nonce: string): EffectCommand {
  const source = { kind: 'skill' as const, id: trueFoxIds.passive, unitId: fox.unitId };
  return { type: 'add-status', source, targetId: target.unitId, instance: {
    instanceId: `${trueFoxIds.seal}:${fox.unitId}:${target.unitId}:${nonce}`, statusId: trueFoxIds.seal, source, stacks: 1,
    duration: { kind: 'count', remaining: 5, owner: 'target-turn' }, values: { attack },
  } };
}
