// Run via npm test (builds the desktop output first).
// 主窗口几何记忆是纯函数：直接导入主进程编译产物验证，不创建也不操控任何窗口。
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  MIN_WINDOW_WIDTH,
  MIN_WINDOW_HEIGHT,
  parseWindowState,
  serializeWindowState,
  visibleOnDisplays,
  resolveWindowGeometry,
} = require('../dist-electron/main/windowState.js');

const area = (x, y, width, height) => ({x, y, width, height});
const fallback = {width: 1560, height: 940};

test('窗口状态解析容忍损坏数据并按最小尺寸收敛', () => {
  for (const raw of [null, undefined, '', 'not json', '[]', '"x"', '{"x":1,"y":2}']) {
    assert.equal(parseWindowState(raw), undefined, String(raw));
  }
  assert.equal(parseWindowState('null'), undefined);
  const state = parseWindowState(JSON.stringify({x: 120.4, y: -40.6, width: 400, height: 300, maximized: true}));
  assert.deepEqual(state, {
    bounds: {x: 120, y: -41, width: MIN_WINDOW_WIDTH, height: MIN_WINDOW_HEIGHT},
    maximized: true,
  });
  // 非布尔值不算最大化，坏字段一律回落到默认。
  assert.equal(parseWindowState('{"x":0,"y":0,"width":1600,"height":900,"maximized":"yes"}').maximized, false);
  assert.equal(parseWindowState('{"width":1600,"height":900}').bounds.x, 0);
});

test('窗口状态序列化可以原样读回', () => {
  const raw = serializeWindowState({bounds: {x: 100, y: 60, width: 1600, height: 900}, maximized: true});
  assert.deepEqual(parseWindowState(raw), {
    bounds: {x: 100, y: 60, width: 1600, height: 900},
    maximized: true,
  });
  assert.equal(JSON.parse(raw).maximized, true);
});

test('只有与工作区重叠到抓得住的尺寸才认为窗口看得见', () => {
  const areas = [area(0, 0, 1920, 1040)];
  assert.equal(visibleOnDisplays({x: 100, y: 100, width: 1200, height: 800}, areas), true);
  // 完全跑到右侧/上方屏幕外：看不见。
  assert.equal(visibleOnDisplays({x: 1900, y: 0, width: 1200, height: 800}, areas), false);
  assert.equal(visibleOnDisplays({x: 100, y: -790, width: 1200, height: 800}, areas), false);
  // 只露出 10px（抓不住）不算，露出 80px 才算。
  assert.equal(visibleOnDisplays({x: -1190, y: 100, width: 1200, height: 800}, areas), false);
  assert.equal(visibleOnDisplays({x: -1120, y: 100, width: 1200, height: 800}, areas), true);
  assert.equal(visibleOnDisplays({x: 100, y: 100, width: 1200, height: 800}, []), false);
});

test('恢复窗口几何：位置可用就沿用（含最大化），不可用就退回默认并居中', () => {
  const areas = [area(0, 0, 2560, 1400)];
  const state = {bounds: {x: 200, y: 120, width: 1800, height: 1000}, maximized: true};
  assert.deepEqual(resolveWindowGeometry(state, areas, fallback), {
    x: 200, y: 120, width: 1800, height: 1000, maximized: true,
  });
  // 换屏后旧坐标落在屏幕外：不带位置（由系统居中）、也不带最大化。
  const gone = {bounds: {x: 4000, y: 200, width: 1800, height: 1000}, maximized: true};
  assert.deepEqual(resolveWindowGeometry(gone, areas, fallback), {width: 1560, height: 940, maximized: false});
  assert.deepEqual(resolveWindowGeometry(undefined, areas, fallback), {width: 1560, height: 940, maximized: false});
  // 显示器列表拿不到（异常路径）：同样退回默认。
  assert.deepEqual(resolveWindowGeometry(state, [], fallback), {width: 1560, height: 940, maximized: false});
});

test('窗口尺寸不会超过所有显示器工作区的并集', () => {
  const areas = [area(0, 0, 1920, 1080), area(1920, 0, 1920, 1080)];
  const state = {bounds: {x: 0, y: 0, width: 6000, height: 1080}, maximized: false};
  assert.deepEqual(resolveWindowGeometry(state, areas, fallback), {
    x: 0, y: 0, width: 3840, height: 1080, maximized: false,
  });
});

test('主窗口创建与事件把几何记忆接上', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.ts'), 'utf8');
  assert.match(main, /const WINDOW_STATE_STORE_KEY = 'onmyoji-studio\.window-state\.v1'/);
  assert.match(main, /function readWindowState\(\): WindowState \| undefined/);
  assert.match(main, /resolveWindowGeometry\(\s*\n\s*readWindowState\(\),\s*\n\s*screen\.getAllDisplays\(\)\.map\(\(display\) => display\.workArea\)/);
  assert.match(main, /if \(geometry\.maximized\) window\.maximize\(\)/, '必须在显示窗口前就最大化');
  // 最小尺寸只有一份来源（windowState.ts），创建窗口时不再各写一份字面量。
  assert.match(main, /minWidth: MIN_WINDOW_WIDTH,\s*\n\s*minHeight: MIN_WINDOW_HEIGHT/);
  assert.equal(/minWidth: 880/.test(main), false);
  // 拖动/缩放合并写入，最大化状态与关闭前各补一次；最大化时记的是还原后的几何。
  assert.match(main, /window\.on\('resize', scheduleRememberWindowState\)/);
  assert.match(main, /window\.on\('move', scheduleRememberWindowState\)/);
  assert.match(main, /window\.on\('maximize', \(\) => \{ sendMaximizedState\(\); scheduleRememberWindowState\(\); \}\)/);
  assert.match(main, /window\.on\('unmaximize', \(\) => \{ sendMaximizedState\(\); scheduleRememberWindowState\(\); \}\)/);
  assert.match(main, /window\.on\('close', \(\) => \{[\s\S]*?rememberWindowState\(\);/);
  assert.match(main, /bounds: window\.getNormalBounds\(\),\s*\n\s*maximized: window\.isMaximized\(\),/);
});
