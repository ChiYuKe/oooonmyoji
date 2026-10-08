import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, BattleState, EffectCommand, SourceRef, StatusInstance } from '../core/types';
import { attemptDebuff } from '../mechanics/control';
import { effectiveDefenseIgnore, effectiveStats } from '../mechanics/stats';
import { passivesEnabled } from '../core/passive-eligibility';
import type { ContentRegistry } from './registry';

export const jinkougyouIds = {
  hero: 391, basic: '3911', fieldSkill: '3912', wishSkill: '3913', unique: 'status.hero.391.unique',
  fragranceField: 'status.hero.391.fragrance-field', heartFragrance: 'status.hero.391.heart-fragrance',
  soulBinder: 'status.hero.391.soul-binder', trance: 'status.hero.391.trance', defenseRuin: 'status.hero.391.defense-ruin',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const wishRatios = [.8, .85, .9, .95, 1] as const;
function soulBinderModifiers(skillLevel: number): NonNullable<StatusInstance['modifiers']> {
  return [{ stat: 'defense', operation: 'percent', amount: skillLevel >= 3 ? -.1 : -.05, perStack: true }];
}

export function registerJinkougyou(registry: ContentRegistry): void {
  registry.registerStatus({ id: jinkougyouIds.unique, mechanicsCoverage: 'partial', category: 'other', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'keep' });
  registry.registerStatus({ id: jinkougyouIds.fragranceField, mechanicsCoverage: 'partial', category: 'other', dispellable: false,
    sealable: false, durationOwner: 'source-turn', refreshPolicy: 'replace', modifyResourceCost(_state, actor, skill, cost) {
      const field = fieldStatus(actor);
      return actor.heroId === jinkougyouIds.hero && field && fieldLevel(actor, field) >= 3 && skill.id !== jinkougyouIds.basic
        ? Math.max(0, cost.amount - 1) : cost.amount;
    } });
  registry.registerStatus({ id: jinkougyouIds.heartFragrance, mechanicsCoverage: 'partial', category: 'mark', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'add-stack', maxStacks: 5 });
  registry.registerStatus({ id: jinkougyouIds.soulBinder, mechanicsCoverage: 'partial', category: 'debuff', dispellable: true,
    sealable: true, durationOwner: 'permanent', refreshPolicy: 'add-stack', stackScope: 'source-unit', maxStacks: 3 });
  registry.registerStatus({ id: jinkougyouIds.trance, mechanicsCoverage: 'partial', category: 'debuff', dispellable: true,
    sealable: true, durationOwner: 'permanent', refreshPolicy: 'replace', preventsAction: true });
  registry.registerStatus({ id: jinkougyouIds.defenseRuin, mechanicsCoverage: 'partial', category: 'debuff', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'keep' });
  registry.registerHero(createJinkougyouDefinition());
}

export function createJinkougyouDefinition(): HeroDefinition {
  const basic: SkillDefinition = { id: jinkougyouIds.basic, target: 'single', targetRelation: 'enemy',
    levels: basicRatios.map(ratio => ({ ratio })), execute(context, intent, params) {
      return directHit(context, intent.actorId, intent.targetIds[0] ?? '', jinkougyouIds.basic, Number(params.ratio ?? 1));
    } };
  const field: SkillDefinition = { id: jinkougyouIds.fieldSkill, resourceCostsByLevel: [3, 3, 3, 2, 2].map(amount => ({ resourceId: 'fire', amount })),
    target: 'self', targetRelation: 'ally', levels: [1, 2, 3, 4, 5].map(level => ({ turns: level >= 2 ? 4 : 3, level })),
    execute(context, intent, params) {
      const actor = context.getUnit(intent.actorId); if (!actor) return [];
      if (!hasUnique(actor)) return [];
      const source = jinkouSource(jinkougyouIds.fieldSkill, actor.unitId);
      return [{ type: 'add-status', source, targetId: actor.unitId, instance: makeStatus(jinkougyouIds.fragranceField,
        actor.unitId, source, { kind: 'count', remaining: Number(params.turns ?? 3), owner: 'source-turn' },
        { skillLevel: Number(params.level ?? actor.skillLevel) }) }];
    } };
  const wish: SkillDefinition = { id: jinkougyouIds.wishSkill, resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'all-enemies', targetRelation: 'enemy', levels: wishRatios.map((ratio, index) => ({ ratio, level: index + 1 })), execute(context, intent, params) {
      const actor = context.getUnit(intent.actorId); const stats = actor && context.getEffectiveStats(actor.unitId);
      if (!actor || !stats) return [];
      const wishRank = skillRank(actor, jinkougyouIds.wishSkill);
      const source = jinkouSource(jinkougyouIds.wishSkill, actor.unitId);
      const missingEnemies = Math.max(0, Math.min(5, context.state.sides[actor.side === 'blue' ? 'red' : 'blue'].length
        - context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue').length));
      const ratio = Number(params.ratio ?? .8) * (wishRank >= 5 ? 1 + .12 * missingEnemies : 1);
      const commands: EffectCommand[] = [];
      const currentField = fieldStatus(actor);
      if (currentField && wishRank >= 2) commands.push({ type: 'add-status', source, targetId: actor.unitId,
        instance: { ...currentField, duration: { kind: 'count', remaining: currentField.duration.kind === 'count'
          ? currentField.duration.remaining + 1 : 4, owner: 'source-turn' } } });
      for (const targetId of intent.targetIds) {
        const target = context.getUnit(targetId); if (!target || target.hp <= 0 || target.side === actor.side) continue;
        const amount = stats.attack * ratio * defenseGapMultiplier(actor, target, context.state);
        commands.push({ type: 'lose-life', source, targetId: target.unitId, amount, lifeLossKind: 'indirect' });
        if (currentField) commands.push(...attemptDebuff(context, { source, targetId: target.unitId, statusId: jinkougyouIds.soulBinder,
          baseChance: target.unitKind === 'monster' ? 1 : .4, duration: { kind: 'permanent' },
          modifiers: soulBinderModifiers(fieldLevel(actor, currentField)) }));
      }
      return commands;
    } };

  return { id: jinkougyouIds.hero, skills: [basic, field, wish], aiCoverage: 'partial',
    aiCoverageNotes: ['参考本地整理的社区 AI 规则：未开启明香境且鬼火足够时先开场，场地存在且鬼火足够时使用菩提愿；普攻优先选择生命比例低于20%或带有失神的敌人。选招/目标规则尚无官方 AI 序列或配对实战记录验证'],
    mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['技能等级按各技能独立读取；二级明香境基础持续4回合，二级菩提愿额外延长1回合；三级明香境起技能鬼火减耗1点；缚魂香跨技能合层，三级明香境起每层降防由5%提升为10%，三层转化为失神和永久降低35%防御；明香境内菩提愿对怪物必中缚魂香；封印转化、特殊目标判定仍未全部覆盖'],
    initialize(context, unitId) {
      const actor = context.getUnit(unitId); if (!actor) return [];
      const sameSide = context.state.sides[actor.side].map(id => context.getUnit(id)).filter(unit => unit?.heroId === jinkougyouIds.hero);
      if (sameSide[0]?.unitId !== unitId) return [];
      const source = jinkouSource(jinkougyouIds.fieldSkill, actor.unitId);
      const commands: EffectCommand[] = [{ type: 'add-status', source, targetId: actor.unitId,
        instance: makeStatus(jinkougyouIds.unique, actor.unitId, source, { kind: 'permanent' }) }];
      const fieldRank = skillRank(actor, jinkougyouIds.fieldSkill);
      if (fieldRank >= 5) commands.push({ type: 'add-status', source, targetId: actor.unitId,
        instance: makeStatus(jinkougyouIds.fragranceField, actor.unitId, source, { kind: 'count', remaining: 3, owner: 'source-turn' },
          { skillLevel: fieldRank }) });
      return commands;
    },
    modifyOutgoingDamage(attacker, target, amount, _kind, state) {
      if (attacker.heroId !== jinkougyouIds.hero || !hasUnique(attacker) || !passivesEnabled(attacker) || !fieldStatus(attacker)) return amount;
      return amount * defenseGapMultiplier(attacker, target, state);
    },
    policy(context, unitId) {
      const actor = context.getUnit(unitId); if (!actor || actor.hp <= 0) return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue'); if (!enemies.length) return undefined;
      const fire = context.state.resources[actor.side]?.fire ?? 0;
      const fieldRank = skillRank(actor, jinkougyouIds.fieldSkill);
      const activeField = hasUnique(actor) && passivesEnabled(actor) && Boolean(fieldStatus(actor));
      if (hasUnique(actor) && !activeField && fire >= (fieldRank >= 4 ? 2 : 3))
        return intent(unitId, jinkougyouIds.fieldSkill, [unitId], 'self', 'ally');
      const activeFieldState = fieldStatus(actor);
      const wishCost = activeFieldState && fieldLevel(actor, activeFieldState) >= 3 ? 2 : 3;
      if (activeField && fire >= wishCost) return intent(unitId, jinkougyouIds.wishSkill, enemies.map(enemy => enemy.unitId), 'all-enemies', 'enemy');
      const preferred = enemies.filter(enemy => enemy.hp / Math.max(1, enemy.stats.hp) < .2
        || enemy.statuses.some(status => status.statusId === jinkougyouIds.trance));
      const target = (preferred.length > 0 ? preferred : enemies).slice()
        .sort((a, b) => a.hp / Math.max(1, a.stats.hp) - b.hp / Math.max(1, b.stats.hp)
          || a.unitId.localeCompare(b.unitId))[0]!;
      return intent(unitId, jinkougyouIds.basic, [target.unitId], 'single', 'enemy');
    },
    handlers: {
      hit: { priority: 90, handle: (context, event) => applySoulBinder(context, event) },
      'effect-resolution': { priority: 90, handle: (context, event) => convertSoulBinder(context, event) },
      'turn-end': { priority: 90, handle: (context, event) => gainHeartFragrance(context, event) },
      'action-validation': { priority: 90, handle: (context, event) => removeTranceAfterSkip(context, event) },
    } };
}

function directHit(context: BattleContext, actorId: string, targetId: string, skillId: string, ratio: number): EffectCommand[] {
  const actor = context.getUnit(actorId); const target = context.getUnit(targetId);
  const attack = actor && context.getEffectiveStats(actor.unitId); const defense = target && context.getEffectiveStats(target.unitId);
  if (!actor || !target || !attack || !defense) return [];
  const hit = context.calculateDamage({ attack: attack.attack, defense: defense.defense, defenseIgnore: effectiveDefenseIgnore(actor),
    ratio, critChance: attack.crit, critDamage: attack.critDamage }, actor, target);
  return [{ type: 'deal-damage', source: jinkouSource(skillId, actorId), targetId, amount: hit.amount, ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}), isCritical: hit.isCritical }];
}

function applySoulBinder(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage' || !event.source.unitId) return;
  const actor = context.getUnit(event.source.unitId); const target = context.getUnit(event.targetId);
  if (!actor || actor.heroId !== jinkougyouIds.hero || !hasUnique(actor) || !passivesEnabled(actor)
    || !target || target.side === actor.side || !fieldStatus(actor)) return;
  const source = jinkouSource(event.source.id, actor.unitId);
  const field = fieldStatus(actor);
  return attemptDebuff(context, { source, targetId: target.unitId, statusId: jinkougyouIds.soulBinder, baseChance: .4,
    duration: { kind: 'permanent' }, parentEventId: event.eventId,
    modifiers: soulBinderModifiers(field ? fieldLevel(actor, field) : actor.skillLevel) });
}

function convertSoulBinder(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'status-added' || event.instance.statusId !== jinkougyouIds.soulBinder || event.instance.stacks < 3) return;
  const target = context.getUnit(event.targetId); const ownerId = event.instance.source.unitId;
  const owner = ownerId && context.getUnit(ownerId);
  if (!target || !owner || !hasUnique(owner) || !passivesEnabled(owner) || target.hp <= 0) return;
  const source = jinkouSource(event.instance.source.id, owner.unitId);
  const commands: EffectCommand[] = [
    { type: 'remove-statuses', source, targetId: target.unitId, statusIds: [jinkougyouIds.soulBinder], reason: 'consumed' },
    { type: 'lose-life', source, targetId: target.unitId,
      amount: (context.getEffectiveStats(owner.unitId)?.attack ?? owner.stats.attack) * 2.31 * defenseGapMultiplier(owner, target, context.state),
      lifeLossKind: 'indirect' },
    { type: 'add-status', source, targetId: target.unitId,
      instance: makeStatus(jinkougyouIds.trance, `${owner.unitId}:${target.unitId}`, source, { kind: 'permanent' }) },
  ];
  if (!target.statuses.some(status => status.statusId === jinkougyouIds.defenseRuin)) commands.push({ type: 'add-status', source,
    targetId: target.unitId, instance: makeStatus(jinkougyouIds.defenseRuin, `${owner.unitId}:${target.unitId}`, source,
      { kind: 'permanent' }, {}, 1, [{ stat: 'defense', operation: 'percent', amount: -.35 }]) });
  return commands;
}

function gainHeartFragrance(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-ended') return;
  const actor = context.getUnit(event.unitId); if (!actor || actor.hp <= 0 || actor.unitKind === 'summon') return;
  const owner = context.getLivingUnits(actor.side).find(unit => unit.heroId === jinkougyouIds.hero && hasUnique(unit)
    && passivesEnabled(unit) && fieldStatus(unit)
    && unit.unitId !== actor.unitId);
  if (!owner) return;
  const current = owner.statuses.find(status => status.statusId === jinkougyouIds.heartFragrance);
  const stacks = Math.min(5, (current?.stacks ?? 0) + 1);
  const source = jinkouSource(jinkougyouIds.fieldSkill, owner.unitId);
  const commands: EffectCommand[] = stacks < 5 ? [{ type: 'add-status', source, targetId: owner.unitId,
    instance: makeStatus(jinkougyouIds.heartFragrance, owner.unitId, source, { kind: 'permanent' }, {}, stacks) }]
    : [{ type: 'remove-statuses', source, targetId: owner.unitId, statusIds: [jinkougyouIds.heartFragrance], reason: 'consumed' },
      ...context.getLivingUnits(owner.side === 'blue' ? 'red' : 'blue').map(target => ({ type: 'lose-life' as const, source,
        targetId: target.unitId, amount: (context.getEffectiveStats(owner.unitId)?.attack ?? owner.stats.attack) * .43,
        lifeLossKind: 'indirect' as const }))];
  return commands;
}

function removeTranceAfterSkip(_context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'action-skipped' || event.reason !== 'interrupted') return;
  const actorId = event.actorId;
  return [{ type: 'remove-statuses', source: { kind: 'status', id: jinkougyouIds.trance, unitId: actorId },
    targetId: actorId, statusIds: [jinkougyouIds.trance], reason: 'consumed', parentEventId: event.eventId }];
}

function fieldStatus(unit: { statuses: readonly StatusInstance[] }): StatusInstance | undefined {
  return unit.statuses.find(status => status.statusId === jinkougyouIds.fragranceField);
}
function fieldLevel(unit: { skillLevel: number; skillLevels?: Readonly<Record<string, number>> }, field: StatusInstance): number {
  return Number(field.values?.skillLevel ?? skillRank(unit, jinkougyouIds.fieldSkill));
}
function skillRank(unit: { skillLevel: number; skillLevels?: Readonly<Record<string, number>> }, skillId: string): number {
  const rank = unit.skillLevels?.[skillId];
  return Number.isInteger(rank) ? Math.max(1, Math.min(5, rank!)) : Math.max(1, Math.min(5, unit.skillLevel));
}
function hasUnique(unit: { statuses: readonly StatusInstance[] }): boolean {
  return unit.statuses.some(status => status.statusId === jinkougyouIds.unique);
}
function defenseGapMultiplier(attacker: { unitId: string }, target: { unitId: string }, state: Readonly<BattleState>): number {
  const own = state.units[attacker.unitId]; const targetUnit = state.units[target.unitId];
  const ownDefense = Math.max(1, own ? effectiveStats(own).defense : 1);
  const targetDefense = targetUnit ? effectiveStats(targetUnit).defense : ownDefense;
  return targetDefense < ownDefense ? 1 + (ownDefense - targetDefense) / ownDefense : 1;
}
function makeStatus(statusId: string, key: string, source: SourceRef, duration: StatusInstance['duration'],
  values: StatusInstance['values'] = {}, stacks = 1, modifiers?: StatusInstance['modifiers']): StatusInstance {
  return { instanceId: `${statusId}:${key}`, statusId, source, duration, stacks, values, ...(modifiers ? { modifiers } : {}) };
}
function intent(actorId: string, skillId: string, targetIds: readonly string[], shape: ActionIntent['shape'],
  targetRelation: ActionIntent['targetRelation']): ActionIntent { return { actorId, skillId, targetIds, shape, targetRelation }; }
function jinkouSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
