import type { DamageInterceptionContext, HeroDefinition, SkillDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, StatusInstance, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { calculateIndirectDamage } from '../mechanics/indirect-damage';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import { createBasicAttackSkill } from './common-skills';
import type { ContentRegistry } from './registry';

export const fengliIds = {
  hero: 349,
  basic: '3491',
  passive: '3492',
  ultimate: '3493',
  haste: 'status.hero.349.pursuit',
  critResist: 'status.hero.349.substitute-crit-resist',
  dodgeWindow: 'status.hero.349.substitute-window',
  fireball: 'status.hero.349.fireball',
  defenseGrowth: 'status.hero.349.defense-ignore-growth',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const ultimateDirectRatios = [1, 1.1, 1.15, 1.25, 1.25] as const;
const ultimateIndirectRatios = [1.75, 1.75, 1.75, 1.75, 3.5] as const;
const dodgeChances = [.1, .2, .3, .4, .4] as const;

export function registerFengli(registry: ContentRegistry): void {
  registry.registerStatus({ id: fengliIds.haste, mechanicsCoverage: 'partial', category: 'buff', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerStatus({ id: fengliIds.critResist, mechanicsCoverage: 'partial', category: 'buff', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'refresh-duration' });
  registry.registerStatus({ id: fengliIds.dodgeWindow, mechanicsCoverage: 'partial', category: 'other', dispellable: false,
    sealable: false, durationOwner: 'event', refreshPolicy: 'replace' });
  registry.registerStatus({ id: fengliIds.fireball, mechanicsCoverage: 'partial', category: 'mark', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerStatus({ id: fengliIds.defenseGrowth, mechanicsCoverage: 'partial', category: 'buff', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace' });
  registry.registerHero(createFengliDefinition());
}

export function createFengliDefinition(): HeroDefinition {
  const basicBase = createBasicAttackSkill(fengliIds.basic, basicRatios);
  const basic: SkillDefinition = { ...basicBase, execute(context, intent, parameters) {
    const actor = context.getUnit(intent.actorId);
    if (!actor || actor.hp <= 0) return [];
    const actorStats = context.getEffectiveStats(actor.unitId) ?? actor.stats;
    const ratio = Number(parameters.ratio ?? 1);
    const source = fengliSource(fengliIds.basic, actor.unitId);
    const commands: EffectCommand[] = intent.targetIds.flatMap(targetId => {
      const target = context.getUnit(targetId);
      if (!target || target.hp <= 0) return [];
      const targetStats = context.getEffectiveStats(target.unitId) ?? target.stats;
      const lowerAttack = targetStats.attack < actorStats.attack;
      const result = context.calculateDamage({ attack: actorStats.attack, defense: targetStats.defense,
        defenseIgnore: effectiveDefenseIgnore(actor) + (lowerAttack ? 300 + defenseIgnoreGrowth(actor) : 0), ratio,
        critChance: Math.max(0, actorStats.crit - (lowerAttack ? 0 : .8)), critDamage: actorStats.critDamage }, actor, target);
      return [{ type: 'deal-damage' as const, source, targetId, amount: result.amount,
        ...(result.damageOptions ? { damageOptions: result.damageOptions } : {}),
        ...(result.isCritical ? { criticalBaseAmount: result.amount / Math.max(1, actorStats.critDamage) } : {}), isCritical: result.isCritical }];
    });
    return [...commands, { type: 'add-status', source, targetId: actor.unitId, instance: {
      instanceId: `${fengliIds.haste}:${actor.unitId}`, statusId: fengliIds.haste, source, stacks: 1,
      duration: { kind: 'count', remaining: 1, owner: 'target-turn' },
      modifiers: [{ stat: 'speed', operation: 'flat', amount: 30 }],
    } }];
  } };
  const ultimate: SkillDefinition = {
    id: fengliIds.ultimate, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'single', targetRelation: 'enemy',
    levels: ultimateDirectRatios.map((ratio, index) => ({ ratio, indirectRatio: ultimateIndirectRatios[index]! })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      const target = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || actor.hp <= 0 || !target || target.hp <= 0) return [];
      const source = fengliSource(fengliIds.ultimate, actor.unitId);
      const attack = context.getEffectiveStats(actor.unitId) ?? actor.stats;
      const targetStats = context.getEffectiveStats(target.unitId) ?? target.stats;
      const lowerAttack = targetStats.attack < attack.attack;
      const direct = context.calculateDamage({ attack: attack.attack, defense: targetStats.defense,
        defenseIgnore: effectiveDefenseIgnore(actor) + (lowerAttack ? 300 + defenseIgnoreGrowth(actor) : 0),
        ratio: Number(parameters.ratio ?? 1), critChance: Math.max(0, attack.crit - (lowerAttack ? 0 : .8)),
        critDamage: attack.critDamage }, actor, target);
      const commands: EffectCommand[] = [{ type: 'deal-damage', source, targetId: target.unitId, amount: direct.amount,
        ...(direct.damageOptions ? { damageOptions: direct.damageOptions } : {}), isCritical: direct.isCritical }];
      const marks = context.state.sides[actor.side === 'blue' ? 'red' : 'blue'].map(id => context.getUnit(id))
        .filter((unit): unit is UnitState => Boolean(unit && unit.statuses.some(status => status.statusId === fengliIds.fireball
          && status.source.unitId === actor.unitId)));
      let defenseBonus = defenseIgnoreGrowth(actor);
      for (const marked of marks) {
        const mark = marked.statuses.find(status => status.statusId === fengliIds.fireball && status.source.unitId === actor.unitId);
        if (!mark) continue;
        const result = calculateFengliIndirect(context, actor, marked, Number(mark.values?.ratio ?? parameters.indirectRatio ?? 1.75), defenseBonus);
        commands.push({ type: 'lose-life', source, targetId: marked.unitId, amount: result.amount, lifeLossKind: 'indirect' },
          { type: 'remove-status-instances', source, targetId: marked.unitId, instanceIds: [mark.instanceId], reason: 'consumed' });
        defenseBonus = Math.min(300, defenseBonus + 50);
      }
      if (marks.length > 0) commands.push(defenseGrowthCommand(actor, defenseBonus, source));
      const applyTargetMark = { type: 'add-status' as const, source, targetId: target.unitId, instance: {
        instanceId: `${fengliIds.fireball}:${actor.unitId}:${target.unitId}`, statusId: fengliIds.fireball,
        source, stacks: 1, duration: { kind: 'count' as const, remaining: 1, owner: 'target-turn' as const },
        values: { ownerUnitId: actor.unitId, ratio: Number(parameters.indirectRatio ?? 1.75) },
      } };
      commands.push(applyTargetMark);
      return commands;
    },
  };
  return {
    id: fengliIds.hero,
    skills: [basic, ultimate],
    aiCoverage: 'partial',
    mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['已按客户端技能行实现：普攻提升30速度1回合；被普攻时未受控则按技能等级概率免疫整次普攻并获得2回合40%至100%暴击抵抗；攻击力较低的目标受到伤害时风狸忽略300防御，攻击力不低于风狸时风狸降低80%暴击；风车·雷火弹消耗3火，直击后引爆风狸所有旧印记，按175%至350%攻击造成间接伤害并给当前目标附加1回合印记，每次爆炸额外增加50点无视防御、最多300。连续帧尚未核对多段普攻的整次闪避窗口、标记快照和多风狸/同一目标重复印记交互。'],
    policy(context, unitId) {
      const actor = context.getUnit(unitId);
      if (!actor || actor.hp <= 0 || actor.unitKind === 'summon') return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (enemies.length === 0) return undefined;
      const target = [...enemies].sort((left, right) => left.hp / Math.max(1, left.stats.hp)
        - right.hp / Math.max(1, right.stats.hp))[0]!;
      const hasOwnedMark = enemies.some(enemy => enemy.statuses.some(status => status.statusId === fengliIds.fireball
        && status.source.unitId === actor.unitId));
      if (hasOwnedMark && (context.state.resources[actor.side]?.fire ?? 0) >= 3) {
        return { actorId: unitId, skillId: fengliIds.ultimate, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
      }
      return { actorId: unitId, skillId: fengliIds.basic, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
    },
    interceptIncomingDamage(state, attacker, target, amount, _kind, interception) {
      return dodgeBasicDamage(state, attacker, target, amount, interception);
    },
    handlers: {
      'turn-end': { priority: 50, handle(context, event) { return tickFireballs(context, event); } },
    },
  };
}

function dodgeBasicDamage(state: import('../core/types').BattleState, attacker: Readonly<UnitState> | undefined,
  target: Readonly<UnitState>, amount: number, context?: DamageInterceptionContext) {
  if (!context || context.actionKind !== 'basic' || !attacker || attacker.side === target.side || amount <= 0
    || target.heroId !== fengliIds.hero || target.hp <= 0 || context.isUnitUnableToAct(target.unitId) || !passivesEnabled(target)) return undefined;
  const source = fengliSource(fengliIds.passive, target.unitId);
  const previous = target.statuses.find(status => status.statusId === fengliIds.dodgeWindow);
  let avoided: boolean;
  if (Number(previous?.values?.attackId ?? -1) === context.attackId) avoided = Boolean(previous?.values?.avoided);
  else avoided = context.battle.random() < dodgeChances[Math.max(0, Math.min(4, skillLevel(target, fengliIds.passive) - 1))]!;
  const marker: StatusInstance = { instanceId: `${fengliIds.dodgeWindow}:${target.unitId}`, statusId: fengliIds.dodgeWindow,
    source, stacks: 1, duration: { kind: 'permanent' }, values: { attackId: context.attackId, avoided } };
  const effects: EffectCommand[] = [{ type: 'add-status', source, targetId: target.unitId, instance: marker }];
  if (avoided && Number(previous?.values?.attackId ?? -1) !== context.attackId) effects.push({ type: 'add-status', source,
    targetId: target.unitId, instance: { instanceId: `${fengliIds.critResist}:${target.unitId}`, statusId: fengliIds.critResist,
      source, stacks: 1, duration: { kind: 'count', remaining: 2, owner: 'target-turn' },
      modifiers: [{ stat: 'critResist', operation: 'flat', amount: skillLevel(target, fengliIds.passive) >= 5 ? 1 : .4 }] } });
  return { amount: avoided ? 0 : amount, effects };
}

function tickFireballs(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-ended') return;
  const target = context.getUnit(event.unitId);
  if (!target || target.hp <= 0) return;
  const commands: EffectCommand[] = [];
  for (const mark of target.statuses.filter(status => status.statusId === fengliIds.fireball)) {
    const owner = mark.source.unitId ? context.getUnit(mark.source.unitId) : undefined;
    if (!owner || owner.heroId !== fengliIds.hero || owner.hp <= 0) continue;
    const oldBonus = defenseIgnoreGrowth(owner);
    const result = calculateFengliIndirect(context, owner, target, Number(mark.values?.ratio ?? 1.75), oldBonus);
    commands.push({ type: 'lose-life', source: fengliSource(fengliIds.ultimate, owner.unitId), targetId: target.unitId,
      amount: result.amount, lifeLossKind: 'indirect', parentEventId: event.eventId },
    { type: 'remove-status-instances', source: fengliSource(fengliIds.ultimate, owner.unitId), targetId: target.unitId,
      instanceIds: [mark.instanceId], reason: 'consumed', parentEventId: event.eventId },
    defenseGrowthCommand(owner, oldBonus + 50, fengliSource(fengliIds.ultimate, owner.unitId)));
  }
  return commands.length ? commands : undefined;
}

function calculateFengliIndirect(context: BattleContext, owner: Readonly<UnitState>, target: Readonly<UnitState>, ratio: number,
  growth: number) {
  const attack = context.getEffectiveStats(owner.unitId) ?? owner.stats;
  const defense = context.getEffectiveStats(target.unitId) ?? target.stats;
  const lowerAttack = defense.attack < attack.attack;
  return calculateIndirectDamage({ attack: attack.attack, defense: defense.defense,
    defenseIgnore: effectiveDefenseIgnore(owner) + (lowerAttack ? 300 + growth : 0), ratio,
    critDamage: attack.critDamage }, context.random);
}

function defenseIgnoreGrowth(owner: Readonly<UnitState>): number {
  return Math.max(0, Math.min(300, Number(owner.statuses.find(status => status.statusId === fengliIds.defenseGrowth)?.values?.bonus ?? 0)));
}

function defenseGrowthCommand(owner: Readonly<UnitState>, bonus: number, source: SourceRef): EffectCommand {
  return { type: 'add-status', source, targetId: owner.unitId, instance: { instanceId: `${fengliIds.defenseGrowth}:${owner.unitId}`,
    statusId: fengliIds.defenseGrowth, source, stacks: 1, duration: { kind: 'permanent' }, values: { bonus: Math.max(0, Math.min(300, bonus)) } } };
}

function fengliSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
function skillLevel(unit: Readonly<UnitState>, skillId: string): number {
  return Math.max(1, Math.min(5, unit.skillLevels?.[skillId] ?? unit.skillLevel));
}
