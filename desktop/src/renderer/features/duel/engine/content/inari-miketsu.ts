import type { HeroDefinition, SkillDefinition, StatusDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, UnitState } from '../core/types';
import { passiveSuppressionStatusId } from '../core/passive-eligibility';
import { soulSuppressionStatusId } from '../core/soul-eligibility';
import { attemptControl } from '../mechanics/control';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import { ContentRegistry } from './registry';

export const inariMiketsuIds = { hero: 326, basic: '3261', solar: '3262', lunar: '3263',
  silence: 'status.hero.326.silence', bindFoot: 'status.hero.326.bind-foot', solarField: 'status.hero.326.solar-field',
  solarBuff: 'status.hero.326.solar-buff', lunarField: 'status.hero.326.lunar-field', lunarBuff: 'status.hero.326.lunar-buff' } as const;

const basicRatios = [.8, .85, .9, .95, .95] as const;
const foxControlChances = [.5, .5, .5, .5, 1] as const;
const lunarAttackDefense = [.2, .25, .25, .3, .3] as const;
const solarGauge = [20, 20, 20, 20, 25] as const;
const solarDispelChance = [0, .4, .6, 1, 1] as const;

export function registerInariMiketsu(registry: ContentRegistry): void {
  const statuses: StatusDefinition[] = [
    { id: inariMiketsuIds.silence, mechanicsCoverage: 'partial', category: 'control', dispellable: true,
      sealable: true, durationOwner: 'target-turn', refreshPolicy: 'refresh-duration', preventsSkill: true },
    { id: inariMiketsuIds.bindFoot, mechanicsCoverage: 'partial', category: 'control', dispellable: true,
      sealable: true, durationOwner: 'target-turn', refreshPolicy: 'refresh-duration', preventsActionGaugeIncrease: true },
    { id: inariMiketsuIds.solarField, mechanicsCoverage: 'partial', category: 'other', dispellable: false,
      sealable: false, durationOwner: 'source-turn', refreshPolicy: 'replace' },
    { id: inariMiketsuIds.solarBuff, mechanicsCoverage: 'partial', category: 'buff', dispellable: true,
      sealable: true, durationOwner: 'source-turn', refreshPolicy: 'replace' },
    { id: inariMiketsuIds.lunarField, mechanicsCoverage: 'partial', category: 'other', dispellable: false,
      sealable: false, durationOwner: 'source-turn', refreshPolicy: 'replace' },
    { id: inariMiketsuIds.lunarBuff, mechanicsCoverage: 'partial', category: 'buff', dispellable: true,
      sealable: true, durationOwner: 'source-turn', refreshPolicy: 'replace' },
  ];
  statuses.forEach(status => registry.registerStatus(status));

  const basic: SkillDefinition = { id: inariMiketsuIds.basic, actionKind: 'basic', target: 'single', targetRelation: 'enemy',
    levels: basicRatios.map((ratio, index) => ({ ratio, controlChance: foxControlChances[index]!, controlTurns: 1 })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId), target = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || !target || !validEnemy(actor, target)) return [];
      return foxBell(context, actor, target, inariMiketsuIds.basic,
        Number(parameters.ratio ?? basicRatios[rank(actor, basic.id) - 1]!),
        Number(parameters.controlChance ?? foxControlChances[rank(actor, basic.id) - 1]!),
        Number(parameters.controlTurns ?? 1));
    } };

  const solar: SkillDefinition = { id: inariMiketsuIds.solar, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'all-allies', targetRelation: 'ally', levels: solarGauge.map((gauge, index) => ({ gauge,
      dispelChance: solarDispelChance[index]! })),
    execute(context, intent) { const actor = context.getUnit(intent.actorId); return actor ? activateField(context, actor, 'solar') : []; } };

  const lunar: SkillDefinition = { id: inariMiketsuIds.lunar, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'all-allies', targetRelation: 'ally', levels: lunarAttackDefense.map((ratio, index) => ({ ratio,
      selfSpeed: index >= 2 ? 30 : 0, selfResist: index >= 2 ? .3 : 0 })),
    execute(context, intent) { const actor = context.getUnit(intent.actorId); return actor ? activateField(context, actor, 'lunar') : []; } };

  const definition: HeroDefinition = { id: inariMiketsuIds.hero, skills: [basic, solar, lunar], mechanicsCoverage: 'partial', aiCoverage: 'partial',
    mechanicsCoverageNotes: ['狐铃80%/85%/90%/95%/95%伤害，等级1至4有50%基础概率、五级100%基础概率，随机附加沉默、被动封印、御魂封印或缚足并按效果命中/抵抗判定；日曜界耗3火，友方+20速度/+20%抵抗，友方回合末把最前端的另一友方推进20点行动条（五级25点），二级起按40%/60%/100%概率驱散其1个减益/控制；月影界耗3火，友方+20%至30%攻击/防御，三级起自身另+30速度/+30%抵抗，敌方回合末以不触发攻击方御魂/被动的狐铃追击并延长控制。五级先机施放月影界。被动/御魂封印字段复用引擎通用状态。唯一效果、多稻荷神、随机狐狸表现和帧触发尚待核验；10点场阵容不含该式神。'],
    initialize(context, unitId) {
      const actor = context.getUnit(unitId);
      return actor?.heroId === inariMiketsuIds.hero && rank(actor, lunar.id) === 5 ? activateField(context, actor, 'lunar') : [];
    },
    handlers: { 'turn-end': { priority: 73, handle(context, event) { return resolveFields(context, event); } } },
    policy(context, unitId) {
      const actor = context.getUnit(unitId); if (!actor || actor.heroId !== inariMiketsuIds.hero || actor.hp <= 0 || actor.unitKind === 'summon') return;
      const allies = context.getLivingUnits(actor.side), enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return;
      const fire = context.state.resources[actor.side]?.fire ?? 0;
      if (fire >= 3) {
        const lunarActive = actor.statuses.some(status => status.statusId === inariMiketsuIds.lunarField);
        const skillId = lunarActive ? solar.id : lunar.id;
        return { actorId: unitId, skillId, targetIds: allies.map(ally => ally.unitId), shape: 'all-allies', targetRelation: 'ally' };
      }
      const target = [...enemies].sort((left, right) => left.hp / Math.max(1, left.stats.hp) - right.hp / Math.max(1, right.stats.hp))[0]!;
      return { actorId: unitId, skillId: basic.id, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
    },
  };
  registry.registerHero(definition);
}

function activateField(context: BattleContext, actor: Readonly<UnitState>, field: 'solar' | 'lunar'): EffectCommand[] {
  const isSolar = field === 'solar';
  const skillId = isSolar ? inariMiketsuIds.solar : inariMiketsuIds.lunar;
  const fieldId = isSolar ? inariMiketsuIds.solarField : inariMiketsuIds.lunarField;
  const buffId = isSolar ? inariMiketsuIds.solarBuff : inariMiketsuIds.lunarBuff;
  const level = rank(actor, skillId), source = inariSource(skillId, actor.unitId);
  const amount = isSolar ? 0 : lunarAttackDefense[level - 1]!;
  const allies = context.getLivingUnits(actor.side);
  const commands: EffectCommand[] = allies.map(ally => ({ type: 'remove-statuses' as const, source, targetId: ally.unitId,
    statusIds: [inariMiketsuIds.solarField, inariMiketsuIds.solarBuff, inariMiketsuIds.lunarField, inariMiketsuIds.lunarBuff],
    reason: 'replaced' as const }));
  const duration = { kind: 'count' as const, remaining: 1, owner: 'source-turn' as const };
  commands.push({ type: 'add-status', source, targetId: actor.unitId, instance: {
    instanceId: `${fieldId}:${actor.unitId}`, statusId: fieldId, source, stacks: 1,
    duration, values: { ownerUnitId: actor.unitId } } });
  for (const ally of allies) {
    const modifiers = isSolar
      ? [{ stat: 'speed' as const, operation: 'flat' as const, amount: 20 }, { stat: 'resist' as const, operation: 'flat' as const, amount: .2 }]
      : [{ stat: 'attack' as const, operation: 'percent' as const, amount }, { stat: 'defense' as const, operation: 'percent' as const, amount },
        ...(ally.unitId === actor.unitId && level >= 3 ? [{ stat: 'speed' as const, operation: 'flat' as const, amount: 30 },
          { stat: 'resist' as const, operation: 'flat' as const, amount: .3 }] : [])];
    commands.push({ type: 'add-status', source, targetId: ally.unitId, instance: {
      instanceId: `${buffId}:${actor.unitId}:${ally.unitId}`, statusId: buffId, source, stacks: 1,
      duration,
      values: { ownerUnitId: actor.unitId }, modifiers } });
  }
  return commands;
}

function resolveFields(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-ended') return;
  const ended = context.getUnit(event.unitId); if (!ended) return;
  const commands: EffectCommand[] = [];
  const allLiving = [...context.getLivingUnits('blue'), ...context.getLivingUnits('red')];
  for (const owner of allLiving) {
    const solar = owner.side === ended.side && owner.heroId === inariMiketsuIds.hero
      ? owner.statuses.find(status => status.statusId === inariMiketsuIds.solarField) : undefined;
    if (solar) {
      const next = context.getLivingUnits(owner.side).filter(ally => ally.unitId !== ended.unitId)
        .sort((left, right) => right.actionGauge - left.actionGauge)[0];
      if (next) {
        const source = inariSource(inariMiketsuIds.solar, owner.unitId);
        commands.push({ type: 'change-action-gauge', source, targetId: next.unitId,
          amount: solarGauge[rank(owner, inariMiketsuIds.solar) - 1]!, parentEventId: event.eventId });
        const chance = solarDispelChance[rank(owner, inariMiketsuIds.solar) - 1]!;
        if (chance > 0 && context.random() < chance) commands.push({ type: 'dispel-statuses', source, targetId: next.unitId,
          maxCount: 1, filter: 'debuff-or-control', parentEventId: event.eventId });
      }
    }
    const lunar = owner.heroId === inariMiketsuIds.hero && owner.side !== ended.side
      ? owner.statuses.some(status => status.statusId === inariMiketsuIds.lunarField) : false;
    if (lunar && ended.hp > 0) commands.push(...foxBell(context, owner, ended, inariMiketsuIds.basic, basicRatios[rank(owner, inariMiketsuIds.basic) - 1]!,
      foxControlChances[rank(owner, inariMiketsuIds.basic) - 1]!, 2, event.eventId, true));
  }
  return commands.length ? commands : undefined;
}

function foxBell(context: BattleContext, actor: Readonly<UnitState>, target: Readonly<UnitState>, skillId: string, ratio: number,
  chance: number, turns: number, parentEventId?: string, noReactiveTriggers = false): EffectCommand[] {
  const offense = context.getEffectiveStats(actor.unitId) ?? actor.stats;
  const defense = context.getEffectiveStats(target.unitId) ?? target.stats;
  const hit = context.calculateDamage({ attack: offense.attack, defense: defense.defense, defenseIgnore: effectiveDefenseIgnore(actor),
    ratio, dmgFluctuation: .01, critChance: offense.crit, critDamage: offense.critDamage }, actor as UnitState, target as UnitState);
  const source = inariSource(skillId, actor.unitId);
  const damage: EffectCommand = { type: 'deal-damage', source, targetId: target.unitId, amount: hit.amount,
    ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}), isCritical: hit.isCritical,
    ...(noReactiveTriggers ? { suppressSoulTriggers: true, suppressTargetSoulTriggers: true,
      suppressTargetPassiveTriggers: true } : {}), ...(parentEventId ? { parentEventId } : {}) };
  const controlKinds = [inariMiketsuIds.silence, passiveSuppressionStatusId, soulSuppressionStatusId, inariMiketsuIds.bindFoot] as const;
  const controlTypes = ['沉默', '封印', '压制', '缚足'] as const;
  const index = Math.min(controlKinds.length - 1, Math.floor(context.random() * controlKinds.length));
  const control = attemptControl(context, { attemptId: `${skillId}:${actor.unitId}:${target.unitId}:${context.state.counters.action}:${context.state.counters.hit}`,
    source, targetId: target.unitId, statusId: controlKinds[index]!, controlType: controlTypes[index]!, baseChance: chance,
    duration: { kind: 'count', remaining: turns, owner: 'target-turn' }, ...(parentEventId ? { parentEventId } : {}) });
  return [damage, ...(control ? [control] : [])];
}

function validEnemy(actor: Readonly<UnitState>, target: Readonly<UnitState>): boolean {
  return actor.heroId === inariMiketsuIds.hero && actor.hp > 0 && target.hp > 0 && target.side !== actor.side;
}
function rank(unit: Readonly<UnitState>, skillId: string): number { return Math.max(1, Math.min(5, unit.skillLevels?.[skillId] ?? unit.skillLevel)); }
function inariSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
