import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, StatusInstance, UnitState } from '../core/types';
import { attemptDebuff } from '../mechanics/control';
import type { ContentRegistry } from './registry';

export const kidomaruIds = {
  hero: 345, basic: '3451', ultimate: '3453', hunter: '3454', rage: 'status.hero.345.rage',
  shackle: 'status.hero.345.shackle', hidden: 'status.hero.345.hidden', shura: 'status.hero.345.shura',
} as const;

const basicRatios = [.5, .53, .56, .59, .59] as const;
const ultimateRatios = [.7, .75, .8, .9, .9] as const;
const hunterRatios = [.32, .34, .36, .4, .4] as const;

/** Original Kidomaru. The complex action-bar proc queue and full shura cleanup are still partial. */
export function registerKidomaru(registry: ContentRegistry): void {
  registry.registerStatus({ id: kidomaruIds.rage, mechanicsCoverage: 'partial', category: 'buff', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace', maxStacks: 3 });
  registry.registerStatus({ id: kidomaruIds.shackle, mechanicsCoverage: 'partial', category: 'mark', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'refresh-duration', preventsActionGaugeChange: true });
  registry.registerStatus({ id: kidomaruIds.hidden, mechanicsCoverage: 'partial', category: 'buff', dispellable: false,
    sealable: false, durationOwner: 'target-turn', refreshPolicy: 'replace', protectsFromDirectTargeting: true });
  registry.registerStatus({ id: kidomaruIds.shura, mechanicsCoverage: 'partial', category: 'shield', dispellable: false,
    sealable: false, durationOwner: 'event', refreshPolicy: 'replace', controlProtection: 'immune' });
  registry.registerHero(createKidomaruDefinition());
}

export function createKidomaruDefinition(): HeroDefinition {
  const basic: SkillDefinition = { id: kidomaruIds.basic, target: 'single', targetRelation: 'enemy',
    levels: basicRatios.map(ratio => ({ ratio })), execute(context, intent, params) {
      return twoHit(context, intent, params, kidomaruIds.basic, 2, Number(params.ratio ?? .5), true);
    } };
  const ultimate: SkillDefinition = { id: kidomaruIds.ultimate, resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'single', targetRelation: 'enemy', levels: ultimateRatios.map(ratio => ({ ratio })), execute(context, intent, params) {
      const actor = context.getUnit(intent.actorId); const target = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || !target || target.hp <= 0) return [];
      const source = kidomaruSource(kidomaruIds.ultimate, actor.unitId);
      const commands = twoHit(context, intent, params, kidomaruIds.ultimate, 3, Number(params.ratio ?? .7), false);
      commands.push(...lockTarget(context, actor, target, source, 1));
      commands.push({ type: 'add-status', source, targetId: actor.unitId, instance: hidden(actor, source) });
      return commands;
    } };
  const hunter: SkillDefinition = { id: kidomaruIds.hunter, target: 'all-enemies', targetRelation: 'enemy',
    levels: hunterRatios.map(ratio => ({ ratio })), execute(context, intent, params) {
      const actor = context.getUnit(intent.actorId); if (!actor) return [];
      const source = kidomaruSource(kidomaruIds.hunter, actor.unitId);
      const attack = context.getEffectiveStats(actor.unitId)?.attack ?? actor.stats.attack;
      return intent.targetIds.flatMap(targetId => {
        const target = context.getUnit(targetId);
        return target && target.hp > 0 ? [{ type: 'deal-damage' as const, source, targetId,
          amount: attack * Number(params.ratio ?? .32), suppressTargetSoulTriggers: true }] : [];
      });
    } };
  return { id: kidomaruIds.hero, skills: [basic, ultimate, hunter], aiCoverage: 'partial', mechanicsCoverage: 'partial',
    initialize(context, unitId) {
      const actor = context.getUnit(unitId); if (!actor || skillRank(actor, kidomaruIds.ultimate) < 5) return [];
      const source = kidomaruSource(kidomaruIds.ultimate, unitId);
      return [{ type: 'add-status', source, targetId: unitId, instance: hidden(actor, source) }];
    },
    handlers: {
      'action-end': { priority: 25, handle(context, event) {
        if (event.type !== 'action-ended') return;
        if (!event.intent) return;
        const owner = context.getUnit(event.intent.actorId);
        if (!owner || owner.heroId !== kidomaruIds.hero) return;
        if (event.skillId === kidomaruIds.hunter) {
          const state = owner.statuses.find(status => status.statusId === kidomaruIds.shura);
          if (!state) return;
          const remaining = Math.max(0, state.stacks - 1);
          const source = kidomaruSource(kidomaruIds.hunter, owner.unitId);
          if (remaining > 0) return [{ type: 'add-status', source, targetId: owner.unitId,
            instance: { ...state, stacks: remaining } }];
          return [{ type: 'remove-statuses', source, targetId: owner.unitId,
            statusIds: [kidomaruIds.shura, kidomaruIds.rage] }, ...context.getLivingUnits(owner.side === 'blue' ? 'red' : 'blue')
            .map(enemy => ({ type: 'remove-statuses' as const, source, targetId: enemy.unitId,
              statusIds: [kidomaruIds.shackle], reason: 'consumed' as const }))];
        }
        const commands: EffectCommand[] = [];
        if (owner.statuses.some(status => status.statusId === kidomaruIds.hidden)) {
          const source = kidomaruSource(event.skillId, owner.unitId);
          commands.push({ type: 'remove-statuses', source, targetId: owner.unitId,
            statusIds: [kidomaruIds.hidden], reason: 'consumed' });
        }
        if (skillRank(owner, kidomaruIds.basic) < 5) return commands;
        const lockedHit = (event.intent.targetIds ?? []).some(id => context.getUnit(id)?.statuses.some(s => s.statusId === kidomaruIds.shackle));
        if (!lockedHit) return commands;
        const source = kidomaruSource(kidomaruIds.basic, owner.unitId);
        commands.push(addRage(owner, source));
        return commands;
      } },
      'turn-end': { priority: 25, handle(context, event) {
        if (event.type !== 'turn-ended') return;
        const ending = context.getUnit(event.unitId); if (!ending) return;
        const commands: EffectCommand[] = [];
        for (const owner of context.getLivingUnits(ending.side === 'blue' ? 'red' : 'blue')) {
          const shura = owner.statuses.find(s => s.statusId === kidomaruIds.shura);
          if (owner.heroId !== kidomaruIds.hero || !shura) continue;
          const source = kidomaruSource(kidomaruIds.hunter, owner.unitId);
          const enemies = context.getLivingUnits(owner.side === 'blue' ? 'red' : 'blue');
          if (enemies.length) commands.push({ type: 'schedule-action', source, scheduling: 'counter', freeCast: true,
            intent: { actorId: owner.unitId, skillId: kidomaruIds.hunter, targetIds: enemies.map(x => x.unitId),
              shape: 'all-enemies', targetRelation: 'enemy' } });
        }
        return commands;
      } },
      'effect-resolution': { priority: 25, handle(context, event) {
        if (event.type === 'status-removed' && event.statusId === kidomaruIds.shura) {
          const ownerId = event.removedSource?.unitId;
          const owner = ownerId ? context.getUnit(ownerId) : undefined;
          if (!owner) return;
          const source = kidomaruSource(kidomaruIds.hunter, owner.unitId);
          return [
            { type: 'remove-statuses', source, targetId: owner.unitId, statusIds: [kidomaruIds.rage] },
            ...context.getLivingUnits(owner.side === 'blue' ? 'red' : 'blue').map(enemy => ({ type: 'remove-statuses' as const,
              source, targetId: enemy.unitId, statusIds: [kidomaruIds.shackle], reason: 'consumed' as const })),
          ];
        }
        if (event.type !== 'status-added' || event.instance.statusId !== kidomaruIds.rage || event.instance.stacks < 3) return;
        const owner = context.getUnit(event.targetId);
        if (!owner || owner.heroId !== kidomaruIds.hero || owner.statuses.some(status => status.statusId === kidomaruIds.shura)) return;
        const source = kidomaruSource(kidomaruIds.hunter, owner.unitId);
        return [{ type: 'remove-statuses', source, targetId: owner.unitId, statusIds: [kidomaruIds.rage], reason: 'consumed' },
          { type: 'add-status', source, targetId: owner.unitId, instance: shuraStatus(owner, source) }];
      } },
    },
  };
}

function twoHit(context: BattleContext, intent: ActionIntent, params: Readonly<Record<string, number | boolean | string>>,
  skillId: string, hits: number, ratio: number, applyLock: boolean): EffectCommand[] {
  const actor = context.getUnit(intent.actorId); const target = context.getUnit(intent.targetIds[0] ?? '');
  if (!actor || !target || target.hp <= 0) return [];
  const source = kidomaruSource(skillId, actor.unitId);
  const atk = context.getEffectiveStats(actor.unitId) ?? actor.stats;
  const def = context.getEffectiveStats(target.unitId) ?? target.stats;
  const commands: EffectCommand[] = Array.from({ length: hits }, () => {
    const result = context.calculateDamage({ attack: atk.attack, defense: def.defense, ratio,
      critChance: atk.crit, critDamage: atk.critDamage }, actor, target);
    return { type: 'deal-damage' as const, source, targetId: target.unitId, amount: result.amount,
      ...(result.damageOptions ? { damageOptions: result.damageOptions } : {}), isCritical: result.isCritical };
  });
  if (actor.statuses.some(status => status.statusId === kidomaruIds.hidden))
    for (let index = 0; index < hits; index++) commands.push({ type: 'deal-damage', source, targetId: target.unitId,
      amount: atk.attack * .33, damageKind: 'true' });
  if (applyLock) commands.push(...lockTarget(context, actor, target, source, 1));
  return commands;
}

function lockTarget(context: BattleContext, actor: Readonly<UnitState>, target: Readonly<UnitState>,
  source: StatusInstance['source'], duration: number): EffectCommand[] {
  const alreadyLocked = target.statuses.some(status => status.statusId === kidomaruIds.shackle);
  return attemptDebuff(context, { source, targetId: target.unitId, statusId: kidomaruIds.shackle,
    baseChance: alreadyLocked ? .3 : 1, duration: { kind: 'count', remaining: duration + 1, owner: 'target-turn' } });
}

function addRage(owner: Readonly<UnitState>, source: StatusInstance['source']): EffectCommand {
  const current = owner.statuses.find(status => status.statusId === kidomaruIds.rage);
  const stacks = Math.min(3, (current?.stacks ?? 0) + 1);
  return { type: 'add-status', source, targetId: owner.unitId, instance: { instanceId: `${kidomaruIds.rage}:${owner.unitId}`,
    statusId: kidomaruIds.rage, source, stacks, duration: { kind: 'permanent' },
    modifiers: [{ stat: 'speed', operation: 'flat', amount: 20 * stacks },
      { stat: 'damage', operation: 'percent', amount: .3 * stacks }] } };
}

function hidden(owner: Readonly<UnitState>, source: StatusInstance['source']): StatusInstance {
  return { instanceId: `${kidomaruIds.hidden}:${owner.unitId}`, statusId: kidomaruIds.hidden, source, stacks: 1,
    duration: { kind: 'count', remaining: 3, owner: 'target-turn' },
    modifiers: [{ stat: 'damageTaken', operation: 'percent', amount: -.2 }] };
}
function shuraStatus(owner: Readonly<UnitState>, source: StatusInstance['source']): StatusInstance {
  return { instanceId: `${kidomaruIds.shura}:${owner.unitId}`, statusId: kidomaruIds.shura, source, stacks: 3,
    duration: { kind: 'count', remaining: 3, owner: 'event' }, values: { shieldRemaining: owner.stats.attack * 1.2 } };
}
function skillRank(unit: Readonly<UnitState>, id: string): number { return Math.max(1, Math.min(5, unit.skillLevels?.[id] ?? unit.skillLevel)); }
function kidomaruSource(id: string, unitId: string): StatusInstance['source'] { return { kind: 'skill', id, unitId }; }
