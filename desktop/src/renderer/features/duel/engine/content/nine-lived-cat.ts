import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import { passivesEnabled } from '../core/passive-eligibility';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, StatusInstance } from '../core/types';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import type { ContentRegistry } from './registry';

export const nineLivedCatIds = {
  hero: 207,
  basic: '2071',
  passive: '2072',
  revengeAttack: '2073',
  lives: 'status.hero.207.nine-lives',
  revenge: 'status.hero.207.revenge',
} as const;

export function registerNineLivedCat(registry: ContentRegistry): void {
  registry.registerStatus({ id: nineLivedCatIds.lives, mechanicsCoverage: 'partial', category: 'buff', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'add-stack', maxStacks: 4 });
  registry.registerStatus({ id: nineLivedCatIds.revenge, mechanicsCoverage: 'partial', category: 'mark', dispellable: true,
    sealable: true, durationOwner: 'permanent', refreshPolicy: 'replace' });

  const basic: SkillDefinition = {
    id: nineLivedCatIds.basic, actionKind: 'basic', target: 'single', targetRelation: 'enemy',
    levels: [1, 1.05, 1.1, 1.15, 1.25].map(ratio => ({ ratio })),
    execute(context, intent, parameters) {
      return attack(context, intent.actorId, intent.targetIds[0] ?? '', nineLivedCatIds.basic, Number(parameters.ratio ?? 1));
    },
  };
  const revengeAttack: SkillDefinition = {
    id: nineLivedCatIds.revengeAttack, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 2 },
    target: 'single', targetRelation: 'enemy', levels: [.73, .77, .81, .85, .89].map(ratio => ({ ratio })),
    execute(context, intent, parameters) {
      return Array.from({ length: 3 }, () => attack(context, intent.actorId, intent.targetIds[0] ?? '',
        nineLivedCatIds.revengeAttack, Number(parameters.ratio ?? .73))).flat();
    },
  };
  const definition: HeroDefinition = {
    id: nineLivedCatIds.hero,
    skills: [basic, revengeAttack],
    aiCoverage: 'verified',
    mechanicsCoverage: 'partial',
    handlers: {
      hit: { priority: 125, handle(context, event) {
        if (event.type !== 'damage' || !event.isCritical || !event.source.unitId) return;
        const actor = context.getUnit(event.source.unitId);
        if (!actor || actor.heroId !== nineLivedCatIds.hero || !passivesEnabled(actor)) return;
        if ((actor.statuses.find(status => status.statusId === nineLivedCatIds.lives)?.stacks ?? 0) >= 4) return;
        const source = catSource(nineLivedCatIds.passive, actor.unitId);
        const instance: StatusInstance = { instanceId: `${nineLivedCatIds.lives}:${actor.unitId}`,
          statusId: nineLivedCatIds.lives, source, stacks: 1, duration: { kind: 'permanent' } };
        return [{ type: 'add-status', source, targetId: actor.unitId, instance, parentEventId: event.eventId }];
      } },
      'unit-defeated': { priority: 115, handle(context, event) {
        if (event.type !== 'unit-defeated') return;
        const actor = context.getUnit(event.unitId);
        if (!actor || actor.heroId !== nineLivedCatIds.hero || !passivesEnabled(actor)) return;
        const source = catSource(nineLivedCatIds.passive, actor.unitId);
        const commands: EffectCommand[] = [];
        const killerId = event.defeatedBy?.unitId ?? event.source.unitId;
        const killer = killerId ? context.getUnit(killerId) : undefined;
        if (killer && killer.unitId !== actor.unitId) {
          const revenge: StatusInstance = { instanceId: `${nineLivedCatIds.revenge}:${actor.unitId}:${event.eventId}`,
            statusId: nineLivedCatIds.revenge, source, stacks: 1, duration: { kind: 'permanent' },
            values: { appliedOnDefeat: true } };
          commands.push({ type: 'add-status', source, targetId: killer.unitId, instance: revenge, parentEventId: event.eventId });
        }
        const lives = actor.statuses.find(status => status.statusId === nineLivedCatIds.lives);
        if ((lives?.stacks ?? 0) < 4) return commands;
        commands.push({ type: 'remove-statuses', source, targetId: actor.unitId,
          statusIds: [nineLivedCatIds.lives], reason: 'consumed', parentEventId: event.eventId });
        commands.push({ type: 'revive', source, targetId: actor.unitId, hp: actor.stats.hp * .2, parentEventId: event.eventId });
        const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
        if (enemies.length > 0) {
          const target = enemies[Math.floor(context.random() * enemies.length)]!;
          const ratio = [.73, .77, .81, .85, .89][Math.max(0, Math.min(4, actor.skillLevel - 1))]!;
          const hits = Array.from({ length: 3 }, () => {
            const actorStats = context.getEffectiveStats(actor.unitId) ?? actor.stats;
            const targetStats = context.getEffectiveStats(target.unitId) ?? target.stats;
            const hit = context.calculateDamage({ attack: actorStats.attack, defense: targetStats.defense,
              defenseIgnore: effectiveDefenseIgnore(actor), ratio, critChance: actorStats.crit, critDamage: actorStats.critDamage }, actor, target);
            return { targetId: target.unitId, amount: hit.amount, ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}), isCritical: hit.isCritical };
          });
          const intent: ActionIntent = { actorId: actor.unitId, skillId: nineLivedCatIds.revengeAttack,
            targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy', kind: 'passive' };
          commands.push({ type: 'schedule-attack', source: catSource(nineLivedCatIds.revengeAttack, actor.unitId),
            intent, scheduling: 'counter', hits, parentEventId: event.eventId });
        }
        return commands;
      } },
    },
    policy(context, unitId): ActionIntent | undefined {
      const actor = context.getUnit(unitId);
      if (!actor) return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      if ((context.state.resources[actor.side]?.fire ?? 0) >= 2) {
        const healthy = enemies.filter(enemy => enemy.hp / Math.max(1, enemy.stats.hp) > .4);
        const candidates = healthy.length ? healthy : enemies;
        const target = candidates.slice().sort((left, right) => right.hp / right.stats.hp - left.hp / left.stats.hp)[0]!;
        return { actorId: unitId, skillId: nineLivedCatIds.revengeAttack, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
      }
      const target = enemies.slice().sort((left, right) => left.hp / left.stats.hp - right.hp / right.stats.hp)[0]!;
      return { actorId: unitId, skillId: nineLivedCatIds.basic, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
    },
  };
  registry.registerHero(definition);
}

function attack(context: BattleContext, actorId: string, targetId: string, skillId: string, ratio: number): EffectCommand[] {
  const actor = context.getUnit(actorId);
  const actorStats = context.getEffectiveStats(actorId);
  const target = context.getUnit(targetId);
  const targetStats = target && context.getEffectiveStats(targetId);
  if (!actor || !actorStats || !target || !targetStats) return [];
  const hit = context.calculateDamage({ attack: actorStats.attack, defense: targetStats.defense,
    defenseIgnore: effectiveDefenseIgnore(actor), ratio, critChance: actorStats.crit,
    critDamage: actorStats.critDamage }, actor, target);
  return [{ type: 'deal-damage', source: catSource(skillId, actor.unitId), targetId: target.unitId,
    amount: hit.amount, ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}), isCritical: hit.isCritical }];
}

function catSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
