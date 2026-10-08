import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, StatusInstance, UnitState } from '../core/types';
import { createBasicAttackSkill } from './common-skills';
import { attemptDebuff } from '../mechanics/control';
import type { ContentRegistry } from './registry';

export const cloudMirrorIds = {
  hero: 344,
  basic: '3444',
  yangBasic: '3441',
  flipYang: '3445',
  flipYin: '3442',
  yinSkill: '3446',
  yangSkill: '3443',
  form: 'status.hero.344.mirror-form',
  mirrorShield: 'status.hero.344.mirror-shield',
  mirrorAnger: 'status.hero.344.mirror-anger',
  mirrorBlessing: 'status.hero.344.mirror-blessing',
  mirrorBlessingUsed: 'status.hero.344.mirror-blessing-used',
  mirrorBlessingShield: 'status.hero.344.mirror-blessing-shield',
} as const;

const yinAttackRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const yangDefenseRatios = [2, 2.4, 2.8, 3.2, 3.6] as const;
const yinSkillRatios = [1.31, 1.35, 1.39, 1.45, 1.45] as const;

/** 云外镜 migration; mirror-blessing reactions and a few client-only targeting rules remain partial. */
export function registerCloudMirror(registry: ContentRegistry): void {
  registry.registerStatus({ id: cloudMirrorIds.form, mechanicsCoverage: 'partial', category: 'other', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace',
    healingConversionToShield: { ratio: .5, shieldStatusId: cloudMirrorIds.mirrorShield, duration: 2, durationOwner: 'target-turn' } });
  registry.registerStatus({ id: cloudMirrorIds.mirrorShield, mechanicsCoverage: 'partial', category: 'shield', dispellable: false,
    sealable: false, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerStatus({ id: 'status.hero.344.flip-speed', mechanicsCoverage: 'partial', category: 'buff', dispellable: true,
    sealable: false, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerStatus({ id: cloudMirrorIds.mirrorAnger, mechanicsCoverage: 'partial', category: 'debuff', dispellable: true,
    sealable: false, durationOwner: 'round', refreshPolicy: 'replace', blocksNextDispellableBuff: true });
  registry.registerStatus({ id: cloudMirrorIds.mirrorBlessing, mechanicsCoverage: 'partial', category: 'buff', dispellable: false,
    sealable: false, durationOwner: 'round', refreshPolicy: 'refresh-duration' });
  registry.registerStatus({ id: cloudMirrorIds.mirrorBlessingUsed, mechanicsCoverage: 'partial', category: 'other', dispellable: false,
    sealable: false, durationOwner: 'round', refreshPolicy: 'replace' });
  registry.registerStatus({ id: cloudMirrorIds.mirrorBlessingShield, mechanicsCoverage: 'partial', category: 'shield', dispellable: false,
    sealable: false, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerHero(createCloudMirrorDefinition());
}

export function createCloudMirrorDefinition(): HeroDefinition {
  const yinBasic = createBasicAttackSkill(cloudMirrorIds.basic, yinAttackRatios);
  const yangBasic: SkillDefinition = {
    id: cloudMirrorIds.yangBasic, target: 'single', targetRelation: 'enemy', levels: yangDefenseRatios.map(ratio => ({ ratio })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      const target = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || !target) return [];
      const defense = context.getEffectiveStats(actor.unitId)?.defense ?? actor.stats.defense;
      const source = { kind: 'skill' as const, id: cloudMirrorIds.yangBasic, unitId: actor.unitId };
      const commands: EffectCommand[] = [{ type: 'deal-damage', source, targetId: target.unitId,
        amount: defense * Number(parameters.ratio ?? 2) }];
      const ally = context.getLivingUnits(actor.side).filter(unit => unit.unitId !== actor.unitId)
        .sort((a, b) => b.actionGauge - a.actionGauge)[0];
      if (ally) commands.push({ type: 'change-action-gauge', source, targetId: ally.unitId, amount: 20 });
      return commands;
    },
  };
  const flipYang = createFlipSkill(cloudMirrorIds.flipYang, 'yang');
  const flipYin = createFlipSkill(cloudMirrorIds.flipYin, 'yin');
  const yinSkill: SkillDefinition = {
    id: cloudMirrorIds.yinSkill, resourceCost: { resourceId: 'fire', amount: 3 }, target: 'all-enemies', targetRelation: 'enemy',
    levels: yinSkillRatios.map(ratio => ({ ratio })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      if (!actor) return [];
      const attack = context.getEffectiveStats(actor.unitId)?.attack ?? actor.stats.attack;
      const source = { kind: 'skill' as const, id: cloudMirrorIds.yinSkill, unitId: actor.unitId };
      const form = actor.statuses.find(status => status.statusId === cloudMirrorIds.form);
      const yinHp = Number(form?.values?.yinHp ?? actor.stats.hp / 2);
      const yinMax = Math.max(1, Number(form?.values?.yinMax ?? actor.stats.hp / 2));
      const followUps = skillRank(actor, cloudMirrorIds.yinSkill) >= 5
        ? Math.min(3, Math.floor((1 - yinHp / yinMax + 1e-7) / .3)) : 0;
      const commands: EffectCommand[] = [];
      for (const targetId of intent.targetIds) {
        const target = context.getUnit(targetId);
        if (!target) continue;
        commands.push({ type: 'deal-damage', source, targetId, amount: attack * Number(parameters.ratio ?? 1.31) });
        commands.push(...attemptDebuff(context, { source, targetId, statusId: cloudMirrorIds.mirrorAnger, baseChance: 1,
          duration: { kind: 'count', remaining: 1, owner: 'round' } }));
      }
      const lotusTargetId = intent.targetIds.find(targetId => (context.getUnit(targetId)?.hp ?? 0) > 0);
      const lotusTarget = lotusTargetId && context.getUnit(lotusTargetId);
      if (lotusTarget) for (let index = 0; index < 1 + followUps; index++) {
        commands.push({ type: 'deal-damage', source, targetId: lotusTarget.unitId, amount: attack * Number(parameters.ratio ?? 1.31) });
      }
      return commands;
    },
  };
  const yangSkill: SkillDefinition = {
    id: cloudMirrorIds.yangSkill, resourceCost: { resourceId: 'fire', amount: 3 }, target: 'single', targetRelation: 'ally',
    resolveResourceCost(_state, actor) {
      return { resourceId: 'fire', amount: yangSkillCost(actor) };
    },
    levels: [{}, {}, {}, {}, {}],
    execute(context, intent) {
      const actor = context.getUnit(intent.actorId);
      const target = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || !target) return [];
      const source = { kind: 'skill' as const, id: cloudMirrorIds.yangSkill, unitId: actor.unitId };
      const blessed = context.getLivingUnits(actor.side)
        .filter(ally => ally.statuses.some(status => status.statusId === cloudMirrorIds.mirrorBlessing)).length;
      const commands: EffectCommand[] = [];
      if (!actor.statuses.some(status => status.statusId === cloudMirrorIds.mirrorBlessing))
        commands.push({ type: 'add-status', source, targetId: actor.unitId, instance: blessing(actor, source, actor) });
      if (target.unitId !== actor.unitId && !target.statuses.some(status => status.statusId === cloudMirrorIds.mirrorBlessing)
        && blessed < 2)
        commands.push({ type: 'add-status', source, targetId: target.unitId, instance: blessing(target, source, actor) });
      else if (target.unitId !== actor.unitId && target.statuses.some(status => status.statusId === cloudMirrorIds.mirrorBlessing))
        commands.push(blessingShield(actor, target, source));
      for (const ally of context.getLivingUnits(actor.side)) commands.push({ type: 'change-action-gauge', source,
        targetId: ally.unitId, amount: 20 });
      return commands;
    },
  };
  return {
    id: cloudMirrorIds.hero,
    skills: [yinBasic, yangBasic, flipYang, flipYin, yinSkill, yangSkill],
    aiCoverage: 'partial', mechanicsCoverage: 'partial',
    initialize(context, unitId) {
      const unit = context.getUnit(unitId);
      if (!unit) return [];
      const half = unit.stats.hp / 2;
      // The client passive defaults to Yin (3447 param1=1); the corresponding Yang
      // override is a separate client parameter and is not part of the lineup export.
      const startsYang = false;
      const source = { kind: 'skill' as const, id: cloudMirrorIds.flipYang, unitId };
      const form: StatusInstance = { instanceId: `${cloudMirrorIds.form}:${unitId}`, statusId: cloudMirrorIds.form, source, stacks: 1,
        duration: { kind: 'permanent' },
      values: { form: startsYang ? 'yang' : 'yin', yinHp: half, yangHp: half, yinMax: half, yangMax: half,
        flipCount: 0, flipCost: 0 } };
      return [
        { type: 'lose-life', source, targetId: unitId, amount: half },
        { type: 'add-status', source, targetId: unitId, instance: form },
        shieldCommand(unit, unit.stats.defense * 6.8, source),
      ];
    },
    handlers: {
      hit: { priority: 10, handle(context, event) {
        if (event.type !== 'damage') return;
        const target = context.getUnit(event.targetId);
        const form = target?.statuses.find(status => status.statusId === cloudMirrorIds.form);
        if (!target || target.heroId !== cloudMirrorIds.hero || !form || event.hpAfter === undefined) return;
        const active = form.values?.form === 'yang' ? 'yangHp' : 'yinHp';
        return [updateLifePool(target, form, event.hpAfter, event.eventId)];
      } },
      'effect-resolution': { priority: 10, handle(context, event) {
        if (event.type === 'status-added') return mirrorBlessingTriggered(context, event);
        if (event.type === 'status-removed' && event.statusId === cloudMirrorIds.mirrorBlessing)
          return mirrorBlessingLost(context, event);
        if (event.type !== 'healing' && event.type !== 'health-restored' && event.type !== 'life-lost') return;
        const target = context.getUnit(event.targetId);
        const form = target?.statuses.find(status => status.statusId === cloudMirrorIds.form);
        if (!target || target.heroId !== cloudMirrorIds.hero || !form) return;
        return [updateLifePool(target, form, target.hp, event.eventId)];
      } },
      'status-expiration': { priority: 10, handle(context, event) {
        if (event.type === 'status-removed' && event.statusId === cloudMirrorIds.mirrorBlessing)
          return mirrorBlessingLost(context, event);
      } },
    },
    policy(context, unitId): ActionIntent | undefined {
      const actor = context.getUnit(unitId);
      if (!actor) return undefined;
      const form = actor.statuses.find(status => status.statusId === cloudMirrorIds.form)?.values?.form;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (form === 'yang') {
        const allied = context.getLivingUnits(actor.side).find(ally => ally.unitId !== actor.unitId) ?? actor;
        const skill = context.state.resources[actor.side]?.fire ?? 0;
        if (skill >= yangSkillCost(actor)) return { actorId: unitId, skillId: cloudMirrorIds.yangSkill, targetIds: [allied.unitId], shape: 'single', targetRelation: 'ally' };
        return { actorId: unitId, skillId: cloudMirrorIds.yangBasic, targetIds: [enemies[0]?.unitId ?? ''], shape: 'single', targetRelation: 'enemy' };
      }
      if ((context.state.resources[actor.side]?.fire ?? 0) >= 3 && enemies.length > 0) return {
        actorId: unitId, skillId: cloudMirrorIds.yinSkill, targetIds: enemies.map(enemy => enemy.unitId), shape: 'all-enemies', targetRelation: 'enemy',
      };
      if (enemies.length > 0) return { actorId: unitId, skillId: cloudMirrorIds.basic, targetIds: [enemies[0]!.unitId], shape: 'single', targetRelation: 'enemy' };
      return undefined;
    },
  };
}

function createFlipSkill(id: string, targetForm: 'yin' | 'yang'): SkillDefinition {
  return {
    id, target: 'self', targetRelation: 'ally', levels: [{}, {}, {}, {}, {}],
    resolveResourceCost(_state, actor) {
      const form = actor.statuses.find(status => status.statusId === cloudMirrorIds.form);
      return { resourceId: 'fire', amount: Math.max(0, Number(form?.values?.flipCost ?? 0)) };
    },
    execute(context, intent) {
      const actor = context.getUnit(intent.actorId);
      const form = actor?.statuses.find(status => status.statusId === cloudMirrorIds.form);
      if (!actor || !form) return [];
      const currentForm = form.values?.form === 'yang' ? 'yang' : 'yin';
      if (currentForm === targetForm) return [];
      const targetHp = Number(form.values?.[targetForm === 'yang' ? 'yangHp' : 'yinHp'] ?? actor.stats.hp / 2);
      const delta = targetHp - actor.hp;
      const source = { kind: 'skill' as const, id, unitId: actor.unitId };
      const next: StatusInstance = { ...form, values: { ...form.values, form: targetForm,
        flipCount: Number(form.values?.flipCount ?? 0) + 1, flipCost: Number(form.values?.flipCost ?? 0) + 2 } };
      const nextForm = next;
      const commands: EffectCommand[] = [{ type: 'add-status', source, targetId: actor.unitId, instance: nextForm }];
      if (delta > 0) commands.push({ type: 'heal', source, targetId: actor.unitId, amount: delta });
      else if (delta < 0) commands.push({ type: 'lose-life', source, targetId: actor.unitId, amount: -delta });
      commands.push({ type: 'add-status', source, targetId: actor.unitId, instance: { instanceId: `status.hero.344.flip-speed:${actor.unitId}`,
        statusId: `status.hero.344.flip-speed`, source, stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' },
        modifiers: [{ stat: 'speed', operation: 'flat', amount: 100 }] } },
      { type: 'remove-statuses', source, targetId: actor.unitId, statusIds: [cloudMirrorIds.mirrorShield], reason: 'replaced' },
      shieldCommand(actor, actor.stats.defense * 6.8, source));
      if (targetForm === 'yang') commands.push({ type: 'add-status', source, targetId: actor.unitId, instance: blessing(actor, source, actor) });
      if (targetForm === 'yin') {
        for (const ally of context.getLivingUnits(actor.side)) commands.push({ type: 'remove-statuses', source, targetId: ally.unitId,
          statusIds: [cloudMirrorIds.mirrorBlessing], reason: 'consumed' });
      }
      return commands;
    },
  };
}

function shieldCommand(unit: Readonly<UnitState>, amount: number, source: StatusInstance['source']): EffectCommand {
  return { type: 'add-status', source, targetId: unit.unitId, instance: { instanceId: `${cloudMirrorIds.mirrorShield}:${unit.unitId}`,
    statusId: cloudMirrorIds.mirrorShield, source, stacks: 1, duration: { kind: 'count', remaining: 2, owner: 'target-turn' },
    values: { shieldRemaining: amount } } };
}

function blessing(unit: Readonly<UnitState>, source: StatusInstance['source'], owner: Readonly<UnitState>): StatusInstance {
  return { instanceId: `${cloudMirrorIds.mirrorBlessing}:${unit.unitId}`, statusId: cloudMirrorIds.mirrorBlessing, source,
    stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'round' },
    values: { healDefenseRatio: skillRank(owner, cloudMirrorIds.yangSkill) >= 2 ? 4.8 : 2.4,
      actionGaugeRatio: skillRank(owner, cloudMirrorIds.yangSkill) >= 4 ? .2 : .1,
      dispelCount: skillRank(owner, cloudMirrorIds.yangSkill) >= 3 ? 2 : 1 } };
}

function skillRank(unit: Readonly<UnitState>, skillId: string): number {
  return Math.max(1, Math.min(5, unit.skillLevels?.[skillId] ?? unit.skillLevel));
}

function yangSkillCost(actor: Readonly<UnitState>): number {
  if (skillRank(actor, cloudMirrorIds.yangSkill) < 5) return 3;
  const form = actor.statuses.find(status => status.statusId === cloudMirrorIds.form);
  const hp = Number(form?.values?.yangHp ?? actor.stats.hp / 2);
  const max = Math.max(1, Number(form?.values?.yangMax ?? actor.stats.hp / 2));
  const reductions = Math.min(3, Math.floor((1 - hp / max + 1e-7) / .3));
  return Math.max(0, 3 - reductions);
}

function updateLifePool(unit: Readonly<UnitState>, form: StatusInstance, hp: number, parentEventId: string): EffectCommand {
  const active = form.values?.form === 'yang' ? 'yangHp' : 'yinHp';
  return { type: 'add-status', source: form.source, targetId: unit.unitId, parentEventId, instance: { ...form,
    values: { ...form.values, [active]: hp } } };
}

function mirrorBlessingTriggered(context: BattleContext,
  event: Extract<BattleEvent, { type: 'status-added' }>): EffectCommand[] | undefined {
  const category = context.getStatusCategory(event.instance.statusId);
  if (category !== 'debuff' && category !== 'control') return;
  const target = context.getUnit(event.targetId);
  if (!target) return;
  const blessingStatus = target.statuses.find(status => status.statusId === cloudMirrorIds.mirrorBlessing);
  const owner = blessingStatus?.source.unitId ? context.getUnit(blessingStatus.source.unitId) : undefined;
  if (!blessingStatus || !owner || owner.heroId !== cloudMirrorIds.hero
    || !context.getUnit(owner.unitId)) return;
  if (target.statuses.some(status => status.statusId === cloudMirrorIds.mirrorBlessingUsed)) return;
  const source = blessingStatus.source;
  const rank = skillRank(owner, cloudMirrorIds.yangSkill);
  const lowAlly = [...context.getLivingUnits(owner.side)].sort((a, b) => a.hp / a.stats.hp - b.hp / b.stats.hp)[0];
  const commands: EffectCommand[] = [{ type: 'add-status', source, targetId: target.unitId, instance: {
    instanceId: `${cloudMirrorIds.mirrorBlessingUsed}:${target.unitId}`, statusId: cloudMirrorIds.mirrorBlessingUsed,
    source, stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'round' },
  } }, { type: 'dispel-statuses', source, targetId: target.unitId,
    maxCount: rank >= 3 ? 2 : 1, filter: 'debuff-or-control', parentEventId: event.eventId },
  { type: 'change-action-gauge', source, targetId: owner.unitId,
    amount: rank >= 4 ? 20 : 10, parentEventId: event.eventId }];
  if (lowAlly) commands.push({ type: 'heal', source, targetId: lowAlly.unitId,
    amount: (context.getEffectiveStats(owner.unitId)?.defense ?? owner.stats.defense) * (rank >= 2 ? 4.8 : 2.4),
    parentEventId: event.eventId });
  return commands;
}

function mirrorBlessingLost(context: BattleContext,
  event: Extract<BattleEvent, { type: 'status-removed' }>): EffectCommand[] | undefined {
  const owner = event.removedSource?.unitId ? context.getUnit(event.removedSource.unitId) : undefined;
  const target = context.getUnit(event.targetId);
  if (!owner || owner.heroId !== cloudMirrorIds.hero || !target) return;
  const source = event.removedSource!;
  return [blessingShield(owner, target, source)];
}

function blessingShield(owner: Readonly<UnitState>, target: Readonly<UnitState>, source: StatusInstance['source']): EffectCommand {
  return { type: 'add-status', source, targetId: target.unitId, instance: {
    instanceId: `${cloudMirrorIds.mirrorBlessingShield}:${owner.unitId}:${target.unitId}`,
    statusId: cloudMirrorIds.mirrorBlessingShield, source, stacks: 1,
    duration: { kind: 'count', remaining: 2, owner: 'target-turn' },
    values: { shieldRemaining: owner.stats.attack * .6 },
  } };
}
