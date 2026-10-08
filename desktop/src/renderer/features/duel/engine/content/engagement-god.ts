import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, StatusInstance, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { createBasicAttackSkill } from './common-skills';
import type { ContentRegistry } from './registry';

export const engagementGodIds = {
  hero: 347, basic: '3471', passive: '3472', blessing: '3473', tie: 'status.hero.347.tie',
  tracker: 'status.hero.347.tie-tracker', fate: 'status.hero.347.fate', anger: 'status.hero.347.anger',
  shelter: 'status.hero.347.shelter', inspiration: 'status.hero.347.inspiration',
  overflowShield: 'status.hero.347.overflow-shield', continuation: 'status.hero.347.continuation',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.15] as const;

/** Enmusubi; tie choice colors and the level-four free-skill payment window remain partial. */
export function registerEngagementGod(registry: ContentRegistry): void {
  const status = (id: string, fields: Omit<Parameters<ContentRegistry['registerStatus']>[0], 'id'>) =>
    registry.registerStatus({ id, mechanicsCoverage: 'partial', ...fields });
  status(engagementGodIds.tie, { category: 'other', dispellable: false, sealable: false,
    durationOwner: 'target-turn', refreshPolicy: 'replace' });
  status(engagementGodIds.tracker, { category: 'other', dispellable: false, sealable: false,
    durationOwner: 'permanent', refreshPolicy: 'replace' });
  status(engagementGodIds.fate, { category: 'buff', dispellable: false, sealable: false,
    durationOwner: 'permanent', refreshPolicy: 'replace', maxStacks: 7 });
  status(engagementGodIds.anger, { category: 'other', dispellable: false, sealable: false,
    durationOwner: 'permanent', refreshPolicy: 'replace', maxStacks: 5 });
  status(engagementGodIds.shelter, { category: 'buff', dispellable: false, sealable: false,
    durationOwner: 'target-turn', refreshPolicy: 'replace', controlProtection: 'single-application' });
  status(engagementGodIds.inspiration, { category: 'buff', dispellable: false, sealable: false,
    durationOwner: 'source-turn', refreshPolicy: 'replace' });
  status(engagementGodIds.overflowShield, { category: 'shield', dispellable: false, sealable: false,
    durationOwner: 'target-turn', refreshPolicy: 'replace' });
  status(engagementGodIds.continuation, { category: 'buff', dispellable: false, sealable: false,
    durationOwner: 'permanent', refreshPolicy: 'replace' });
  registry.registerHero(createEngagementGodDefinition());
}

export function createEngagementGodDefinition(): HeroDefinition {
  const base = createBasicAttackSkill(engagementGodIds.basic, basicRatios);
  const basic: SkillDefinition = { ...base, execute(context, intent, params) {
    const commands = [...base.execute(context, intent, params)];
    const owner = context.getUnit(intent.actorId);
    if (owner && skillRank(owner, engagementGodIds.basic) >= 5) commands.push({ type: 'change-action-gauge',
      source: source(engagementGodIds.basic, owner.unitId), targetId: owner.unitId, amount: 20 });
    return commands;
  } };
  const blessing: SkillDefinition = { id: engagementGodIds.blessing, resourceCost: { resourceId: 'fire', amount: 2 },
    target: 'single', targetRelation: 'ally', levels: [{}, {}, {}, {}, {}], execute(context, intent) {
      const owner = context.getUnit(intent.actorId); const selected = context.getUnit(intent.targetIds[0] ?? '');
      if (!owner || !selected) return [];
      const sourceRef = source(engagementGodIds.blessing, owner.unitId);
      const fate = owner.statuses.find(status => status.statusId === engagementGodIds.fate)?.stacks ?? 0;
      const commands: EffectCommand[] = [{ type: 'add-status', source: sourceRef, targetId: selected.unitId,
        instance: { instanceId: `${engagementGodIds.shelter}:${owner.unitId}:${selected.unitId}`,
          statusId: engagementGodIds.shelter, source: sourceRef, stacks: 1,
          duration: { kind: 'count', remaining: 1, owner: 'target-turn' } } }];
      const attackBonus = .4 + .05 * fate;
      for (const ally of context.getLivingUnits(owner.side)) {
        if (ally.unitKind === 'summon') continue;
        const duration = { kind: 'count' as const, remaining: 1, owner: 'source-turn' as const };
        commands.push({ type: 'add-status', source: sourceRef, targetId: ally.unitId, instance: {
          instanceId: `${engagementGodIds.inspiration}:${owner.unitId}:${ally.unitId}`,
          statusId: engagementGodIds.inspiration, source: sourceRef, stacks: 1, duration,
          modifiers: [{ stat: 'damage', operation: 'percent', amount: attackBonus },
            ...(fate >= 3 && skillRank(owner, engagementGodIds.blessing) >= 3
              ? [{ stat: 'speed' as const, operation: 'flat' as const, amount: 30 }] : [])],
        } });
        const healing = ally.stats.hp * .09;
        const overflow = Math.max(0, healing - (ally.stats.hp - ally.hp));
        commands.push({ type: 'heal', source: sourceRef, targetId: ally.unitId, amount: healing });
        if (fate >= 1 && skillRank(owner, engagementGodIds.blessing) >= 2 && overflow > 0)
          commands.push({ type: 'add-status', source: sourceRef, targetId: ally.unitId, instance: {
            instanceId: `${engagementGodIds.overflowShield}:${owner.unitId}:${ally.unitId}`,
            statusId: engagementGodIds.overflowShield, source: sourceRef, stacks: 1,
            duration: { kind: 'count', remaining: 1, owner: 'target-turn' },
            values: { shieldRemaining: overflow * .5 },
          } });
      }
      if (fate >= 7 && skillRank(owner, engagementGodIds.blessing) >= 4 && selected.unitId !== owner.unitId) {
        commands.push({ type: 'add-status', source: sourceRef, targetId: selected.unitId, instance: {
          instanceId: `${engagementGodIds.continuation}:${owner.unitId}:${selected.unitId}`,
          statusId: engagementGodIds.continuation, source: sourceRef, stacks: 1, duration: { kind: 'permanent' },
        } });
        commands.push({ type: 'add-status', source: sourceRef, targetId: owner.unitId, instance: {
          instanceId: `${engagementGodIds.shelter}:${owner.unitId}:${owner.unitId}`,
          statusId: engagementGodIds.shelter, source: sourceRef, stacks: 1,
          duration: { kind: 'count', remaining: 1, owner: 'target-turn' },
        } });
      }
      return commands;
    } };
  return { id: engagementGodIds.hero, skills: [basic, blessing], aiCoverage: 'partial', mechanicsCoverage: 'partial',
    initialize(context, unitId) {
      const owner = context.getUnit(unitId); if (!owner) return [];
      const commands: EffectCommand[] = [{ type: 'add-status', source: source(engagementGodIds.passive, unitId), targetId: unitId,
        instance: { instanceId: `${engagementGodIds.tracker}:${unitId}`, statusId: engagementGodIds.tracker,
          source: source(engagementGodIds.passive, unitId), stacks: 1, duration: { kind: 'permanent' },
          values: { lastTie: -1, forceNext: false } } }];
      if (skillRank(owner, engagementGodIds.blessing) >= 5) commands.push(addShelter(owner, source(engagementGodIds.passive, unitId)));
      return commands;
    },
    handlers: {
      'turn-start': { priority: 20, handle(context, event) {
        if (event.type !== 'turn-started') return;
        const recipient = context.getUnit(event.unitId); if (!recipient || recipient.unitKind === 'summon') return;
        const commands: EffectCommand[] = [];
        for (const owner of context.getLivingUnits(recipient.side)) {
          if (owner.heroId !== engagementGodIds.hero || owner.unitId === recipient.unitId || !passivesEnabled(owner)) continue;
          const tracker = owner.statuses.find(status => status.statusId === engagementGodIds.tracker);
          const values = tracker?.values ?? {};
          const forced = values.forceNext === true;
          const tieType = Math.floor(context.random() * 4);
          const success = forced || (Number(values.lastTie ?? -1) === tieType);
          const sourceRef = source(engagementGodIds.passive, owner.unitId);
          commands.push({ type: 'add-status', source: sourceRef, targetId: recipient.unitId, instance: {
            instanceId: `${engagementGodIds.tie}:${owner.unitId}:${recipient.unitId}`, statusId: engagementGodIds.tie,
            source: sourceRef, stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' }, values: { tieType },
          } });
          if (success) {
            commands.push({ type: 'change-resource', source: sourceRef, side: owner.side, resourceId: 'fire', amount: 1 },
              addFate(owner, sourceRef), trackerStatus(owner, sourceRef, tieType, false, 0));
            if (forced || Number(values.anger ?? 0) > 0) commands.push({ type: 'remove-statuses', source: sourceRef,
              targetId: owner.unitId, statusIds: [engagementGodIds.anger], reason: 'consumed' });
          }
          else {
            const anger = Math.min(5, Number(values.anger ?? 0) + 1);
            commands.push(addAnger(owner, sourceRef, anger), trackerStatus(owner, sourceRef, tieType, anger >= 5, anger));
          }
        }
        return commands;
      } },
      'turn-end': { priority: 20, handle(context, event) {
        if (event.type !== 'turn-ended') return;
        const target = context.getUnit(event.unitId); if (!target) return;
        const continuation = target.statuses.find(status => status.statusId === engagementGodIds.continuation);
        if (!continuation) return;
        return [{ type: 'remove-statuses', source: continuation.source, targetId: target.unitId,
          statusIds: [engagementGodIds.continuation], reason: 'consumed' },
        { type: 'schedule-turn', source: continuation.source, unitId: target.unitId,
          scheduling: 'extra-turn', selection: 'action-gauge' }];
      } },
    },
  };
}

function trackerStatus(owner: Readonly<UnitState>, sourceRef: StatusInstance['source'], tie: number, forceNext: boolean, anger: number): EffectCommand {
  const previous = owner.statuses.find(status => status.statusId === engagementGodIds.tracker);
  return { type: 'add-status', source: sourceRef, targetId: owner.unitId, instance: { instanceId: `${engagementGodIds.tracker}:${owner.unitId}`,
    statusId: engagementGodIds.tracker, source: sourceRef, stacks: 1, duration: { kind: 'permanent' },
    values: { ...previous?.values, lastTie: tie, forceNext, anger } } };
}
function addFate(owner: Readonly<UnitState>, sourceRef: StatusInstance['source']): EffectCommand {
  const stacks = Math.min(7, (owner.statuses.find(status => status.statusId === engagementGodIds.fate)?.stacks ?? 0) + 1);
  return { type: 'add-status', source: sourceRef, targetId: owner.unitId, instance: { instanceId: `${engagementGodIds.fate}:${owner.unitId}`,
    statusId: engagementGodIds.fate, source: sourceRef, stacks, duration: { kind: 'permanent' } } };
}
function addAnger(owner: Readonly<UnitState>, sourceRef: StatusInstance['source'], stacks: number): EffectCommand {
  return { type: 'add-status', source: sourceRef, targetId: owner.unitId, instance: { instanceId: `${engagementGodIds.anger}:${owner.unitId}`,
    statusId: engagementGodIds.anger, source: sourceRef, stacks, duration: { kind: 'permanent' } } };
}
function addShelter(owner: Readonly<UnitState>, sourceRef: StatusInstance['source']): EffectCommand {
  return { type: 'add-status', source: sourceRef, targetId: owner.unitId, instance: { instanceId: `${engagementGodIds.shelter}:${owner.unitId}`,
    statusId: engagementGodIds.shelter, source: sourceRef, stacks: 1,
    duration: { kind: 'count', remaining: 1, owner: 'target-turn' } } };
}
function skillRank(owner: Readonly<UnitState>, skillId: string): number { return Math.max(1, Math.min(5, owner.skillLevels?.[skillId] ?? owner.skillLevel)); }
function source(id: string, unitId: string): StatusInstance['source'] { return { kind: 'skill', id, unitId }; }
