import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import type { BattleContext, BattleEvent, EffectCommand, SourceRef, StatusInstance, UnitState } from '../core/types';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import { passivesEnabled } from '../core/passive-eligibility';
import type { ContentRegistry } from './registry';

export const luminousMoonChaserIds = {
  hero: 395, basic: '3951', passive: '3952', ultimate: '3953',
  unique: 'status.hero.395.unique-passive', flow: 'status.hero.395.flow', shine: 'status.hero.395.shine',
  gathered: 'status.hero.395.gathered-light', lostRadiance: 'status.hero.395.lost-radiance', overflowBuff: 'status.hero.395.overflow-buff',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;

export function registerLuminousMoonChaser(registry: ContentRegistry): void {
  const statusBase = { mechanicsCoverage: 'partial' as const, dispellable: false, sealable: false };
  registry.registerStatus({ id: luminousMoonChaserIds.unique, ...statusBase, durationOwner: 'permanent', refreshPolicy: 'keep' });
  registry.registerStatus({ id: luminousMoonChaserIds.flow, ...statusBase, category: 'buff', durationOwner: 'permanent', refreshPolicy: 'replace', maxStacks: 3 });
  registry.registerStatus({ id: luminousMoonChaserIds.shine, ...statusBase, category: 'buff', durationOwner: 'permanent', refreshPolicy: 'replace', maxStacks: 10 });
  // Client DATA_BUFF row 3953 (集落光) sets immuneDispele=1.
  registry.registerStatus({ id: luminousMoonChaserIds.gathered, dispellable: false, sealable: false, category: 'buff', durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerStatus({ id: luminousMoonChaserIds.lostRadiance, dispellable: false, sealable: true, category: 'debuff',
    durationOwner: 'target-turn', refreshPolicy: 'refresh-duration', blocksResourceMeterAdvance: true });
  registry.registerStatus({ id: luminousMoonChaserIds.overflowBuff, dispellable: true, sealable: false, category: 'buff',
    durationOwner: 'target-turn', refreshPolicy: 'refresh-duration' });
  registry.registerHero(createLuminousMoonChaserDefinition());
}

export function createLuminousMoonChaserDefinition(): HeroDefinition {
  const basic: SkillDefinition = { id: luminousMoonChaserIds.basic, target: 'single', targetRelation: 'enemy',
    levels: basicRatios.map((ratio, level) => ({ ratio, pushChance: level === 4 ? .5 : 0 })), execute(context, intent, params) {
      const actor = context.getUnit(intent.actorId); const target = context.getUnit(intent.targetIds[0] ?? '');
      const atk = actor && context.getEffectiveStats(actor.unitId); const def = target && context.getEffectiveStats(target.unitId);
      if (!actor || !target || !atk || !def) return [];
      const hit = context.calculateDamage({ attack: atk.attack, defense: def.defense, defenseIgnore: effectiveDefenseIgnore(actor),
        ratio: Number(params.ratio ?? 1), critChance: atk.crit, critDamage: atk.critDamage }, actor, target);
      const source = moonSource(luminousMoonChaserIds.basic, actor.unitId);
      const commands: EffectCommand[] = [{ type: 'deal-damage', source, targetId: target.unitId, amount: hit.amount, ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}), isCritical: hit.isCritical }];
      if (Number(params.pushChance) > 0 && target.hp > 0 && target.unitKind !== 'monster'
        && context.random() < Number(params.pushChance))
        commands.push({ type: 'advance-resource-meter', source, side: target.side, resourceId: 'fire', steps: -1 });
      return commands;
    } };
  const ultimate: SkillDefinition = { id: luminousMoonChaserIds.ultimate, actionKind: 'skill',
    resourceCostsByLevel: [3, 3, 3, 2, 2].map(amount => ({ resourceId: 'fire', amount })),
    target: 'all-allies', targetRelation: 'ally', levels: [1, 2, 3, 4, 5].map(level => ({ lostDuration: level >= 3 ? 2 : 1, level })),
    execute(context, intent, params) {
      const actor = context.getUnit(intent.actorId); if (!actor) return [];
      const source = moonSource(luminousMoonChaserIds.ultimate, actor.unitId);
      return intent.targetIds.flatMap(targetId => {
        const target = context.getUnit(targetId); if (!target || target.hp <= 0 || target.unitKind === 'summon') return [];
        return [{ type: 'add-status' as const, source, targetId, instance: statusInstance(luminousMoonChaserIds.gathered,
          `${actor.unitId}:${targetId}`, source, { kind: 'count', remaining: 1, owner: 'target-turn' },
          { ownerUnitId: actor.unitId, ultimateRank: skillRank(actor, luminousMoonChaserIds.ultimate) }) }];
      });
    } };
  return { id: luminousMoonChaserIds.hero, skills: [basic, ultimate], aiCoverage: 'verified', mechanicsCoverage: 'partial',
    aiCoverageNotes: ['按社区AI规则：鬼火足够时无条件施放3技能「集落光」，即使我方仅存活自身也选择自身为目标；鬼火不足时回退普攻。'],
    mechanicsCoverageNotes: ['普攻、被动与大招等级分别读取；开局鬼火条、流光增益、技能费用、集落光状态等级均按对应技能结算；已覆盖回合结束封印校验、唯一流光持有者、五级普攻击退鬼火行动条且对怪物无效、友方正式技能扣火与效果结算扣火均触发集落光、一次扣火消耗1层流光并按实际扣火量推进鬼火条，以及对行动条最前敌方施加失彩；客户端 buff 3953 描述也明确扣火后推进等量鬼火条、消耗集落光、施加失彩 3954 并减少流光 3956，但没有给出失彩扣火回调是否另做命中/抵抗检定；已验证流光追月神被动封印不取消已施加集落光的扣火触发和到期效果，失彩免疫仍可阻止落地，客户端 3954 标记 immuneDispele=1，模拟按不可驱散处理并通过一般驱散回归；技能表 3952 的 addBuffRate=99 实际对应 buffId=3952，不证明失彩 3954 的扣火回调概率；最高行动条目标离场时选下一名在场敌人；客户端 useDebuffResist=false 不代表无视抵抗，多笔扣火顺序仍待实机核验'],
    initialize(context, unitId) {
      const unit = context.getUnit(unitId); if (!unit) return [];
      const owners = context.state.sides[unit.side].map(id => context.getUnit(id)).filter(other => other?.heroId === luminousMoonChaserIds.hero);
      const isUnique = owners[0]?.unitId === unitId;
      const src = moonSource(luminousMoonChaserIds.passive, unitId);
      if (!isUnique) return [];
      const commands: EffectCommand[] = [
        { type: 'add-status', source: src, targetId: unitId,
          instance: statusInstance(luminousMoonChaserIds.unique, unitId, src, { kind: 'permanent' }) },
        { type: 'add-status', source: src, targetId: unitId,
          instance: statusInstance(luminousMoonChaserIds.flow, unitId, src, { kind: 'permanent' }, {}, 3, flowModifiers()) },
      ];
      if (skillRank(unit, luminousMoonChaserIds.passive) >= 3)
        commands.push({ type: 'advance-resource-meter', source: src, side: unit.side, resourceId: 'fire', steps: 4 });
      return commands;
    },
    policy(context, unitId) {
      const actor = context.getUnit(unitId); if (!actor || actor.hp <= 0) return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue'); if (!enemies.length) return undefined;
      const cost = skillRank(actor, luminousMoonChaserIds.ultimate) >= 4 ? 2 : 3;
      if ((context.state.resources[actor.side]?.fire ?? 0) >= cost)
        return { actorId: unitId, skillId: luminousMoonChaserIds.ultimate,
          targetIds: context.getLivingUnits(actor.side).filter(ally => ally.unitKind !== 'summon').map(ally => ally.unitId),
          shape: 'all-allies', targetRelation: 'ally' };
      const target = enemies.slice().sort((a, b) => a.hp / Math.max(1, a.stats.hp) - b.hp / Math.max(1, b.stats.hp))[0]!;
      return { actorId: unitId, skillId: luminousMoonChaserIds.basic, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
    },
    handlers: {
      'resource-overflow': { priority: 90, handle: (context, event) => onOverflow(context, event) },
      'resource-payment': { priority: 90, handle: (context, event) => onFireLoss(context, event) },
      'effect-resolution': { priority: 90, handle: (context, event) => onFireLoss(context, event) },
      'turn-start': { priority: 90, handle: (context, event) => onTurnStart(context, event) },
      'turn-end': { priority: 90, handle: (context, event) => onTurnEnd(context, event) },
      'status-expiration': { priority: 90, handle: (context, event) => onGatheredExpiry(context, event) },
    } };
}

function onTurnEnd(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-ended') return;
  const actor = context.getUnit(event.unitId); if (!actor || actor.hp <= 0 || !hasStatus(actor, luminousMoonChaserIds.unique)
    || !passivesEnabled(actor)) return;
  const source = moonSource(luminousMoonChaserIds.passive, actor.unitId);
  const commands: EffectCommand[] = [{ type: 'advance-resource-meter', source, side: actor.side, resourceId: 'fire', steps: 3 }];
  for (const ally of context.getLivingUnits(actor.side)) {
    const current = statusFor(ally, luminousMoonChaserIds.shine);
    const stacks = Math.min(10, (current?.stacks ?? 0) + 2);
    commands.push({ type: 'add-status', source, targetId: ally.unitId, instance: statusInstance(luminousMoonChaserIds.shine,
      `${actor.unitId}:${ally.unitId}`, source, { kind: 'permanent' }, {}, stacks,
      [{ stat: 'attack', operation: 'percent', amount: stacks * (skillRank(actor, luminousMoonChaserIds.passive) >= 4 ? .1 : .05) },
       { stat: 'speed', operation: 'flat', amount: stacks * (skillRank(actor, luminousMoonChaserIds.passive) >= 2 ? 3 : 0) }]) });
  }
  const flow = statusFor(actor, luminousMoonChaserIds.flow);
  commands.push(setStacks(actor, luminousMoonChaserIds.flow, Math.min(3, (flow?.stacks ?? 0) + 3), source));
  return commands;
}

function onOverflow(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'resource-overflow' || event.resourceId !== 'fire' || event.amount <= 0) return;
  const owner = context.getLivingUnits(event.side).find(unit => unit.heroId === luminousMoonChaserIds.hero && hasStatus(unit, luminousMoonChaserIds.unique));
  if (!owner || context.isUnitUnableToAct(owner.unitId) || !passivesEnabled(owner)) return;
  const shine = statusFor(owner, luminousMoonChaserIds.shine); if ((shine?.stacks ?? 0) >= 10) return;
  const source = moonSource(luminousMoonChaserIds.passive, owner.unitId);
  const commands: EffectCommand[] = [];
  for (const ally of context.getLivingUnits(event.side)) {
    const current = statusFor(ally, luminousMoonChaserIds.shine);
    const stacks = Math.min(10, (current?.stacks ?? 0) + Math.min(event.amount, 10 - (shine?.stacks ?? 0)));
    commands.push({ type: 'add-status', source, targetId: ally.unitId, instance: statusInstance(luminousMoonChaserIds.shine,
      `${owner.unitId}:${ally.unitId}`, source, { kind: 'permanent' }, {}, stacks,
      [{ stat: 'attack', operation: 'percent', amount: stacks * (skillRank(owner, luminousMoonChaserIds.passive) >= 4 ? .1 : .05) },
       { stat: 'speed', operation: 'flat', amount: stacks * (skillRank(owner, luminousMoonChaserIds.passive) >= 2 ? 3 : 0) }]) });
  }
  return commands;
}

function onTurnStart(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-started') return;
  const actor = context.getUnit(event.unitId); if (!actor || actor.hp <= 0) return;
  const owner = context.getLivingUnits(actor.side).find(unit => unit.heroId === luminousMoonChaserIds.hero && hasStatus(unit, luminousMoonChaserIds.unique));
  if (!owner || skillRank(owner, luminousMoonChaserIds.passive) < 5 || !passivesEnabled(owner) || context.isUnitUnableToAct(owner.unitId)
    || (context.state.resources[actor.side]?.fire ?? 0) >= 3) return;
  const flow = statusFor(owner, luminousMoonChaserIds.flow); if (!flow || flow.stacks < 1) return;
  const source = moonSource(luminousMoonChaserIds.passive, owner.unitId);
  return [setStacks(owner, luminousMoonChaserIds.flow, flow.stacks - 1, source),
    { type: 'advance-resource-meter', source, side: actor.side, resourceId: 'fire', steps: 1 }];
}

function onFireLoss(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'resource-changed' || event.resourceId !== 'fire' || event.after >= event.before) return;
  // Fire is shared by side, so the event source can be an enemy draining our
  // resource. Prefer the acting payer when it carries Gathered Light; otherwise
  // resolve the mark from an allied carrier on the side whose fire was reduced.
  const sourceUnit = event.source.unitId ? context.getUnit(event.source.unitId) : undefined;
  const carriers = context.getLivingUnits(event.side).filter(unit => statusFor(unit, luminousMoonChaserIds.gathered));
  const carrier = sourceUnit?.side === event.side && statusFor(sourceUnit, luminousMoonChaserIds.gathered)
    ? sourceUnit : carriers[0];
  if (!carrier) return;
  const gathered = statusFor(carrier, luminousMoonChaserIds.gathered)!;
  const ownerId = String(gathered.values?.ownerUnitId ?? ''); const owner = context.getUnit(ownerId);
  if (!owner || owner.hp <= 0 || event.side !== owner.side || carrier.side !== owner.side) return;
  const flow = statusFor(owner, luminousMoonChaserIds.flow); if (!flow || flow.stacks <= 0) return;
  const enemies = context.getLivingUnits(owner.side === 'blue' ? 'red' : 'blue');
  const target = enemies.slice().sort((a, b) => b.actionGauge - a.actionGauge)[0];
  const source = moonSource(luminousMoonChaserIds.ultimate, owner.unitId);
  const flowSource = moonSource(luminousMoonChaserIds.passive, owner.unitId);
  const commands: EffectCommand[] = [setStacks(owner, luminousMoonChaserIds.flow, flow.stacks - 1, flowSource),
    { type: 'remove-statuses', source, targetId: carrier.unitId, statusIds: [luminousMoonChaserIds.gathered], reason: 'consumed' },
    { type: 'advance-resource-meter', source, side: owner.side, resourceId: 'fire', steps: event.before - event.after }];
  if (target) commands.push({ type: 'add-status', source, targetId: target.unitId, instance: statusInstance(luminousMoonChaserIds.lostRadiance,
    `${owner.unitId}:${target.unitId}`, source, { kind: 'count',
      remaining: Number(gathered.values?.ultimateRank ?? skillRank(owner, luminousMoonChaserIds.ultimate)) >= 3 ? 2 : 1, owner: 'target-turn' },
    { ownerUnitId: owner.unitId }) });
  return commands;
}

function onGatheredExpiry(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'status-removed' || event.reason !== 'expired' || event.statusId !== luminousMoonChaserIds.gathered) return;
  const ownerId = String(event.removedValues?.ownerUnitId ?? ''); const owner = context.getUnit(ownerId);
  const holder = context.getUnit(event.targetId); if (!owner || !holder) return;
  const source = moonSource(luminousMoonChaserIds.ultimate, owner.unitId);
  const rank = skillRank(owner, luminousMoonChaserIds.ultimate);
  const commands: EffectCommand[] = [];
  if (rank >= 2) commands.push({ type: 'dispel-statuses', source, targetId: holder.unitId,
    filter: 'debuff-or-control', maxCount: 1 });
  if (rank >= 5) commands.push({ type: 'add-status', source, targetId: holder.unitId,
    instance: statusInstance(luminousMoonChaserIds.overflowBuff, `${owner.unitId}:${holder.unitId}`, source,
      { kind: 'count', remaining: 2, owner: 'target-turn' }, {}, 1,
      [{ stat: 'attack', operation: 'percent', amount: .3 }, { stat: 'speed', operation: 'flat', amount: 30 }]) });
  return commands.length ? commands : undefined;
}

function hasStatus(unit: { statuses: readonly StatusInstance[] }, id: string): boolean { return unit.statuses.some(status => status.statusId === id); }
function statusFor(unit: { statuses: readonly StatusInstance[] }, id: string): StatusInstance | undefined { return unit.statuses.find(status => status.statusId === id); }
function setStacks(unit: { unitId: string }, statusId: string, stacks: number, source: SourceRef): EffectCommand {
  if (stacks <= 0) return { type: 'remove-statuses', source, targetId: unit.unitId, statusIds: [statusId], reason: 'consumed' };
  const modifiers = statusId === luminousMoonChaserIds.flow ? flowModifiers() : undefined;
  return { type: 'add-status', source, targetId: unit.unitId, instance: statusInstance(statusId, unit.unitId, source, { kind: 'permanent' }, {}, stacks, modifiers) };
}
function flowModifiers(): NonNullable<StatusInstance['modifiers']> {
  return [{ stat: 'resist', operation: 'flat', amount: .1, perStack: true }];
}
function skillRank(unit: Readonly<UnitState>, skillId: string): number {
  const rank = unit.skillLevels?.[skillId];
  return Number.isFinite(rank) ? Math.max(1, Math.min(6, Math.floor(rank!))) : unit.skillLevel;
}
function statusInstance(statusId: string, key: string, source: SourceRef, duration: StatusInstance['duration'],
  values: StatusInstance['values'] = {}, stacks = 1, modifiers?: StatusInstance['modifiers']): StatusInstance {
  return { instanceId: `${statusId}:${key}`, statusId, source, duration, stacks, values, ...(modifiers ? { modifiers } : {}) };
}
function moonSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
