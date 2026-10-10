import type { DamageInterception, HeroDefinition, SkillDefinition, StatusDefinition } from '../core/definitions';
import { passivesEnabled } from '../core/passive-eligibility';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, StatusInstance, UnitState } from '../core/types';
import { effectiveStats } from '../mechanics/stats';
import type { ContentRegistry } from './registry';

export const emptyFaceAuraIds = {
  hero: 366, basic: '3661', passive: '3662', dream: '3663', return: '3664',
  masks: 'status.hero.366.unmasked', oneEye: 'status.hero.366.one-eye', dark: 'status.hero.366.dark',
  darkSpeed: 'status.hero.366.dark-speed', seal: 'status.hero.366.passive-seal', rebirth: 'status.hero.366.rebirth-ready',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const returnRatio = .63;

export function registerEmptyFaceAura(registry: ContentRegistry): void {
  const statuses: StatusDefinition[] = [
    { id: emptyFaceAuraIds.masks, mechanicsCoverage: 'partial', category: 'mark', dispellable: false, sealable: false,
      durationOwner: 'permanent', refreshPolicy: 'add-stack', stackScope: 'source-unit', maxStacks: 7 },
    { id: emptyFaceAuraIds.oneEye, mechanicsCoverage: 'partial', category: 'debuff', dispellable: true, sealable: false,
      durationOwner: 'target-turn', refreshPolicy: 'replace' },
    { id: emptyFaceAuraIds.dark, mechanicsCoverage: 'partial', category: 'buff', dispellable: false, sealable: false,
      durationOwner: 'permanent', refreshPolicy: 'keep', grantedSkills: [createReturnSkill()] },
    { id: emptyFaceAuraIds.darkSpeed, mechanicsCoverage: 'partial', category: 'buff', dispellable: false, sealable: false,
      durationOwner: 'permanent', refreshPolicy: 'replace' },
    { id: emptyFaceAuraIds.seal, mechanicsCoverage: 'partial', category: 'debuff', dispellable: false, sealable: false,
      durationOwner: 'source-turn', refreshPolicy: 'replace', maxStacks: 1, stackScope: 'source-unit' },
    { id: emptyFaceAuraIds.rebirth, mechanicsCoverage: 'partial', category: 'buff', dispellable: false, sealable: false,
      durationOwner: 'permanent', refreshPolicy: 'replace', preventsLethalDamage: true, requiresPassiveEnabled: true },
  ];
  statuses.forEach(status => registry.registerStatus(status));
  registry.registerHero(createEmptyFaceAuraDefinition());
}

export function createEmptyFaceAuraDefinition(): HeroDefinition {
  const basic: SkillDefinition = {
    id: emptyFaceAuraIds.basic, target: 'single', targetRelation: 'enemy', levels: basicRatios.map(ratio => ({ ratio })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId), target = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || actor.hp <= 0 || actor.heroId !== emptyFaceAuraIds.hero || !target || target.hp <= 0 || target.side === actor.side) return [];
      const offense = effectiveStats(actor), defense = effectiveStats(target);
      const hit = context.calculateDamage({ attack: offense.attack, defense: defense.defense, ratio: Number(parameters.ratio ?? 1),
        defenseIgnore: maskIgnore(actor) + (has(actor, emptyFaceAuraIds.dark) ? 200 : 0),
        critChance: defense.defense <= 0 ? 1 : offense.crit, critDamage: offense.critDamage }, actor, target);
      return [{ type: 'deal-damage', source: faceSource(emptyFaceAuraIds.basic, actor.unitId), targetId: target.unitId,
        amount: hit.amount, ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}), isCritical: hit.isCritical,
        suppressSoulTriggers: true, suppressTargetSoulTriggers: true, suppressTargetPassiveTriggers: true, cannotBeShared: true }];
    },
  };
  const dream: SkillDefinition = {
    id: emptyFaceAuraIds.dream, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'single', targetRelation: 'enemy', levels: [1, 2, 3, 4, 5].map(rank => ({ rank, gauge: 25 })),
    execute(context, intent) {
      const actor = context.getUnit(intent.actorId), target = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || actor.hp <= 0 || actor.heroId !== emptyFaceAuraIds.hero || !target || target.hp <= 0 || target.side === actor.side) return [];
      const rank = rankOf(actor, emptyFaceAuraIds.dream), source = faceSource(emptyFaceAuraIds.dream, actor.unitId);
      const commands: EffectCommand[] = [];
      const previous = target.statuses.find(status => status.statusId === emptyFaceAuraIds.oneEye);
      if (previous) {
        const resentment = Number(previous.values?.resentment ?? 0);
        if (previous.source.unitId === actor.unitId && resentment > 0) commands.push({ type: 'lose-life', source, targetId: target.unitId,
          amount: Math.min(resentment, teamInitialAttack(context, actor.side) * 40), lifeLossKind: 'indirect' });
        commands.push({ type: 'remove-status-instances', source, targetId: target.unitId,
          instanceIds: [previous.instanceId], reason: 'consumed' });
      }
      commands.push(addOneEye(actor, target));
      if (previous?.source.unitId === actor.unitId && rank >= 5) commands.push({ type: 'add-status', source, targetId: target.unitId,
        instance: { instanceId: `${emptyFaceAuraIds.seal}:${actor.unitId}:${target.unitId}`, statusId: emptyFaceAuraIds.seal,
          source, stacks: 1, duration: { kind: 'count', remaining: 2, owner: 'source-turn' }, values: { sealPassives: true } } });
      for (const ally of context.getLivingUnits(actor.side)) commands.push({ type: 'change-action-gauge', source,
        targetId: ally.unitId, amount: 25 });
      return commands;
    },
  };
  const transform: SkillDefinition = {
    id: emptyFaceAuraIds.passive, actionKind: 'skill', target: 'single', targetRelation: 'enemy', levels: [{}, {}, {}, {}, {}],
    canUse(state, actor) { return actor.heroId === emptyFaceAuraIds.hero && !has(actor, emptyFaceAuraIds.dark)
      && maskCount(actor) >= 4 && actor.hp > 0 && actor.unitKind !== 'summon'
      && state.units[actor.unitId] !== undefined; },
    execute(context, intent) {
      const actor = context.getUnit(intent.actorId);
      if (!actor || actor.hp <= 0 || actor.heroId !== emptyFaceAuraIds.hero || has(actor, emptyFaceAuraIds.dark) || maskCount(actor) < 4) return [];
      return enterDark(context, actor, intent.targetIds[0], true);
    },
  };
  return {
    id: emptyFaceAuraIds.hero, skills: [basic, transform, dream, createReturnSkill()], aiCoverage: 'partial', mechanicsCoverage: 'partial',
    handlers: {
      'unit-defeated': { priority: 51, handle(context, event) { return collectMask(context, event); } },
      'turn-start': { priority: 51, handle(context, event) { return addDreamResentment(context, event); } },
      'turn-end': { priority: 51, handle(context, event) { return igniteExpiredEye(context, event); } },
      'hit': { priority: 51, handle(context, event) { return recordDreamDamage(context, event); } },
      'effect-resolution': { priority: 51, handle(context, event) {
        return triggerRebirth(context, event) ?? recordDreamDamage(context, event);
      } },
    },
    interceptIncomingDamage(state, _attacker, target, amount): DamageInterception | undefined {
      const eye = target.statuses.find(status => status.statusId === emptyFaceAuraIds.oneEye);
      if (eye && amount > 0 && rankOfSource(state, eye.source.unitId, emptyFaceAuraIds.dream) >= 4) {
        const stored = Number(eye.values?.resentment ?? 0) + amount * .3;
        return { amount: amount * .7, effects: [{ type: 'add-status', source: eye.source, targetId: target.unitId,
          instance: { ...eye, values: { ...eye.values, resentment: stored } } }] };
      }
      return undefined;
    },
    aiCoverageNotes: ['社区式神AI条目：我方存活数≥2时用3技能，=1时用2技能；3技能选择当前生命值较高敌人，4技能选当前生命上限最低单位（含召唤物）。策略按该规则实现；火量不足时回普攻，仍需实战AI记录核对权重例外。'],
    mechanicsCoverageNotes: ['按本地3661至3664及3661至3665战斗状态行接入存湮等级伤害、非召唤单位阵亡叠未面（上限7、每张无视50防御）、梦虚空境3火/全体友方25%行动条、一线目20%降防/三回合引燃/同目标重挂引燃、回合开始怨痕131%攻击/友方伤害20%/自身受伤30%记录与减伤、怨痕按友方初始总攻击4000%封顶；四张未面可手动转黑光或挡致命伤害，黑光满血/清自身减益、按未面加速、追加轮回段数/200无视防御/15%吸血已接入。剩余未覆盖：间接伤害与御魂/护盾/分担的完整客户端语义，持续期与引燃的实战事件时序，重复挂目被动封印的精确回合窗口，以及被动四级的未面补充条件。'],
    policy(context, unitId) {
      const actor = context.getUnit(unitId);
      if (!actor || actor.heroId !== emptyFaceAuraIds.hero || actor.hp <= 0 || actor.unitKind === 'summon') return undefined;
      const allies = context.getLivingUnits(actor.side).filter(unit => unit.unitKind !== 'summon');
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      if (has(actor, emptyFaceAuraIds.dark)) {
        if ((context.state.resources[actor.side]?.fire ?? 0) < 3) {
          const target = enemies.slice().sort((a, b) => a.hp - b.hp)[0]!;
          return intent(actor.unitId, emptyFaceAuraIds.basic, [target.unitId], 'single', 'enemy');
        }
        const target = enemies.slice().sort((a, b) => a.stats.hp - b.stats.hp)[0]!;
        return intent(actor.unitId, emptyFaceAuraIds.return, [target.unitId], 'single', 'enemy');
      }
      if (allies.length === 1 && maskCount(actor) >= 4) {
        const target = enemies.slice().sort((a, b) => a.hp - b.hp)[0]!;
        return intent(actor.unitId, emptyFaceAuraIds.passive, [target.unitId], 'single', 'enemy');
      }
      if (allies.length >= 2 && (context.state.resources[actor.side]?.fire ?? 0) >= 3) {
        const target = enemies.slice().sort((a, b) => b.hp - a.hp)[0]!;
        return intent(actor.unitId, emptyFaceAuraIds.dream, [target.unitId], 'single', 'enemy');
      }
      const target = enemies.slice().sort((a, b) => a.hp - b.hp)[0]!;
      return intent(actor.unitId, emptyFaceAuraIds.basic, [target.unitId], 'single', 'enemy');
    },
  };
}

function createReturnSkill(): SkillDefinition {
  return { id: emptyFaceAuraIds.return, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'single', targetRelation: 'enemy', levels: [1, 2, 3, 4, 5].map(rank => ({ ratio: returnRatio, rank })),
    canUse(_state, actor) { return actor.heroId === emptyFaceAuraIds.hero && has(actor, emptyFaceAuraIds.dark); },
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      if (!actor || actor.hp <= 0 || !has(actor, emptyFaceAuraIds.dark)) return [];
      const selected = intent.targetIds.map(id => context.getUnit(id))
        .find((unit): unit is UnitState => Boolean(unit && unit.hp > 0 && unit.side !== actor.side));
      const targets = [...context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue')].filter(unit => unit.unitId !== selected?.unitId);
      const hits = rankOf(actor, emptyFaceAuraIds.passive) >= 3 ? 1 + maskCount(actor) : 1;
      const commands: EffectCommand[] = [];
      const projectedHp = new Map([...targets, ...(selected ? [selected] : [])].map(unit => [unit.unitId, unit.hp]));
      let target = selected;
      for (let index = 0; index < hits && target; index += 1) {
        const attack = effectiveStats(actor).attack;
        const hit = context.calculateDamage({ attack, defense: effectiveStats(target).defense, ratio: Number(parameters.ratio ?? returnRatio),
          defenseIgnore: maskIgnore(actor) + 200, critChance: effectiveStats(actor).crit,
          critDamage: effectiveStats(actor).critDamage, leechRate: .15 }, actor, target);
        commands.push({ type: 'deal-damage', source: faceSource(emptyFaceAuraIds.return, actor.unitId), targetId: target.unitId,
          amount: hit.amount, leechRate: .15, ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}), isCritical: hit.isCritical,
          suppressSoulTriggers: true, suppressTargetSoulTriggers: true, suppressTargetPassiveTriggers: true, cannotBeShared: true });
        projectedHp.set(target.unitId, Math.max(0, (projectedHp.get(target.unitId) ?? target.hp) - hit.amount));
        if ((projectedHp.get(target.unitId) ?? 0) <= 0 && index + 1 < hits) {
          target = [...targets].filter(unit => (projectedHp.get(unit.unitId) ?? unit.hp) > 0)
            .sort((a, b) => (projectedHp.get(a.unitId) ?? a.hp) - (projectedHp.get(b.unitId) ?? b.hp))[0];
          if (target) targets.splice(targets.indexOf(target), 1);
        }
      }
      return commands;
    } };
}

function collectMask(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'unit-defeated') return;
  const dead = context.getUnit(event.unitId);
  if (!dead || dead.unitKind === 'summon') return;
  return (['blue', 'red'] as const).flatMap(side => context.getLivingUnits(side).filter(unit => unit.heroId === emptyFaceAuraIds.hero
    && unit.unitKind !== 'summon').slice(0, 1)).filter(unit => unit.hp > 0 && passivesEnabled(unit) && maskCount(unit) < 7)
    .flatMap(owner => addMask(owner, 1));
}
function triggerRebirth(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'status-removed' || event.statusId !== emptyFaceAuraIds.rebirth || event.reason !== 'consumed') return;
  const owner = context.getUnit(event.targetId);
  if (!owner || owner.heroId !== emptyFaceAuraIds.hero || owner.hp <= 0 || !passivesEnabled(owner) || has(owner, emptyFaceAuraIds.dark)) return;
  return enterDark(context, owner);
}
function igniteExpiredEye(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-ended') return;
  const target = context.getUnit(event.unitId), eye = target?.statuses.find(status => status.statusId === emptyFaceAuraIds.oneEye
    && status.duration.kind === 'count' && status.duration.owner === 'target-turn' && status.duration.remaining <= 1);
  if (!target || !eye) return;
  const owner = context.getUnit(eye.source.unitId ?? '');
  const commands: EffectCommand[] = [];
  const resentment = Number(eye.values?.resentment ?? 0);
  if (owner && resentment > 0) commands.push({ type: 'lose-life', source: eye.source, targetId: target.unitId,
    amount: Math.min(resentment, teamInitialAttack(context, owner.side) * 40), lifeLossKind: 'indirect', parentEventId: event.eventId });
  commands.push({ type: 'remove-status-instances', source: eye.source, targetId: target.unitId,
    instanceIds: [eye.instanceId], reason: 'expired', parentEventId: event.eventId });
  return commands;
}
function addDreamResentment(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-started') return;
  const actor = context.getUnit(event.unitId);
  if (!actor || actor.heroId !== emptyFaceAuraIds.hero || actor.hp <= 0 || rankOf(actor, emptyFaceAuraIds.dream) < 2) return;
  const amount = effectiveStats(actor).attack * 1.31;
  return allUnits(context).flatMap(target => {
    const eye = target.statuses.find(status => status.statusId === emptyFaceAuraIds.oneEye && status.source.unitId === actor.unitId);
    return eye ? [updateEye(target, eye, Number(eye.values?.resentment ?? 0) + amount)] : [];
  });
}
function recordDreamDamage(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if ((event.type !== 'life-lost' && event.type !== 'damage') || event.hpLost <= 0) return;
  const target = context.getUnit(event.targetId), eye = target?.statuses.find(status => status.statusId === emptyFaceAuraIds.oneEye);
  if (!target || !eye) return;
  const owner = context.getUnit(eye.source.unitId ?? '');
  const attacker = event.source.unitId ? context.getUnit(event.source.unitId) : undefined;
  if (!owner || owner.hp <= 0 || rankOf(owner, emptyFaceAuraIds.dream) < 3 || target.side === owner.side
    || !attacker || attacker.side !== owner.side) return;
  return [updateEye(target, eye, Number(eye.values?.resentment ?? 0) + event.hpLost * .2)];
}
function updateEye(target: Readonly<UnitState>, eye: StatusInstance, resentment: number): EffectCommand {
  return { type: 'add-status', source: eye.source, targetId: target.unitId,
    instance: { ...eye, values: { ...eye.values, resentment } } };
}
function addOneEye(owner: Readonly<UnitState>, target: Readonly<UnitState>): EffectCommand {
  return { type: 'add-status', source: faceSource(emptyFaceAuraIds.dream, owner.unitId), targetId: target.unitId,
    instance: { instanceId: `${emptyFaceAuraIds.oneEye}:${owner.unitId}:${target.unitId}`, statusId: emptyFaceAuraIds.oneEye,
      source: faceSource(emptyFaceAuraIds.dream, owner.unitId), stacks: 1,
      duration: { kind: 'count', remaining: 3, owner: 'target-turn' },
      modifiers: [{ stat: 'defense', operation: 'percent', amount: -.2 }], values: { resentment: 0 } } };
}
function enterDark(context: Pick<BattleContext, 'state' | 'getUnit' | 'getLivingUnits' | 'getStatusCategory'>,
  actor: Readonly<UnitState>, targetId?: string, manual = false): EffectCommand[] {
  const source = faceSource(emptyFaceAuraIds.passive, actor.unitId), commands: EffectCommand[] = [];
  const marked = targetId ? context.getUnit(targetId) : Object.values(context.state.units).find(unit =>
    unit.statuses.some(status => status.statusId === emptyFaceAuraIds.oneEye && status.source.unitId === actor.unitId));
  if (marked) {
    const target = marked, eye = target.statuses.find(status => status.statusId === emptyFaceAuraIds.oneEye && status.source.unitId === actor.unitId);
    if (target && eye) {
      const resentment = Number(eye.values?.resentment ?? 0);
      if (resentment > 0) commands.push({ type: 'lose-life', source, targetId: target.unitId,
        amount: Math.min(resentment, teamInitialAttack(context, actor.side) * 40), lifeLossKind: 'indirect' });
      commands.push({ type: 'remove-status-instances', source, targetId: target.unitId, instanceIds: [eye.instanceId], reason: 'consumed' });
    }
  }
  const rebirth = actor.statuses.find(status => status.statusId === emptyFaceAuraIds.rebirth);
  if (rebirth) commands.push({ type: 'remove-status-instances', source, targetId: actor.unitId,
    instanceIds: [rebirth.instanceId], reason: 'consumed' });
  commands.push({ type: 'add-status', source, targetId: actor.unitId, instance: { instanceId: `${emptyFaceAuraIds.dark}:${actor.unitId}`,
    statusId: emptyFaceAuraIds.dark, source, stacks: 1, duration: { kind: 'permanent' }, values: { blackLight: true } } },
  { type: 'restore-health', source, targetId: actor.unitId, amount: actor.stats.hp });
  for (const status of actor.statuses.filter(item => context.getStatusCategory(item.statusId) === 'debuff'
    || context.getStatusCategory(item.statusId) === 'control'))
    commands.push({ type: 'remove-status-instances', source, targetId: actor.unitId, instanceIds: [status.instanceId], reason: 'consumed' });
  const speed = rankOf(actor, emptyFaceAuraIds.passive) >= 2 ? 5 * maskCount(actor) : 0;
  if (speed) for (const ally of context.getLivingUnits(actor.side)) commands.push({ type: 'add-status', source, targetId: ally.unitId,
    instance: { instanceId: `${emptyFaceAuraIds.darkSpeed}:${actor.unitId}:${ally.unitId}`, statusId: emptyFaceAuraIds.darkSpeed,
      source, stacks: 1, duration: { kind: 'permanent' }, modifiers: [{ stat: 'speed', operation: 'flat', amount: speed }] } });
  if (manual && rankOf(actor, emptyFaceAuraIds.passive) >= 5) commands.push({ type: 'schedule-turn', source, unitId: actor.unitId,
    scheduling: 'extra-turn', selection: 'action-gauge' });
  return commands;
}
function addMask(owner: Readonly<UnitState>, amount: number): EffectCommand[] {
  const status = owner.statuses.find(item => item.statusId === emptyFaceAuraIds.masks);
  const source = faceSource(emptyFaceAuraIds.passive, owner.unitId);
  const commands: EffectCommand[] = [{ type: 'add-status', source, targetId: owner.unitId, instance: { instanceId: status?.instanceId ?? `${emptyFaceAuraIds.masks}:${owner.unitId}`,
    statusId: emptyFaceAuraIds.masks, source, stacks: Math.min(amount, 7 - maskCount(owner)), duration: { kind: 'permanent' },
    modifiers: [{ stat: 'defenseIgnore', operation: 'flat', amount: 50, perStack: true }] } }];
  if (maskCount(owner) + amount >= 4 && !has(owner, emptyFaceAuraIds.rebirth)) commands.push({ type: 'add-status', source, targetId: owner.unitId,
    instance: { instanceId: `${emptyFaceAuraIds.rebirth}:${owner.unitId}`, statusId: emptyFaceAuraIds.rebirth,
      source, stacks: 1, duration: { kind: 'permanent' } } });
  return commands;
}
function maskCount(owner: Readonly<UnitState>): number { return owner.statuses.find(status => status.statusId === emptyFaceAuraIds.masks)?.stacks ?? 0; }
function maskIgnore(owner: Readonly<UnitState>): number { return maskCount(owner) * 50; }
function teamInitialAttack(context: Pick<BattleContext, 'state'>, side: string): number {
  return Object.values(context.state.units).filter(unit => unit.side === side && unit.unitKind !== 'summon')
    .reduce((sum, unit) => sum + unit.stats.attack, 0);
}
function rankOfSource(state: Readonly<{ units: Record<string, UnitState> }>, sourceUnitId: string | undefined, skillId: string): number {
  const owner = sourceUnitId ? state.units[sourceUnitId] : undefined;
  return owner ? rankOf(owner, skillId) : 0;
}
function rankOf(owner: Readonly<UnitState>, skillId: string): number {
  const value = owner.skillLevels?.[skillId];
  return Number.isFinite(value) ? Math.max(1, Math.min(6, Math.floor(value!))) : Math.max(1, Math.min(6, owner.skillLevel));
}
function has(unit: Readonly<UnitState>, statusId: string): boolean { return unit.statuses.some(status => status.statusId === statusId); }
function faceSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
function intent(actorId: string, skillId: string, targetIds: readonly string[], shape: ActionIntent['shape'],
  targetRelation: ActionIntent['targetRelation']): ActionIntent { return { actorId, skillId, targetIds, shape, targetRelation }; }
function allUnits(context: BattleContext): readonly UnitState[] {
  return [...context.getLivingUnits('blue'), ...context.getLivingUnits('red')];
}
