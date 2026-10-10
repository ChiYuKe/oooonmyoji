import type { HeroDefinition, SkillDefinition, StatusDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, StatusInstance, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { createBasicAttackSkill } from './common-skills';
import type { ContentRegistry } from './registry';

export const fujiMountainIds = {
  hero: 379, basic: '3791', cloudStrike: '37911', mountainStrike: '37912', twinStrike: '37913',
  passive: '3792', fieldSkill: '3793', field: 'status.hero.379.field', cloudMark: 'status.hero.379.cloud-mark',
  mountainMark: 'status.hero.379.mountain-mark', cloudClothing: 'status.hero.379.cloud-clothing',
  mountainColor: 'status.hero.379.mountain-color', noncritBuff: 'status.hero.379.noncrit-buff',
  fieldAttack: 'status.hero.379.field-attack', resistance: 'status.hero.379.resistance', critSuppression: 'status.hero.379.crit-suppression',
  allyMemory: 'status.hero.379.ally-memory',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const makeSource = (skillId: string, unitId: string): SourceRef => ({ kind: 'skill', id: skillId, unitId });
const opposing = (side: 'blue' | 'red'): 'blue' | 'red' => side === 'blue' ? 'red' : 'blue';
const isFuji = (unit: Readonly<UnitState> | undefined): unit is Readonly<UnitState> => unit?.heroId === fujiMountainIds.hero;
const skillRank = (unit: Readonly<UnitState>, id: string): number => Math.max(1, Math.min(6,
  unit.skillLevels?.[id] ?? unit.skillLevel ?? 1));

export function registerFujiMountain(registry: ContentRegistry): void {
  const ids = fujiMountainIds;
  const status = (id: string, category: StatusDefinition['category'], dispellable: boolean,
    durationOwner: StatusDefinition['durationOwner'] = 'target-turn', maxStacks?: number): StatusDefinition => ({
    id, mechanicsCoverage: 'partial', category, dispellable, sealable: false,
    durationOwner, refreshPolicy: maxStacks ? 'add-stack' : 'replace',
    ...(maxStacks ? { maxStacks, stackScope: 'source-unit' as const } : {}),
  });
  registry.registerStatus(status(ids.field, 'other', false, 'source-turn'));
  registry.registerStatus(status(ids.fieldAttack, 'buff', false, 'source-turn'));
  registry.registerStatus(status(ids.cloudMark, 'mark', false, 'permanent', 5));
  registry.registerStatus(status(ids.mountainMark, 'mark', false, 'permanent', 5));
  registry.registerStatus(status(ids.cloudClothing, 'buff', true));
  registry.registerStatus(status(ids.mountainColor, 'shield', true));
  registry.registerStatus(status(ids.noncritBuff, 'buff', false));
  registry.registerStatus(status(ids.resistance, 'buff', true));
  registry.registerStatus(status(ids.critSuppression, 'debuff', true));
  registry.registerStatus(status(ids.allyMemory, 'other', false, 'permanent'));

  const basic = createBasicAttackSkill(ids.basic, basicRatios);
  const forms = [ids.cloudStrike, ids.mountainStrike, ids.twinStrike].map((skillId, index): SkillDefinition => ({
    id: skillId, actionKind: 'basic', target: 'single', targetRelation: 'enemy', levels: basicRatios.map(ratio => ({ ratio })),
    canUse(_state, actor) {
      if (!isFuji(actor) || !passivesEnabled(actor)) return false;
      const cloud = markCount(actor, ids.cloudMark), mountain = markCount(actor, ids.mountainMark);
      return index === 0 ? cloud > 0 && mountain === 0 : index === 1 ? mountain > 0 && cloud === 0 : cloud > 0 && mountain > 0;
    },
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId), target = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || !target || !isFuji(actor) || actor.hp <= 0 || target.hp <= 0 || target.side === actor.side) return [];
      const attack = context.getEffectiveStats(actor.unitId) ?? actor.stats;
      const defense = context.getEffectiveStats(target.unitId)?.defense ?? target.stats.defense;
      const hit = context.calculateDamage({ attack: attack.attack, defense, ratio: Number(parameters?.ratio ?? 1),
        critChance: attack.crit, critDamage: attack.critDamage }, actor, target);
      const source = makeSource(skillId, actor.unitId);
      const commands: EffectCommand[] = [{ type: 'deal-damage', source, targetId: target.unitId,
        amount: hit.amount, ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}), isCritical: hit.isCritical }];
      if (passivesEnabled(actor)) {
        const consumeCloud = index !== 1 ? markCount(actor, ids.cloudMark) : 0;
        const consumeMountain = index !== 0 ? markCount(actor, ids.mountainMark) : 0;
        if (consumeCloud > 0) {
          const mark = ownMark(actor, ids.cloudMark);
          if (mark) commands.push({ type: 'change-status-stacks', source, targetId: actor.unitId,
            instanceId: mark.instanceId, amount: -consumeCloud });
          for (const ally of context.getLivingUnits(actor.side)) {
            const current = ally.statuses.find(item => item.statusId === ids.noncritBuff && item.source.unitId === actor.unitId);
            const nextRate = Math.min(.15, Number(current?.modifiers?.[0]?.amount ?? 0) + .03 * consumeCloud);
            commands.push({ type: 'add-status', source, targetId: ally.unitId, instance: {
              instanceId: `${ids.noncritBuff}:${actor.unitId}:${ally.unitId}`, statusId: ids.noncritBuff, source,
              stacks: 1, duration: { kind: 'count', remaining: skillRank(actor, ids.passive) >= 5 ? 2 : 1, owner: 'target-turn' },
              modifiers: [{ stat: 'damage', operation: 'percent', amount: nextRate }], values: { rate: nextRate },
            } });
          }
        }
        if (consumeMountain > 0) {
          const mark = ownMark(actor, ids.mountainMark);
          if (mark) commands.push({ type: 'change-status-stacks', source, targetId: actor.unitId,
            instanceId: mark.instanceId, amount: -consumeMountain });
          for (const ally of context.getLivingUnits(actor.side)) commands.push({ type: 'heal', source,
            targetId: ally.unitId, amount: actor.stats.defense * consumeMountain });
          if (skillRank(actor, ids.passive) >= 3) {
            for (let count = 0; count < consumeMountain; count++) {
              const candidates = context.getLivingUnits(actor.side).filter(ally => ally.statuses.some(item =>
                context.isStatusDispellable(item.statusId) && ['debuff', 'control'].includes(context.getStatusCategory(item.statusId) ?? '')));
              const controls = candidates.filter(ally => ally.statuses.some(item => context.isStatusDispellable(item.statusId)
                && context.getStatusCategory(item.statusId) === 'control'));
              const pool = controls.length ? controls : candidates;
              if (pool.length) {
                const chosen = pool[Math.min(pool.length - 1, Math.floor(context.random() * pool.length))]!;
                commands.push({ type: 'dispel-statuses', source, targetId: chosen.unitId, maxCount: 1,
                  filter: 'debuff-or-control', preferCategories: ['control'] });
              }
            }
          }
        }
      }
      if (skillRank(actor, ids.basic) >= 5) commands.push(resistanceCommand(actor, source));
      return commands;
    },
  }));

  const field: SkillDefinition = {
    id: ids.fieldSkill, actionKind: 'skill', target: 'all-allies', targetRelation: 'ally',
    resourceCost: { resourceId: 'fire', amount: 3 }, levels: [{}, {}, {}, {}, {}],
    execute(context, intent) {
      const owner = context.getUnit(intent.actorId);
      if (!owner || !isFuji(owner) || owner.hp <= 0 || uniqueFuji(context, owner.side)?.unitId !== owner.unitId) return [];
      return openField(context, owner);
    },
  };
  const definition: HeroDefinition = {
    id: ids.hero, skills: [basic, ...forms, field], aiCoverage: 'partial', mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['按本地3791–3793技能/状态行接入重峦100%至125%及五级抵抗、山行结界3火和三回合持续、两类友方结界增益与云/山印记、印记上限5及普攻消耗后的群体非暴击增伤/治疗/优先驱散控制、技能2级随机得印、技能4级先机双印、技能5级先机开结界和增伤延长。按行动声明记录同技能回合并于回合末发放山色；反击/额外行动的计入范围、行动间隔状态窗口、暴击机制细节和各状态精确驱散/封印交互仍需连续帧核验。'],
    aiCoverageNotes: ['本地社区AI条目：无山行结界时施放3技能；1技能优先选择生命比例低于20%的单位。结界存在后的单体目标次序和平局处理未明确，当前依云/山印记使用相应普攻变体并优先低生命敌方。'],
    initialize(context, unitId) {
      const owner = context.getUnit(unitId);
      if (!owner || !isFuji(owner) || uniqueFuji(context, owner.side)?.unitId !== owner.unitId) return [];
      const commands: EffectCommand[] = [];
      if (passivesEnabled(owner) && skillRank(owner, ids.passive) >= 4) {
        commands.push(...addMark(owner, ids.cloudMark), ...addMark(owner, ids.mountainMark));
      }
      if (skillRank(owner, ids.fieldSkill) >= 5) commands.push(...openField(context, owner));
      return commands;
    },
    policy(context, unitId): ActionIntent | undefined {
      const actor = context.getUnit(unitId);
      if (!actor || actor.hp <= 0 || !isFuji(actor)) return undefined;
      const enemies = context.getLivingUnits(opposing(actor.side));
      if (!enemies.length) return undefined;
      const fieldIsActive = actor.statuses.some(item => item.statusId === ids.field);
      if (!fieldIsActive && (context.state.resources[actor.side]?.fire ?? actor.resources.fire ?? 0) >= 3)
        return { actorId: unitId, skillId: ids.fieldSkill, targetIds: context.getLivingUnits(actor.side).map(unit => unit.unitId),
          shape: 'all-allies', targetRelation: 'ally' };
      const cloud = passivesEnabled(actor) ? markCount(actor, ids.cloudMark) : 0;
      const mountain = passivesEnabled(actor) ? markCount(actor, ids.mountainMark) : 0;
      const skillId = cloud > 0 && mountain > 0 ? ids.twinStrike : cloud > 0 ? ids.cloudStrike : mountain > 0 ? ids.mountainStrike : ids.basic;
      const target = enemies.slice().sort((left, right) => {
        const leftCritical = left.hp / Math.max(1, left.stats.hp) < .2 ? 0 : 1;
        const rightCritical = right.hp / Math.max(1, right.stats.hp) < .2 ? 0 : 1;
        return leftCritical - rightCritical || left.hp / Math.max(1, left.stats.hp) - right.hp / Math.max(1, right.stats.hp);
      })[0]!;
      return { actorId: unitId, skillId, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
    },
    interceptIncomingDamage(_state, _attacker, target, amount, _kind, damageContext) {
      if (!damageContext?.isCritical) return undefined;
      const owner = damageContext.battle.getLivingUnits(target.side).find(unit => isFuji(unit));
      if (!owner || !hasField(owner) || skillRank(owner, ids.fieldSkill) < 2) return undefined;
      return { amount: amount * .75, effects: [] };
    },
    handlers: {
      'turn-start': { priority: 36, handle(context, event) { return ownerTurnStart(context, event); } },
      'action-selection': { priority: 36, handle(context, event) { return grantCloudClothing(context, event); } },
      'turn-end': { priority: 36, handle(context, event) { return finishAllyTurn(context, event); } },
      'attack-start': { priority: 36, handle(context, event) { return suppressExtremeCrit(context, event); } },
    },
  };
  registry.registerHero(definition);
}

function openField(context: BattleContext, owner: Readonly<UnitState>): EffectCommand[] {
  const existing = owner.statuses.find(item => item.statusId === fujiMountainIds.field && item.source.unitId === owner.unitId);
  const generation = Number(existing?.values?.generation ?? 0) + 1;
  const source = makeSource(fujiMountainIds.fieldSkill, owner.unitId);
  const commands: EffectCommand[] = [{ type: 'add-status', source, targetId: owner.unitId, instance: {
    instanceId: `${fujiMountainIds.field}:${owner.unitId}`, statusId: fujiMountainIds.field, source, stacks: 1,
    duration: { kind: 'count', remaining: 3, owner: 'source-turn' }, values: { generation },
  } }];
  for (const ally of context.getLivingUnits(owner.side)) {
    const old = ally.statuses.find(item => item.statusId === fujiMountainIds.allyMemory && item.source.unitId === owner.unitId);
    commands.push({ type: 'add-status', source, targetId: ally.unitId, instance: {
      instanceId: `${fujiMountainIds.allyMemory}:${owner.unitId}:${ally.unitId}`, statusId: fujiMountainIds.allyMemory,
      source, stacks: 1, duration: { kind: 'permanent' },
      values: { generation, hasActed: false, lastSkill: String(old?.values?.lastSkill ?? ''), actedThisTurn: false, mountainAtEnd: false },
    } });
    if (skillRank(owner, fujiMountainIds.fieldSkill) >= 4) {
      const attack = Math.min(owner.stats.defense * .5, ally.stats.attack * .2);
      commands.push({ type: 'add-status', source, targetId: ally.unitId, instance: {
        instanceId: `${fujiMountainIds.fieldAttack}:${owner.unitId}:${ally.unitId}`, statusId: fujiMountainIds.fieldAttack,
        source, stacks: 1, duration: { kind: 'count', remaining: 3, owner: 'source-turn' },
        modifiers: [{ stat: 'attack', operation: 'flat', amount: attack }], values: { fieldAttack: true },
      } });
    }
  }
  return commands;
}

function grantCloudClothing(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'action-declared') return;
  const actorId = event.intent.actorId, actor = context.getUnit(actorId);
  if (!actor || actor.hp <= 0) return;
  const owner = uniqueFuji(context, actor.side);
  if (!owner || !hasField(owner)) return;
  const memory = actor.statuses.find(item => item.statusId === fujiMountainIds.allyMemory && item.source.unitId === owner.unitId);
  const generation = Number(owner.statuses.find(item => item.statusId === fujiMountainIds.field)?.values?.generation ?? 0);
  const validMemory = memory && Number(memory.values?.generation ?? -1) === generation;
  const sameSkill = validMemory && memory.values?.hasActed === true && memory.values?.lastSkill === event.intent.skillId;
  const firstAction = !validMemory || memory.values?.hasActed !== true;
  const grantCloud = firstAction || sameSkill;
  const commands: EffectCommand[] = [];
  if (grantCloud) {
    commands.push(cloudClothingCommand(owner, actor));
    if (passivesEnabled(owner)) commands.push(...addMark(owner, fujiMountainIds.cloudMark, event.eventId));
  }
  if (validMemory) commands.push({ type: 'add-status', source: makeSource(fujiMountainIds.passive, owner.unitId), targetId: actor.unitId,
    instance: { ...memory, values: { ...memory.values, hasActed: true, lastSkill: event.intent.skillId,
      actedThisTurn: true, mountainAtEnd: !grantCloud } }, parentEventId: event.eventId });
  else commands.push({ type: 'add-status', source: makeSource(fujiMountainIds.passive, owner.unitId), targetId: actor.unitId,
    instance: { instanceId: `${fujiMountainIds.allyMemory}:${owner.unitId}:${actor.unitId}`, statusId: fujiMountainIds.allyMemory,
      source: makeSource(fujiMountainIds.passive, owner.unitId), stacks: 1, duration: { kind: 'permanent' },
      values: { generation, hasActed: true, lastSkill: event.intent.skillId, actedThisTurn: true, mountainAtEnd: !grantCloud } },
    parentEventId: event.eventId });
  return commands;
}

function finishAllyTurn(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-ended') return;
  const actor = context.getUnit(event.unitId);
  if (!actor || actor.hp <= 0) return;
  const owner = uniqueFuji(context, actor.side);
  if (!owner || !hasField(owner)) return;
  const memory = actor.statuses.find(item => item.statusId === fujiMountainIds.allyMemory && item.source.unitId === owner.unitId);
  if (!memory) return;
  const commands: EffectCommand[] = [];
  if (memory.values?.mountainAtEnd === true || memory.values?.actedThisTurn !== true) {
    commands.push(mountainColorCommand(owner, actor));
    if (passivesEnabled(owner)) commands.push(...addMark(owner, fujiMountainIds.mountainMark, event.eventId));
  }
  commands.push({ type: 'add-status', source: makeSource(fujiMountainIds.passive, owner.unitId), targetId: actor.unitId,
    instance: { ...memory, values: { ...memory.values, actedThisTurn: false, mountainAtEnd: false } }, parentEventId: event.eventId });
  return commands;
}

function ownerTurnStart(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-started' || event.scheduling === 'extra-turn') return;
  const owner = context.getUnit(event.unitId);
  if (!owner || !isFuji(owner) || owner.hp <= 0 || !passivesEnabled(owner)
    || uniqueFuji(context, owner.side)?.unitId !== owner.unitId || skillRank(owner, fujiMountainIds.passive) < 2) return;
  return addMark(owner, context.random() < .5 ? fujiMountainIds.cloudMark : fujiMountainIds.mountainMark, event.eventId);
}

function suppressExtremeCrit(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'attack-start' || !event.source.unitId || !event.targetIds.length) return;
  const attacker = context.getUnit(event.source.unitId);
  if (!attacker || attacker.hp <= 0) return;
  const protectedTargets = event.targetIds.map(id => context.getUnit(id)).filter((target): target is UnitState => Boolean(target && target.hp > 0));
  for (const target of protectedTargets) {
    const owner = uniqueFuji(context, target.side);
    if (!owner || !hasField(owner) || skillRank(owner, fujiMountainIds.fieldSkill) < 2
      || attacker.side === owner.side || (context.getEffectiveStats(attacker.unitId)?.critDamage ?? attacker.stats.critDamage)
        <= (context.getEffectiveStats(owner.unitId)?.critDamage ?? owner.stats.critDamage) * 3
      || attacker.statuses.some(item => item.statusId === fujiMountainIds.critSuppression && item.source.unitId === owner.unitId)) continue;
    return [{ type: 'add-status', source: makeSource(fujiMountainIds.fieldSkill, owner.unitId), targetId: attacker.unitId,
      parentEventId: event.eventId, instance: { instanceId: `${fujiMountainIds.critSuppression}:${owner.unitId}:${attacker.unitId}`,
        statusId: fujiMountainIds.critSuppression, source: makeSource(fujiMountainIds.fieldSkill, owner.unitId), stacks: 1,
        duration: { kind: 'count', remaining: 1, owner: 'source-turn' },
        modifiers: [{ stat: 'crit', operation: 'flat', amount: -.5 }], values: { turn: context.state.counters.action } } }];
  }
}

function cloudClothingCommand(owner: Readonly<UnitState>, target: Readonly<UnitState>): EffectCommand {
  const source = makeSource(fujiMountainIds.fieldSkill, owner.unitId);
  const attack = Math.min(owner.stats.defense * 2, target.stats.attack * .4);
  return { type: 'add-status', source, targetId: target.unitId, instance: {
    instanceId: `${fujiMountainIds.cloudClothing}:${owner.unitId}:${target.unitId}`, statusId: fujiMountainIds.cloudClothing,
    source, stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' },
    modifiers: [{ stat: 'attack', operation: 'flat', amount: attack }], values: { attack },
  } };
}

function mountainColorCommand(owner: Readonly<UnitState>, target: Readonly<UnitState>): EffectCommand {
  const source = makeSource(fujiMountainIds.fieldSkill, owner.unitId);
  return { type: 'add-status', source, targetId: target.unitId, instance: {
    instanceId: `${fujiMountainIds.mountainColor}:${owner.unitId}:${target.unitId}`, statusId: fujiMountainIds.mountainColor,
    source, stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' },
    modifiers: [{ stat: 'resist', operation: 'flat', amount: .3 }],
    values: { shieldRemaining: owner.stats.defense * 3.5 },
  } };
}

function addMark(owner: Readonly<UnitState>, statusId: string, parentEventId?: string): EffectCommand[] {
  const source = makeSource(fujiMountainIds.passive, owner.unitId), current = ownMark(owner, statusId);
  return current
    ? [{ type: 'change-status-stacks', source, targetId: owner.unitId, instanceId: current.instanceId, amount: 1,
      ...(parentEventId ? { parentEventId } : {}) }]
    : [{ type: 'add-status', source, targetId: owner.unitId, instance: { instanceId: `${statusId}:${owner.unitId}`,
      statusId, source, stacks: 1, duration: { kind: 'permanent' } }, ...(parentEventId ? { parentEventId } : {}) }];
}

function resistanceCommand(owner: Readonly<UnitState>, source: SourceRef): EffectCommand {
  return { type: 'add-status', source, targetId: owner.unitId, instance: { instanceId: `${fujiMountainIds.resistance}:${owner.unitId}`,
    statusId: fujiMountainIds.resistance, source, stacks: 1, duration: { kind: 'count', remaining: 2, owner: 'target-turn' },
    modifiers: [{ stat: 'resist', operation: 'flat', amount: .5 }] } };
}

function markCount(owner: Readonly<UnitState>, id: string): number { return ownMark(owner, id)?.stacks ?? 0; }
function ownMark(owner: Readonly<UnitState>, id: string): StatusInstance | undefined {
  return owner.statuses.find(item => item.statusId === id && item.source.unitId === owner.unitId);
}
function hasField(owner: Readonly<UnitState>): boolean { return owner.statuses.some(item => item.statusId === fujiMountainIds.field); }
function uniqueFuji(context: BattleContext, side: 'blue' | 'red'): Readonly<UnitState> | undefined {
  return context.getLivingUnits(side).find(unit => isFuji(unit));
}
