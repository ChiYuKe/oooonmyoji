const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createCipheriv, createDecipheriv } = require('node:crypto');
const { AiAssistant } = require('../dist-electron/main/aiAssistant.js');
const { completionUrl, aiCardContext, parseAiSuggestions, parseAiNodeRecommendations } = require('../dist-electron/shared/ai-assistant.js');

function fixture(t, request, loadImage) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoflow-ai-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'ai-settings.json');
  const cryptoKey = Buffer.alloc(32, 12), iv = Buffer.alloc(16, 8);
  const secrets = {
    available: () => true,
    encrypt: value => { const cipher = createCipheriv('aes-256-cbc', cryptoKey, iv); return Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]); },
    decrypt: value => { const cipher = createDecipheriv('aes-256-cbc', cryptoKey, iv); return Buffer.concat([cipher.update(value), cipher.final()]).toString('utf8'); },
  };
  const service = new AiAssistant(file, secrets, request, loadImage);
  const settings = { enabled: true, baseUrl: 'https://example.com/v1', model: 'test-model', apiKey: 'private-test-key' };
  return { service, settings, file, secrets };
}
const response = content => new Response(JSON.stringify({ choices: [{ message: { content } }] }));
const query = { mode: 'name', context: '{"action":"vision.wait_template"}', instruction: '简短' };

test('node recommendations only accept existing compatible candidate IDs, retain ranking and deduplicate', async t => {
  const candidates = [{ id: 'action:input.tap_match', title: '点击匹配结果', type: 'task', action: 'input.tap_match', parameterNames: ['match'], secret: 'hidden-key' }, { id: 'type:sequence', title: '顺序', type: 'sequence' }];
  let body;
  const reply = JSON.stringify({ nodes: [{ id: 'invented:action', reason: '不能创建' }, { id: candidates[0].id, reason: '上游已有匹配结果，可用于点击目标' }, { id: candidates[0].id, reason: '重复' }, { id: candidates[1].id, reason: '组合顺序步骤' }] });
  const { service, settings } = fixture(t, async (_, options) => { body = JSON.parse(options.body); return response(reply); });
  service.saveSettings(settings);
  const result = await service.suggest({ ...query, mode: 'node', candidates });
  assert.deepEqual(result.nodes.map(item => item.id), candidates.map(item => item.id));
  assert.equal(JSON.parse(body.messages[1].content).candidates[0].secret, undefined);
  assert.ok(!body.messages[1].content.includes('hidden-key')); assert.match(body.messages[0].content, /before/);
  assert.throws(() => parseAiNodeRecommendations('{"nodes":[{"id":"unknown","reason":"无效"}]}', candidates), /未推荐可用/);
  for (const invalid of [[], [candidates[0], candidates[0]], [{ id: 'a', title: '名称', type: 'task', parameterNames: [null] }]]) {
    await assert.rejects(service.suggest({ ...query, mode: 'node', candidates: invalid }), /列表/);
  }
});

test('AI keys persist encrypted, are omitted from public settings, preserve on blank form and can be removed', t => {
  const { service, settings, file, secrets } = fixture(t);
  assert.deepEqual(service.getSettings(), { enabled: false, baseUrl: '', model: '', hasApiKey: false });
  service.saveSettings(settings);
  assert.ok(!fs.readFileSync(file, 'utf8').includes(settings.apiKey));
  assert.deepEqual(new AiAssistant(file, secrets).getSettings(), { enabled: true, baseUrl: settings.baseUrl, model: settings.model, hasApiKey: true });
  const { apiKey, ...update } = settings;
  service.saveSettings(update);
  assert.ok(service.getSettings().hasApiKey);
  service.saveSettings({ ...update, apiKey: '' });
  assert.equal(service.getSettings().hasApiKey, false);
  service.saveSettings({ ...update, enabled: false, apiKey: '' });
  assert.equal(service.getSettings().hasApiKey, false);
});

test('multimodal suggestions attach labelled deduplicated local templates and workflow context', async t => {
  const loaded = []; let body;
  const { service, settings } = fixture(t, async (_, options) => { body = JSON.parse(options.body); return response('{"names":["确认队友准备完毕"],"advice":[]}'); }, async relative => {
    loaded.push(relative); return 'data:image/png;base64,aGVsbG8=';
  });
  service.saveSettings(settings);
  await service.suggest({ ...query, templatePaths: ['assets/templates/ready.png', 'assets/templates/ready.png'] });
  assert.deepEqual(loaded, ['assets/templates/ready.png']);
  const parts = body.messages[1].content;
  assert.equal(JSON.parse(parts[0].text).card, query.context);
  assert.match(parts[1].text, /assets\/templates\/ready.png/);
  assert.equal(parts[2].type, 'image_url'); assert.equal(parts[2].image_url.url, 'data:image/png;base64,aGVsbG8=');
  assert.match(body.messages[0].content, /upstream\/downstream/);
});

test('unsafe images, oversized payloads and unsupported vision fail without silent retries', async t => {
  let calls = 0, reads = 0;
  const { service, settings } = fixture(t, async () => { calls++; return new Response('private-test-key', { status: 400 }); }, async () => { reads++; return 'data:image/png;base64,aGVsbG8='; });
  service.saveSettings(settings);
  for (const templatePaths of [[undefined], ['assets/../private.png'], ['https://example.com/image.png'], ['C:/image.png'], ['ai-settings.json'], Array(7).fill('assets/a.png')]) {
    await assert.rejects(service.suggest({ ...query, templatePaths }), /路径无效/);
  }
  assert.equal(calls, 0); assert.equal(reads, 0);
  await assert.rejects(service.suggest({ ...query, templatePaths: ['assets/a.png'] }), /模型支持图片/);
  assert.equal(calls, 1);
  const big = fixture(t, async () => { throw new Error('Should not request'); }, async () => 'data:image/png;base64,' + 'a'.repeat(4 * 1024 * 1024));
  big.service.saveSettings(big.settings);
  await assert.rejects(big.service.suggest({ ...query, templatePaths: ['assets/a.png'] }), /过大/);
});

test('unavailable encryption and invalid settings never overwrite previous credentials', t => {
  const { service, settings, file, secrets } = fixture(t);
  service.saveSettings(settings); const before = fs.readFileSync(file, 'utf8');
  secrets.available = () => false;
  assert.throws(() => service.saveSettings({ ...settings, apiKey: 'new-key' }), /加密不可用/);
  assert.throws(() => service.saveSettings({ ...settings, baseUrl: 'http://remote.example/v1' }), /HTTPS/);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('compatible completion request uses saved configuration and returns safe selectable names', async t => {
  let seen;
  const { service, settings } = fixture(t, async (url, options) => { seen = { url, options }; return response('{"names":["等待挑战按钮","等待挑战按钮","识别挑战入口"],"advice":["检查超时参数"]}'); });
  service.saveSettings(settings);
  assert.deepEqual(await service.suggest(query), { names: ['等待挑战按钮', '识别挑战入口'], advice: ['检查超时参数'] });
  assert.equal(seen.url, 'https://example.com/v1/chat/completions');
  assert.equal(seen.options.headers.Authorization, 'Bearer private-test-key');
  assert.equal(seen.options.redirect, 'error');
  const body = JSON.parse(seen.options.body);
  assert.equal(body.model, settings.model); assert.equal(body.stream, false);
  assert.equal(JSON.parse(body.messages[1].content).context, undefined);
  assert.equal(JSON.parse(body.messages[1].content).card, query.context);
});

test('disabled suggestions make no requests; connection test can use saved disabled settings', async t => {
  let calls = 0;
  const { service, settings } = fixture(t, async () => { calls++; return response('OK'); });
  service.saveSettings({ ...settings, enabled: false });
  await assert.rejects(service.suggest(query), /启用 AI/); assert.equal(calls, 0);
  await service.testConnection(); assert.equal(calls, 1);
});

test('automatic saving retains incomplete settings without making API calls', async t => {
  let calls = 0;
  const { service } = fixture(t, async () => { calls++; return response('OK'); });
  assert.deepEqual(service.saveSettings({ enabled: true, baseUrl: '', model: '' }), { enabled: true, baseUrl: '', model: '', hasApiKey: false });
  await assert.rejects(service.suggest(query), /补全/);
  await assert.rejects(service.testConnection(), /补全/);
  assert.equal(calls, 0);
});

test('provider failures and echoed credentials never expose secrets', async t => {
  let errorResponse = true;
  const { service, settings } = fixture(t, async () => errorResponse ? new Response('private-test-key', { status: 401 }) : response('{"names":["private-test-key"],"advice":[]}'));
  service.saveSettings(settings);
  await assert.rejects(service.suggest(query), error => error.message.includes('401') && !error.message.includes(settings.apiKey));
  errorResponse = false;
  assert.deepEqual((await service.suggest(query)).names, ['[已隐藏]']);
});

test('invalid replies, oversized replies and overlapping requests fail cleanly', async t => {
  let finish;
  const { service, settings } = fixture(t, () => new Promise(resolve => { finish = resolve; }));
  service.saveSettings(settings);
  const waiting = service.suggest(query);
  await assert.rejects(service.suggest(query), /进行中/);
  finish(response('invalid JSON')); await assert.rejects(waiting, /格式不正确/);
  const other = fixture(t);
  const tooLong = new AiAssistant(other.file, other.secrets, async () => new Response('x'.repeat(256001)));
  tooLong.saveSettings(settings); await assert.rejects(tooLong.suggest(query), /回复过长/);
});

test('card context excludes other cards and secret fields; response parser and endpoints reject invalid values', () => {
  const text = aiCardContext({ name: '等待按钮', action: 'vision.wait_template', params: { template: 'button.png', nested: { password: 'hidden-password', api_key: 'hidden-key' } }, children: ['other-card'] });
  assert.ok(text.includes('button.png')); assert.ok(!text.includes('hidden-password')); assert.ok(!text.includes('hidden-key')); assert.ok(!text.includes('other-card'));
  assert.throws(() => aiCardContext({ params: { big: 'x'.repeat(16001) } }), /过长/);
  assert.equal(completionUrl('http://localhost:1234/v1/'), 'http://localhost:1234/v1/chat/completions');
  assert.equal(completionUrl('https://example.com/v1/chat/completions/'), 'https://example.com/v1/chat/completions');
  assert.throws(() => completionUrl('https://user:key@example.com/v1'), /不能包含/);
  assert.throws(() => completionUrl('https://example.com/v1?key=secret'), /不能包含/);
  assert.deepEqual(parseAiSuggestions('```json\n{"names":["名称"],"advice":[]}\n```').names, ['名称']);
  assert.throws(() => parseAiSuggestions('{"names":[]}'), /可用建议/);
});
