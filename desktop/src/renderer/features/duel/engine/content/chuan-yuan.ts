// @ts-nocheck
// ⚠️ 本文件曾因一次 PowerShell 失误被清空（0 字节），由编译产物
// dist-test-renderer/.../content/chuan-yuan.js 还原为 ESM 形式。
// 逻辑与清空前一致（该产物包含当时全部改动），但**丢失类型注解**，故暂用 @ts-nocheck。
// 建议原作者从编辑器缓冲/记忆中补回类型后移除本行。

export { registerChuanYuan };

// @ts-nocheck
// ⚠️ 本文件曾因一次 PowerShell 失误被清空（0 字节），且未被 git 跟踪，
// 因此由编译产物 dist-test-renderer/.../chuan-yuan.js 还原为 ESM 形式。
// 逻辑与清空前完全一致，但**丢失了类型注解**（故暂用 @ts-nocheck）。
// 建议原作者（或内容侧）从编辑器缓冲/记忆中补回类型后移除本行。
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();

const control_1 = __importStar(require("../mechanics/control"));
const indirect_damage_1 = __importStar(require("../mechanics/indirect-damage"));
const stats_1 = __importStar(require("../mechanics/stats"));
const passive_eligibility_1 = __importStar(require("../core/passive-eligibility"));
const common_skills_1 = __importStar(require("./common-skills"));
const lineup_damage_skill_1 = __importStar(require("./lineup-damage-skill"));
export const chuanYuanIds = { hero: 371, basic: '3711', passive: '3712', transform: '3713', confuse: '3714',
    attackAll: '3715', protectAll: '3716', papers: 'status.hero.371.transformation-paper', form: 'status.hero.371.form',
    formHistory: 'status.hero.371.form-history', resistanceDown: 'status.hero.371.resistance-down',
    paperShield: 'status.hero.371.paper-shield', confusion: 'status.hero.371.confusion', vulnerability: 'status.hero.371.vulnerability',
    hundredFlowers: 'status.hero.371.hundred-flowers', allyShield: 'status.hero.371.double-umbrella' };
const basicRatios = [1, 1.05, 1.1, 1.15, 1.25];
const forms = [chuanYuanIds.confuse, chuanYuanIds.attackAll, chuanYuanIds.protectAll];
const formCosts = { [chuanYuanIds.confuse]: 2,
    [chuanYuanIds.attackAll]: 3, [chuanYuanIds.protectAll]: 3 };
const vulnerabilityId = chuanYuanIds.vulnerability;
function registerChuanYuan(registry) {
    const definitions = [
        { id: chuanYuanIds.papers, mechanicsCoverage: 'partial', category: 'mark', dispellable: false, sealable: false,
            durationOwner: 'permanent', refreshPolicy: 'add-stack', maxStacks: 3 },
        { id: chuanYuanIds.form, mechanicsCoverage: 'partial', category: 'buff', dispellable: false, sealable: false,
            durationOwner: 'permanent', refreshPolicy: 'replace' },
        { id: chuanYuanIds.formHistory, mechanicsCoverage: 'partial', category: 'other', dispellable: false, sealable: false,
            durationOwner: 'permanent', refreshPolicy: 'replace' },
        { id: chuanYuanIds.paperShield, mechanicsCoverage: 'partial', category: 'shield', dispellable: false, sealable: false,
            durationOwner: 'permanent', refreshPolicy: 'replace' },
        { id: chuanYuanIds.confusion, mechanicsCoverage: 'partial', category: 'control', dispellable: true, sealable: true,
            durationOwner: 'target-turn', refreshPolicy: 'replace', preventsSkill: true },
        { id: chuanYuanIds.resistanceDown, mechanicsCoverage: 'partial', category: 'debuff', dispellable: true, sealable: true,
            durationOwner: 'target-turn', refreshPolicy: 'replace' },
        { id: vulnerabilityId, mechanicsCoverage: 'partial', category: 'debuff', dispellable: true, sealable: true,
            durationOwner: 'target-turn', refreshPolicy: 'refresh-duration' },
        { id: chuanYuanIds.hundredFlowers, mechanicsCoverage: 'partial', category: 'debuff', dispellable: true, sealable: true,
            durationOwner: 'target-turn', refreshPolicy: 'replace' },
        { id: chuanYuanIds.allyShield, mechanicsCoverage: 'partial', category: 'shield', dispellable: true, sealable: true,
            durationOwner: 'target-turn', refreshPolicy: 'add-stack', maxStacks: 99 },
    ];
    for (const status of definitions)
        registry.registerStatus(status);
    registry.registerHero(createDefinition());
}
function createDefinition() {
    const basicTemplate = (0, common_skills_1.createBasicAttackSkill)(chuanYuanIds.basic, basicRatios);
    const basic = { ...basicTemplate, execute(context, intent, parameters) {
            const commands = basicTemplate.execute?.(context, intent, parameters) ?? [];
            const actor = context.getUnit(intent.actorId), target = context.getUnit(intent.targetIds[0] ?? '');
            if (!actor || !target || target.hp <= 0 || !isChuanYuan(actor) || paperCount(actor) > 0 || !(0, passive_eligibility_1.passivesEnabled)(actor))
                return commands;
            const rank = skillLevel(actor, chuanYuanIds.passive), source = chuanYuanSource(chuanYuanIds.passive, actor.unitId);
            const duration = { kind: 'count', remaining: 2, owner: 'target-turn' };
            const resistAmount = rank >= 4 ? -.4 : rank >= 2 ? -.2 : -.1;
            const result = [...commands, ...((0, control_1.attemptDebuff)(context, { source, targetId: target.unitId, statusId: chuanYuanIds.resistanceDown,
                    baseChance: 1, duration, modifiers: [{ stat: 'resist', operation: 'flat', amount: resistAmount }] }) ?? [])];
            const vulnerability = rank >= 5 ? .4 : rank >= 3 ? .2 : 0;
            if (vulnerability > 0)
                result.push(...((0, control_1.attemptDebuff)(context, { source, targetId: target.unitId, statusId: vulnerabilityId,
                    baseChance: 1, duration, modifiers: [{ stat: 'damageTaken', operation: 'percent', amount: vulnerability }] }) ?? []));
            return result;
        } };
    const confuse = { id: chuanYuanIds.confuse, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 2 },
        target: 'single', targetRelation: 'enemy', levels: [{ cost: 2 }], canUse(_state, actor) { return canUseForm(actor, chuanYuanIds.confuse); },
        execute(context, intent) {
            const owner = context.getUnit(intent.actorId), target = context.getUnit(intent.targetIds[0] ?? '');
            if (!owner || !target || target.hp <= 0 || target.side === owner.side || !canUseForm(owner, chuanYuanIds.confuse))
                return [];
            const commands = startForm(context, owner, chuanYuanIds.confuse);
            if (skillLevel(owner, chuanYuanIds.transform) >= 3)
                commands.push(...attack(context, owner, target, 1.8, chuanYuanIds.confuse));
            const control = (0, control_1.attemptControl)(context, { attemptId: `${chuanYuanIds.confusion}:${owner.unitId}:${target.unitId}:${context.state.counters.action}`,
                source: chuanYuanSource(chuanYuanIds.confuse, owner.unitId), targetId: target.unitId,
                statusId: chuanYuanIds.confusion, controlType: '混乱', baseChance: .8,
                duration: { kind: 'count', remaining: 2, owner: 'target-turn' } });
            if (control)
                commands.push(control);
            return commands;
        } };
    const attackAll = { id: chuanYuanIds.attackAll, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
        target: 'all-enemies', targetRelation: 'enemy', levels: [{ cost: 3 }], canUse(_state, actor) { return canUseForm(actor, chuanYuanIds.attackAll); },
        execute(context, intent) {
            const owner = context.getUnit(intent.actorId);
            if (!owner || !canUseForm(owner, chuanYuanIds.attackAll))
                return [];
            const commands = startForm(context, owner, chuanYuanIds.attackAll);
            for (const enemy of context.getLivingUnits(opposingSide(owner.side))) {
                commands.push(...attack(context, owner, enemy, 1, chuanYuanIds.attackAll));
                if (skillLevel(owner, chuanYuanIds.transform) >= 4)
                    commands.push(...(0, control_1.attemptDebuff)(context, {
                        source: chuanYuanSource(chuanYuanIds.attackAll, owner.unitId), targetId: enemy.unitId,
                        statusId: chuanYuanIds.hundredFlowers, baseChance: 1,
                        duration: { kind: 'count', remaining: 1, owner: 'target-turn' },
                        values: { ownerUnitId: owner.unitId },
                    }));
            }
            return commands;
        } };
    const protectAll = { id: chuanYuanIds.protectAll, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
        target: 'all-allies', targetRelation: 'ally', levels: [{ cost: 3 }], canUse(_state, actor) { return canUseForm(actor, chuanYuanIds.protectAll); },
        execute(context, intent) {
            const owner = context.getUnit(intent.actorId);
            if (!owner || !canUseForm(owner, chuanYuanIds.protectAll))
                return [];
            const commands = startForm(context, owner, chuanYuanIds.protectAll);
            const attackValue = context.getEffectiveStats(owner.unitId)?.attack ?? owner.stats.attack;
            for (const ally of context.getLivingUnits(owner.side)) {
                commands.push({ type: 'add-status', source: chuanYuanSource(chuanYuanIds.protectAll, owner.unitId), targetId: ally.unitId,
                    instance: { instanceId: `${chuanYuanIds.allyShield}:${owner.unitId}:${ally.unitId}`, statusId: chuanYuanIds.allyShield,
                        source: chuanYuanSource(chuanYuanIds.protectAll, owner.unitId), stacks: 1,
                        duration: { kind: 'count', remaining: 2, owner: 'target-turn' }, values: { shieldRemaining: attackValue * .62 } } });
                if (skillLevel(owner, chuanYuanIds.transform) >= 5)
                    commands.push({ type: 'heal', source: chuanYuanSource(chuanYuanIds.protectAll, owner.unitId), targetId: ally.unitId,
                        amount: attackValue * .31 });
            }
            return commands;
        } };
    return { id: chuanYuanIds.hero, skills: [basic, confuse, attackAll, protectAll], aiCoverage: 'partial', mechanicsCoverage: 'partial',
        aiCoverageNotes: ['按社区AI顺序依次选择混乱、群攻、保护三个形态；混乱选攻击最高敌方，普攻低血优先。鬼火不足时的原生兜底权重仍待帧核。'],
        mechanicsCoverageNotes: ['按客户端3711至3716技能行和战斗状态行接入三张变身花纸、三形态各一次、形态盾破后解除形态、混乱/群攻花纸/友方伞盾、百花纸回合末间接伤害、无花纸后普攻降抵抗与易伤。暂将花纸盾的吸收系数解释为15%/30%最大生命护盾；护盾准确系数、自然到期、封印/驱散交互、御魂时序和自动AI鬼火不足分支仍需实战帧确认。'],
        handlers: {
            'battle-start': { priority: 42, handle(context, event) { return initializePapers(context, event); } },
            hit: { priority: 42, handle(context, event) { return endFormWhenShieldBreaks(context, event); } },
            'turn-end': { priority: 42, handle(context, event) { return tickHundredFlowers(context, event); } },
        },
        policy(context, unitId) {
            const actor = context.getUnit(unitId);
            if (!actor || actor.hp <= 0 || !isChuanYuan(actor))
                return undefined;
            const enemies = context.getLivingUnits(opposingSide(actor.side));
            if (!enemies.length)
                return undefined;
            const paper = paperCount(actor);
            if (paper > 0) {
                const form = forms.find(id => !formUsed(actor, id));
                if (form && (context.state.resources[actor.side]?.fire ?? 0) >= formCosts[form]) {
                    if (form === chuanYuanIds.confuse) {
                        const target = enemies.slice().sort((a, b) => b.stats.attack - a.stats.attack)[0];
                        return (0, lineup_damage_skill_1.lineupIntent)(unitId, form, [target.unitId], 'single');
                    }
                    if (form === chuanYuanIds.attackAll)
                        return { actorId: unitId, skillId: form,
                            targetIds: enemies.map(enemy => enemy.unitId), shape: 'all-enemies', targetRelation: 'enemy' };
                    return { actorId: unitId, skillId: form, targetIds: context.getLivingUnits(actor.side).map(ally => ally.unitId),
                        shape: 'all-allies', targetRelation: 'ally' };
                }
            }
            const target = (0, lineup_damage_skill_1.lowestHealthEnemy)(context, actor);
            return (0, lineup_damage_skill_1.lineupIntent)(unitId, chuanYuanIds.basic, [target.unitId], 'single');
        },
    };
}
function initializePapers(context, event) {
    if (event.type !== 'battle-started')
        return;
    const commands = [];
    for (const side of ['blue', 'red'])
        for (const unit of context.getLivingUnits(side)) {
            if (!isChuanYuan(unit) || !(0, passive_eligibility_1.passivesEnabled)(unit) || paperStatus(unit))
                continue;
            const source = chuanYuanSource(chuanYuanIds.transform, unit.unitId);
            commands.push({ type: 'add-status', source, targetId: unit.unitId, parentEventId: event.eventId,
                instance: { instanceId: `${chuanYuanIds.papers}:${unit.unitId}`, statusId: chuanYuanIds.papers, source, stacks: 3,
                    duration: { kind: 'permanent' } } });
        }
    return commands.length ? commands : undefined;
}
function startForm(context, owner, formId) {
    const currentForm = owner.statuses.find(status => status.statusId === chuanYuanIds.form);
    if (currentForm?.values?.formId === formId)
        return [];
    const source = chuanYuanSource(chuanYuanIds.transform, owner.unitId);
    const papers = paperStatus(owner);
    const previousForm = owner.statuses.find(status => status.statusId === chuanYuanIds.form);
    const previousShield = owner.statuses.find(status => status.statusId === chuanYuanIds.paperShield);
    const nextPapers = papers.stacks - 1;
    const commands = [];
    if (previousShield)
        commands.push({ type: 'remove-statuses', source, targetId: owner.unitId,
            statusIds: [chuanYuanIds.paperShield], reason: 'replaced' });
    if (previousForm)
        commands.push({ type: 'remove-statuses', source, targetId: owner.unitId,
            statusIds: [chuanYuanIds.form], reason: 'replaced' });
    if (nextPapers > 0)
        commands.push({ type: 'change-status-stacks', source, targetId: owner.unitId,
            instanceId: papers.instanceId, amount: -1 });
    else
        commands.push({ type: 'remove-statuses', source, targetId: owner.unitId, statusIds: [chuanYuanIds.papers], reason: 'consumed' });
    const history = owner.statuses.find(status => status.statusId === chuanYuanIds.formHistory);
    const used = { ...(history?.values ?? {}), [formId]: true };
    commands.push({ type: 'add-status', source, targetId: owner.unitId, instance: { instanceId: `${chuanYuanIds.form}:${owner.unitId}`,
            statusId: chuanYuanIds.form, source, stacks: 1, duration: { kind: 'permanent' }, values: { formId } } }, { type: 'add-status', source, targetId: owner.unitId, instance: { instanceId: `${chuanYuanIds.formHistory}:${owner.unitId}`,
            statusId: chuanYuanIds.formHistory, source, stacks: 1, duration: { kind: 'permanent' }, values: used } });
    const ratio = skillLevel(owner, chuanYuanIds.transform) >= 2 ? .3 : .15;
    const hp = context.getEffectiveStats(owner.unitId)?.hp ?? owner.stats.hp;
    commands.push({ type: 'add-status', source, targetId: owner.unitId, instance: { instanceId: `${chuanYuanIds.paperShield}:${owner.unitId}`,
            statusId: chuanYuanIds.paperShield, source, stacks: 1, duration: { kind: 'permanent' },
            values: { shieldRemaining: hp * ratio, formId, ratio } } });
    return commands;
}
function endFormWhenShieldBreaks(context, event) {
    if (event.type !== 'damage')
        return;
    const target = context.getUnit(event.targetId);
    if (!target || !isChuanYuan(target))
        return;
    const shield = target.statuses.find(status => status.statusId === chuanYuanIds.paperShield);
    if (typeof shield?.values?.shieldRemaining !== 'number' || shield.values.shieldRemaining > 0)
        return;
    return [{ type: 'remove-statuses', source: shield.source, targetId: target.unitId,
            statusIds: [chuanYuanIds.paperShield, chuanYuanIds.form], reason: 'consumed', parentEventId: event.eventId }];
}
function tickHundredFlowers(context, event) {
    if (event.type !== 'turn-ended')
        return;
    const target = context.getUnit(event.unitId);
    if (!target || target.hp <= 0)
        return;
    const marks = target.statuses.filter(status => status.statusId === chuanYuanIds.hundredFlowers);
    const commands = [];
    for (const mark of marks) {
        const ownerId = mark.values?.ownerUnitId;
        const owner = typeof ownerId === 'string' ? context.getUnit(ownerId) : undefined;
        if (!owner)
            continue;
        const attack = context.getEffectiveStats(owner.unitId)?.attack ?? owner.stats.attack;
        const defense = context.getEffectiveStats(target.unitId)?.defense ?? target.stats.defense;
        const damage = (0, indirect_damage_1.calculateIndirectDamage)({ attack, defense, defenseIgnore: (0, stats_1.effectiveDefenseIgnore)(owner), ratio: 1.4,
            critDamage: context.getEffectiveStats(owner.unitId)?.critDamage ?? owner.stats.critDamage,
            layers: (0, indirect_damage_1.indirectBuffLv)(target) }, context.random);
        commands.push({ type: 'lose-life', source: mark.source, targetId: target.unitId, amount: damage.amount,
            lifeLossKind: 'indirect', parentEventId: event.eventId });
    }
    return commands.length ? commands : undefined;
}
function canUseForm(owner, formId) {
    if (!isChuanYuan(owner) || owner.hp <= 0)
        return false;
    const currentForm = owner.statuses.find(status => status.statusId === chuanYuanIds.form);
    return currentForm?.values?.formId === formId || (paperCount(owner) > 0 && !formUsed(owner, formId));
}
function formUsed(owner, formId) {
    const state = owner.statuses.find(status => status.statusId === chuanYuanIds.formHistory);
    return state?.values?.[formId] === true;
}
function paperStatus(owner) {
    return owner.statuses.find(status => status.statusId === chuanYuanIds.papers);
}
function paperCount(owner) { return paperStatus(owner)?.stacks ?? 0; }
function attack(context, owner, target, ratio, skillId) {
    const attackStat = context.getEffectiveStats(owner.unitId) ?? owner.stats;
    const defense = context.getEffectiveStats(target.unitId) ?? target.stats;
    const hit = context.calculateDamage({ attack: attackStat.attack, defense: defense.defense,
        defenseIgnore: (0, stats_1.effectiveDefenseIgnore)(owner), ratio, critChance: attackStat.crit, critDamage: attackStat.critDamage }, owner, target);
    return [{ type: 'deal-damage', source: chuanYuanSource(skillId, owner.unitId), targetId: target.unitId, amount: hit.amount,
            ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}), isCritical: hit.isCritical,
            ...(hit.isCritical ? { criticalBaseAmount: hit.amount / Math.max(1, attackStat.critDamage) } : {}) }];
}
function skillLevel(unit, skillId) { return Math.max(1, Math.min(6, unit.skillLevels?.[skillId] ?? unit.skillLevel)); }
function isChuanYuan(unit) { return unit.heroId === chuanYuanIds.hero && unit.unitKind !== 'summon'; }
function opposingSide(side) { return side === 'blue' ? 'red' : 'blue'; }
function chuanYuanSource(id, unitId) { return { kind: 'skill', id, unitId }; }
