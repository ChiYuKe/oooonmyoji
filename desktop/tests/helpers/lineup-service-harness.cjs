const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

exports.harness = (fetch, entry = 'lineupService') => {
  const modules = new Map(), cookies = [], partitions = [];
  let now = Date.now();
  class Clock extends Date { static now() { return now; } }
  const native = { net: { fetch }, session: { fromPartition: name => {
    partitions.push(name);
    return { fetch, cookies: { set: async value => { cookies.push(value); } } };
  } } };
  const load = filename => {
    if (modules.has(filename)) return modules.get(filename);
    const exports = {}; modules.set(filename, exports);
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
      exports, require: name => {
        if (name === 'electron') return native;
        assert.ok(name.startsWith('./'));
        return load(path.resolve(path.dirname(filename), `${name}.js`));
      }, URL, URLSearchParams, Buffer, AbortSignal, TextDecoder, structuredClone, Date: Clock, Error,
    }, { filename });
    return exports;
  };
  return { service: load(path.resolve(__dirname, `../../dist-electron/main/${entry}.js`)), advance: ms => { now += ms; }, cookies, partitions };
};
