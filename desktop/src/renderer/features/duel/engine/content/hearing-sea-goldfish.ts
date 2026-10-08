import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, StatusInstance, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { attemptDebuff } from '../mechanics/control';
import type { ContentRegistry } from './registry';

export const hearingSeaGoldfishIds = {
  hero: 346, basic: '3461', passive: '3462', ultimate: '3463',
  resentment: 'status.hero.346.resentment', concentration: 'status.hero.346.concentration',
  shield: 'status.hero.346.spirit-fish-shield', field: 'status.hero.346.fish-tail-field',
  surge: 'status.hero.346.surge', bind: 'status.hero.346.current-bind', slow: 'status.hero.346.current-slow',
  slowPending: 'status.hero.346.current-slow-pending',
} as const;

const basicRatios = [.8, .85, .9, .95, 1] as const;

/** Hearing Sea Goldfish Princess; the noncritical-only field reduction and target-priority details remain partial. */
export function registerHearingSeaGoldfish(registry: ContentRegistry): void {
  const status = (id: string, values: Omit<Parameters<ContentRegistry['registerStatus']>[0], 'id'>) =>
    registry.registerStatus({ id, mechanicsCoverage: 'partial', ...values });
  status(hearingSeaGoldfishIds.resentment, { category: 'debuff', dispellable: true, sealable: true,
    durationOwner: 'target-turn', refreshPolicy: 'replace', maxStacks: 3 });
  status(hearingSeaGoldfishIds.concentration, { category: 'buff', dispellable: false, sealable: false,
    durationOwner: 'permanent', refreshPolicy: 'replace', maxStacks: 8 });
  status(hearingSeaGoldfishIds.shield, { category: 'shield', dispellable: false, sealable: false,
    durationOwner: 'target-turn', refreshPolicy: 'replace' });
  status(hearingSeaGoldfishIds.field, { category: 'buff', dispellable: false, sealable: false,
    durationOwner: 'source-turn', refreshPolicy: 'replace' });
  status(hearingSeaGoldfishIds.surge, { category: 'other', dispellable: false, sealable: false,
    durationOwner: 'round', refreshPolicy: 'replace', maxStacks: 3 });
  status(hearingSeaGoldfishIds.bind, { category: 'debuff', dispellable: true, sealable: true,
    durationOwner: 'target-turn', refreshPolicy: 'replace', preventsActionGaugeChange: true });
  status(hearingSeaGoldfishIds.slow, { category: 'debuff', dispellable: true, sealable: true,
    durationOwner: 'target-turn', refreshPolicy: 'replace' });
  status(hearingSeaGoldfishIds.slowPending, { category: 'other', dispellable: false, sealable: false,
    durationOwner: 'permanent', refreshPolicy: 'replace' });
  registry.registerHero(createHearingSeaGoldfishDefinition());
}

export function createHearingSeaGoldfishDefinition(): HeroDefinition {
  const basic: SkillDefinition = { id: hearingSeaGoldfishIds.basic, target: 'single', targetRelation: 'enemy',
    levels: basicRatios.map(ratio => ({ ratio })), execute(context, intent, params) {
      const owner = context.getUnit(intent.actorId); const target = context.getUnit(intent.targetIds[0] ?? '');
      if (!owner || !target) return [];
      const source = goldfishSource(hearingSeaGoldfishIds.basic, owner.unitId);
      const attack = context.getEffectiveStats(owner.unitId) ?? owner.stats;
      const defense = context.getEffectiveStats(target.unitId) ?? target.stats;
      const hit = context.calculateDamage({ attack: attack.attack, defense: defense.defense,
        ratio: Number(params.ratio ?? .8), critChance: attack.crit, critDamage: attack.critDamage }, owner, target);
      return [{ type: 'deal-damage', source, targetId: target.unitId,
        amount: hit.amount, ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}), isCritical: hit.isCritical },
      { type: 'dispel-statuses', source, targetId: target.unitId, maxCount: 1, filter: 'buff' }];
    } };
  const ultimate: SkillDefinition = { id: hearingSeaGoldfishIds.ultimate, resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'single', targetRelation: 'enemy', levels: [{}, {}, {}, {}, {}],
    resolveResourceCost(_state, owner) { return { resourceId: 'fire', amount: skillRank(owner, hearingSeaGoldfishIds.ultimate) >= 5 ? 2 : 3 }; },
    execute(context, intent) {
      const owner = context.getUnit(intent.actorId); const target = context.getUnit(intent.targetIds[0] ?? '');
      if (!owner || !target) return [];
      const source = goldfishSource(hearingSeaGoldfishIds.ultimate, owner.unitId);
      return [
        ...addResentment(context, owner, target, source, 3),
        ...openField(context, owner, source, 10),
        addSurge(owner, source),
      ];
    } };
  return { id: hearingSeaGoldfishIds.hero, skills: [basic, ultimate], aiCoverage: 'partial', mechanicsCoverage: 'partial',
    initialize(context, unitId) {
      const owner = context.getUnit(unitId); if (!owner) return [];
      const source = goldfishSource(hearingSeaGoldfishIds.passive, unitId);
      const commands: EffectCommand[] = [{ type: 'add-status', source, targetId: unitId,
        instance: concentration(owner, source, 4) }];
      return commands;
    },
    handlers: {
      hit: { priority: 25, handle(context, event) {
        if (event.type !== 'damage' || event.hpLost <= 0 || !event.source.unitId) return;
        const target = context.getUnit(event.targetId); const attacker = context.getUnit(event.source.unitId);
        if (!target || !attacker || target.side === attacker.side || event.amount <= target.stats.hp * .3) return;
        const commands: EffectCommand[] = [];
        for (const owner of context.getLivingUnits(target.side)) if (owner.heroId === hearingSeaGoldfishIds.hero && passivesEnabled(owner))
          commands.push(...addResentment(context, owner, attacker, goldfishSource(hearingSeaGoldfishIds.basic, owner.unitId),
            3, event.eventId));
        return commands;
      } },
      'turn-end': { priority: 25, handle(context, event) {
        if (event.type !== 'turn-ended') return;
        const ending = context.getUnit(event.unitId); if (!ending) return;
        const commands: EffectCommand[] = [];
        if (ending.statuses.some(status => status.statusId === hearingSeaGoldfishIds.slowPending)) {
          const source = goldfishSource(hearingSeaGoldfishIds.passive, ending.unitId);
          commands.push({ type: 'remove-statuses', source, targetId: ending.unitId,
            statusIds: [hearingSeaGoldfishIds.slowPending], reason: 'consumed' });
          commands.push({ type: 'add-status', source, targetId: ending.unitId, instance: {
            instanceId: `${hearingSeaGoldfishIds.slow}:${ending.unitId}`, statusId: hearingSeaGoldfishIds.slow,
            source, stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' },
            modifiers: [{ stat: 'speed', operation: 'percent', amount: -.4 }],
          } });
        }
        for (const owner of context.getLivingUnits(ending.side === 'blue' ? 'red' : 'blue')) {
          if (owner.heroId !== hearingSeaGoldfishIds.hero || !passivesEnabled(owner)) continue;
          const source = goldfishSource(hearingSeaGoldfishIds.passive, owner.unitId);
          commands.push(gainConcentration(owner, source));
          if (!owner.statuses.some(status => status.statusId === hearingSeaGoldfishIds.shield)) commands.push(shield(owner, source));
        }
        for (const owner of context.getLivingUnits(ending.side)) {
          if (owner.heroId !== hearingSeaGoldfishIds.hero || !passivesEnabled(owner)) continue;
          const field = owner.statuses.some(s => s.statusId === hearingSeaGoldfishIds.field);
          const source = goldfishSource(hearingSeaGoldfishIds.ultimate, owner.unitId);
          if (field && !context.isUnitUnableToAct(owner.unitId)) {
            for (const ally of context.getLivingUnits(owner.side)) commands.push({ type: 'heal', source, targetId: ally.unitId,
              amount: (context.getEffectiveStats(owner.unitId)?.attack ?? owner.stats.attack)
                * (ally.hp / ally.stats.hp <= .5 && skillRank(owner, hearingSeaGoldfishIds.ultimate) >= 4 ? 1.5 : .5),
              parentEventId: event.eventId });
            commands.push(...triggerSurge(context, owner, source, event.eventId));
          }
        }
        return commands;
      } },
      'effect-resolution': { priority: 25, handle(context, event) {
        if (event.type === 'action-gauge-changed' && event.after > event.before) {
          const target = context.getUnit(event.unitId); if (!target) return;
          const commands: EffectCommand[] = [];
          for (const owner of context.getLivingUnits(target.side === 'blue' ? 'red' : 'blue')) {
            if (owner.heroId !== hearingSeaGoldfishIds.hero || !owner.statuses.some(s => s.statusId === hearingSeaGoldfishIds.field)) continue;
            const source = goldfishSource(hearingSeaGoldfishIds.passive, owner.unitId);
            commands.push(addSurge(owner, source, event.eventId));
            commands.push({ type: 'add-status', source, targetId: target.unitId, parentEventId: event.eventId,
              instance: { instanceId: `${hearingSeaGoldfishIds.slowPending}:${owner.unitId}:${target.unitId}`,
                statusId: hearingSeaGoldfishIds.slowPending, source, stacks: 1, duration: { kind: 'permanent' } } });
          }
          return commands;
        }
        if (event.type !== 'status-added' || event.instance.statusId !== hearingSeaGoldfishIds.concentration
          || event.instance.stacks < 8) return;
        const owner = context.getUnit(event.targetId); if (!owner || owner.heroId !== hearingSeaGoldfishIds.hero) return;
        const source = goldfishSource(hearingSeaGoldfishIds.passive, owner.unitId);
        const active = owner.statuses.some(s => s.statusId === hearingSeaGoldfishIds.field);
        const commands: EffectCommand[] = [{ type: 'remove-statuses', source, targetId: owner.unitId,
          statusIds: [hearingSeaGoldfishIds.concentration], reason: 'consumed' }];
        if (active) for (const ally of context.getLivingUnits(owner.side)) commands.push({ type: 'change-action-gauge', source,
          targetId: ally.unitId, amount: 25 });
        else {
          commands.push({ type: 'dispel-statuses', source, targetId: owner.unitId, filter: 'debuff-or-control' });
          for (const enemy of context.getLivingUnits(owner.side === 'blue' ? 'red' : 'blue')) commands.push({ type: 'add-status', source,
            targetId: enemy.unitId, instance: { instanceId: `${hearingSeaGoldfishIds.bind}:${owner.unitId}:${enemy.unitId}`,
              statusId: hearingSeaGoldfishIds.bind, source, stacks: 1, duration: { kind: 'count', remaining: 2, owner: 'target-turn' } } });
          commands.push(...openField(context, owner, source, 10));
        }
        return commands;
      } },
    },
  };
}

function gainConcentration(owner: Readonly<UnitState>, source: StatusInstance['source']): EffectCommand {
  const current = owner.statuses.find(s => s.statusId === hearingSeaGoldfishIds.concentration)?.stacks ?? 0;
  return { type: 'add-status', source, targetId: owner.unitId, instance: concentration(owner, source, Math.min(8, current + 1)) };
}
function concentration(owner: Readonly<UnitState>, source: StatusInstance['source'], stacks: number): StatusInstance {
  return { instanceId: `${hearingSeaGoldfishIds.concentration}:${owner.unitId}`, statusId: hearingSeaGoldfishIds.concentration,
    source, stacks, duration: { kind: 'permanent' } };
}
function shield(owner: Readonly<UnitState>, source: StatusInstance['source']): EffectCommand {
  return { type: 'add-status', source, targetId: owner.unitId, instance: { instanceId: `${hearingSeaGoldfishIds.shield}:${owner.unitId}`,
    statusId: hearingSeaGoldfishIds.shield, source, stacks: 1, duration: { kind: 'permanent' },
    values: { shieldRemaining: owner.stats.attack * .8 } } };
}
function openField(context: BattleContext, owner: Readonly<UnitState>, source: StatusInstance['source'], gauge: number): EffectCommand[] {
  return [{ type: 'add-status', source, targetId: owner.unitId, instance: { instanceId: `${hearingSeaGoldfishIds.field}:${owner.unitId}`,
    statusId: hearingSeaGoldfishIds.field, source, stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'source-turn' } } },
  ...context.getLivingUnits(owner.side).map(ally => ({ type: 'change-action-gauge' as const, source, targetId: ally.unitId, amount: gauge }))];
}
function addResentment(context: BattleContext, owner: Readonly<UnitState>, target: Readonly<UnitState>,
  source: StatusInstance['source'], stacks: number, parentEventId?: string): EffectCommand[] {
  return attemptDebuff(context, { source, targetId: target.unitId, statusId: hearingSeaGoldfishIds.resentment,
    baseChance: 1, stacks: Math.min(3, stacks), duration: { kind: 'count', remaining: 2, owner: 'target-turn' }, parentEventId });
}
function addSurge(owner: Readonly<UnitState>, source: StatusInstance['source'], parentEventId?: string): EffectCommand {
  const old = owner.statuses.find(s => s.statusId === hearingSeaGoldfishIds.surge);
  const ratio = Math.min(.8, Number(old?.values?.ratio ?? .47) + .03);
  return { type: 'add-status', source, targetId: owner.unitId, instance: { instanceId: `${hearingSeaGoldfishIds.surge}:${owner.unitId}`,
    statusId: hearingSeaGoldfishIds.surge, source, stacks: Math.min(3, (old?.stacks ?? 0) + 1),
    duration: { kind: 'count', remaining: 1, owner: 'round' }, values: { ratio } }, ...(parentEventId ? { parentEventId } : {}) };
}
function triggerSurge(context: BattleContext, owner: Readonly<UnitState>, source: StatusInstance['source'], parentEventId: string): EffectCommand[] {
  const status = owner.statuses.find(s => s.statusId === hearingSeaGoldfishIds.surge); if (!status) return [];
  const enemies = [...context.getLivingUnits(owner.side === 'blue' ? 'red' : 'blue')];
  const commands: EffectCommand[] = [];
  const attack = context.getEffectiveStats(owner.unitId)?.attack ?? owner.stats.attack;
  const ratio = Number(status.values?.ratio ?? .5);
  for (let i = 0; i < status.stacks && enemies.length; i++) {
    const target = enemies.splice(Math.floor(context.random() * enemies.length), 1)[0]!;
    const resentment = target.statuses.some(s => s.statusId === hearingSeaGoldfishIds.resentment
      && s.source.unitId === owner.unitId);
    const rankBonus = resentment && skillRank(owner, hearingSeaGoldfishIds.ultimate) >= 2 ? 1.5 : 1;
    commands.push({ type: 'lose-life', source, targetId: target.unitId, amount: attack * ratio * rankBonus,
      lifeLossKind: 'indirect', parentEventId });
  }
  commands.push({ type: 'remove-statuses', source, targetId: owner.unitId, statusIds: [hearingSeaGoldfishIds.surge],
    reason: 'consumed', parentEventId });
  return commands;
}
function skillRank(owner: Readonly<UnitState>, id: string): number { return Math.max(1, Math.min(5, owner.skillLevels?.[id] ?? owner.skillLevel)); }
function goldfishSource(id: string, unitId: string): StatusInstance['source'] { return { kind: 'skill', id, unitId }; }
