import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, StatusInstance, UnitState } from '../core/types';
import { passiveSuppressionStatusId } from '../core/passive-eligibility';
import { soulSuppressionStatusId } from '../core/soul-eligibility';
import { passivesEnabled } from '../core/passive-eligibility';
import { attemptControl, attemptDebuff } from '../mechanics/control';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import { createBasicAttackSkill } from './common-skills';
import type { ContentRegistry } from './registry';

export const omikaneIds = {
  hero: 304,
  basic: '3041',
  foxHunt: '3042',
  spiritArrow: '3043',
  sealedArrow: '3044',
  field: 'status.hero.304.fox-hunt-field',
  talisman: 'status.hero.304.talisman',
  silence: 'status.hero.304.silence',
  healingReduction: 'status.hero.304.healing-reduction',
} as const;

const basicRatios = [.8, .84, .88, .92, 1] as const;
const spiritArrowRankBonus = [.2, .21, .22, .23, .25] as const;
const foxHuntLayers = 4;

export function registerOmikane(registry: ContentRegistry): void {
  registry.registerStatus({ id: omikaneIds.field, mechanicsCoverage: 'partial', category: 'buff', dispellable: true,
    sealable: false, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerStatus({ id: omikaneIds.talisman, mechanicsCoverage: 'partial', category: 'buff', dispellable: true,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'add-stack', stackScope: 'source-unit', maxStacks: 12 });
  registry.registerStatus({ id: omikaneIds.silence, mechanicsCoverage: 'partial', category: 'control', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace', preventsSkill: true });
  registry.registerStatus({ id: omikaneIds.healingReduction, mechanicsCoverage: 'partial', category: 'debuff', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerHero(createOmikaneDefinition());
}

export function createOmikaneDefinition(): HeroDefinition {
  const basic = createBasicAttackSkill(omikaneIds.basic, basicRatios);
  const foxHunt: SkillDefinition = {
    id: omikaneIds.foxHunt, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'self', targetRelation: 'ally', levels: [{ layers: foxHuntLayers }],
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      if (!actor || actor.hp <= 0) return [];
      return openFoxHunt(context, actor, Number(parameters.layers ?? 4), `action-${context.state.counters.action + 1}`);
    },
  };
  const spiritArrow: SkillDefinition = {
    id: omikaneIds.spiritArrow, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'single', targetRelation: 'enemy', canUse(_state, actor) { return talismanStacks(actor) > 0; },
    levels: spiritArrowRankBonus.map(bonus => ({ ratio: 1.95, perLayerBonus: bonus })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      const target = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || !target || target.hp <= 0) return [];
      const stats = context.getEffectiveStats(actor.unitId) ?? actor.stats;
      const targetStats = context.getEffectiveStats(target.unitId) ?? target.stats;
      const stacks = talismanStacks(actor);
      const ratio = Number(parameters.ratio ?? 1.95) * (1 + stacks * Number(parameters.perLayerBonus ?? .2));
      const hit = context.calculateDamage({ attack: stats.attack, defense: targetStats.defense,
        defenseIgnore: effectiveDefenseIgnore(actor), ratio, critChance: stats.crit, critDamage: stats.critDamage }, actor, target);
      const source = omikaneSource(omikaneIds.spiritArrow, actor.unitId);
      const commands: EffectCommand[] = [{ type: 'deal-damage', source, targetId: target.unitId, amount: hit.amount,
        ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}),
        ...(hit.isCritical ? { criticalBaseAmount: hit.amount / Math.max(1, stats.critDamage) } : {}), isCritical: hit.isCritical }];
      for (const ally of context.getLivingUnits(actor.side)) {
        const instances = ally.statuses.filter(status => status.statusId === omikaneIds.talisman
          && status.source.unitId === actor.unitId).map(status => status.instanceId);
        if (instances.length) commands.push({ type: 'remove-status-instances', source, targetId: ally.unitId,
          instanceIds: instances, reason: 'consumed' });
      }
      return commands;
    },
  };

  return {
    id: omikaneIds.hero,
    skills: [basic, foxHunt, spiritArrow],
    aiCoverage: 'partial', mechanicsCoverage: 'verified',
    aiCoverageNotes: ['官方 SKILL_AI_DATA 未从斗技客户端运行时加载，本地只能参考社区整理的选招表：友方御馔津均无灵符时使用狐狩界；仅一名御馔津持有灵符时有50%概率狐狩界/破魔箭；多名持有灵符时使用破魔箭。现已按该规则移除“结界存续时强制普攻”的未经证实分支；一矢被动箭帧不能证明行动选招，仍缺官方AI表和可辨认的配对行动帧。'],
    mechanicsCoverageNotes: ['已按客户端技能行实现固定4层狐狩界、12层灵符上限、灵符全队属性、技能等级普攻倍率、敌方行动结束5%/结界内40%封魔箭、封魔箭伤害与控制/封印/减疗，以及燃爆按灵符增伤并消耗灵符。回归覆盖开场/主动施放、结界过期清除灵符、概率边界和目标被动/御魂屏蔽。'],
    initialize(context, unitId) {
      const owner = context.getUnit(unitId);
      if (!owner || owner.heroId !== omikaneIds.hero || !passivesEnabled(owner)) return [];
      return openFoxHunt(context, owner, foxHuntLayers, 'preemptive');
    },
    policy(context, unitId): ActionIntent | undefined {
      const actor = context.getUnit(unitId);
      if (!actor || actor.hp <= 0 || actor.unitKind === 'summon') return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      const target = enemies.slice().sort((left, right) => left.hp / Math.max(1, left.stats.hp)
        - right.hp / Math.max(1, right.stats.hp))[0]!;
      const fire = context.state.resources[actor.side]?.fire ?? 0;
      if (fire >= 3) {
        const friendlyMikos = context.getLivingUnits(actor.side).filter(unit => unit.heroId === omikaneIds.hero
          && unit.unitKind !== 'summon');
        const talismanMikos = friendlyMikos.filter(unit => talismanStacks(unit) > 0);
        const actorHasTalisman = talismanStacks(actor) > 0;
        const chooseFoxHunt = () => ({ actorId: unitId, skillId: omikaneIds.foxHunt,
          targetIds: [unitId], shape: 'self' as const, targetRelation: 'ally' as const });
        if (talismanMikos.length === 0 || !actorHasTalisman
          || (talismanMikos.length === 1 && context.random() < .5)) return chooseFoxHunt();
        return { actorId: unitId, skillId: omikaneIds.spiritArrow, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
      }
      return { actorId: unitId, skillId: omikaneIds.basic, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
    },
    handlers: {
      'turn-end': { priority: 28, handle(context, event) { return shootAfterEnemyTurn(context, event); } },
      'status-expiration': { priority: 28, handle(context, event) { return expireField(context, event); } },
      'unit-defeated': { priority: 28, handle(context, event) { return clearOnDefeat(context, event); } },
    },
  };
}

function openFoxHunt(context: BattleContext, owner: Readonly<UnitState>, layers: number, marker: string): EffectCommand[] {
  const source = omikaneSource(omikaneIds.foxHunt, owner.unitId);
  const commands: EffectCommand[] = [{ type: 'add-status', source, targetId: owner.unitId, instance: {
    instanceId: `${omikaneIds.field}:${owner.unitId}`, statusId: omikaneIds.field, source, stacks: 1,
    duration: { kind: 'count', remaining: 1, owner: 'target-turn' }, values: { castMarker: marker },
  } }];
  const boundedLayers = Math.max(0, Math.min(12, Math.floor(layers)));
  for (const ally of context.getLivingUnits(owner.side)) {
    if (ally.unitKind === 'summon') continue;
    commands.push({ type: 'add-status', source, targetId: ally.unitId, instance: {
      instanceId: `${omikaneIds.talisman}:${owner.unitId}:${ally.unitId}`, statusId: omikaneIds.talisman, source,
      stacks: boundedLayers, duration: { kind: 'permanent' }, modifiers: talismanModifiers(),
      values: { fieldOwnerId: owner.unitId },
    } });
  }
  return commands;
}

function shootAfterEnemyTurn(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-ended') return;
  const target = context.getUnit(event.unitId);
  if (!target || target.hp <= 0 || target.unitKind === 'summon') return;
  const archers = context.getLivingUnits(target.side === 'blue' ? 'red' : 'blue')
    .filter(unit => unit.heroId === omikaneIds.hero && passivesEnabled(unit));
  const commands: EffectCommand[] = [];
  for (const owner of archers) {
    const inField = hasField(owner);
    if (context.random() >= (inField ? .4 : .05)) continue;
    const ownerStats = context.getEffectiveStats(owner.unitId) ?? owner.stats;
    const targetStats = context.getEffectiveStats(target.unitId) ?? target.stats;
    const rank = skillLevel(owner, omikaneIds.basic);
    const ratio = basicRatios[Math.max(0, Math.min(4, rank - 1))]!;
    const hit = context.calculateDamage({ attack: ownerStats.attack, defense: targetStats.defense,
      defenseIgnore: effectiveDefenseIgnore(owner), ratio, critChance: ownerStats.crit, critDamage: ownerStats.critDamage }, owner, target);
    const source = omikaneSource(omikaneIds.sealedArrow, owner.unitId);
    const intent: ActionIntent = { actorId: owner.unitId, skillId: omikaneIds.sealedArrow, targetIds: [target.unitId],
      shape: 'single', targetRelation: 'enemy', kind: 'passive' };
    commands.push({ type: 'schedule-attack', source, intent, scheduling: 'assist',
      suppressTargetSoulTriggers: true, suppressTargetPassiveTriggers: true,
      hits: [{ targetId: target.unitId, amount: hit.amount, ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}),
        ...(hit.isCritical ? { criticalBaseAmount: hit.amount / Math.max(1, ownerStats.critDamage) } : {}),
        isCritical: hit.isCritical, suppressTargetPassiveTriggers: true }], parentEventId: event.eventId });
    const duration = { kind: 'count' as const, remaining: 1, owner: 'target-turn' as const };
    const scopeId = `${omikaneIds.sealedArrow}:${event.eventId}:${owner.unitId}`;
    for (const [statusId, label] of [[passiveSuppressionStatusId, '被动封印'], [soulSuppressionStatusId, '御魂封印'],
      [omikaneIds.silence, '沉默']] as const) {
      const control = attemptControl(context, { attemptId: `${statusId}:${owner.unitId}:${target.unitId}:${event.eventId}`,
        source, targetId: target.unitId, statusId, controlType: label, baseChance: 1, duration,
        parentEventId: event.eventId, scopeId });
      if (control) commands.push(control);
    }
    commands.push(...attemptDebuff(context, { source, targetId: target.unitId, statusId: omikaneIds.healingReduction,
      baseChance: 1, duration, parentEventId: event.eventId, modifiers: [{ stat: 'healingTaken', operation: 'percent', amount: -.75 }] }));
  }
  return commands;
}

function expireField(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'status-removed' || event.statusId !== omikaneIds.field || event.reason !== 'expired') return;
  const owner = event.source.unitId ? context.getUnit(event.source.unitId) : undefined;
  if (!owner) return;
  const source = omikaneSource(omikaneIds.foxHunt, owner.unitId);
  return context.getLivingUnits(owner.side).flatMap(ally => {
    const instances = ally.statuses.filter(status => status.statusId === omikaneIds.talisman && status.source.unitId === owner.unitId)
      .map(status => status.instanceId);
    return instances.length ? [{ type: 'remove-status-instances' as const, source, targetId: ally.unitId, instanceIds: instances,
      reason: 'expired' as const, parentEventId: event.eventId }] : [];
  });
}

function clearOnDefeat(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'unit-defeated') return;
  const owner = context.getUnit(event.unitId);
  if (!owner || owner.heroId !== omikaneIds.hero) return;
  const source = omikaneSource(omikaneIds.foxHunt, owner.unitId);
  return context.state.sides[owner.side].flatMap(allyId => {
    const ally = context.getUnit(allyId);
    if (!ally) return [];
    const instances = ally.statuses.filter(status => status.statusId === omikaneIds.talisman && status.source.unitId === owner.unitId)
      .map(status => status.instanceId);
    return instances.length ? [{ type: 'remove-status-instances' as const, source, targetId: ally.unitId,
      instanceIds: instances, reason: 'expired' as const, parentEventId: event.eventId }] : [];
  });
}

function talismanModifiers(): NonNullable<StatusInstance['modifiers']> {
  return [{ stat: 'defense', operation: 'percent', amount: .03, perStack: true },
    { stat: 'damage', operation: 'percent', amount: .02, perStack: true },
    { stat: 'speed', operation: 'flat', amount: 1, perStack: true }];
}
function talismanStacks(unit: Readonly<UnitState>): number {
  return unit.statuses.filter(status => status.statusId === omikaneIds.talisman && status.source.unitId === unit.unitId)
    .reduce((sum, status) => sum + status.stacks, 0);
}
function hasField(unit: Readonly<UnitState>): boolean { return unit.statuses.some(status => status.statusId === omikaneIds.field); }
function omikaneSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
function skillLevel(unit: Readonly<UnitState>, skillId: string): number {
  return Math.max(1, Math.min(5, unit.skillLevels?.[skillId] ?? unit.skillLevel));
}
