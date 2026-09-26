// Run via npm test (builds the renderer test output first).
// 注释框标题的折行：SVG 的 <text> 不会自己换行，长句子会横着跑出框外。
// 这里用固定宽度的替身测量函数驱动折行算法本身（不依赖字体与 DOM）。
const {test} = require('node:test');
const assert = require('node:assert/strict');
const { wrapText, estimateCharWidth, createCharMeasure } = require('../dist-test-renderer/canvas/canvas/text-wrap.js');

/** 替身测量：汉字 10px、其余字符 5px，便于手算期望的行。 */
const han = (char) => (/[\u4e00-\u9fff]/.test(char) ? 10 : 5);
/** 每行最多能放几个汉字宽。 */
const width = (hanCount) => hanCount * 10;

test('折行：按宽度切行，每行都不超宽', () => {
  const lines = wrapText('一二三四五六七八九十一二三四五', width(5), han);
  assert.deepEqual(lines, ['一二三四五', '六七八九十', '一二三四五']);
  for (const line of lines) assert.ok(han(line) <= width(5), `「${line}」不该超宽`);
});

test('折行：收尾标点悬挂在上一行，不会跑到行首', () => {
  // 第 5 个字是「，」：宁可让它挂在上一行，也不要「，」单独开头。
  const lines = wrapText('一二三四，五六七八九十', width(5), han);
  assert.equal(lines[0], '一二三四，');
  assert.ok(!lines[1].startsWith('，'), '标点不能在行首');
});

test('折行：显式换行与空行都保留', () => {
  assert.deepEqual(wrapText('甲乙\n丙丁', width(5), han), ['甲乙', '丙丁']);
  assert.deepEqual(wrapText('甲乙\n\n丙丁', width(5), han), ['甲乙', '', '丙丁']);
  assert.deepEqual(wrapText('', width(5), han), ['']);
  assert.deepEqual(wrapText('甲\n', width(5), han), ['甲', '']);
});

test('折行：拉丁词优先在空格处断，超长单词硬断', () => {
  const lines = wrapText('hello world again', width(3), han); // 一行 30px ≈ 6 个拉丁字符
  assert.deepEqual(lines, ['hello', 'world', 'again']);
  // 没有空格的超长串：只能硬断，且不丢字符（一行 30px = 6 个拉丁字符）。
  const hard = wrapText('abcdefghij', width(3), han);
  assert.deepEqual(hard, ['abcdef', 'ghij']);
  assert.equal(hard.join(''), 'abcdefghij');
});

test('折行：宽度小到放不下一个字也不死循环', () => {
  const lines = wrapText('一二三', 1, han);
  assert.deepEqual(lines, ['一', '二', '三']);
  assert.deepEqual(wrapText('甲', 0, han), ['甲']);
});

test('折行：不丢字符（含标点与空格）', () => {
  const text = '结算页分支：先识别当前页面，再按状态分支（含 OCR 兜底）';
  const lines = wrapText(text, width(8), han);
  assert.ok(lines.length > 1, '长句必须折行');
  assert.equal(lines.join('').replace(/ /g, ''), text.replace(/ /g, ''));
});

test('宽度估算：全角一个字宽、拉丁半个，且测量函数在没有 DOM 时也能用', () => {
  assert.equal(estimateCharWidth('汉', 12), 12);
  assert.equal(estimateCharWidth('a', 12), 12 * 0.55);
  assert.ok(estimateCharWidth('あ', 12) === 12, '假名算全角');
  const measure = createCharMeasure({ fontSize: 12, fontFamily: 'sans-serif' });
  assert.equal(measure('汉'), 12, '没有 canvas 时退化成估算表');
  assert.equal(measure('汉'), measure('汉'), '同一字符重复测量结果稳定');
});
