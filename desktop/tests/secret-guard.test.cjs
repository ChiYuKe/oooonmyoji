const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { isSecretFile, findSecrets } = require('../scripts/secret-guard.cjs');
const root = path.resolve(__dirname, '../..');

test('Git ignores credential files and temporary backups anywhere in the project', () => {
  const files = ['ai-settings.json', 'desktop/ai-settings.json.tmp', 'workflows/ai-settings.json.bak', '.env', 'desktop/.env.local', 'keys/private.pem', 'keys/service.key', 'config/credentials.json', 'config/secrets.json'];
  const result = spawnSync('git', ['check-ignore', '--no-index', '--stdin'], { cwd: root, input: files.join('\n'), encoding: 'utf8' });
  assert.equal(result.status, 0); assert.deepEqual(result.stdout.trim().split(/\r?\n/), files);
  for (const file of ['.env.example', '.env.sample', '.env.template', 'config/config.example.json']) {
    const example = spawnSync('git', ['check-ignore', '--no-index', file], { cwd: root });
    assert.equal(example.status, 1, file);
  }
});

test('credential filenames are rejected even if force-added; examples and source files remain usable', () => {
  for (const name of ['ai-settings.json', 'nested/ai-settings.json.tmp', '.env.production', 'keys/secret.pem', 'credentials.json', 'config/config.json', 'C:/workspace/config/config.json', '"目录/ai-settings.json"']) {
    assert.ok(isSecretFile(name), name); assert.ok(findSecrets(name, Buffer.from('{}')).length, name);
  }
  for (const name of ['.env.example', 'config/config.example.json', 'src/aiAssistant.ts']) assert.equal(isSecretFile(name), false, name);
});

test('fixed API keys, tokens, encrypted credentials and private keys are detected without echoing values', () => {
  const secret = 'sk-' + 'a'.repeat(32);
  const samples = [secret, 'ghp_' + 'b'.repeat(36), '-----BEGIN ' + 'PRIVATE KEY-----', ['OPENAI', 'API', 'KEY'].join('_') + '="' + 'opaque-provider-credential' + '"', JSON.stringify({ ['encrypted' + 'Key']: 'ciphertext-value' }), 'Authorization: "Bearer ' + 'fixed-service-credential' + '"'];
  for (const content of samples) {
    const issues = findSecrets('src/example.txt', Buffer.from('first line\n' + content));
    assert.ok(issues.length); assert.equal(issues[0].line, 2);
    assert.ok(!JSON.stringify(issues).includes(content));
    assert.deepEqual(Object.keys(issues[0]), ['file', 'line', 'reason']);
  }
});

test('source expressions and explicit dummy fixtures do not masquerade as live credentials', () => {
  const safe = ['apiKey: value.apiKey', 'apiKey: process.env.AI_API_KEY', 'apiKey: "YOUR_API_KEY"', 'apiKey: "private-test-key"', 'encryptedKey: ""', 'Authorization: "Bearer isolated-smoke-key"', 'const field = "API Key";'];
  for (const content of safe) assert.deepEqual(findSecrets('src/example.ts', Buffer.from(content)), [], content);
});

test('commit and push hooks enforce staged and history checks; packaging omits secret files', () => {
  assert.match(fs.readFileSync(path.join(root, '.githooks/pre-commit'), 'utf8'), /check-secrets\.cjs --staged \|\| exit 1/);
  assert.match(fs.readFileSync(path.join(root, '.githooks/pre-push'), 'utf8'), /check-secrets\.cjs --history \|\| exit 1/);
  assert.match(fs.readFileSync(path.join(root, 'desktop/scripts/package-windows-portable.cjs'), 'utf8'), /if \(isSecretFile\(source\)\) return;/);
});

test('real Git hook blocks force-added credentials; staged and history scans never print the credential', t => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'autoflow-secret-guard-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const run = (command, args) => spawnSync(command, args, { cwd: temporary, encoding: 'utf8' });
  fs.mkdirSync(path.join(temporary, 'desktop/scripts'), { recursive: true });
  fs.mkdirSync(path.join(temporary, '.githooks'));
  for (const file of ['check-secrets.cjs', 'secret-guard.cjs']) fs.copyFileSync(path.join(root, 'desktop/scripts', file), path.join(temporary, 'desktop/scripts', file));
  for (const file of ['pre-commit', 'pre-push']) {
    fs.copyFileSync(path.join(root, '.githooks', file), path.join(temporary, '.githooks', file));
    fs.chmodSync(path.join(temporary, '.githooks', file), 0o755);
  }
  assert.equal(run('git', ['init', '-q']).status, 0);
  assert.equal(run('git', ['config', 'core.hooksPath', '.githooks']).status, 0);
  fs.writeFileSync(path.join(temporary, '.gitignore'), '.env\n');
  const credential = 'sk-' + 'q'.repeat(32);
  fs.writeFileSync(path.join(temporary, '.env'), ['SERVICE', 'API', 'KEY'].join('_') + '="' + credential + '"\n');
  assert.equal(run('git', ['add', '-f', '.env']).status, 0);
  const staged = run(process.execPath, ['desktop/scripts/check-secrets.cjs', '--staged']);
  assert.equal(staged.status, 1); assert.ok(!staged.stderr.includes(credential)); assert.match(staged.stderr, /\.env:1/);
  const hook = run('git', ['hook', 'run', 'pre-commit']);
  assert.notEqual(hook.status, 0); assert.ok(!hook.stderr.includes(credential));
  // Create unsafe history only in this disposable test repository, bypassing its hook.
  assert.equal(run('git', ['-c', 'core.hooksPath=', '-c', 'user.name=Secret Guard Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'isolated fixture']).status, 0);
  const history = run(process.execPath, ['desktop/scripts/check-secrets.cjs', '--history']);
  assert.equal(history.status, 1); assert.ok(!history.stderr.includes(credential)); assert.match(history.stderr, /\.env:1/);
  // Removing a key from the working tree cannot hide the version already staged or committed.
  fs.writeFileSync(path.join(temporary, '.env'), '');
  assert.equal(run(process.execPath, ['desktop/scripts/check-secrets.cjs', '--staged']).status, 1);
});
