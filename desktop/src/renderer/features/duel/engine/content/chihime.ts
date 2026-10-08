import type { HeroDefinition, SkillDefinition, StatusDefinition } from '../core/definitions';
import type { EffectCommand, SourceRef, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { createBasicAttackSkill } from './common-skills';
import { attemptControl } from '../mechanics/control';
import { createLineupDamageSkill, lineupIntent, lowestHealthEnemy } from './lineup-damage-skill';
import type { ContentRegistry } from './registry';

export const chihimeIds = { hero: 356, basic: '3561', dream: '3562', summon: '3563', release: '3564',
  halberd: 'status.hero.356.halberd', halberdImmunity: 'status.hero.356.halberd-immunity',
  halberdProtection: 'status.hero.356.halberd-protection',
  enemySkillGaugeTriggered: 'status.hero.356.enemy-skill-gauge-triggered',
  lament: 'status.hero.356.lament', tideSound: 'status.hero.356.tide-sound', tideDream: 'status.hero.356.tide-dream',
  deepFreeze: 'status.hero.356.deep-freeze', teamTideBonus: 'status.hero.356.tide-damage' } as const;

export function registerChihime(registry: ContentRegistry): void {
  const halberd: StatusDefinition = { id: chihimeIds.halberd, mechanicsCoverage: 'partial', category: 'other',
    dispellable: false, sealable: false, durationOwner: 'permanent', refreshPolicy: 'keep' };
  registry.registerStatus(halberd);
  registry.registerStatus({ id: chihimeIds.halberdImmunity, mechanicsCoverage: 'partial', category: 'buff', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'keep', controlProtection: 'immune' });
  registry.registerStatus({ id: chihimeIds.halberdProtection, mechanicsCoverage: 'partial', category: 'buff', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'keep', controlProtection: 'immune', statusImmunity: 'debuffs' });
  registry.registerStatus({ id: chihimeIds.enemySkillGaugeTriggered, mechanicsCoverage: 'partial', category: 'other', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'keep' });
  registry.registerStatus({ id: chihimeIds.tideSound, mechanicsCoverage: 'partial', category: 'mark', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'add-stack', maxStacks: 7 });
  registry.registerStatus({ id: chihimeIds.tideDream, mechanicsCoverage: 'partial', category: 'debuff', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerStatus({ id: chihimeIds.deepFreeze, mechanicsCoverage: 'partial', category: 'control', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace', preventsAction: true });
  registry.registerStatus({ id: chihimeIds.teamTideBonus, mechanicsCoverage: 'partial', category: 'buff', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'add-stack', maxStacks: 5 });
  registry.registerStatus({ id: chihimeIds.lament, mechanicsCoverage: 'partial', category: 'buff', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'add-stack', maxStacks: 5 });
  registry.registerHero(createChihimeDefinition());
}

function createChihimeDefinition(): HeroDefinition {
  const basicAttack = createBasicAttackSkill(chihimeIds.basic, [1, 1.05, 1.1, 1.2, 1.25]);
  const basic: SkillDefinition = { ...basicAttack, execute(context, intent, parameters) {
    const actor = context.getUnit(intent.actorId);
    const commands = [...basicAttack.execute(context, intent, parameters)];
    const halberdUnit = actor ? findHalberd(context, actor) : undefined;
    if (actor && halberdUnit && skillRank(actor, chihimeIds.basic) >= 5)
      commands.push(...gainTideSound(actor, halberdUnit, { kind: 'skill', id: chihimeIds.basic, unitId: actor.unitId }, 1));
    return commands;
  } };
  const dreamAttack = createLineupDamageSkill(chihimeIds.dream, [1.72, 1.85, 1.98, 2.11, 2.11], { cost: 2 });
  const dream: SkillDefinition = { ...dreamAttack, execute(context, intent, parameters) {
    const actor = context.getUnit(intent.actorId);
    const targetId = intent.targetIds[0];
    const commands: EffectCommand[] = [...dreamAttack.execute(context, intent, parameters)];
    if (!actor || !targetId || !isHalberdActive(context, actor)) return commands;
    const source = { kind: 'skill' as const, id: chihimeIds.dream, unitId: actor.unitId };
    commands.push({ type: 'add-status', source, targetId, instance: { instanceId: `${chihimeIds.tideDream}:${actor.unitId}:${targetId}`,
      statusId: chihimeIds.tideDream, source, stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' },
      values: { ownerUnitId: actor.unitId } } });
    return commands;
  } };
  const summon: SkillDefinition = { id: chihimeIds.summon, actionKind: 'skill', target: 'self', targetRelation: 'ally',
    canUse: (state, actor) => !hasHalberdInState(state, actor),
    levels: [{}, { damageReduction: .3 }, { damageReduction: .3 }, { damageReduction: .3 }, { damageReduction: .3 }],
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId); if (!actor) return [];
      const source = { kind: 'skill' as const, id: chihimeIds.summon, unitId: actor.unitId };
      const stats = context.getEffectiveStats(actor.unitId) ?? actor.stats;
      const summonId = `summon:chihime:${actor.unitId}:${context.state.counters.action + 1}`;
      const damageReduction = Number(parameters.damageReduction ?? 0);
      const protection: EffectCommand = { type: 'add-status', source, targetId: actor.unitId, instance: {
        instanceId: `${chihimeIds.halberd}:${actor.unitId}`, statusId: chihimeIds.halberd, source, stacks: 1,
        duration: { kind: 'permanent' }, values: { summonId },
        ...(damageReduction > 0 ? { modifiers: [{ stat: 'damageTaken' as const, operation: 'percent' as const,
          amount: -damageReduction }] } : {}) } };
      const summon: UnitState = { unitId: summonId, heroId: chihimeIds.hero, displayName: '海原贝戟',
        unitKind: 'summon', summonedByUnitId: actor.unitId,
        skillLevel: actor.skillLevel, ...(actor.skillLevels ? { skillLevels: actor.skillLevels } : {}), side: actor.side,
        stats: { ...stats, hp: Math.max(1, stats.attack * 5.5), attack: 0, speed: 0 }, hp: Math.max(1, stats.attack * 5.5),
        shield: 0, actionGauge: 0, statuses: [{ instanceId: `${chihimeIds.halberdProtection}:${summonId}`,
          statusId: chihimeIds.halberdProtection, source, stacks: 1, duration: { kind: 'permanent' },
          ...(damageReduction > 0 ? { modifiers: [{ stat: 'damageTaken' as const, operation: 'percent' as const,
            amount: -damageReduction }] } : {}) }], resources: {} };
      const commands: EffectCommand[] = [{ type: 'add-status', source, targetId: actor.unitId, instance: {
        ...protection.instance } }, { type: 'summon-unit', source, unit: summon }];
      commands.push({ type: 'remove-statuses', source, targetId: actor.unitId,
        statusIds: [chihimeIds.halberdImmunity], reason: 'consumed' });
      if (skillRank(actor, chihimeIds.summon) >= 5) commands.push(...gainTideSound(actor, summon, source, 3));
      return commands;
    } };
  const releaseDamage = createLineupDamageSkill(chihimeIds.release, [1.2, 1.2, 1.2, 1.2, 1.2], { cost: 2, target: 'all-enemies' });
  const release: SkillDefinition = { ...releaseDamage, execute(context, intent, parameters) {
    const actor = context.getUnit(intent.actorId); if (!actor) return [];
    const source = { kind: 'skill' as const, id: chihimeIds.release, unitId: actor.unitId };
    const lament = actor.statuses.find(status => status.statusId === chihimeIds.lament);
    const stacks = Math.max(1, Math.min(5, lament?.stacks ?? 1));
    const attack = releaseDamage.execute(context, intent, { ...parameters, ratio: 1.2 + stacks });
    const halberdUnit = findHalberd(context, actor);
    if (halberdUnit) return [...attack, { type: 'lose-life', source, targetId: halberdUnit.unitId, amount: halberdUnit.hp }];
    return [...attack, ...returnHalberd(actor, source)];
  }, canUse: (state, actor) => hasHalberdInState(state, actor) };
  return { id: chihimeIds.hero, skills: [basic, dream, summon, release], aiCoverage: 'partial',
    aiCoverageNotes: ['参考本地整理的社区 AI 规则：持戟时优先汐梦并选当前生命值最高的敌人；普攻优先选生命比例低于20%的敌人。释放潮声阈值仍按客户端数据的7层处理；目标策略尚无官方 AI 序列或配对实战记录验证'],
    mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['已按客户端行接入千汐等级倍率/五级普攻叠潮声、汐梦2火伤害与敌方非召唤回合末推千姬10%行动条/扣敌方3火/五级扣至0时深度冰冻及速度-20、海潮入梦召戟/5.5倍攻击生命/继承防御/二级起千姬与海原贝戟各30%减伤/三级起耗火必叠潮声/四级持戟免控放逐/五级召唤初始3层、海原贝戟免疫控制和减益、友方受击恢复30%而千姬自身50%、敌方施术每场首次推条30%、七层潮声返3火并永久给全队15%增伤至5层、永生之汐2火并按悲歌220%至620%攻击伤害及收戟。被动封印已抑制被动触发，召唤与收戟技能状态互斥。未以10点场帧验证；汐梦控制命中时窗、致命伤害后的恢复/阵亡处理、AI选择与御魂插入顺序、完整放逐移出与返回流程尚待帧核或引擎建模。'],
    handlers: {
      'action-end': { priority: 85, handle(context, event) {
        if (event.type !== 'action-ended' || event.actionKind !== 'skill' || !event.source.unitId) return;
        const enemy = context.getUnit(event.source.unitId);
        if (!enemy) return;
        const allies = context.getLivingUnits(enemy.side === 'blue' ? 'red' : 'blue')
          .filter(unit => unit.heroId === chihimeIds.hero && passivesEnabled(unit) && isHalberdActive(context, unit)
            && !unit.statuses.some(status => status.statusId === chihimeIds.enemySkillGaugeTriggered));
        return allies.flatMap(chihime => {
          const source = { kind: 'skill' as const, id: chihimeIds.summon, unitId: chihime.unitId };
          return [
            { type: 'add-status' as const, source, targetId: chihime.unitId, parentEventId: event.eventId,
              instance: { instanceId: `${chihimeIds.enemySkillGaugeTriggered}:${chihime.unitId}`,
                statusId: chihimeIds.enemySkillGaugeTriggered, source, stacks: 1, duration: { kind: 'permanent' } } },
            { type: 'change-action-gauge' as const, source, targetId: chihime.unitId, amount: 30, parentEventId: event.eventId },
          ];
        });
      } },
      hit: { priority: 125, handle(context, event) {
        if (event.type !== 'damage' || event.hpLost <= 0) return;
        const target = context.getUnit(event.targetId);
        if (!target || target.hp <= 0) return;
        const owners = context.getLivingUnits(target.side).filter(unit => unit.heroId === chihimeIds.hero
          && passivesEnabled(unit) && isHalberdActive(context, unit));
        return owners.map(owner => ({ type: 'restore-health' as const,
          source: { kind: 'skill' as const, id: chihimeIds.summon, unitId: owner.unitId },
          targetId: target.unitId, amount: event.hpLost * (target.unitId === owner.unitId ? .5 : .3), parentEventId: event.eventId }));
      } },
      'unit-defeated': { priority: 125, handle(context, event) {
        if (event.type !== 'unit-defeated') return;
        const summon = context.getUnit(event.unitId);
        const owner = summon?.summonedByUnitId ? context.getUnit(summon.summonedByUnitId) : undefined;
        if (!summon || summon.heroId !== chihimeIds.hero || summon.unitKind !== 'summon' || !owner
          || owner.heroId !== chihimeIds.hero
          || !owner.statuses.some(status => status.statusId === chihimeIds.halberd
            && status.values?.summonId === summon.unitId)) return;
        return returnHalberd(owner, { kind: 'skill', id: chihimeIds.summon, unitId: owner.unitId }, event.eventId, summon);
      } },
      'resource-payment': { priority: 85, handle(context, event) {
        if (event.type !== 'resource-changed' || event.resourceId !== 'fire' || event.before <= event.after) return;
        const payer = event.source.unitId ? context.getUnit(event.source.unitId) : undefined;
        if (!payer || payer.side !== event.side) return;
        const chihimes = context.getLivingUnits(event.side).filter(unit => unit.heroId === chihimeIds.hero
          && unit.unitKind !== 'summon' && passivesEnabled(unit) && findHalberd(context, unit));
        return chihimes.flatMap(chihime => {
          const halberdUnit = findHalberd(context, chihime);
          if (!halberdUnit) return [];
          const chance = skillRank(chihime, chihimeIds.summon) >= 3 ? 1 : .5;
          const spent = event.before - event.after;
          const gains = Array.from({ length: spent }, () => context.random() < chance ? 1 : 0)
            .reduce<number>((sum, value) => sum + value, 0);
          return gains > 0 ? gainTideSound(chihime, halberdUnit,
            { kind: 'skill', id: chihimeIds.summon, unitId: chihime.unitId }, gains, event.eventId) : [];
        });
      } },
      'turn-start': { priority: 80, handle(context, event) {
        if (event.type !== 'turn-started') return;
        const actor = context.getUnit(event.unitId);
        if (!actor || actor.heroId !== chihimeIds.hero || !passivesEnabled(actor) || !isHalberdActive(context, actor)) return;
        const source = { kind: 'skill' as const, id: chihimeIds.release, unitId: actor.unitId };
        return [{ type: 'add-status', source, targetId: actor.unitId, parentEventId: event.eventId,
          instance: { instanceId: `${chihimeIds.lament}:${actor.unitId}`, statusId: chihimeIds.lament, source, stacks: 1,
            duration: { kind: 'permanent' } } }];
      } },
      'turn-end': { priority: 85, handle(context, event) {
        if (event.type !== 'turn-ended') return;
        const target = context.getUnit(event.unitId);
        if (!target) return;
        const commands: EffectCommand[] = [];
        if (target.unitKind !== 'summon') {
          const chihimes = context.getLivingUnits(target.side === 'blue' ? 'red' : 'blue')
            .filter(unit => unit.heroId === chihimeIds.hero && passivesEnabled(unit));
          for (const chihime of chihimes) commands.push({ type: 'change-action-gauge',
            source: { kind: 'skill', id: chihimeIds.dream, unitId: chihime.unitId },
            targetId: chihime.unitId, amount: 10, parentEventId: event.eventId });
        }
        if (target.hp <= 0) return commands;
        const mark = target.statuses.find(status => status.statusId === chihimeIds.tideDream);
        const owner = mark?.values?.ownerUnitId;
        const chihime = typeof owner === 'string' ? context.getUnit(owner) : undefined;
        if (!mark || !chihime || target.side === chihime.side) return commands;
        const fire = context.state.resources[target.side]?.fire ?? 0;
        const source = { kind: 'skill' as const, id: chihimeIds.dream, unitId: chihime.unitId };
        commands.push({ type: 'remove-statuses', source, targetId: target.unitId, statusIds: [chihimeIds.tideDream],
          reason: 'consumed', parentEventId: event.eventId });
        if (!isHalberdActive(context, chihime)) return commands;
        commands.push({ type: 'change-resource', source, side: target.side, resourceId: 'fire',
          amount: -Math.min(3, fire), parentEventId: event.eventId });
        if (fire > 0 && fire <= 3 && target.unitKind !== 'monster' && skillRank(chihime, chihimeIds.dream) >= 5) {
          const control = attemptControl(context, { attemptId: `${chihimeIds.deepFreeze}:${event.eventId}`,
            source, targetId: target.unitId, statusId: chihimeIds.deepFreeze, controlType: '深度冰冻', baseChance: 1,
            duration: { kind: 'count', remaining: 1, owner: 'target-turn' },
            modifiers: [{ stat: 'speed', operation: 'flat', amount: -20 }], parentEventId: event.eventId });
          if (control) commands.push(control);
        }
        return commands;
      } },
    },
    policy(context, unitId) {
      const actor = context.getUnit(unitId); if (!actor || actor.hp <= 0) return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue'); if (!enemies.length) return undefined;
      if (actor.unitKind === 'summon') return undefined;
      const hasHalberd = isHalberdActive(context, actor);
      if (!hasHalberd) return lineupIntent(unitId, chihimeIds.summon, [unitId], 'self');
      const tideSound = findHalberd(context, actor)?.statuses.find(status => status.statusId === chihimeIds.tideSound)?.stacks ?? 0;
      if (tideSound >= 7 && (context.state.resources[actor.side]?.fire ?? 0) >= 2)
        return lineupIntent(unitId, chihimeIds.release, enemies.map(enemy => enemy.unitId), 'all-enemies');
      if ((context.state.resources[actor.side]?.fire ?? 0) >= 2) {
        const target = [...enemies].sort((left, right) => right.hp - left.hp || left.unitId.localeCompare(right.unitId))[0]!;
        return lineupIntent(unitId, chihimeIds.dream, [target.unitId], 'single');
      }
      const lowHealthTarget = enemies.filter(enemy => enemy.hp / Math.max(1, enemy.stats.hp) < .2)
        .sort((left, right) => left.hp / Math.max(1, left.stats.hp) - right.hp / Math.max(1, right.stats.hp)
          || left.unitId.localeCompare(right.unitId))[0];
      const target = lowHealthTarget ?? lowestHealthEnemy(context, actor)!;
      return lineupIntent(unitId, chihimeIds.basic, [target.unitId], 'single');
    },
    initialize(context, unitId) {
      const actor = context.getUnit(unitId);
      return actor && skillRank(actor, chihimeIds.summon) >= 4 ? [{ type: 'add-status', source: { kind: 'skill', id: chihimeIds.summon, unitId },
        targetId: unitId, instance: { instanceId: `${chihimeIds.halberdImmunity}:${unitId}`, statusId: chihimeIds.halberdImmunity,
          source: { kind: 'skill', id: chihimeIds.summon, unitId }, stacks: 1, duration: { kind: 'permanent' } } }] : [];
    },
    modifyOutgoingDamage(attacker, _target, amount, _kind, state) {
      const tideDamage = state.sides[attacker.side].map(unitId => state.units[unitId]).filter(unit => unit?.heroId === chihimeIds.hero)
        .reduce((total, unit) => total + (unit?.statuses.find(status => status.statusId === chihimeIds.teamTideBonus)?.stacks ?? 0), 0);
      return amount * (1 + .15 * Math.min(5, tideDamage));
    },
  };
}

function gainTideSound(chihime: Readonly<UnitState>, halberd: Readonly<UnitState>, source: SourceRef, requested: number,
  parentEventId?: string): EffectCommand[] {
  const current = halberd.statuses.find(status => status.statusId === chihimeIds.tideSound)?.stacks ?? 0;
  const gained = Math.min(Math.max(0, requested), 7 - current);
  if (gained <= 0) return [];
  const statusSource = { kind: 'skill' as const, id: chihimeIds.summon, unitId: chihime.unitId };
  const commands: EffectCommand[] = [{ type: 'add-status', source, targetId: halberd.unitId, ...(parentEventId ? { parentEventId } : {}),
    instance: { instanceId: `${chihimeIds.tideSound}:${halberd.unitId}`, statusId: chihimeIds.tideSound,
      source: statusSource, stacks: gained, duration: { kind: 'permanent' } } }];
  if (current < 7 && current + gained >= 7) {
    commands.push({ type: 'add-status', source, targetId: chihime.unitId, ...(parentEventId ? { parentEventId } : {}), instance: {
      instanceId: `${chihimeIds.teamTideBonus}:${chihime.unitId}`, statusId: chihimeIds.teamTideBonus,
      source: statusSource, stacks: 1, duration: { kind: 'permanent' } } });
    commands.push({ type: 'change-resource', source, side: chihime.side, resourceId: 'fire', amount: 3,
      ...(parentEventId ? { parentEventId } : {}) });
  }
  return commands;
}

function findHalberd(context: import('../core/types').BattleContext, owner: Readonly<UnitState>): UnitState | undefined {
  const marker = owner.statuses.find(status => status.statusId === chihimeIds.halberd);
  const id = marker?.values?.summonId;
  const summon = typeof id === 'string' ? context.getUnit(id) : undefined;
  if (summon && summon.hp > 0 && summon.unitKind === 'summon' && summon.summonedByUnitId === owner.unitId) return summon;
  // Temporary compatibility for old snapshots that stored only the holder marker.
  return marker && id === undefined ? owner as UnitState : undefined;
}

function isHalberdActive(context: import('../core/types').BattleContext, owner: Readonly<UnitState>): boolean {
  return findHalberd(context, owner) !== undefined;
}

function hasHalberdInState(state: import('../core/types').BattleState, owner: Readonly<UnitState>): boolean {
  const marker = owner.statuses.find(status => status.statusId === chihimeIds.halberd);
  const id = marker?.values?.summonId;
  const summon = typeof id === 'string' ? state.units[id] : undefined;
  return Boolean(summon && summon.hp > 0 && summon.unitKind === 'summon' && summon.summonedByUnitId === owner.unitId);
}

function returnHalberd(owner: Readonly<UnitState>, source: SourceRef, parentEventId?: string,
  halberd?: Readonly<UnitState>): EffectCommand[] {
  const commands: EffectCommand[] = [];
  if (halberd) commands.push({ type: 'remove-statuses', source, targetId: halberd.unitId,
    statusIds: [chihimeIds.halberdProtection, chihimeIds.tideSound], reason: 'consumed',
    ...(parentEventId ? { parentEventId } : {}) });
  commands.push({ type: 'remove-statuses', source, targetId: owner.unitId,
      statusIds: [chihimeIds.halberd, chihimeIds.tideSound, chihimeIds.lament], reason: 'consumed',
      ...(parentEventId ? { parentEventId } : {}) });
  if (skillRank(owner, chihimeIds.summon) >= 4) commands.push({ type: 'add-status', source, targetId: owner.unitId,
    instance: { instanceId: `${chihimeIds.halberdImmunity}:${owner.unitId}`, statusId: chihimeIds.halberdImmunity,
      source, stacks: 1, duration: { kind: 'permanent' } }, ...(parentEventId ? { parentEventId } : {}) });
  return commands;
}

function skillRank(unit: Readonly<UnitState>, skillId: string): number {
  const rank = unit.skillLevels?.[skillId];
  return Number.isFinite(rank) ? Math.max(1, Math.min(6, Math.floor(rank!))) : unit.skillLevel;
}
