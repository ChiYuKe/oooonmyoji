// Prints locations and reasons only. Never prints matching content or credentials.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { findSecrets } = require('./secret-guard.cjs');
const root = path.resolve(__dirname, '../..');
function git(args, options = {}) {
  const result = spawnSync('git', args, { cwd: root, maxBuffer: 128 * 1024 * 1024, ...options });
  if (result.error || result.status !== 0) throw new Error('无法读取 Git 内容，已停止凭据检查');
  return result.stdout;
}
// History scanning reads whole blobs, so a single call would exceed the buffer cap on large
// repositories; batches keep peak memory bounded by the chunk instead of the whole history.
const objectChunkSize = 64;
function scanObjects(objects) {
  if (!objects.length) return [];
  const issues = [];
  for (let start = 0; start < objects.length; start += objectChunkSize) {
    const chunk = objects.slice(start, start + objectChunkSize);
    const data = git(['cat-file', '--batch'], { input: chunk.map(item => item.oid).join('\n') + '\n' });
    let offset = 0;
    for (const item of chunk) {
      const end = data.indexOf(10, offset);
      if (end < 0) throw new Error('无法读取 Git 文件内容');
      const header = data.subarray(offset, end).toString('ascii').split(' ');
      if (header[1] !== 'blob' || !/^\d+$/.test(header[2])) throw new Error('无法读取 Git 文件内容');
      const size = Number(header[2]);
      issues.push(...findSecrets(item.file, data.subarray(end + 1, end + 1 + size)));
      offset = end + 1 + size + 1;
    }
  }
  return issues;
}
function stagedObjects() {
  return git(['ls-files', '--stage', '-z']).toString('utf8').split('\0').filter(Boolean).map(entry => {
    const separator = entry.indexOf('\t'), header = entry.slice(0, separator).split(' ');
    if (header[2] !== '0') throw new Error('请先解决 Git 合并冲突');
    return { oid: header[1], file: entry.slice(separator + 1), mode: header[0] };
  }).filter(item => item.mode !== '160000');
}
function historyObjects() {
  const entries = git(['rev-list', '--objects', '--all']).toString('utf8').trim().split('\n').filter(Boolean);
  const checked = git(['cat-file', '--batch-check'], { input: entries.map(entry => entry.split(' ')[0]).join('\n') + '\n' }).toString('ascii').trim().split('\n');
  return entries.flatMap((entry, index) => {
    const separator = entry.indexOf(' ');
    if (separator < 0 || checked[index]?.split(' ')[1] !== 'blob') return [];
    // Git quotes non-ASCII paths; decode those through its NUL-delimited current index
    // when possible. Historical paths remain safe labels; contents are still scanned.
    return [{ oid: entry.slice(0, separator), file: entry.slice(separator + 1) }];
  });
}
try {
  const mode = process.argv[2] || '--staged';
  let issues;
  if (mode === '--staged') issues = scanObjects(stagedObjects());
  else if (mode === '--history') issues = scanObjects(historyObjects());
  else if (mode === '--all') {
    const files = git(['ls-files', '--cached', '--others', '--exclude-standard', '-z']).toString('utf8').split('\0').filter(Boolean);
    issues = [...new Set(files)].flatMap(file => {
      const target = path.join(root, file);
      if (!fs.existsSync(target) || !fs.lstatSync(target).isFile()) return [];
      return findSecrets(file, fs.readFileSync(target));
    });
  } else throw new Error('用法：check-secrets.cjs --staged | --all | --history');
  const unique = [...new Map(issues.map(issue => [`${issue.file}:${issue.line}:${issue.reason}`, issue])).values()];
  if (unique.length) {
    console.error('凭据检查未通过，请移除凭据文件或将真实密钥改为本机配置。');
    for (const issue of unique) console.error(`${issue.file}:${issue.line} — ${issue.reason}`);
    process.exitCode = 1;
  } else console.log('凭据检查通过（未发现受检凭据文件或固定密钥）。');
} catch (error) { console.error(error.message); process.exitCode = 1; }
