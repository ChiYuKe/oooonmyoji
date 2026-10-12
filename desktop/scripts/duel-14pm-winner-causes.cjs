// Paired diagnostic interventions: each variant starts with the same input and seed.
const fs = require('node:fs');
const path = require('node:path');
const engine = '../dist-test-renderer/renderer/features/duel/engine/';
const { createBattleState } = require(engine + 'simulation/input-adapter.js');
const { createMigratedContentRegistry } = require(engine + 'content/register-migrated-content.js');
const { runBattle } = require(engine + 'simulation/run-battle.js');
const input = require('../tests/fixtures/duel-14pm-lineup.json');
const rows = [];
const variants = ['forced-mask-break', 'without-forced-mask-break', 'without-extra-first-skill-gauge',
  'halberd-without-shield-entity-multiplier'];
for (const variant of variants) {
  for (let sampleIndex = 0; sampleIndex < 10; sampleIndex++) {
    const registry = createMigratedContentRegistry();
    if (variant === 'forced-mask-break') registry.getStatus('status.hero.331.seal-mask').selectAction = (context, actor, instance) => {
      const owner = context.getUnit(instance.source.unitId);
      if (!owner?.hp || owner.side === actor.side || !owner.statuses.some(s => s.statusId === 'status.hero.331.seal-barrier')
        || (context.state.resources[actor.side]?.fire ?? 0) < 1) return undefined;
      return { actorId: actor.unitId, skillId: '3316', targetIds: [actor.unitId], shape: 'self', targetRelation: 'ally' };
    };
    if (variant === 'without-extra-first-skill-gauge')
      registry.getHero(356).handlers['action-end'].handle = () => [];
    if (variant === 'halberd-without-shield-entity-multiplier') {
      const skill = registry.getHero(356).skills.find(skill => skill.id === '3563');
      const execute = skill.execute;
      skill.execute = (...args) => execute(...args).map(command => command.type === 'summon-unit'
        ? { ...command, unit: { ...command.unit, shieldEntity: false } } : command);
    }
    const result = runBattle(createBattleState(input), registry, { seed: 1, sampleIndex, actionLimit: 600 });
    const actions = result.events.filter(e => e.type === 'action-declared');
    rows.push({ variant, sampleIndex, seed: result.seed, winner: result.winner, reason: result.reason,
      maskBreaks: actions.filter(e => e.intent.skillId === '3316').length,
      halberdSummons: actions.filter(e => e.intent.skillId === '3563').length,
      chihimeRestoredHp: result.events.filter(e => e.type === 'health-restored' && e.source.id === '3563')
        .reduce((sum, e) => sum + e.hpGained, 0),
      tideFireGained: result.events.filter(e => e.type === 'resource-changed' && e.source.id === '3563'
        && e.after > e.before).reduce((sum, e) => sum + e.after - e.before, 0),
      initialDelirium: result.events.find(e => e.type === 'status-added'
        && e.instance.statusId === 'status.hero.396.delirium')?.targetId,
      chihimeActions: actions.filter(e => e.intent.actorId === 'blue:4:356').map(e => e.intent),
      blueSkills: actions.filter(e => e.intent.actorId.startsWith('blue:')).map(e => e.intent.skillId),
      opening: actions.filter(e => (e.scheduling ?? 'normal') === 'normal').slice(0, 30).map(e => e.intent) });
  }
}
const output = path.resolve(__dirname, '../out/fourteen-match/winner-causes.json');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(rows, null, 2));
for (const variant of variants) {
  const group = rows.filter(row => row.variant === variant);
  console.log(JSON.stringify({ variant, blue: group.filter(row => row.winner === 'blue').length,
    red: group.filter(row => row.winner === 'red').length,
    actionLimit: group.filter(row => row.reason === 'action-limit').length,
    maskBreaks: group.map(row => row.maskBreaks) }));
}
