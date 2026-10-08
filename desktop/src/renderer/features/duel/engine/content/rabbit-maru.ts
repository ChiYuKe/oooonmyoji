import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import type { EffectCommand, SourceRef, StatusInstance, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { createBasicAttackSkill } from './common-skills';
import type { ContentRegistry } from './registry';

export const rabbitMaruIds = {
  hero: 289,
  basic: '2891',
  passive: '2892',
  cleanse: '2893',
  carrots: 'status.hero.289.carrots',
  triggeredAttack: 'status.hero.289.carrot-triggered-attack',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const actionGaugeRatios = [.1, .15, .2, .25, .3] as const;
const removableControlTypes = new Set(['冰冻', '睡眠', '变形', '眩晕', '深度冰冻']);

/** 兔丸的胡萝卜资源、受击被动和守护之心行动条技能迁移。 */
export function registerRabbitMaru(registry: ContentRegistry): void {
  registry.registerStatus({ id: rabbitMaruIds.carrots, mechanicsCoverage: 'verified', category: 'other', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'add-stack', maxStacks: 4 });
  registry.registerStatus({ id: rabbitMaruIds.triggeredAttack, mechanicsCoverage: 'verified', category: 'other', dispellable: false,
    sealable: false, durationOwner: 'event', refreshPolicy: 'replace' });
  registry.registerHero(createRabbitMaruDefinition());
}

export function createRabbitMaruDefinition(): HeroDefinition {
  const cleanse: SkillDefinition = {
    id: rabbitMaruIds.cleanse,
    actionKind: 'skill',
    resourceCost: { resourceId: 'fire', amount: 2 },
    target: 'single',
    targetRelation: 'ally',
    levels: actionGaugeRatios.map(ratio => ({ ratio })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      const primary = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || !primary) return [];
      const carrotStatus = actor.statuses.find(status => status.statusId === rabbitMaruIds.carrots
        && status.source.unitId === actor.unitId);
      const carrotCount = carrotStatus?.stacks ?? 0;
      const baseRatio = Number(parameters.ratio ?? .1);
      const source = rabbitSource(actor.unitId);
      const commands: EffectCommand[] = [];
      const targetControls = primary.statuses.filter(status => removableControlTypes.has(String(status.values?.controlType ?? ''))
        && context.isStatusDispellable(status.statusId));
      if (targetControls.length > 0) commands.push({ type: 'dispel-statuses', source, targetId: primary.unitId,
        statusIds: targetControls.map(status => status.statusId), maxCount: targetControls.length });
      commands.push({ type: 'change-action-gauge', source, targetId: primary.unitId,
        amount: baseRatio * (isControlled(primary) ? 200 : 100) });
      const remaining = context.getLivingUnits(actor.side).filter(unit => unit.unitId !== primary.unitId && unit.unitKind !== 'summon');
      for (let index = 0; index < carrotCount && remaining.length > 0; index++) {
        const targetIndex = Math.floor(context.random() * remaining.length);
        const target = remaining.splice(targetIndex, 1)[0]!;
        commands.push({ type: 'change-action-gauge', source, targetId: target.unitId,
          amount: baseRatio * (isControlled(target) ? 200 : 100) });
      }
      if (carrotStatus) commands.push({ type: 'remove-statuses', source, targetId: actor.unitId,
        statusIds: [rabbitMaruIds.carrots], reason: 'consumed' });
      return commands;
    },
  };
  const definition: HeroDefinition = {
    id: rabbitMaruIds.hero,
    skills: [createBasicAttackSkill(rabbitMaruIds.basic, basicRatios), cleanse],
    aiCoverage: 'verified',
    mechanicsCoverage: 'partial',
    handlers: {
      'turn-start': { priority: 36, handle(context, event) {
        if (event.type !== 'turn-started') return;
        const actor = context.getUnit(event.unitId);
        if (!actor || actor.heroId !== rabbitMaruIds.hero) return;
        return [carrotCommand(actor, 2, `${event.eventId}:turn-start`)];
      } },
      hit: { priority: 37, handle(context, event) {
        if (event.type !== 'damage' || event.hpLost <= 0 || event.attackId === undefined) return;
        const wearer = context.getUnit(event.targetId);
        if (!wearer || wearer.heroId !== rabbitMaruIds.hero || !passivesEnabled(wearer)
          || wearer.statuses.some(status => status.statusId === rabbitMaruIds.triggeredAttack
            && Number(status.values?.attackId) === event.attackId)) return;
        const markerSource: SourceRef = { kind: 'skill', id: rabbitMaruIds.passive, unitId: wearer.unitId };
        const marker: StatusInstance = { instanceId: `${rabbitMaruIds.triggeredAttack}:${event.attackId}:${wearer.unitId}`,
          statusId: rabbitMaruIds.triggeredAttack, source: markerSource, stacks: 1,
          duration: { kind: 'count', remaining: 1, owner: 'event', event: 'attack-end' },
          values: { attackId: event.attackId } };
        const chance = wearer.skillLevel >= 5 ? .6 : wearer.skillLevel >= 3 ? .5 : .4;
        const commands: EffectCommand[] = [{ type: 'add-status', source: markerSource, targetId: wearer.unitId,
          instance: marker, parentEventId: event.eventId }];
        if (context.random() < chance) commands.unshift(carrotCommand(wearer, 1, marker.instanceId));
        return commands;
      } },
      'attack-end': { priority: 37, handle(context, event) {
        if (event.type !== 'attack-ended' || event.attackId === undefined) return;
        const commands: EffectCommand[] = [];
        for (const unit of Object.values(context.state.units)) {
          if (unit.heroId !== rabbitMaruIds.hero || !unit.statuses.some(status => status.statusId === rabbitMaruIds.triggeredAttack
            && Number(status.values?.attackId) === event.attackId)) continue;
          commands.push({ type: 'remove-statuses', source: rabbitSource(unit.unitId), targetId: unit.unitId,
            statusIds: [rabbitMaruIds.triggeredAttack], reason: 'consumed', parentEventId: event.eventId });
        }
        return commands;
      } },
    },
    policy(context, unitId) {
      const actor = context.getUnit(unitId);
      if (!actor) return undefined;
      const allies = context.getLivingUnits(actor.side).filter(unit => unit.unitKind !== 'summon');
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (enemies.length === 0) return undefined;
      const carrotCount = actor.statuses.find(status => status.statusId === rabbitMaruIds.carrots
        && status.source.unitId === actor.unitId)?.stacks ?? 0;
      const hasControlledAlly = allies.some(unit => unit.statuses.some(status => context.getStatusCategory(status.statusId) === 'control'
        || status.values?.controlType !== undefined));
      if (allies.length > 0 && carrotCount > 0 && (hasControlledAlly || carrotCount >= 4)) {
        const target = allies[Math.floor(context.random() * allies.length)]!;
        return { actorId: unitId, skillId: rabbitMaruIds.cleanse, targetIds: [target.unitId], shape: 'single', targetRelation: 'ally' };
      }
      return { actorId: unitId, skillId: rabbitMaruIds.basic, targetIds: [enemies[0]!.unitId], shape: 'single', targetRelation: 'enemy' };
    },
  };
  return definition;
}

function carrotCommand(unit: Readonly<UnitState>, count: number, instanceId: string): EffectCommand {
  const source = rabbitSource(unit.unitId);
  const instance: StatusInstance = { instanceId: `${rabbitMaruIds.carrots}:${unit.unitId}:${instanceId}`,
    statusId: rabbitMaruIds.carrots, source, stacks: count, duration: { kind: 'permanent' } };
  return { type: 'add-status', source, targetId: unit.unitId, instance };
}

function rabbitSource(unitId: string): SourceRef {
  return { kind: 'skill', id: rabbitMaruIds.passive, unitId };
}

function isControlled(unit: Readonly<UnitState>): boolean {
  return unit.statuses.some(status => status.values?.controlType !== undefined);
}
