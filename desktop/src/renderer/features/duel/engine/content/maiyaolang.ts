import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, BattleState, EffectCommand, SourceRef, StatusInstance, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import { createBasicAttackSkill } from './common-skills';
import type { ContentRegistry } from './registry';

export const maiyaolangIds = {
  hero: 305,
  basic: '3051',
  passive: '3052',
  ultimate: '3053',
  scale: 'status.hero.305.scale',
  truth: 'status.hero.305.truth',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const ultimateRatios = [2.63, 2.7615, 2.893, 3.0245, 3.2875] as const;
const maxScales = 3;
const bonusPerScale = .33;
const truthDuration = 2;

export function registerMaiyaolang(registry: ContentRegistry): void {
  registry.registerStatus({ id: maiyaolangIds.scale, mechanicsCoverage: 'partial', category: 'mark',
    dispellable: false, sealable: false, durationOwner: 'permanent', refreshPolicy: 'add-stack', maxStacks: maxScales,
    stackScope: 'source-unit' });
  registry.registerStatus({ id: maiyaolangIds.truth, mechanicsCoverage: 'partial', category: 'debuff',
    dispellable: true, sealable: true, durationOwner: 'target-turn', refreshPolicy: 'refresh-duration' });
  registry.registerHero(createMaiyaolangDefinition());
}

export function createMaiyaolangDefinition(): HeroDefinition {
  const basic = createBasicAttackSkill(maiyaolangIds.basic, basicRatios);
  const ultimate: SkillDefinition = {
    id: maiyaolangIds.ultimate, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'single', targetRelation: 'enemy', useClientDamageData: true,
    levels: ultimateRatios.map(ratio => ({ ratio, truthRatio: .03, truthAttackCap: 6 })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      const target = intent.targetIds.map(id => context.getUnit(id)).find((unit): unit is UnitState => Boolean(unit && unit.hp > 0));
      if (!actor || actor.hp <= 0 || !target) return [];
      const attack = context.getEffectiveStats(actor.unitId) ?? actor.stats;
      const source = maiyaolangSource(maiyaolangIds.ultimate, actor.unitId);
      const commands: EffectCommand[] = [];
      const truth = target.statuses.some(status => status.statusId === maiyaolangIds.truth);
      if (truth) {
        // tips_6 is the shield effect: preserve normal damage mitigation, but bypass shields and sharing.
        commands.push({ type: 'deal-damage', source, targetId: target.unitId,
          amount: Math.min(target.hp * Number(parameters.truthRatio ?? .03), attack.attack * Number(parameters.truthAttackCap ?? 6)),
          damageKind: 'normal', ignoreShield: true, suppressTargetSoulTriggers: true, suppressTargetPassiveTriggers: true,
          cannotBeShared: true });
      } else {
        const defense = context.getEffectiveStats(target.unitId)?.defense ?? target.stats.defense;
        const result = context.calculateDamage({ attack: attack.attack, defense, defenseIgnore: effectiveDefenseIgnore(actor),
          ratio: Number(parameters.ratio ?? ultimateRatios[0]), critChance: attack.crit, critDamage: attack.critDamage }, actor, target);
        commands.push({ type: 'deal-damage', source, targetId: target.unitId, amount: result.amount,
          ...(result.damageOptions ? { damageOptions: result.damageOptions } : {}),
          ...(result.isCritical ? { criticalBaseAmount: result.amount / Math.max(1, attack.critDamage) } : {}),
          isCritical: result.isCritical });
      }
      commands.push(...addScale(context, actor, target, source));
      return commands;
    },
  };

  return {
    id: maiyaolangIds.hero,
    skills: [basic, ultimate],
    aiCoverage: 'partial',
    aiCoverageNotes: ['鬼火不少于3时优先使用退魔，并优先选择已有真理状态目标；其他情况普攻。客户端选招策略未提取完整，仍需帧核。'],
    mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['已接入释物之形普攻倍率、退魔3火技能倍率与真理状态下3%当前生命伤害（上限攻击600%、无视护盾）、唯一被动、天平最多3层/每层33%增伤、敌方回合结束40%/觉醒50%挂标，以及1/2/3层对应30%/40%/60%生命线转化2回合真理。客户端技能行没有显式行动条改动；真理伤害会跳过椒图生命链接分摊且不触发目标御魂/被动；目标帧样本未确认卖药郎，天平与真理的驱散类别及客户端帧核仍未验证。'],
    handlers: {
      'turn-end': { priority: 45, handle(context, event) { return addScaleAtEnemyTurnEnd(context, event); } },
      hit: { priority: 45, handle(context, event) { return convertScaleAtHealthThreshold(context, event); } },
    },
    modifyOutgoingDamage(attacker, target, amount, _kind, state) {
      if (attacker.heroId !== maiyaolangIds.hero || attacker.unitKind === 'summon' || !passivesEnabled(attacker)
        || !isUniquePassiveOwner(state, attacker.unitId)) return amount;
      const scales = target.statuses.filter(status => status.statusId === maiyaolangIds.scale
        && status.source.unitId === attacker.unitId).reduce((sum, status) => sum + status.stacks, 0);
      return amount * (1 + scales * bonusPerScale);
    },
    policy(context, actorId) {
      const actor = context.getUnit(actorId);
      if (!actor || actor.hp <= 0 || actor.unitKind === 'summon') return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      const target = [...enemies].sort((a, b) => Number(b.statuses.some(status => status.statusId === maiyaolangIds.truth))
        - Number(a.statuses.some(status => status.statusId === maiyaolangIds.truth))
        || a.hp / Math.max(1, a.stats.hp) - b.hp / Math.max(1, b.stats.hp))[0]!;
      const fire = context.state.resources[actor.side]?.fire ?? actor.resources.fire ?? 0;
      const skillId = fire >= 3 ? maiyaolangIds.ultimate : maiyaolangIds.basic;
      return { actorId, skillId, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
    },
  };
}

function addScaleAtEnemyTurnEnd(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-ended') return;
  const target = context.getUnit(event.unitId);
  if (!target || target.hp <= 0) return;
  const owners = context.getLivingUnits(target.side === 'blue' ? 'red' : 'blue')
    .filter(unit => unit.heroId === maiyaolangIds.hero && unit.unitKind !== 'summon' && passivesEnabled(unit));
  const uniqueOwner = owners[0];
  if (!uniqueOwner) return;
  return [uniqueOwner].flatMap(owner => {
    const chance = owner.awakeFilter === 0 ? .4 : .5;
    if (context.random() >= chance) return [];
    const source = maiyaolangSource(maiyaolangIds.passive, owner.unitId);
    return addScale(context, owner, target, source, event.eventId);
  });
}

function addScale(context: BattleContext, owner: Readonly<UnitState>, target: Readonly<UnitState>, source: SourceRef,
  parentEventId?: string): EffectCommand[] {
  if (target.statuses.some(status => status.statusId === maiyaolangIds.truth && status.source.unitId === owner.unitId)) return [];
  const current = target.statuses.filter(status => status.statusId === maiyaolangIds.scale && status.source.unitId === owner.unitId)
    .reduce((sum, status) => sum + status.stacks, 0);
  if (current >= maxScales) return [];
  const instance: StatusInstance = { instanceId: `${maiyaolangIds.scale}:${owner.unitId}:${target.unitId}`,
    statusId: maiyaolangIds.scale, source, stacks: 1, duration: { kind: 'permanent' } };
  const commands: EffectCommand[] = [{ type: 'add-status', source, targetId: target.unitId, instance,
    ...(parentEventId ? { parentEventId } : {}) }];
  const nextStacks = current + 1;
  const threshold = nextStacks === 1 ? .3 : nextStacks === 2 ? .4 : .6;
  if (target.hp / Math.max(1, target.stats.hp) < threshold) commands.push(...truthConversion(owner, target, source, parentEventId));
  return commands;
}

function convertScaleAtHealthThreshold(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage' || event.hpLost <= 0) return;
  const target = context.getUnit(event.targetId);
  if (!target || target.hp <= 0) return;
  const marks = target.statuses.filter(status => status.statusId === maiyaolangIds.scale);
  const owners = new Set(marks.map(mark => mark.source.unitId).filter((id): id is string => Boolean(id)));
  const commands: EffectCommand[] = [];
  for (const ownerId of owners) {
    const owner = context.getUnit(ownerId);
    if (!owner || !passivesEnabled(owner)) continue;
    const stacks = marks.filter(mark => mark.source.unitId === ownerId).reduce((sum, mark) => sum + mark.stacks, 0);
    const threshold = stacks === 1 ? .3 : stacks === 2 ? .4 : .6;
    if (target.hp / Math.max(1, target.stats.hp) < threshold) commands.push(...truthConversion(owner, target,
      maiyaolangSource(maiyaolangIds.passive, owner.unitId), event.eventId));
  }
  return commands.length ? commands : undefined;
}

function truthConversion(owner: Readonly<UnitState>, target: Readonly<UnitState>, source: SourceRef,
  parentEventId?: string): EffectCommand[] {
  const scaleIds = target.statuses.filter(status => status.statusId === maiyaolangIds.scale && status.source.unitId === owner.unitId)
    .map(status => status.instanceId);
  if (!scaleIds.length || target.statuses.some(status => status.statusId === maiyaolangIds.truth && status.source.unitId === owner.unitId)) return [];
  return [
    { type: 'remove-status-instances', source, targetId: target.unitId, instanceIds: scaleIds, reason: 'consumed',
      ...(parentEventId ? { parentEventId } : {}) },
    { type: 'add-status', source, targetId: target.unitId, instance: { instanceId: `${maiyaolangIds.truth}:${owner.unitId}:${target.unitId}`,
      statusId: maiyaolangIds.truth, source, stacks: 1, duration: { kind: 'count', remaining: truthDuration, owner: 'target-turn' } },
      ...(parentEventId ? { parentEventId } : {}) },
  ];
}

function maiyaolangSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }

function isUniquePassiveOwner(state: Readonly<BattleState>, unitId: string): boolean {
  const owner = state.units[unitId];
  if (!owner) return false;
  const first = state.sides[owner.side].map(id => state.units[id]).find(unit => unit?.heroId === maiyaolangIds.hero
    && unit.unitKind !== 'summon' && unit.hp > 0 && passivesEnabled(unit));
  return first?.unitId === unitId;
}
