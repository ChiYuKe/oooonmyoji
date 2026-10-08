import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import type { ActionIntent, EffectCommand, StatusInstance } from '../core/types';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import type { ContentRegistry } from './registry';

export const songstressIds = {
  hero: 582,
  basic: '5821',
  passive: '5822',
  tour: '5823',
  harmony: 'status.hero.582.harmony',
  resonanceWall: 'status.hero.582.resonance-wall',
  controlSpeed: 'status.hero.582.control-speed',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;

/** Modular migration for 巡音流歌. Seal interactions and summon filtering remain partial. */
export function registerSongstress(registry: ContentRegistry): void {
  registry.registerStatus({ id: songstressIds.harmony, mechanicsCoverage: 'partial', category: 'mark', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace', maxStacks: 5 });
  registry.registerStatus({ id: songstressIds.resonanceWall, mechanicsCoverage: 'verified', category: 'shield', dispellable: false,
    sealable: false, durationOwner: 'target-turn', refreshPolicy: 'add-stack', maxStacks: 2, absorbsCriticalBonus: true });
  registry.registerStatus({ id: songstressIds.controlSpeed, mechanicsCoverage: 'verified', category: 'buff', dispellable: true,
    sealable: false, durationOwner: 'target-turn', refreshPolicy: 'refresh-duration' });
  registry.registerHero(createSongstressDefinition());
}

export function createSongstressDefinition(): HeroDefinition {
  const basic: SkillDefinition = {
    id: songstressIds.basic,
    target: 'single',
    targetRelation: 'enemy',
    levels: basicRatios.map(ratio => ({ ratio })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      const target = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || !target) return [];
      const actorStats = context.getEffectiveStats(actor.unitId) ?? actor.stats;
      const targetStats = context.getEffectiveStats(target.unitId) ?? target.stats;
      const result = context.calculateDamage({ attack: actorStats.attack, defense: targetStats.defense, defenseIgnore: effectiveDefenseIgnore(actor),
        ratio: Number(parameters.ratio ?? 1), critChance: actorStats.crit, critDamage: actorStats.critDamage }, actor, target);
      return [{ type: 'deal-damage', source: { kind: 'skill', id: songstressIds.basic, unitId: actor.unitId },
        targetId: target.unitId, amount: result.amount, ...(result.damageOptions ? { damageOptions: result.damageOptions } : {}),
        ...(result.isCritical ? { criticalBaseAmount: result.amount / Math.max(1, actorStats.critDamage) } : {}), isCritical: result.isCritical }];
    },
  };
  const tour: SkillDefinition = {
    id: songstressIds.tour,
    resourceCost: { resourceId: 'fire', amount: 3 },
    resourceCostsByLevel: [3, 3, 3, 3, 2].map(amount => ({ resourceId: 'fire', amount })),
    target: 'all-allies',
    targetRelation: 'ally',
    levels: [{ harmony: 0, gauge: false }, { harmony: 1, gauge: false }, { harmony: 2, gauge: false },
      { harmony: 2, gauge: true }, { harmony: 2, gauge: true }],
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      if (!actor) return [];
      const source = { kind: 'skill' as const, id: songstressIds.tour, unitId: actor.unitId };
      const commands: EffectCommand[] = [];
      for (const targetId of intent.targetIds) {
        const target = context.getUnit(targetId);
        if (!target || target.hp <= 0) continue;
        commands.push({ type: 'dispel-statuses', source, targetId, filter: 'debuff-or-control', maxCount: 1,
          preferCategories: ['control', 'debuff'] });
        const currentWall = target.statuses.find(status => status.statusId === songstressIds.resonanceWall
          && status.source.unitId === actor.unitId);
        const canAddLayer = !currentWall || currentWall.stacks < 2;
        const initialResist = typeof currentWall?.values?.initialResist === 'number'
          ? currentWall.values.initialResist : Math.max(0, target.stats.resist);
        const wall: StatusInstance = {
          instanceId: `${songstressIds.resonanceWall}:${actor.unitId}:${target.unitId}:${context.state.counters.action + 1}`,
          statusId: songstressIds.resonanceWall, source, stacks: 1,
          duration: { kind: 'count', remaining: 2, owner: 'target-turn' },
          values: { criticalAbsorbRemaining: canAddLayer ? initialResist * 8000 : 0, initialResist },
        };
        commands.push({ type: 'add-status', source, targetId, instance: wall });
      }
      const harmonyCount = Number(parameters.harmony ?? 0);
      if (harmonyCount > 0) {
        const existing = actor.statuses.find(status => status.statusId === songstressIds.harmony && status.source.unitId === actor.unitId);
        commands.push({ type: 'add-status', source, targetId: actor.unitId, instance: {
          instanceId: `${songstressIds.harmony}:${actor.unitId}:${context.state.counters.action + 1}`,
          statusId: songstressIds.harmony, source, stacks: Math.min(5, (existing?.stacks ?? 0) + harmonyCount), duration: { kind: 'permanent' },
          values: { progress: existing?.values?.progress ?? 0 },
        } });
      }
      return commands;
    },
  };

  return {
    id: songstressIds.hero,
    skills: [basic, tour],
    aiCoverage: 'verified',
    mechanicsCoverage: 'partial',
    modifyIncomingDamage(_attacker, target, amount) {
      if (target.skillLevel < 4) return amount;
      const reduction = Math.min(.9, Math.floor(Math.max(0, target.stats.resist) / .4) * .1);
      return amount * (1 - reduction);
    },
    handlers: {
      'effect-resolution': { priority: 20, handle(context, event) {
        if (event.type === 'status-added') {
          const appliedDefinition = context.getUnit(event.targetId);
          const status = appliedDefinition?.statuses.find(candidate => candidate.instanceId === event.instance.instanceId);
          if (!appliedDefinition || !status) return;
          // The passive counts each newly applied debuff/control once per living teammate.
          // Generic status coverage is provided by registered content metadata.
          const category = context.getStatusCategory(status.statusId);
          if (category !== 'debuff' && category !== 'control') return;
          const singers = Object.values(context.state.units).filter(unit => unit.hp > 0 && unit.side === appliedDefinition.side
            && unit.heroId === songstressIds.hero);
          const commands: EffectCommand[] = [];
          for (const singer of singers) {
            const meter = singer.statuses.find(item => item.statusId === songstressIds.harmony && item.source.unitId === singer.unitId);
            const stacks = Math.min(5, meter?.stacks ?? 0);
            if (stacks >= 5) continue;
            const progress = Number(meter?.values?.progress ?? 0) + 1;
            const gained = progress >= 3 ? 1 : 0;
            commands.push({ type: 'add-status', source: { kind: 'skill', id: songstressIds.passive, unitId: singer.unitId },
              targetId: singer.unitId, instance: { instanceId: `${songstressIds.harmony}:${singer.unitId}:progress`,
                statusId: songstressIds.harmony, source: { kind: 'skill', id: songstressIds.passive, unitId: singer.unitId },
                stacks: Math.min(5, stacks + gained), duration: { kind: 'permanent' }, values: { progress: gained ? progress - 3 : progress } },
              parentEventId: event.eventId });
          }
          return commands;
        }
        if (event.type !== 'status-removed') return;
        const target = context.getUnit(event.targetId);
        if (!target) return;
        const commands: EffectCommand[] = [];
        if (event.statusCategory === 'control' && target.heroId === songstressIds.hero && target.hp > 0 && target.skillLevel >= 2) {
          const amount = target.skillLevel >= 3 ? 60 : 40;
          commands.push({ type: 'add-status', source: { kind: 'skill', id: songstressIds.passive, unitId: target.unitId },
            targetId: target.unitId, instance: { instanceId: `${songstressIds.controlSpeed}:${target.unitId}:${context.state.counters.action}`,
              statusId: songstressIds.controlSpeed, source: { kind: 'skill', id: songstressIds.passive, unitId: target.unitId },
              stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' }, modifiers: [{ stat: 'speed', operation: 'flat', amount }] },
            parentEventId: event.eventId });
        }
        if (event.reason === 'dispelled' && event.source.kind === 'skill' && event.source.id === songstressIds.tour
          && (context.getUnit(event.source.unitId ?? '')?.skillLevel ?? 0) >= 4
          && target.statuses.some(status => status.instanceId !== event.instanceId)) {
          const remainingControl = target.statuses.some(status => status.instanceId !== event.instanceId
            && context.getStatusCategory(status.statusId) === 'control');
          if (remainingControl) commands.push({ type: 'change-action-gauge', source: event.source, targetId: target.unitId,
            amount: 30, parentEventId: event.eventId });
        }
        const harmonySinger = event.source.kind === 'skill' && event.source.id === songstressIds.passive
          ? context.getUnit(event.source.unitId ?? '') : undefined;
        if (event.reason === 'dispelled' && harmonySinger?.heroId === songstressIds.hero && harmonySinger.skillLevel >= 5
          && event.statusCategory && ['control', 'debuff'].includes(event.statusCategory)) {
          const current = target.statuses.find(status => status.statusId === songstressIds.resonanceWall
            && status.source.unitId === harmonySinger.unitId);
          const initialResist = typeof current?.values?.initialResist === 'number' ? current.values.initialResist : target.stats.resist;
          commands.push({ type: 'add-status', source: { kind: 'skill', id: songstressIds.passive, unitId: harmonySinger.unitId },
            targetId: target.unitId, instance: { instanceId: `${songstressIds.resonanceWall}:${harmonySinger.unitId}:${target.unitId}:harmony:${context.state.counters.action}`,
              statusId: songstressIds.resonanceWall, source: { kind: 'skill', id: songstressIds.passive, unitId: harmonySinger.unitId },
              stacks: 1, duration: { kind: 'count', remaining: 2, owner: 'target-turn' },
              values: { criticalAbsorbRemaining: current && current.stacks >= 2 ? 0 : Math.max(0, initialResist) * 8000, initialResist } },
            parentEventId: event.eventId });
        }
        return commands;
      } },
      'turn-end': { priority: 20, handle(context, event) {
        if (event.type !== 'turn-ended') return;
        const commands: EffectCommand[] = [];
        for (const side of ['blue', 'red'] as const) {
          const allies = context.getLivingUnits(side);
          const singers = allies.filter(unit => unit.heroId === songstressIds.hero
            && (unit.statuses.find(status => status.statusId === songstressIds.harmony && status.source.unitId === unit.unitId)?.stacks ?? 0) > 0);
          for (const singer of singers) {
            const candidates = allies.map((unit, index) => ({ unit, index, controls: unit.statuses.filter(status => context.getStatusCategory(status.statusId) === 'control').length,
              debuffs: unit.statuses.filter(status => context.getStatusCategory(status.statusId) === 'debuff').length }));
            candidates.sort((a, b) => Number(b.controls > 0) - Number(a.controls > 0)
              || (b.controls + b.debuffs) - (a.controls + a.debuffs) || a.index - b.index);
            const target = candidates[0]?.unit;
            if (!target) continue;
            const harmony = singer.statuses.find(status => status.statusId === songstressIds.harmony && status.source.unitId === singer.unitId)!;
            const left = harmony.stacks - 1;
            if (left > 0) commands.push({ type: 'add-status', source: { kind: 'skill', id: songstressIds.passive, unitId: singer.unitId },
              targetId: singer.unitId, instance: { ...harmony, instanceId: `${songstressIds.harmony}:${singer.unitId}:turn:${context.state.counters.action}`,
                stacks: left }, parentEventId: event.eventId });
            else commands.push({ type: 'remove-statuses', source: { kind: 'skill', id: songstressIds.passive, unitId: singer.unitId },
              targetId: singer.unitId, statusIds: [songstressIds.harmony], reason: 'consumed', parentEventId: event.eventId });
            commands.push({ type: 'dispel-statuses', source: { kind: 'skill', id: songstressIds.passive, unitId: singer.unitId },
              targetId: target.unitId, filter: 'debuff-or-control', maxCount: 2, preferCategories: ['control', 'debuff'], parentEventId: event.eventId });
          }
        }
        return commands;
      } },
    },
    policy(context, unitId): ActionIntent | undefined {
      const actor = context.getUnit(unitId);
      if (!actor) return undefined;
      const allies = context.getLivingUnits(actor.side);
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (enemies.length === 0) return undefined;
      const cost = actor.skillLevel >= 5 ? 2 : 3;
      if ((context.state.resources[actor.side]?.fire ?? 0) >= cost) return { actorId: unitId, skillId: songstressIds.tour,
        targetIds: allies.map(ally => ally.unitId), shape: 'all-allies', targetRelation: 'ally' };
      return { actorId: unitId, skillId: songstressIds.basic, targetIds: [enemies[0]!.unitId], shape: 'single', targetRelation: 'enemy' };
    },
  };
}
