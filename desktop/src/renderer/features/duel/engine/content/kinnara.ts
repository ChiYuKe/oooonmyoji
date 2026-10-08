import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, StatusInstance, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { attemptDebuff } from '../mechanics/control';
import type { ContentRegistry } from './registry';

export const kinnaraIds = {
  hero: 353, basic: '3531', passive: '3532', ultimate: '3533',
  palace: '35321', mountain: '35322', palaceGlow: '35323', warmWind: '35324', clearFeather: '35325',
  isolation: 'status.hero.353.isolation', available: 'status.hero.353.available-tone',
  melodyMemory: 'status.hero.353.melody-memory', melodyBuff: 'status.hero.353.melody-buff',
  shelter: 'status.hero.353.shelter', critConversion: 'status.hero.353.crit-conversion',
} as const;

const tones = [kinnaraIds.palace, kinnaraIds.mountain, kinnaraIds.palaceGlow, kinnaraIds.warmWind,
  kinnaraIds.clearFeather] as const;
const ultimateRatios = [.5, .53, .56, .6, .6] as const;
const basicRatios = [1, 1.05, 1.1, 1.15, 1.15] as const;

export function registerKinnara(registry: ContentRegistry): void {
  const status = (id: string, fields: Omit<Parameters<ContentRegistry['registerStatus']>[0], 'id'>) =>
    registry.registerStatus({ id, mechanicsCoverage: 'partial', ...fields });
  status(kinnaraIds.isolation, { category: 'debuff', dispellable: true, sealable: true,
    durationOwner: 'target-turn', refreshPolicy: 'refresh-duration' });
  for (const tone of tones) status(availableToneStatus(tone), { category: 'other', dispellable: false, sealable: false,
    durationOwner: 'permanent', refreshPolicy: 'replace' });
  status(kinnaraIds.melodyMemory, { category: 'other', dispellable: false, sealable: false,
    durationOwner: 'permanent', refreshPolicy: 'replace' });
  status(kinnaraIds.melodyBuff, { category: 'buff', dispellable: false, sealable: false,
    durationOwner: 'target-turn', refreshPolicy: 'refresh-duration' });
  status(kinnaraIds.shelter, { category: 'buff', dispellable: false, sealable: false,
    durationOwner: 'target-turn', refreshPolicy: 'replace', controlProtection: 'single-application' });
  status(kinnaraIds.critConversion, { category: 'buff', dispellable: false, sealable: false,
    durationOwner: 'permanent', refreshPolicy: 'replace' });
  registry.registerHero(createKinnaraDefinition());
}

export function createKinnaraDefinition(): HeroDefinition {
  const passive: SkillDefinition = { id: kinnaraIds.passive, actionKind: 'passive', target: 'self', targetRelation: 'ally',
    levels: Array.from({ length: 6 }, () => ({})), canUse() { return false; }, execute() { return []; } };
  const basic: SkillDefinition = { id: kinnaraIds.basic, actionKind: 'basic', target: 'single', targetRelation: 'enemy',
    levels: basicRatios.map(ratio => ({ ratio })), execute(context, intent, parameters) {
      const owner = context.getUnit(intent.actorId), target = context.getUnit(intent.targetIds[0] ?? '');
      if (!owner || owner.heroId !== kinnaraIds.hero || owner.hp <= 0 || !target || target.hp <= 0) return [];
      const sourceRef = kinnaraSource(kinnaraIds.basic, owner.unitId);
      const commands: EffectCommand[] = [hit(context, owner, target, sourceRef, Number(parameters.ratio ?? basicRatios[0]))];
      if (skillRank(owner, kinnaraIds.basic) >= 5) {
        const lastTone = readMelodyState(owner).lastTone;
        if (lastTone) commands.push(...applyToneEffect(context, owner, lastTone, intent.targetIds[0], sourceRef));
      }
      return commands;
    } };
  const ultimate: SkillDefinition = { id: kinnaraIds.ultimate, actionKind: 'skill', target: 'single', targetRelation: 'enemy',
    resourceCost: { resourceId: 'fire', amount: 3 }, levels: ultimateRatios.map(ratio => ({ ratio })), execute(context, intent, parameters) {
      const owner = context.getUnit(intent.actorId), target = context.getUnit(intent.targetIds[0] ?? '');
      if (!owner || owner.heroId !== kinnaraIds.hero || owner.hp <= 0 || !target || target.hp <= 0) return [];
      const sourceRef = kinnaraSource(kinnaraIds.ultimate, owner.unitId), commands: EffectCommand[] = [];
      for (let index = 0; index < 5; index++) {
        const currentTarget = context.getUnit(target.unitId);
        if (!currentTarget || currentTarget.hp <= 0) break;
        commands.push(hit(context, owner, currentTarget, sourceRef, Number(parameters.ratio ?? ultimateRatios[0])));
      }
      if (skillRank(owner, kinnaraIds.ultimate) >= 5) {
        for (const tone of readMelodyState(owner).playedTones) {
          commands.push(...applyToneEffect(context, owner, tone, target.unitId, sourceRef));
        }
      }
      return commands;
    } };
  const toneSkills = tones.map(tone => createToneSkill(tone));
  const definition: HeroDefinition = { id: kinnaraIds.hero, skills: [basic, passive, ultimate, ...toneSkills],
    mechanicsCoverage: 'partial', aiCoverage: 'partial',
    mechanicsCoverageNotes: ['依据客户端3531/3532/3533及35321–35325技能行实现：自身回合开始随机开放两种律音供选择；律音各自按客户端效果结算，五级破减免律音耗火；序五级重放最近一曲，急五级重放本场已经弹奏过的各曲。缺少紧那罗实战帧；自动技能选择、目标筛选和御魂/被动插入顺序仍需帧核。'],
    handlers: { 'turn-start': { priority: 353, handle(context, event) { return openMelodies(context, event); } } },
    policy(context, unitId) { return chooseKinnaraAction(context, unitId); },
  };
  return definition;
}

function createToneSkill(tone: typeof tones[number]): SkillDefinition {
  const skill: SkillDefinition = { id: tone, actionKind: 'skill', target: tone === kinnaraIds.palace ? 'single' : tone === kinnaraIds.mountain
    ? 'single' : 'all-allies', targetRelation: tone === kinnaraIds.palace || tone === kinnaraIds.mountain ? 'enemy' : 'ally',
  levels: Array.from({ length: 6 }, () => ({})),
  resolveResourceCost(_state, actor) { return { resourceId: 'fire', amount: skillRank(actor, kinnaraIds.passive) >= 5 ? 0 : 1 }; },
  canUse(state, actor) { return actor.heroId === kinnaraIds.hero && actor.hp > 0 && actor.unitKind !== 'summon'
    && actor.statuses.some(status => status.statusId === availableToneStatus(tone))
    && (skillRank(actor, kinnaraIds.passive) >= 5 || (state.resources[actor.side]?.fire ?? 0) >= 1); },
  execute(context, intent) {
    const owner = context.getUnit(intent.actorId);
    if (!owner || owner.hp <= 0 || owner.heroId !== kinnaraIds.hero) return [];
    const targetId = tone === kinnaraIds.palace || tone === kinnaraIds.mountain ? intent.targetIds[0] : undefined;
    const sourceRef = kinnaraSource(tone, owner.unitId);
    const available = owner.statuses.find(status => status.statusId === availableToneStatus(tone));
    if (!available) return [];
    const played = playTone(context, owner, tone, targetId, sourceRef);
    return [ { type: 'remove-status-instances', source: sourceRef, targetId: owner.unitId,
      instanceIds: [available.instanceId], reason: 'consumed' }, ...played ];
  } };
  return skill;
}

function openMelodies(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-started') return;
  const owner = context.getUnit(event.unitId);
  if (!owner || owner.heroId !== kinnaraIds.hero || owner.hp <= 0 || owner.unitKind === 'summon' || !passivesEnabled(owner)) return;
  const sourceRef = kinnaraSource(kinnaraIds.passive, owner.unitId);
  const commands: EffectCommand[] = owner.statuses.filter(status => tones.some(tone => status.statusId === availableToneStatus(tone)))
    .map(status => ({ type: 'remove-status-instances', source: status.source, targetId: owner.unitId,
      instanceIds: [status.instanceId], reason: 'replaced' as const, parentEventId: event.eventId }));
  const remaining = [...tones];
  const selected: (typeof tones[number])[] = [];
  for (let index = 0; index < 2; index++) selected.push(remaining.splice(Math.floor(context.random() * remaining.length), 1)[0]!);
  for (const tone of selected) commands.push({ type: 'add-status', source: sourceRef, targetId: owner.unitId, parentEventId: event.eventId,
    instance: { instanceId: `${availableToneStatus(tone)}:${owner.unitId}`, statusId: availableToneStatus(tone), source: sourceRef,
      stacks: 1, duration: { kind: 'permanent' } } });
  if (skillRank(owner, kinnaraIds.passive) >= 3) {
    const previous = owner.statuses.find(status => status.statusId === kinnaraIds.critConversion);
    commands.push({ type: 'add-status', source: sourceRef, targetId: owner.unitId, parentEventId: event.eventId,
      instance: makeCritConversionStatus(owner, .5, Number(previous?.values?.convertedTones ?? 0), 0) });
  }
  return commands;
}

function playTone(context: BattleContext, owner: Readonly<UnitState>, tone: typeof tones[number], targetId: string | undefined,
  sourceRef: SourceRef): EffectCommand[] {
  const commands = applyToneEffect(context, owner, tone, targetId, sourceRef);
  const state = readMelodyState(owner), unique = [...new Set([...state.playedTones, tone])];
  const memory: StatusInstance = { instanceId: `${kinnaraIds.melodyMemory}:${owner.unitId}`, statusId: kinnaraIds.melodyMemory,
    source: sourceRef, stacks: 1, duration: { kind: 'permanent' }, values: { lastTone: tone, playedTones: unique.join(',') } };
  commands.push({ type: 'add-status', source: sourceRef, targetId: owner.unitId, instance: memory });
  const rank = skillRank(owner, kinnaraIds.passive);
  if (rank >= 2) commands.push({ type: 'change-action-gauge', source: sourceRef, targetId: owner.unitId, amount: 35,
    checkImmunity: true });
  if (rank >= 4) commands.push({ type: 'add-status', source: sourceRef, targetId: owner.unitId,
    instance: { instanceId: `${kinnaraIds.shelter}:${owner.unitId}`, statusId: kinnaraIds.shelter,
      source: sourceRef, stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' } } });
  if (rank >= 3) {
    const previous = owner.statuses.find(status => status.statusId === kinnaraIds.critConversion);
    const convertedThisTurn = Math.min(5, Number(previous?.values?.convertedThisTurn ?? 0) + 1);
    const totalConverted = Number(previous?.values?.convertedTones ?? 0) + 1;
    const reduction = Math.max(0, .5 - convertedThisTurn * .1);
    commands.push({ type: 'add-status', source: sourceRef, targetId: owner.unitId,
      instance: makeCritConversionStatus(owner, reduction, totalConverted, convertedThisTurn) });
  }
  return commands;
}

function applyToneEffect(context: BattleContext, owner: Readonly<UnitState>, tone: typeof tones[number], targetId: string | undefined,
  sourceRef: SourceRef): EffectCommand[] {
  if (tone === kinnaraIds.palace) {
    const target = targetId ? context.getUnit(targetId) : context.getLivingUnits(enemySide(owner.side))[0];
    if (!target || target.hp <= 0) return [];
    return [hit(context, owner, target, sourceRef, 1.5), ...attemptDebuff(context, { source: sourceRef, targetId: target.unitId,
      statusId: kinnaraIds.isolation, baseChance: 1, duration: { kind: 'count', remaining: 2, owner: 'target-turn' } })];
  }
  if (tone === kinnaraIds.mountain) {
    const enemies = context.getLivingUnits(enemySide(owner.side));
    const commands: EffectCommand[] = [];
    for (let index = 0; index < 5 && enemies.length; index++) {
      const target = enemies[Math.floor(context.random() * enemies.length)]!;
      const attack = context.getEffectiveStats(owner.unitId) ?? owner.stats, defense = context.getEffectiveStats(target.unitId) ?? target.stats;
      const result = context.calculateDamage({ attack: attack.attack, defense: defense.defense, ratio: .9,
        critChance: attack.crit, critDamage: attack.critDamage }, owner, target);
      commands.push({ type: 'deal-damage', source: sourceRef, targetId: target.unitId, amount: result.amount,
        ...(result.damageOptions ? { damageOptions: result.damageOptions } : {}), isCritical: result.isCritical,
        suppressTargetSoulTriggers: true });
    }
    return commands;
  }
  if (tone === kinnaraIds.palaceGlow) return context.getLivingUnits(owner.side).flatMap(ally => [
    { type: 'change-action-gauge' as const, source: sourceRef, targetId: ally.unitId, amount: 10, checkImmunity: true },
    addBuff(ally, sourceRef, kinnaraIds.palaceGlow, 2, [{ stat: 'critDamage', operation: 'flat', amount: .4 }]),
  ]);
  if (tone === kinnaraIds.warmWind) return context.getLivingUnits(owner.side).flatMap(ally => [
    { type: 'heal' as const, source: sourceRef, targetId: ally.unitId,
      amount: (context.getEffectiveStats(owner.unitId) ?? owner.stats).attack * .8 },
    addBuff(ally, sourceRef, kinnaraIds.warmWind, 2, [{ stat: 'defense', operation: 'percent', amount: .4 }]),
  ]);
  const allies = context.getLivingUnits(owner.side), eligible = allies.map(ally => ({ ally,
    candidates: ally.statuses.filter(status => context.isStatusDispellable(status.statusId)
      && ['debuff', 'control'].includes(context.getStatusCategory(status.statusId) ?? '')) }));
  const canDispel = eligible.filter(entry => entry.candidates.length > 0).length;
  const commands: EffectCommand[] = [{ type: 'change-resource', source: sourceRef, side: owner.side, resourceId: 'fire', amount: 1 }];
  if (canDispel <= 3) commands.push({ type: 'change-resource', source: sourceRef, side: owner.side, resourceId: 'fire', amount: 1 });
  for (const { ally } of eligible) commands.push({ type: 'dispel-statuses', source: sourceRef, targetId: ally.unitId,
    maxCount: 1, filter: 'debuff-or-control' });
  return commands;
}

function addBuff(target: Readonly<UnitState>, sourceRef: SourceRef, statusId: string, remaining: number,
  modifiers: NonNullable<StatusInstance['modifiers']>): EffectCommand {
  return { type: 'add-status', source: sourceRef, targetId: target.unitId,
    instance: { instanceId: `${statusId}:${sourceRef.unitId}:${target.unitId}`, statusId, source: sourceRef, stacks: 1,
      duration: { kind: 'count', remaining, owner: 'target-turn' }, modifiers } };
}

function makeCritConversionStatus(owner: Readonly<UnitState>, reduction: number, convertedTones: number, convertedThisTurn = 0): StatusInstance {
  const sourceRef = kinnaraSource(kinnaraIds.passive, owner.unitId);
  return { instanceId: `${kinnaraIds.critConversion}:${owner.unitId}`, statusId: kinnaraIds.critConversion, source: sourceRef,
    stacks: 1, duration: { kind: 'permanent' }, values: { convertedTones, convertedThisTurn },
    modifiers: [{ stat: 'critDamageTaken', operation: 'percent', amount: -reduction },
      { stat: 'critDamage', operation: 'flat', amount: convertedTones * .2 }] };
}

function readMelodyState(owner: Readonly<UnitState>): { lastTone?: typeof tones[number]; playedTones: (typeof tones[number])[] } {
  const raw = owner.statuses.find(status => status.statusId === kinnaraIds.melodyMemory)?.values?.playedTones;
  const played = typeof raw === 'string' ? raw.split(',').filter((id): id is typeof tones[number] => tones.includes(id as typeof tones[number])) : [];
  const last = owner.statuses.find(status => status.statusId === kinnaraIds.melodyMemory)?.values?.lastTone;
  return { ...(typeof last === 'string' && tones.includes(last as typeof tones[number]) ? { lastTone: last as typeof tones[number] } : {}),
    playedTones: [...new Set(played)] };
}

function chooseKinnaraAction(context: BattleContext, unitId: string): ActionIntent | undefined {
  const owner = context.getUnit(unitId); if (!owner || owner.heroId !== kinnaraIds.hero || owner.hp <= 0 || owner.unitKind === 'summon') return;
  const enemies = context.getLivingUnits(enemySide(owner.side)); if (!enemies.length) return;
  const available = tones.filter(tone => owner.statuses.some(status => status.statusId === availableToneStatus(tone)));
  const best = available.map(tone => ({ tone, score: tone === kinnaraIds.warmWind
    ? context.getLivingUnits(owner.side).filter(ally => ally.hp / Math.max(1, ally.stats.hp) < .8).length * 3
    : tone === kinnaraIds.clearFeather ? Math.max(0, 3 - (context.state.resources[owner.side]?.fire ?? 0)) * 2
      + context.getLivingUnits(owner.side).reduce((n, ally) => n + ally.statuses.filter(status => ['debuff', 'control'].includes(context.getStatusCategory(status.statusId) ?? '')).length, 0)
      : tone === kinnaraIds.palaceGlow ? context.getLivingUnits(owner.side).length * 2
        : tone === kinnaraIds.mountain ? enemies.length * 1.5 : 2 }))
    .sort((a, b) => b.score - a.score)[0]?.tone;
  if (best) return { actorId: unitId, skillId: best, targetIds: best === kinnaraIds.palace || best === kinnaraIds.mountain
    ? [enemies[0]!.unitId] : context.getLivingUnits(owner.side).map(ally => ally.unitId),
    shape: best === kinnaraIds.palace ? 'single' : best === kinnaraIds.mountain ? 'single' : 'all-allies',
    targetRelation: best === kinnaraIds.palace || best === kinnaraIds.mountain ? 'enemy' : 'ally' };
  if ((context.state.resources[owner.side]?.fire ?? 0) >= 3) return { actorId: unitId, skillId: kinnaraIds.ultimate,
    targetIds: [enemies[0]!.unitId], shape: 'single', targetRelation: 'enemy' };
  return { actorId: unitId, skillId: kinnaraIds.basic, targetIds: [enemies[0]!.unitId], shape: 'single', targetRelation: 'enemy' };
}

function hit(context: BattleContext, owner: Readonly<UnitState>, target: Readonly<UnitState>, sourceRef: SourceRef, ratio: number): EffectCommand {
  const attack = context.getEffectiveStats(owner.unitId) ?? owner.stats, defense = context.getEffectiveStats(target.unitId) ?? target.stats;
  const result = context.calculateDamage({ attack: attack.attack, defense: defense.defense, ratio,
    critChance: attack.crit, critDamage: attack.critDamage }, owner, target);
  return { type: 'deal-damage', source: sourceRef, targetId: target.unitId, amount: result.amount,
    ...(result.damageOptions ? { damageOptions: result.damageOptions } : {}), isCritical: result.isCritical };
}

function skillRank(unit: Readonly<UnitState>, skillId: string): number {
  return Math.max(1, Math.min(skillId === kinnaraIds.passive ? 6 : 5, unit.skillLevels?.[skillId] ?? unit.skillLevel));
}
function availableToneStatus(tone: string): string { return `${kinnaraIds.available}:${tone}`; }
function enemySide(side: UnitState['side']): UnitState['side'] { return side === 'blue' ? 'red' : 'blue'; }
function kinnaraSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
