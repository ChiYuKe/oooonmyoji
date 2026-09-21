// Run via npm test (builds the renderer test output first).
// 阶段 7：崩溃恢复副本（localStorage 留档）。
// - 每份文档保留最近 N 份，内容相同不重复堆；
// - 存储不可用/内容坏掉时安全退化，绝不影响编辑；
// - 超大正文不写库（localStorage 配额有限）。
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {
  createRecoveryStore, RECOVERY_STORAGE_KEY, RECOVERY_HISTORY_LIMIT,
} = require('../dist-test-renderer/renderer/recovery-store.js');

/** 内存版存储。 */
function memoryStore(initial = null) {
  let value = initial;
  return {
    read: () => value,
    write: (next) => { value = next; },
    raw: () => value,
  };
}

test('留档、取最新与历史顺序', () => {
  const store = memoryStore();
  const recovery = createRecoveryStore({ read: store.read, write: store.write });
  assert.equal(recovery.latest('a'), null);

  recovery.record('a', '第一版', true, 1000);
  recovery.record('a', '第二版', false, 2000);
  assert.deepEqual(recovery.latest('a'), { text: '第二版', at: 2000, dirty: false });
  assert.deepEqual(recovery.history('a').map((entry) => entry.text), ['第二版', '第一版']);
  assert.deepEqual(recovery.uris(), ['a']);

  // 内容相同不重复堆：只更新时间戳，历史长度不变。
  recovery.record('a', '第二版', true, 3000);
  assert.equal(recovery.history('a').length, 2);
  assert.equal(recovery.latest('a').at, 3000);
  assert.equal(recovery.latest('a').dirty, true);

  // 另一份文档互不影响。
  recovery.record('b', 'b 的内容', true, 4000);
  assert.deepEqual(recovery.uris().sort(), ['a', 'b']);
  assert.equal(recovery.latest('a').text, '第二版');
});

test('每份文档只留最近的 N 份，超出后丢最旧的', () => {
  const store = memoryStore();
  const recovery = createRecoveryStore({ read: store.read, write: store.write });
  for (let index = 0; index < RECOVERY_HISTORY_LIMIT + 3; index += 1) recovery.record('a', `版本 ${index}`, true, 1000 + index);
  const history = recovery.history('a');
  assert.equal(history.length, RECOVERY_HISTORY_LIMIT);
  assert.equal(history[0].text, `版本 ${RECOVERY_HISTORY_LIMIT + 2}`, '最新在前');
  assert.equal(history[history.length - 1].text, '版本 3', '最旧的被丢掉');
});

test('清除只清掉指定文档', () => {
  const store = memoryStore();
  const recovery = createRecoveryStore({ read: store.read, write: store.write });
  recovery.record('a', 'A', true, 1);
  recovery.record('b', 'B', true, 1);
  recovery.clear('a');
  assert.equal(recovery.latest('a'), null);
  assert.equal(recovery.latest('b').text, 'B');
  recovery.clear('a'); // 重复清除安全
});

test('坏存储与坏内容安全退化', () => {
  const broken = createRecoveryStore({ read: () => { throw new Error('denied'); }, write: () => { throw new Error('quota'); } });
  broken.record('a', 'x', true);
  assert.equal(broken.latest('a'), null);
  assert.deepEqual(broken.uris(), []);

  const garbage = createRecoveryStore({ read: () => '{not json', write: () => {} });
  assert.deepEqual(garbage.uris(), []);
  garbage.record('a', 'ok', true, 5);
  assert.equal(garbage.latest('a'), null, '读不出来就当没有，不会抛');

  const weird = createRecoveryStore({ read: () => JSON.stringify({ a: { entries: 'nope' }, b: { entries: [null, { text: 3 }] } }), write: () => {} });
  assert.deepEqual(weird.uris(), []);
});

test('超大正文与空值不写库', () => {
  const store = memoryStore();
  const recovery = createRecoveryStore({ read: store.read, write: store.write });
  recovery.record('a', 'x'.repeat(2_000_000), true);
  assert.equal(recovery.latest('a'), null, '超限正文不留档');
  recovery.record('a', '', true);
  recovery.record('', 'text', true);
  assert.deepEqual(recovery.uris(), []);
  // 存储键是固定的公开契约（测试与清理脚本都按它找）。
  assert.equal(RECOVERY_STORAGE_KEY, 'onmyoji-studio.recovery.v1');
});
