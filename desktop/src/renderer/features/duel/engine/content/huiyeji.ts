import type { HeroDefinition, SkillDefinition, StatusDefinition } from '../core/definitions';
import { passivesEnabled } from '../core/passive-eligibility';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, StatusInstance, UnitState } from '../core/types';
import { battleSkillRow, skillNumber } from '../../../../../shared/game-skill-data';
import { createBasicAttackSkill } from './common-skills';
import type { ContentRegistry } from './registry';

export const huiyejiIds = {
  hero: 280,
  basic: '2801',
  passive: '2802',
  ultimate: '2803',
  realm: 'status.hero.280.realm',
  fireTrigger: 'status.hero.280.fire-trigger',
  fireShortfall: 'status.hero.280.fire-shortfall',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const basicFireChances = [.1, .1, .1, .1, .1, 1] as const;
const receivedHitFireChances = [.3, .35, .4, .4, .4] as const;
const defenseBonuses = [.15, .2, .2, .25, .25, .35] as const;
const resistBonuses = [.1, .1, .1, .1, .1, .3] as const;
const turnFireChance = .67;

/** 辉夜姬的受击返火、鬼火削减、龙首之玉结界与结界内资源透支。 */
export function registerHuiyeji(registry: ContentRegistry): void {
  const realmStatus: StatusDefinition = {
    id: huiyejiIds.realm, mechanicsCoverage: 'partial', category: 'buff', dispellable: true, sealable: false,
    durationOwner: 'source-turn', refreshPolicy: 'replace',
    handlers: { 'turn-start': { priority: 39, handle(context, event) { return grantRealmFire(context, event); } } },
    modifyResourceCost(state, actor, skill, cost) {
      if (cost.resourceId !== 'fire') return cost.amount;
      const current = Math.max(0, state.resources[actor.side]?.fire ?? 0);
      const discount = skill.id === huiyejiIds.ultimate ? 1 : 0;
      const adjusted = Math.max(0, cost.amount - discount);
      return current < adjusted ? current : adjusted;
    },
  };
  registry.registerStatus(realmStatus);
  registry.registerStatus({ id: huiyejiIds.fireTrigger, mechanicsCoverage: 'partial', category: 'other', dispellable: false,
    sealable: false, durationOwner: 'event', refreshPolicy: 'replace' });
  registry.registerStatus({ id: huiyejiIds.fireShortfall, mechanicsCoverage: 'partial', category: 'other', dispellable: false,
    sealable: false, durationOwner: 'event', refreshPolicy: 'replace' });

  const basic = createBasicAttackSkill(huiyejiIds.basic, basicRatios);
  const ultimate: SkillDefinition = {
    id: huiyejiIds.ultimate, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 2 },
    target: 'all-allies', targetRelation: 'ally',
    levels: defenseBonuses.map((defense, index) => ({ defense, resist: resistBonuses[index]!, duration: 2,
      fireChance: turnFireChance })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      if (!actor || actor.hp <= 0 || actor.heroId !== huiyejiIds.hero) return [];
      const rank = skillIndex(actor, huiyejiIds.ultimate);
      const commands: EffectCommand[] = [];
      for (const allyId of intent.targetIds) {
        const ally = context.getUnit(allyId);
        if (!ally || ally.hp <= 0 || ally.side !== actor.side) continue;
        commands.push({ type: 'add-status', source: huiyejiSource(actor.unitId), targetId: ally.unitId,
          instance: realmInstance(actor, ally, Number(parameters.defense ?? defenseBonuses[rank]!),
            Number(parameters.resist ?? resistBonuses[rank]!), Number(parameters.duration ?? 2)) });
      }
      return commands;
    },
  };

  const definition: HeroDefinition = {
    id: huiyejiIds.hero, skills: [basic, ultimate], aiCoverage: 'partial', mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['已接入蓬莱玉枝1火削减概率（觉醒六级必定）、火鼠裘受击按被动等级30%至40%返1火且每次攻击只判定一次、结界内友方行动前67%返1火、龙首之玉2火/两回合及可查明的防御和抵抗加成，结界内技能鬼火费用不足时透支现有鬼火、辉夜姬按差额每火5%当前生命承担代价并缩短结界1回合，结界内龙首之玉费用减1。客户端技能等级3/5只写抵抗提升，随附buff表未给这两级的确切抵抗值；当前保持10%基值并列为未核。多辉夜姬结界归属、受击触发对无伤/护盾命中的原生判定、火上限及透支与御魂减费叠加顺序仍待帧核。'],
    handlers: {
      hit: { priority: 39, handle(context, event) { return returnFireWhenHit(context, event); } },
      'attack-end': { priority: 39, handle(context, event) { return clearFireTriggerMarker(context, event); } },
      'action-end': { priority: 39, handle(context, event) { return finishAction(context, event); } },
      'action-selection': { priority: 39, handle(context, event) { return payRealmShortfall(context, event); } },
    },
    policy(context, unitId) {
      const actor = context.getUnit(unitId);
      if (!actor || actor.hp <= 0 || actor.unitKind === 'summon') return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      const fire = context.state.resources[actor.side]?.fire ?? 0;
      const hasRealm = actor.statuses.some(status => status.statusId === huiyejiIds.realm);
      if (fire >= (hasRealm ? 1 : 2))
        return huiyejiIntent(actor.unitId, huiyejiIds.ultimate, context.getLivingUnits(actor.side).map(unit => unit.unitId));
      return huiyejiIntent(actor.unitId, huiyejiIds.basic, [enemies[0]!.unitId], 'single', 'enemy');
    },
  };
  registry.registerHero(definition);
}

function realmInstance(owner: Readonly<UnitState>, target: Readonly<UnitState>, defense: number, resist: number, duration: number): StatusInstance {
  const source = huiyejiSource(owner.unitId);
  return { instanceId: `${huiyejiIds.realm}:${owner.unitId}:${target.unitId}`, statusId: huiyejiIds.realm,
    source, stacks: 1, duration: { kind: 'count', remaining: duration, owner: 'source-turn' },
    modifiers: [{ stat: 'defense', operation: 'percent', amount: defense }, { stat: 'resist', operation: 'percent', amount: resist }] };
}

function grantRealmFire(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-started') return;
  const target = context.getUnit(event.unitId);
  if (!target || target.hp <= 0) return;
  const realm = target.statuses.find(status => status.statusId === huiyejiIds.realm);
  if (!realm || !context.getUnit(realm.source.unitId ?? '') || context.random() >= turnFireChance) return;
  return [{ type: 'change-resource', source: realm.source, side: target.side, resourceId: 'fire', amount: 1, parentEventId: event.eventId }];
}

function returnFireWhenHit(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage' || event.attackId === undefined) return;
  const target = context.getUnit(event.targetId);
  if (!target || target.hp <= 0) return;
  const candidates = context.getLivingUnits(target.side).filter(owner => owner.heroId === huiyejiIds.hero && passivesEnabled(owner)
    && (owner.unitId === target.unitId || target.statuses.some(status => status.statusId === huiyejiIds.realm
      && status.source.unitId === owner.unitId)));
  const commands: EffectCommand[] = [];
  for (const owner of candidates) {
    if (owner.statuses.some(status => status.statusId === huiyejiIds.fireTrigger
      && Number(status.values?.attackId) === event.attackId)) continue;
    const markerSource = huiyejiSource(owner.unitId, huiyejiIds.passive);
    const marker: StatusInstance = { instanceId: `${huiyejiIds.fireTrigger}:${owner.unitId}:${event.attackId}`,
      statusId: huiyejiIds.fireTrigger, source: markerSource, stacks: 1,
      duration: { kind: 'count', remaining: 1, owner: 'event', event: 'attack-end' }, values: { attackId: event.attackId } };
    commands.push({ type: 'add-status', source: markerSource, targetId: owner.unitId, instance: marker, parentEventId: event.eventId });
    const chance = receivedHitFireChances[skillIndex(owner, huiyejiIds.passive)]!;
    if (context.random() < chance) commands.push({ type: 'change-resource', source: markerSource, side: owner.side,
      resourceId: 'fire', amount: 1, parentEventId: event.eventId });
  }
  return commands.length ? commands : undefined;
}

function clearFireTriggerMarker(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'attack-ended' || event.attackId === undefined) return;
  const commands: EffectCommand[] = [];
  for (const owner of Object.values(context.state.units)) {
    for (const marker of owner.statuses.filter(status => status.statusId === huiyejiIds.fireTrigger
      && Number(status.values?.attackId) === event.attackId)) {
      commands.push({ type: 'remove-status-instances', source: marker.source, targetId: owner.unitId,
        instanceIds: [marker.instanceId], reason: 'consumed', parentEventId: event.eventId });
    }
  }
  return commands.length ? commands : undefined;
}

function basicSkillFireLoss(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'action-ended' || event.actionKind !== 'basic' || event.skillId !== huiyejiIds.basic || !event.intent) return;
  const actor = context.getUnit(event.intent.actorId);
  const target = context.getUnit(event.intent.targetIds[0] ?? '');
  if (!actor || actor.hp <= 0 || actor.heroId !== huiyejiIds.hero || !target || target.hp <= 0 || target.side === actor.side
    || !passivesEnabled(actor)) return;
  const chance = basicFireChances[Math.min(5, Math.max(0, (actor.skillLevels?.[huiyejiIds.basic] ?? actor.skillLevel) - 1))]!;
  if (context.random() >= chance) return;
  return [{ type: 'change-resource', source: huiyejiSource(actor.unitId, huiyejiIds.basic), side: target.side,
    resourceId: 'fire', amount: -1, parentEventId: event.eventId }];
}

function finishAction(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'action-ended') return;
  const commands: EffectCommand[] = [];
  if (event.actionId !== undefined) for (const owner of Object.values(context.state.units)) {
    if (owner.heroId !== huiyejiIds.hero) continue;
    const markers = owner.statuses.filter(status => status.statusId === huiyejiIds.fireShortfall
      && Number(status.values?.actionId) === event.actionId);
    for (const marker of markers) {
      const missing = Number(marker.values?.missing ?? 0);
      if (owner.hp > 0 && missing > 0) commands.push({ type: 'lose-life', source: marker.source, targetId: owner.unitId,
        amount: owner.hp * .05 * missing, lifeLossKind: 'direct', parentEventId: event.eventId });
      commands.push({ type: 'remove-status-instances', source: marker.source, targetId: owner.unitId,
        instanceIds: [marker.instanceId], reason: 'consumed', parentEventId: event.eventId });
      commands.push(...reduceRealmDuration(context, owner, event.eventId));
    }
  }
  commands.push(...(basicSkillFireLoss(context, event) ?? []));
  return commands.length ? commands : undefined;
}

function payRealmShortfall(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'action-declared' || event.resourceCostWaived) return;
  const actor = context.getUnit(event.intent.actorId);
  if (!actor || actor.hp <= 0) return;
  const realm = actor.statuses.find(status => status.statusId === huiyejiIds.realm);
  const owner = realm?.source.unitId ? context.getUnit(realm.source.unitId) : undefined;
  if (!realm || !owner || owner.hp <= 0) return;
  const rank = actor.skillLevels?.[event.intent.skillId] ?? actor.skillLevel;
  const row = battleSkillRow(event.intent.skillId, rank, actor.awakeFilter);
  const baseCost = skillNumber(row, 'consumeVal') ?? (event.intent.skillId === huiyejiIds.ultimate ? 2 : 0);
  if (baseCost <= 0) return;
  const discounted = Math.max(0, baseCost - (event.intent.skillId === huiyejiIds.ultimate ? 1 : 0));
  const available = Math.max(0, context.state.resources[actor.side]?.fire ?? 0);
  const missing = Math.max(0, discounted - available);
  if (missing <= 0) return;
  const ownerSource = huiyejiSource(owner.unitId);
  const actionId = event.actionId ?? context.state.counters.action;
  return [{ type: 'add-status', source: ownerSource, targetId: owner.unitId, parentEventId: event.eventId, instance: {
    instanceId: `${huiyejiIds.fireShortfall}:${owner.unitId}:${actionId}`, statusId: huiyejiIds.fireShortfall,
    source: ownerSource, stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'event', event: 'action-end' },
    values: { actionId, missing },
  } }];
}

function reduceRealmDuration(context: BattleContext, owner: Readonly<UnitState>, parentEventId: string): EffectCommand[] {
  const ownerSource = huiyejiSource(owner.unitId);
  const commands: EffectCommand[] = [];
  for (const ally of context.getLivingUnits(owner.side)) {
    const instances = ally.statuses.filter(status => status.statusId === huiyejiIds.realm && status.source.unitId === owner.unitId);
    for (const instance of instances) {
      commands.push({ type: 'remove-status-instances', source: ownerSource, targetId: ally.unitId,
        instanceIds: [instance.instanceId], reason: 'consumed', parentEventId });
      if (instance.duration.kind === 'count' && instance.duration.remaining > 1) {
        commands.push({ type: 'add-status', source: ownerSource, targetId: ally.unitId,
          instance: { ...instance, duration: { ...instance.duration, remaining: instance.duration.remaining - 1 } },
          parentEventId });
      }
    }
  }
  return commands;
}

function skillIndex(owner: Readonly<UnitState>, skillId: string): number {
  const rank = owner.skillLevels?.[skillId] ?? owner.skillLevel;
  return Math.max(0, Math.min(skillId === huiyejiIds.ultimate ? 5 : 4, rank - 1));
}
function huiyejiIntent(actorId: string, skillId: string, targetIds: readonly string[], shape: ActionIntent['shape'] = 'all-allies',
  targetRelation: ActionIntent['targetRelation'] = 'ally'): ActionIntent {
  return { actorId, skillId, targetIds, shape, targetRelation };
}
function huiyejiSource(unitId: string, skillId: string = huiyejiIds.ultimate): SourceRef {
  return { kind: 'skill', id: skillId, unitId };
}
