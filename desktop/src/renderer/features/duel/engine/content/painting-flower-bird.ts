import type { HeroDefinition, SkillDefinition, StatusDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, StatusInstance, UnitState } from '../core/types';
import { effectiveStats } from '../mechanics/stats';
import { createBasicAttackSkill } from './common-skills';
import type { ContentRegistry } from './registry';

export const paintingFlowerBirdIds = {
  hero: 367, basic: '3671', passive: '3672', dream: '3673', bloom: '3674',
  moYing: 'status.hero.367.mo-ying', protection: 'status.hero.367.protection',
  painting: 'status.hero.367.painting', ink: 'status.hero.367.ink',
  paintingDamage: 'status.hero.367.painting-damage', maxHealth: 'status.hero.367.max-health',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const bloomRatios = [.08, .1, .1, .12, .12] as const;
const bloomBounces = [2, 2, 3, 3, 4] as const;

export function registerPaintingFlowerBird(registry: ContentRegistry): void {
  const statuses: StatusDefinition[] = [
    { id: paintingFlowerBirdIds.moYing, mechanicsCoverage: 'partial', category: 'buff', dispellable: false, sealable: false,
      durationOwner: 'permanent', refreshPolicy: 'keep' },
    { id: paintingFlowerBirdIds.protection, mechanicsCoverage: 'partial', category: 'buff', dispellable: true, sealable: false,
      durationOwner: 'target-turn', refreshPolicy: 'replace', controlProtection: 'single-application' },
    { id: paintingFlowerBirdIds.painting, mechanicsCoverage: 'partial', category: 'other', dispellable: false, sealable: false,
      durationOwner: 'source-turn', refreshPolicy: 'replace' },
    { id: paintingFlowerBirdIds.ink, mechanicsCoverage: 'partial', category: 'mark', dispellable: false, sealable: false,
      durationOwner: 'permanent', refreshPolicy: 'replace' },
    { id: paintingFlowerBirdIds.paintingDamage, mechanicsCoverage: 'partial', category: 'buff', dispellable: false, sealable: false,
      durationOwner: 'permanent', refreshPolicy: 'replace' },
    { id: paintingFlowerBirdIds.maxHealth, mechanicsCoverage: 'partial', category: 'buff', dispellable: false, sealable: false,
      durationOwner: 'permanent', refreshPolicy: 'keep' },
  ];
  statuses.forEach(status => registry.registerStatus(status));
  registry.registerHero(createPaintingFlowerBirdDefinition());
}

export function createPaintingFlowerBirdDefinition(): HeroDefinition {
  const basicBase = createBasicAttackSkill(paintingFlowerBirdIds.basic, basicRatios);
  const basic: SkillDefinition = { ...basicBase, execute(context, intent, parameters) {
    const actor = context.getUnit(intent.actorId);
    const commands = [...basicBase.execute(context, intent, parameters)];
    if (actor && actor.heroId === paintingFlowerBirdIds.hero && actor.hp > 0 && actor.unitKind !== 'summon'
      && skillRank(actor, paintingFlowerBirdIds.basic) >= 5)
      commands.push(statusCommand(actor, paintingFlowerBirdIds.protection, flowerSource(paintingFlowerBirdIds.basic, actor.unitId),
        { kind: 'count', remaining: 1, owner: 'target-turn' }));
    return commands;
  } };
  const dream: SkillDefinition = {
    id: paintingFlowerBirdIds.dream, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 2 },
    target: 'single', targetRelation: 'enemy', levels: [1, 2, 3, 4, 5].map(rank => ({ rank })),
    canUse(state, actor) { return actor.heroId === paintingFlowerBirdIds.hero && !has(actor, paintingFlowerBirdIds.painting)
      && actor.hp > 0 && actor.unitKind !== 'summon' && (state.resources[actor.side]?.fire ?? actor.resources.fire ?? 0) >= 2; },
    execute(context, intent) {
      const actor = context.getUnit(intent.actorId), target = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || actor.hp <= 0 || actor.heroId !== paintingFlowerBirdIds.hero || has(actor, paintingFlowerBirdIds.painting)
        || !target || target.hp <= 0 || target.side === actor.side || target.unitKind === 'summon') return [];
      const rank = skillRank(actor, paintingFlowerBirdIds.dream), source = flowerSource(paintingFlowerBirdIds.dream, actor.unitId);
      const ratio = rank >= 4 ? .2 : rank >= 2 ? .15 : .1;
      const painting: StatusInstance = { instanceId: `${paintingFlowerBirdIds.painting}:${actor.unitId}`,
        statusId: paintingFlowerBirdIds.painting, source, stacks: 1,
        duration: { kind: 'count', remaining: 4, owner: 'source-turn' },
        values: { turnsRemaining: 4, inkTargetId: target.unitId, transferRatio: ratio, perHitCap: actor.stats.hp * 12 } };
      const commands: EffectCommand[] = [
        { type: 'add-status', source, targetId: actor.unitId, instance: painting },
        statusCommand(target, paintingFlowerBirdIds.ink, source, { kind: 'permanent' },
          { paintingOwnerId: actor.unitId, transferRatio: ratio }),
      ];
      if (rank >= 3) commands.push(...paintingDamageBuffs(context, actor, rank >= 5 ? .2 : .1));
      return commands;
    },
  };
  const bloom: SkillDefinition = {
    id: paintingFlowerBirdIds.bloom, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 0 },
    target: 'single', targetRelation: 'ally', levels: bloomRatios.map((ratio, index) => ({ ratio, bounces: bloomBounces[index]!, rank: index + 1 })),
    canUse(_state, actor) { return actor.heroId === paintingFlowerBirdIds.hero && has(actor, paintingFlowerBirdIds.painting)
      && actor.hp > 0 && actor.unitKind !== 'summon'; },
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId), initial = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || actor.hp <= 0 || actor.heroId !== paintingFlowerBirdIds.hero || actor.unitKind === 'summon'
        || !has(actor, paintingFlowerBirdIds.painting) || !initial || initial.hp <= 0 || initial.side !== actor.side
        || initial.unitId === actor.unitId || initial.unitKind === 'summon') return [];
      const rank = skillRank(actor, paintingFlowerBirdIds.dream);
      const bounces = Number(parameters.bounces ?? bloomBounces[rank - 1]);
      const ratio = Number(parameters.ratio ?? bloomRatios[rank - 1]);
      const eligible = context.getLivingUnits(actor.side).filter(unit => unit.unitId !== actor.unitId && unit.unitKind !== 'summon');
      const ordered = [initial, ...eligible.filter(unit => unit.unitId !== initial.unitId)
        .sort((a, b) => a.hp / Math.max(1, a.stats.hp) - b.hp / Math.max(1, b.stats.hp))].slice(0, 1 + bounces);
      const source = flowerSource(paintingFlowerBirdIds.bloom, actor.unitId);
      return ordered.map(target => ({ type: 'heal', source, targetId: target.unitId, amount: target.stats.hp * ratio }));
    },
  };
  return {
    id: paintingFlowerBirdIds.hero, skills: [basic, dream, bloom], mechanicsCoverage: 'partial', aiCoverage: 'partial',
    handlers: {
      'battle-start': { priority: 52, handle(context, event) { return initializeMoYing(context, event); } },
      'hit': { priority: 52, handle(context, event) { return paintDamageTransmission(context, event); } },
      'effect-resolution': { priority: 52, handle(context, event) {
        if (event.type === 'status-removed' && event.statusId === paintingFlowerBirdIds.painting)
          return handlePaintingRemoved(context, event);
        if (event.type === 'healing' && event.source.id === paintingFlowerBirdIds.bloom)
          return transferBloomCrit(context, event);
        return undefined;
      } },
      'status-expiration': { priority: 52, handle(context, event) {
        if (event.type === 'status-removed' && event.statusId === paintingFlowerBirdIds.painting)
          return handlePaintingRemoved(context, event);
        return undefined;
      } },
    },
    modifyOutgoingDamage(attacker, _target, amount, _kind, state) {
      if (state.activeAttackShape !== 'all-enemies' && state.activeAttackShape !== 'multi') return amount;
      const buff = attacker.statuses.find(status => status.statusId === paintingFlowerBirdIds.paintingDamage);
      return buff ? amount * (1 + Number(buff.values?.ratio ?? 0)) : amount;
    },
    aiCoverageNotes: ['社区式神AI条目：敌方无逐墨时使用绘梦浮生，有逐墨时用繁花坠露；绘梦浮生优先标记当前生命值最高敌人，繁花坠露优先治疗生命比例最低友方，普攻优先打低于20%生命的目标。条件目标已实现，召唤物筛选、鬼火不足时的完整兜底顺序和多目标残局仍需实战AI帧复核。'],
    mechanicsCoverageNotes: ['按本地3671至3674及3672/3673战斗状态行接入基础攻击、满级庇护、墨萦治疗加成/抵抗/开战加生命上限、2火浮生画影/逐墨、群攻增伤、一线目传导及繁花坠露治疗弹射和暴击传导。画影按来源回合持续4回合，单次传导封顶绘世花鸟卷生命上限1200%。仍需核对画影的伤害免疫/状态免疫与召唤目标语义、非战斗AI/召唤单位传导、治疗暴击使用何种暴击率、逐墨存续与传导的御魂触发边界。'],
    policy(context, unitId) {
      const actor = context.getUnit(unitId);
      if (!actor || actor.heroId !== paintingFlowerBirdIds.hero || actor.hp <= 0 || actor.unitKind === 'summon') return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      const inked = findOwnedInk(context, actor.unitId);
      if (inked) {
        const ally = context.getLivingUnits(actor.side).filter(unit => unit.unitId !== actor.unitId && unit.unitKind !== 'summon')
          .sort((a, b) => a.hp / Math.max(1, a.stats.hp) - b.hp / Math.max(1, b.stats.hp))[0];
        if (ally) return intent(actor.unitId, paintingFlowerBirdIds.bloom, [ally.unitId], 'single', 'ally');
      }
      if ((context.state.resources[actor.side]?.fire ?? 0) >= 2) {
        const target = enemies.filter(unit => unit.unitKind !== 'summon').sort((a, b) => b.hp - a.hp)[0];
        if (target) return intent(actor.unitId, paintingFlowerBirdIds.dream, [target.unitId], 'single', 'enemy');
      }
      const lowHealth = enemies.filter(unit => unit.hp / Math.max(1, unit.stats.hp) < .2)
        .sort((a, b) => a.hp / Math.max(1, a.stats.hp) - b.hp / Math.max(1, b.stats.hp))[0];
      const target = lowHealth ?? enemies.slice().sort((a, b) => a.hp / Math.max(1, a.stats.hp) - b.hp / Math.max(1, b.stats.hp))[0]!;
      return intent(actor.unitId, paintingFlowerBirdIds.basic, [target.unitId], 'single', 'enemy');
    },
  };
}

function initializeMoYing(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'battle-started') return;
  const commands: EffectCommand[] = [];
  for (const side of ['blue', 'red'] as const) {
    const owner = context.getLivingUnits(side).find(unit => unit.heroId === paintingFlowerBirdIds.hero && unit.unitKind !== 'summon');
    if (!owner || !passiveOwner(context, owner)) continue;
    const ratio = skillRank(owner, paintingFlowerBirdIds.passive) >= 2 ? .3 : .2;
    const resist = skillRank(owner, paintingFlowerBirdIds.passive) >= 3 ? .2 : 0;
    for (const ally of context.getLivingUnits(side)) {
      commands.push(statusCommand(ally, paintingFlowerBirdIds.moYing, flowerSource(paintingFlowerBirdIds.passive, owner.unitId),
        { kind: 'permanent' }, undefined, [{ stat: 'healingTaken', operation: 'percent', amount: ratio },
          ...(resist ? [{ stat: 'resist' as const, operation: 'flat' as const, amount: resist }] : [])]));
      if (skillRank(owner, paintingFlowerBirdIds.passive) >= 4 && ally.unitKind !== 'summon') {
        commands.push({ type: 'increase-max-health', source: flowerSource(paintingFlowerBirdIds.passive, owner.unitId),
          targetId: ally.unitId, amount: ally.stats.hp * .1 });
        commands.push(statusCommand(ally, paintingFlowerBirdIds.maxHealth, flowerSource(paintingFlowerBirdIds.passive, owner.unitId),
          { kind: 'permanent' }));
      }
    }
  }
  return commands;
}

function paintDamageTransmission(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage' || event.hpLost <= 0 || event.source.id === paintingFlowerBirdIds.painting
    || event.source.id === paintingFlowerBirdIds.bloom || event.source.id === paintingFlowerBirdIds.dream) return;
  const hitUnit = context.getUnit(event.targetId);
  if (!hitUnit) return;
  const commands: EffectCommand[] = [];
  for (const owner of [...context.getLivingUnits('blue'), ...context.getLivingUnits('red')].filter(unit =>
    unit.heroId === paintingFlowerBirdIds.hero && unit.unitKind !== 'summon' && unit.side !== hitUnit.side
      && has(unit, paintingFlowerBirdIds.painting))) {
    const inked = findOwnedInk(context, owner.unitId);
    if (!inked || inked.unitId === hitUnit.unitId || inked.hp <= 0) continue;
    const image = owner.statuses.find(status => status.statusId === paintingFlowerBirdIds.painting);
    const ratio = Number(image?.values?.transferRatio ?? .1);
    const cap = Number(image?.values?.perHitCap ?? owner.stats.hp * 12);
    commands.push(transferDamage(owner, inked, flowerSource(paintingFlowerBirdIds.painting, owner.unitId),
      Math.min(event.hpLost * ratio, cap), event.source.id));
  }
  return commands.length ? commands : undefined;
}

function transferBloomCrit(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'healing' || event.amount <= 0) return;
  const owner = context.getUnit(event.source.unitId ?? '');
  const target = context.getUnit(event.targetId);
  if (!owner || owner.hp <= 0 || !target || context.random() >= effectiveStats(owner).crit) return;
  const inked = findOwnedInk(context, owner.unitId);
  if (!inked || inked.hp <= 0) return;
  const image = owner.statuses.find(status => status.statusId === paintingFlowerBirdIds.painting);
  if (!image) return;
  const cap = Number(image.values?.perHitCap ?? owner.stats.hp * 12);
  const ratio = inked.unitKind === 'monster' ? 1 : .2;
  return [transferDamage(owner, inked, flowerSource(paintingFlowerBirdIds.bloom, owner.unitId),
    Math.min(event.amount * ratio, cap), paintingFlowerBirdIds.bloom)];
}

function transferDamage(owner: Readonly<UnitState>, target: Readonly<UnitState>, source: SourceRef, amount: number,
  originalSourceId: string): EffectCommand {
  return { type: 'deal-damage', source, targetId: target.unitId, amount, precalculated: true, cannotBeShared: true,
    suppressSoulTriggers: true, suppressTargetSoulTriggers: true, suppressTargetPassiveTriggers: true,
    ...(originalSourceId === paintingFlowerBirdIds.bloom ? { actionKind: 'skill' as const } : {}) };
}

function paintingDamageBuffs(context: BattleContext, owner: Readonly<UnitState>, ratio: number): EffectCommand[] {
  return context.getLivingUnits(owner.side).map(ally => statusCommand(ally, paintingFlowerBirdIds.paintingDamage,
    flowerSource(paintingFlowerBirdIds.dream, owner.unitId), { kind: 'permanent' }, { ratio }));
}

function handlePaintingRemoved(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'status-removed') return;
  const owner = context.getUnit(event.targetId);
  if (!owner || owner.heroId !== paintingFlowerBirdIds.hero) return;
  const commands: EffectCommand[] = [];
  for (const ally of [...context.getLivingUnits('blue'), ...context.getLivingUnits('red')].filter(unit => unit.side === owner.side)) {
    const buff = ally.statuses.filter(status => status.statusId === paintingFlowerBirdIds.paintingDamage
      && status.source.unitId === owner.unitId);
    if (buff.length) commands.push({ type: 'remove-status-instances', source: event.source, targetId: ally.unitId,
      instanceIds: buff.map(status => status.instanceId), reason: 'consumed', parentEventId: event.eventId });
  }
  const ink = findOwnedInk(context, owner.unitId);
  if (ink) {
    const mark = ink.statuses.find(status => status.statusId === paintingFlowerBirdIds.ink
      && status.source.unitId === owner.unitId);
    if (mark) commands.push({ type: 'remove-status-instances', source: event.source, targetId: ink.unitId,
      instanceIds: [mark.instanceId], reason: 'consumed', parentEventId: event.eventId });
  }
  if (passiveOwner(context, owner) && skillRank(owner, paintingFlowerBirdIds.passive) >= 5
    && event.reason !== 'expired' && owner.hp > 0)
    commands.push({ type: 'change-action-gauge', source: flowerSource(paintingFlowerBirdIds.passive, owner.unitId),
      targetId: owner.unitId, amount: 30, parentEventId: event.eventId });
  return commands.length ? commands : undefined;
}

function findOwnedInk(context: BattleContext, ownerId: string): UnitState | undefined {
  return [...context.getLivingUnits('blue'), ...context.getLivingUnits('red')].find(unit =>
    unit.statuses.some(status => status.statusId === paintingFlowerBirdIds.ink && status.source.unitId === ownerId));
}
function passiveOwner(context: BattleContext, owner: Readonly<UnitState>): boolean {
  return context.getLivingUnits(owner.side).find(unit => unit.heroId === paintingFlowerBirdIds.hero && unit.unitKind !== 'summon')?.unitId === owner.unitId;
}
function has(unit: Readonly<UnitState>, statusId: string): boolean { return unit.statuses.some(status => status.statusId === statusId); }
function skillRank(owner: Readonly<UnitState>, skillId: string): number {
  const rank = owner.skillLevels?.[skillId];
  return Number.isFinite(rank) ? Math.max(1, Math.min(6, Math.floor(rank!))) : Math.max(1, Math.min(6, owner.skillLevel));
}
function statusCommand(target: Readonly<UnitState>, statusId: string, source: SourceRef, duration: StatusInstance['duration'],
  values?: StatusInstance['values'], modifiers?: StatusInstance['modifiers']): EffectCommand {
  return { type: 'add-status', source, targetId: target.unitId, instance: { instanceId: `${statusId}:${source.unitId}:${target.unitId}`,
    statusId, source, stacks: 1, duration, ...(values ? { values } : {}), ...(modifiers ? { modifiers } : {}) } };
}
function flowerSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
function intent(actorId: string, skillId: string, targetIds: readonly string[], shape: ActionIntent['shape'],
  targetRelation: ActionIntent['targetRelation']): ActionIntent { return { actorId, skillId, targetIds, shape, targetRelation }; }
