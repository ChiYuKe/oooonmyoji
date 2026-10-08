import type { HeroDefinition, SkillDefinition, StatusDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, StatusInstance, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { attemptDebuff } from '../mechanics/control';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import { createBasicAttackSkill } from './common-skills';
import type { ContentRegistry } from './registry';

export const yiIds = {
  hero: 303,
  basic: '3031',
  passive: '3032',
  ultimate: '3033',
  pieces: 'status.hero.303.pieces',
  heldPiece: 'status.hero.303.held-piece',
  fireSpent: 'status.hero.303.fire-spent',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.2] as const;
const ultimateRatios = [.42, .44, .46, .48, .51] as const;
const maxPieces = 4;
const burstRatio = 6;
const modifierPerPiece = .05;
const heldColors = ['weakening', 'vulnerability'] as const;

export function registerYi(registry: ContentRegistry): void {
  const statuses: StatusDefinition[] = [
    { id: yiIds.pieces, mechanicsCoverage: 'partial', category: 'debuff', dispellable: true, sealable: true,
      durationOwner: 'permanent', refreshPolicy: 'replace', maxStacks: maxPieces },
    { id: yiIds.heldPiece, mechanicsCoverage: 'partial', category: 'other', dispellable: false, sealable: false,
      durationOwner: 'permanent', refreshPolicy: 'replace' },
    { id: yiIds.fireSpent, mechanicsCoverage: 'partial', category: 'other', dispellable: false, sealable: false,
      durationOwner: 'target-turn', refreshPolicy: 'replace' },
  ];
  for (const status of statuses) registry.registerStatus(status);
  registry.registerHero(createYiDefinition());
}

export function createYiDefinition(): HeroDefinition {
  const basic = createBasicAttackSkill(yiIds.basic, basicRatios);
  const passive: SkillDefinition = { id: yiIds.passive, actionKind: 'passive', target: 'single', targetRelation: 'enemy',
    levels: [{ rank: 1 }], execute() { return []; } };
  const ultimate: SkillDefinition = { id: yiIds.ultimate, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    resourceCostsByLevel: [...ultimateRatios.map(() => ({ resourceId: 'fire', amount: 3 })), { resourceId: 'fire', amount: 2 }],
    target: 'single', targetRelation: 'enemy', useClientDamageData: true,
    levels: ultimateRatios.map((ratio, index) => ({ ratio, hitCount: 9, rank: index + 1 })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      const selected = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || actor.heroId !== yiIds.hero || actor.hp <= 0 || !selected || selected.hp <= 0 || selected.side === actor.side) return [];
      const enemies = context.getLivingUnits(opposingSide(actor.side));
      const ratio = Number(parameters.ratio ?? ultimateRatios[skillRank(actor, yiIds.ultimate) - 1]!);
      const hitCount = Math.max(1, Math.floor(Number(parameters.hitCount ?? 9)));
      const commands: EffectCommand[] = [];
      for (let index = 0; index < hitCount; index += 1) {
        const target = index === 0 ? selected : enemies[Math.min(enemies.length - 1, Math.floor(context.random() * enemies.length))]!;
        commands.push(...attackOne(context, actor, target, ratio, yiIds.ultimate));
      }
      return commands;
    } };
  return {
    id: yiIds.hero,
    skills: [basic, passive, ultimate],
    aiCoverage: 'partial',
    mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['已按主线斗技技能行接入征子普攻、神之一手3火九次投掷/六级2火，以及气合交替棋色、命中附加棋子、四层同色造成600%攻击伤害、上限时优先替换异色和敌方未耗火回合随机掉层；棋子按客户端 buff_3031/3032 三级属性每层降低目标5%造成伤害或提高5%受到伤害。初始持色、四层爆发后棋子是否清空、逐段触发及效果抵抗口径在技能/状态分支行间不完全一致；帧图无弈出场，需连续实战帧核实。'],
    initialize(context, unitId) {
      const actor = context.getUnit(unitId);
      if (!actor || actor.heroId !== yiIds.hero) return [];
      const source = yiSource(yiIds.passive, actor.unitId);
      return [{ type: 'add-status', source, targetId: actor.unitId, instance: {
        instanceId: `${yiIds.heldPiece}:${actor.unitId}`, statusId: yiIds.heldPiece, source, stacks: 1,
        duration: { kind: 'permanent' }, values: { color: heldColors[0] },
      } }];
    },
    handlers: {
      hit: { priority: 58, handle(context, event) { return addPieceOnAttack(context, event); } },
      'attack-end': { priority: 58, handle(context, event) { return rotateHeldPiece(context, event); } },
      'turn-start': { priority: 58, handle(context, event) { return resetTargetFireMarker(context, event); } },
      'resource-payment': { priority: 58, handle(context, event) { return recordTargetFirePayment(context, event); } },
      'turn-end': { priority: 58, handle(context, event) { return removePieceAfterFirelessTurn(context, event); } },
    },
    policy(context, unitId) {
      const actor = context.getUnit(unitId);
      if (!actor || actor.heroId !== yiIds.hero || actor.hp <= 0) return undefined;
      const enemies = context.getLivingUnits(opposingSide(actor.side));
      if (!enemies.length) return undefined;
      const fire = context.state.resources[actor.side]?.fire ?? 0;
      const skillId = fire >= (skillRank(actor, yiIds.ultimate) >= 6 ? 2 : 3) ? yiIds.ultimate : yiIds.basic;
      return yiIntent(actor.unitId, skillId, [enemies[0]!.unitId], 'single', 'enemy');
    },
  };
}

function addPieceOnAttack(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage' || !event.source.unitId || (event.source.id !== yiIds.basic && event.source.id !== yiIds.ultimate)) return;
  const actor = context.getUnit(event.source.unitId);
  const target = context.getUnit(event.targetId);
  if (!actor || actor.heroId !== yiIds.hero || actor.hp <= 0 || !passivesEnabled(actor) || !target || target.hp <= 0) return;
  const held = actor.statuses.find(status => status.statusId === yiIds.heldPiece);
  const color = String(held?.values?.color ?? heldColors[0]);
  const source = yiSource(yiIds.passive, actor.unitId);
  const roll = attemptDebuff(context, { source, targetId: target.unitId, statusId: yiIds.pieces,
    baseChance: 1, duration: { kind: 'permanent' }, parentEventId: event.eventId });
  if (!roll.some(command => command.type === 'add-status')) return roll;

  const existing = target.statuses.find(status => status.statusId === yiIds.pieces && status.source.unitId === actor.unitId);
  let weakening = Number(existing?.values?.weakening ?? 0);
  let vulnerability = Number(existing?.values?.vulnerability ?? 0);
  let total = weakening + vulnerability;
  if (total >= maxPieces) {
    if (color === 'weakening' && vulnerability > 0) vulnerability -= 1;
    else if (color === 'vulnerability' && weakening > 0) weakening -= 1;
    else if (color === 'weakening') weakening -= 1;
    else vulnerability -= 1;
    total -= 1;
  }
  if (color === 'weakening') weakening += 1;
  else vulnerability += 1;
  total += 1;

  const commands: EffectCommand[] = [{ type: 'add-status', source, targetId: target.unitId, parentEventId: event.eventId,
    instance: pieceInstance(actor, target, total, weakening, vulnerability) }];
  const sameColorCount = color === 'weakening' ? weakening : vulnerability;
  if (sameColorCount === maxPieces) {
    const stats = context.getEffectiveStats(actor.unitId) ?? actor.stats;
    const defense = context.getEffectiveStats(target.unitId) ?? target.stats;
    const hit = context.calculateDamage({ attack: stats.attack, defense: defense.defense,
      defenseIgnore: effectiveDefenseIgnore(actor), ratio: burstRatio, critChance: stats.crit, critDamage: stats.critDamage }, actor, target);
    commands.push({ type: 'deal-damage', source, targetId: target.unitId, amount: hit.amount,
      ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}),
      ...(hit.isCritical ? { criticalBaseAmount: hit.amount / Math.max(1, stats.critDamage) } : {}),
      isCritical: hit.isCritical, parentEventId: event.eventId });
    weakening -= color === 'weakening' ? maxPieces : 0;
    vulnerability -= color === 'vulnerability' ? maxPieces : 0;
    total = weakening + vulnerability;
    commands.push(total > 0 ? { type: 'add-status', source, targetId: target.unitId, parentEventId: event.eventId,
      instance: pieceInstance(actor, target, total, weakening, vulnerability) }
      : { type: 'remove-status-instances', source, targetId: target.unitId, instanceIds: [existing?.instanceId
        ?? `${yiIds.pieces}:${actor.unitId}:${target.unitId}`], reason: 'consumed', parentEventId: event.eventId });
  }
  return commands;
}

function rotateHeldPiece(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'attack-ended' || !event.source.unitId || event.suppressSourcePassiveTriggers) return;
  const actor = context.getUnit(event.source.unitId);
  if (!actor || actor.heroId !== yiIds.hero || actor.hp <= 0 || !passivesEnabled(actor)) return;
  const held = actor.statuses.find(status => status.statusId === yiIds.heldPiece);
  const nextColor = held?.values?.color === heldColors[0] ? heldColors[1] : heldColors[0];
  const source = yiSource(yiIds.passive, actor.unitId);
  return [{ type: 'add-status', source, targetId: actor.unitId, parentEventId: event.eventId, instance: {
    instanceId: `${yiIds.heldPiece}:${actor.unitId}`, statusId: yiIds.heldPiece, source, stacks: 1,
    duration: { kind: 'permanent' }, values: { color: nextColor },
  } }];
}

function resetTargetFireMarker(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-started') return;
  const target = context.getUnit(event.unitId);
  const marker = target?.statuses.find(status => status.statusId === yiIds.fireSpent);
  const ownerId = String(marker?.source.unitId ?? '');
  const owner = ownerId ? context.getUnit(ownerId) : undefined;
  if (!target || !marker || !owner || owner.heroId !== yiIds.hero) return;
  const source = yiSource(yiIds.passive, owner.unitId);
  return [{ type: 'remove-status-instances', source, targetId: target.unitId,
    instanceIds: [marker.instanceId], reason: 'expired', parentEventId: event.eventId }];
}

function recordTargetFirePayment(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'resource-changed' || event.resourceId !== 'fire' || event.after >= event.before || !event.source.unitId) return;
  const actor = context.getUnit(event.source.unitId);
  const marker = actor?.statuses.find(status => status.statusId === yiIds.pieces);
  const ownerId = String(marker?.values?.ownerUnitId ?? marker?.source.unitId ?? '');
  const owner = ownerId ? context.getUnit(ownerId) : undefined;
  if (!actor || !marker || !owner || owner.heroId !== yiIds.hero
    || actor.statuses.some(status => status.statusId === yiIds.fireSpent && status.source.unitId === owner.unitId)) return;
  const source = yiSource(yiIds.passive, owner.unitId);
  return [{ type: 'add-status', source, targetId: actor.unitId, parentEventId: event.eventId, instance: {
    instanceId: `${yiIds.fireSpent}:${owner.unitId}:${actor.unitId}`, statusId: yiIds.fireSpent, source, stacks: 1,
    duration: { kind: 'count', remaining: 1, owner: 'target-turn' },
  } }];
}

function removePieceAfterFirelessTurn(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-ended') return;
  const target = context.getUnit(event.unitId);
  const marker = target?.statuses.find(status => status.statusId === yiIds.pieces);
  const ownerId = String(marker?.values?.ownerUnitId ?? marker?.source.unitId ?? '');
  const owner = ownerId ? context.getUnit(ownerId) : undefined;
  if (!target || !marker || !owner || owner.heroId !== yiIds.hero) return;
  const spent = target.statuses.find(status => status.statusId === yiIds.fireSpent && status.source.unitId === owner.unitId);
  const source = yiSource(yiIds.passive, owner.unitId);
  const commands: EffectCommand[] = [];
  if (spent) commands.push({ type: 'remove-status-instances', source, targetId: target.unitId,
    instanceIds: [spent.instanceId], reason: 'consumed', parentEventId: event.eventId });
  if (spent) return commands;
  const weakening = Number(marker.values?.weakening ?? 0), vulnerability = Number(marker.values?.vulnerability ?? 0);
  if (weakening + vulnerability <= 0) return;
  const removeWeakening = context.random() * (weakening + vulnerability) < weakening;
  const nextWeakening = Math.max(0, weakening - (removeWeakening ? 1 : 0));
  const nextVulnerability = Math.max(0, vulnerability - (removeWeakening ? 0 : 1));
  const remaining = nextWeakening + nextVulnerability;
  commands.push(remaining > 0 ? { type: 'add-status', source, targetId: target.unitId, parentEventId: event.eventId,
    instance: pieceInstance(owner, target, remaining, nextWeakening, nextVulnerability) }
    : { type: 'remove-status-instances', source, targetId: target.unitId, instanceIds: [marker.instanceId],
      reason: 'expired', parentEventId: event.eventId });
  return commands;
}

function pieceInstance(owner: Readonly<UnitState>, target: Readonly<UnitState>, total: number, weakening: number,
  vulnerability: number): StatusInstance {
  const weakness = modifierPerPiece;
  const modifiers = [];
  if (weakening > 0) modifiers.push({ stat: 'damage' as const, operation: 'percent' as const, amount: -weakness * weakening });
  if (vulnerability > 0) modifiers.push({ stat: 'damageTaken' as const, operation: 'percent' as const, amount: weakness * vulnerability });
  const source = yiSource(yiIds.passive, owner.unitId);
  return { instanceId: `${yiIds.pieces}:${owner.unitId}:${target.unitId}`, statusId: yiIds.pieces, source,
    stacks: total, duration: { kind: 'permanent' }, values: { ownerUnitId: owner.unitId, weakening, vulnerability }, modifiers };
}

function attackOne(context: BattleContext, actor: Readonly<UnitState>, target: Readonly<UnitState>, ratio: number,
  skillId: string): EffectCommand[] {
  const attack = context.getEffectiveStats(actor.unitId) ?? actor.stats;
  const defense = context.getEffectiveStats(target.unitId) ?? target.stats;
  const hit = context.calculateDamage({ attack: attack.attack, defense: defense.defense,
    defenseIgnore: effectiveDefenseIgnore(actor), ratio, critChance: attack.crit, critDamage: attack.critDamage }, actor as UnitState, target as UnitState);
  return [{ type: 'deal-damage', source: yiSource(skillId, actor.unitId), targetId: target.unitId, amount: hit.amount,
    ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}),
    ...(hit.isCritical ? { criticalBaseAmount: hit.amount / Math.max(1, attack.critDamage) } : {}), isCritical: hit.isCritical }];
}

function skillRank(unit: Readonly<UnitState>, skillId: string): number {
  return Math.max(1, Math.min(skillId === yiIds.passive ? 5 : 6, unit.skillLevels?.[skillId] ?? unit.skillLevel));
}

function yiIntent(actorId: string, skillId: string, targetIds: readonly string[], shape: ActionIntent['shape'],
  targetRelation: NonNullable<ActionIntent['targetRelation']>): ActionIntent {
  return { actorId, skillId, targetIds, shape, targetRelation };
}

function opposingSide(side: UnitState['side']): UnitState['side'] { return side === 'blue' ? 'red' : 'blue'; }
function yiSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
