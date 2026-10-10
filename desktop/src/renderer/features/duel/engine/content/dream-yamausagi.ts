import type { HeroDefinition, SkillDefinition, StatusDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, UnitState } from '../core/types';
import { isUnitBanished } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { attemptControl, attemptDebuff } from '../mechanics/control';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import { createBasicAttackSkill } from './common-skills';
import type { ContentRegistry } from './registry';

export const dreamYamausagiIds = {
  hero: 377, basic: '3771', formation: '3772', ultimate: '3773', dance: '3774',
  mines: 'status.hero.377.mines', ninjaLaw: 'status.hero.377.ninja-law', danceAttack: 'status.hero.377.dance-attack',
  aim: 'status.hero.377.aim', transform: 'status.hero.377.transform', mineResistDown: 'status.hero.377.mine-resist-down',
  enemyTurnCount: 'status.hero.377.enemy-turn-count',
} as const;

const basicRatios = [.5, .53, .56, .59, .65] as const;
const transformChance = [.1, .1, .2, .2, .3] as const;
const sideAgainst = (side: 'blue' | 'red'): 'blue' | 'red' => side === 'blue' ? 'red' : 'blue';
const isDreamYamausagi = (unit: Readonly<UnitState> | undefined): unit is Readonly<UnitState> => unit?.heroId === dreamYamausagiIds.hero;
const rank = (unit: Readonly<UnitState>, skillId: string): number => Math.max(1, Math.min(6,
  unit.skillLevels?.[skillId] ?? unit.skillLevel ?? 1));
const sourceFor = (skillId: string, unitId: string): SourceRef => ({ kind: 'skill', id: skillId, unitId });

export function registerDreamYamausagi(registry: ContentRegistry): void {
  const ids = dreamYamausagiIds;
  const statuses: StatusDefinition[] = [
    { id: ids.mines, mechanicsCoverage: 'partial', category: 'mark', dispellable: false, sealable: false,
      durationOwner: 'permanent', refreshPolicy: 'add-stack', stackScope: 'source-unit', maxStacks: 9 },
    { id: ids.ninjaLaw, mechanicsCoverage: 'partial', category: 'mark', dispellable: false, sealable: false,
      durationOwner: 'permanent', refreshPolicy: 'add-stack', stackScope: 'source-unit', maxStacks: 9 },
    { id: ids.danceAttack, mechanicsCoverage: 'partial', category: 'buff', dispellable: true, sealable: true,
      durationOwner: 'target-turn', refreshPolicy: 'replace' },
    { id: ids.aim, mechanicsCoverage: 'partial', category: 'buff', dispellable: true, sealable: true,
      durationOwner: 'source-turn', refreshPolicy: 'replace' },
    { id: ids.transform, mechanicsCoverage: 'partial', category: 'control', dispellable: true, sealable: true,
      durationOwner: 'target-turn', refreshPolicy: 'refresh-duration', preventsAction: true },
    { id: ids.mineResistDown, mechanicsCoverage: 'partial', category: 'debuff', dispellable: true, sealable: true,
      durationOwner: 'target-turn', refreshPolicy: 'refresh-duration' },
    { id: ids.enemyTurnCount, mechanicsCoverage: 'partial', category: 'other', dispellable: false, sealable: false,
      durationOwner: 'permanent', refreshPolicy: 'replace' },
  ];
  for (const status of statuses) registry.registerStatus(status);

  const basicTemplate = createBasicAttackSkill(ids.basic, basicRatios);
  const basic: SkillDefinition = { ...basicTemplate,
    levels: basicRatios.map(ratio => ({ ratio, hits: 2 })),
    execute(context, intent, parameters) {
      const owner = context.getUnit(intent.actorId);
      const target = context.getUnit(intent.targetIds[0] ?? '');
      if (!owner || !target || owner.hp <= 0 || target.hp <= 0 || target.side === owner.side) return [];
      const source = sourceFor(ids.basic, owner.unitId);
      const ratio = Number(parameters.ratio ?? .5);
      return [damageCommand(context, owner, target, source, ratio), damageCommand(context, owner, target, source, ratio)];
    },
  };
  const formation: SkillDefinition = {
    id: ids.formation, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 2 },
    target: 'all-enemies', targetRelation: 'enemy', levels: [{}, {}, {}, {}, {}],
    execute(context, intent) {
      const owner = context.getUnit(intent.actorId);
      if (!owner || !isDreamYamausagi(owner) || owner.hp <= 0 || !isFirstDreamYamausagi(context.state, owner)) return [];
      const commands = placeMines(owner, sourceFor(ids.formation, owner.unitId), 3);
      return commands;
    },
  };
  const ultimate: SkillDefinition = {
    id: ids.ultimate, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'all-enemies', targetRelation: 'enemy', levels: [{ ratio: 1.6 }, { ratio: 1.6 }, { ratio: 1.6 }, { ratio: 1.6 }, { ratio: 1.6 }],
    execute(context, intent) {
      const owner = context.getUnit(intent.actorId);
      if (!owner || !isDreamYamausagi(owner) || owner.hp <= 0 || !isFirstDreamYamausagi(context.state, owner)) return [];
      const ownerRank = rank(owner, ids.ultimate);
      const source = sourceFor(ids.ultimate, owner.unitId);
      const selectedId = intent.selectedTargetId ?? intent.targetIds[0];
      const commands: EffectCommand[] = [];
      if (ownerRank >= 2) commands.push({ type: 'add-status', source, targetId: owner.unitId, instance: {
        instanceId: `${ids.aim}:${owner.unitId}`, statusId: ids.aim, source, stacks: 1,
        duration: { kind: 'count', remaining: 2, owner: 'source-turn' },
        modifiers: [{ stat: 'hit', operation: 'flat', amount: .3 }],
      } });
      if (ownerRank >= 4) commands.push(...placeMines(owner, source, 1));
      if (selectedId) {
        const target = context.getUnit(selectedId);
        if (target && target.hp > 0 && target.side !== owner.side) {
          const control = attemptControl(context, { attemptId: `${ids.transform}:${owner.unitId}:${target.unitId}:${context.state.counters.action}`,
            source, targetId: target.unitId, statusId: ids.transform, controlType: '变形',
            baseChance: transformChance[ownerRank - 1]!, bonusHit: ownerRank >= 2 ? .3 : 0,
            duration: { kind: 'count', remaining: 1, owner: 'target-turn' } });
          if (control) commands.push(control);
        }
      }
      const targets = [...new Set(intent.targetIds)].map(targetId => context.getUnit(targetId))
        .filter((target): target is Readonly<UnitState> => Boolean(target && target.hp > 0 && target.side !== owner.side));
      const law = owner.statuses.find(status => status.statusId === ids.ninjaLaw && status.source.unitId === owner.unitId);
      const ratio = 1.6 * (1 + .2 * Math.min(9, law?.stacks ?? 0));
      for (const target of targets) commands.push(damageCommand(context, owner, target, source, ratio));
      if (law) commands.push({ type: 'remove-status-instances', source, targetId: owner.unitId,
        instanceIds: [law.instanceId], reason: 'consumed' });
      return commands;
    },
  };
  const definition: HeroDefinition = {
    id: ids.hero, skills: [basic, formation, ultimate], mechanicsCoverage: 'partial', aiCoverage: 'partial',
    mechanicsCoverageNotes: ['按本地3771–3774技能行、3772/3773/3774/3775/3777/3778状态行接入普攻双段、2火布置3颗行动条地雷、敌方经过50%行动条引爆/150%伤害、地雷触发全队10%拉条与10%/20%攻击增益并叠梦忍法、3火终结技变形/全体160%+每篇梦忍法20%增伤/清空层数、二技能累计敌方行动后驱散或免费补雷。二级地雷穿150防、四级减抵抗、五级5次计数/终结技变形30%及四级起终结技布1雷已接入。自然行动条推进现发出统一经过事件，推条穿越同样触发地雷。多只梦寻山兔的唯一效果、炸弹满层/越线边界、地雷受御魂触发与眩晕/放逐状态的原生窗口仍待实战帧确认；本场阵容无梦寻山兔。'],
    aiCoverageNotes: ['社区AI：梦忍法少于9篇用2技能，达到9篇用3技能；付不起火时本模型明确退回普攻。终结技选择目标按首个合法敌方目标近似，客户端在平局和阴阳师目标上的优先级还需帧核。'],
    handlers: {
      'effect-resolution': { priority: 43, handle(context, event) { return detonateMine(context, event); } },
      hit: { priority: 43, handle(context, event) { return mineResistDown(context, event); } },
      'turn-end': { priority: 43, handle(context, event) { return countEnemyTurns(context, event, registry); } },
    },
    policy(context, unitId) {
      const owner = context.getUnit(unitId);
      if (!owner || owner.hp <= 0 || !isDreamYamausagi(owner) || !isFirstDreamYamausagi(context.state, owner)) return undefined;
      const enemies = context.getLivingUnits(sideAgainst(owner.side));
      if (!enemies.length) return undefined;
      const first = enemies[0]!;
      const law = owner.statuses.find(status => status.statusId === ids.ninjaLaw && status.source.unitId === owner.unitId);
      const fire = context.state.resources[owner.side]?.fire ?? owner.resources.fire ?? 0;
      const skillId = (law?.stacks ?? 0) >= 9 && fire >= 3 ? ids.ultimate
        : (law?.stacks ?? 0) < 9 && fire >= 2 ? ids.formation : ids.basic;
      const shape = skillId === ids.formation ? 'all-enemies' : 'single';
      return { actorId: unitId, skillId, targetIds: skillId === ids.formation ? enemies.map(unit => unit.unitId) : [first.unitId],
        ...(skillId === ids.formation ? { selectedTargetId: first.unitId } : {}), shape, targetRelation: 'enemy' };
    },
  };
  registry.registerHero(definition);
}

function isFirstDreamYamausagi(state: BattleContext['state'], owner: Readonly<UnitState>): boolean {
  return state.sides[owner.side].map(unitId => state.units[unitId]).find(unit => unit && isDreamYamausagi(unit))?.unitId === owner.unitId;
}

function placeMines(owner: Readonly<UnitState>, source: SourceRef, amount: number): EffectCommand[] {
  if (amount <= 0) return [];
  return [{ type: 'add-status', source, targetId: owner.unitId, instance: {
    instanceId: `${dreamYamausagiIds.mines}:${owner.unitId}`, statusId: dreamYamausagiIds.mines,
    source, stacks: amount, duration: { kind: 'permanent' },
  } }];
}

function damageCommand(context: BattleContext, owner: Readonly<UnitState>, target: Readonly<UnitState>, source: SourceRef,
  ratio: number, defenseIgnore = 0): EffectCommand {
  const attack = context.getEffectiveStats(owner.unitId) ?? owner.stats;
  const defense = context.getEffectiveStats(target.unitId)?.defense ?? target.stats.defense;
  const hit = context.calculateDamage({ attack: attack.attack, defense, defenseIgnore: effectiveDefenseIgnore(owner) + defenseIgnore,
    ratio, critChance: attack.crit, critDamage: attack.critDamage }, owner, target);
  return { type: 'deal-damage', source, targetId: target.unitId, amount: hit.amount,
    ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}), isCritical: hit.isCritical };
}

function detonateMine(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'action-gauge-changed' || !(event.before < 50 && event.after >= 50)) return;
  const target = context.getUnit(event.unitId);
  if (!target || target.hp <= 0 || target.unitKind === 'summon') return;
  const owner = context.getLivingUnits(target.side === 'blue' ? 'red' : 'blue')
    .find(unit => isDreamYamausagi(unit) && isFirstDreamYamausagi(context.state, unit));
  const mines = owner?.statuses.find(status => status.statusId === dreamYamausagiIds.mines
    && status.source.unitId === owner.unitId);
  if (!owner || !mines || mines.stacks < 1) return;
  const source = sourceFor(dreamYamausagiIds.formation, owner.unitId);
  const commands: EffectCommand[] = [{ type: 'change-status-stacks', source, targetId: owner.unitId,
    instanceId: mines.instanceId, amount: -1, parentEventId: event.eventId },
  damageCommand(context, owner, target, source, 1.5,
    rank(owner, dreamYamausagiIds.formation) >= 2 ? 150 : 0)];
  if (rank(owner, dreamYamausagiIds.formation) >= 4) commands.push(...attemptDebuff(context, { source,
    targetId: target.unitId, statusId: dreamYamausagiIds.mineResistDown, baseChance: 1,
    duration: { kind: 'count', remaining: 1, owner: 'target-turn' }, parentEventId: event.eventId,
    modifiers: [{ stat: 'resist', operation: 'flat', amount: -.3 }] }));
  if (!context.isUnitUnableToAct(owner.unitId) && !isUnitBanished(owner) && passivesEnabled(owner)) {
    const danceRank = rank(owner, dreamYamausagiIds.formation);
    const buffSource = sourceFor(dreamYamausagiIds.dance, owner.unitId);
    for (const ally of context.getLivingUnits(owner.side)) {
      commands.push({ type: 'change-action-gauge', source: buffSource, targetId: ally.unitId, amount: 10, parentEventId: event.eventId },
        { type: 'add-status', source: buffSource, targetId: ally.unitId, instance: {
          instanceId: `${dreamYamausagiIds.danceAttack}:${owner.unitId}:${ally.unitId}`, statusId: dreamYamausagiIds.danceAttack,
          source: buffSource, stacks: 1, duration: { kind: 'count', remaining: 2, owner: 'target-turn' },
          modifiers: [{ stat: 'attack', operation: 'percent', amount: danceRank >= 3 ? .2 : .1 }],
        }, parentEventId: event.eventId });
    }
    commands.push({ type: 'add-status', source: buffSource, targetId: owner.unitId, instance: {
      instanceId: `${dreamYamausagiIds.ninjaLaw}:${owner.unitId}`, statusId: dreamYamausagiIds.ninjaLaw,
      source: buffSource, stacks: 1, duration: { kind: 'permanent' },
    }, parentEventId: event.eventId });
  }
  return commands;
}

function countEnemyTurns(context: BattleContext, event: BattleEvent, registry: ContentRegistry): EffectCommand[] | undefined {
  if (event.type !== 'turn-ended' || !event.unitId) return;
  const enemy = context.getUnit(event.unitId);
  if (!enemy || enemy.unitKind === 'summon') return;
  const owner = context.getLivingUnits(enemy.side === 'blue' ? 'red' : 'blue')
    .find(unit => isDreamYamausagi(unit) && isFirstDreamYamausagi(context.state, unit));
  if (!owner || !passivesEnabled(owner)) return;
  const current = owner.statuses.find(status => status.statusId === dreamYamausagiIds.enemyTurnCount
    && status.source.unitId === owner.unitId);
  const count = Number(current?.values?.count ?? 0) + 1;
  const threshold = rank(owner, dreamYamausagiIds.formation) >= 5 ? 5 : 6;
  const source = sourceFor(dreamYamausagiIds.formation, owner.unitId);
  const commands: EffectCommand[] = [{ type: 'add-status', source, targetId: owner.unitId, instance: {
    instanceId: `${dreamYamausagiIds.enemyTurnCount}:${owner.unitId}`, statusId: dreamYamausagiIds.enemyTurnCount,
    source, stacks: 1, duration: { kind: 'permanent' }, values: { count: count >= threshold ? 0 : count },
  }, parentEventId: event.eventId }];
  if (count < threshold) return commands;
  const removableControls = owner.statuses.filter(status => registry.getStatus(status.statusId)?.category === 'control'
    && registry.getStatus(status.statusId)?.dispellable === true);
  if (removableControls.length) commands.push({ type: 'dispel-statuses', source, targetId: owner.unitId,
    instanceIds: [removableControls[0]!.instanceId], maxCount: 1, parentEventId: event.eventId });
  else if (!context.isUnitUnableToAct(owner.unitId) && !isUnitBanished(owner)) commands.push(...placeMines(owner, source, 2));
  return commands;
}

function mineResistDown(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage' || event.source.id !== dreamYamausagiIds.formation || !event.source.unitId) return;
  const owner = context.getUnit(event.source.unitId);
  const target = context.getUnit(event.targetId);
  if (!owner || !isDreamYamausagi(owner) || rank(owner, dreamYamausagiIds.formation) < 4
    || !target || target.hp <= 0 || target.side === owner.side) return;
  return attemptDebuff(context, { source: sourceFor(dreamYamausagiIds.formation, owner.unitId), targetId: target.unitId,
    statusId: dreamYamausagiIds.mineResistDown, baseChance: 1,
    duration: { kind: 'count', remaining: 1, owner: 'target-turn' }, parentEventId: event.eventId,
    modifiers: [{ stat: 'resist', operation: 'flat', amount: -.3 }] });
}
