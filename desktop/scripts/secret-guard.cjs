const path = require('node:path');

function isSecretFile(file) {
  const normalized = file.replace(/^"|"$/g, '').replace(/\\/g, '/').toLowerCase();
  const name = path.posix.basename(normalized);
  return /^ai-settings\.json(?:[.~-].*)?$/.test(name)
    || (name === '.env' || name.startsWith('.env.')) && !['.env.example', '.env.sample', '.env.template'].includes(name)
    || /\.(?:pem|key)$/.test(name)
    || ['credentials.json', 'secrets.json'].includes(name)
    || normalized === 'config/config.json' || normalized.endsWith('/config/config.json');
}

// Only explicit non-credential examples are allowed, never arbitrary substrings like "test".
function isPlaceholder(value) {
  return !value || /^(?:private-test-key|isolated-smoke-key|smoke-only-key|hidden-key|hidden-password|new-key|dummy|example|placeholder|your[-_]api[-_]key|YOUR_API_KEY|API_KEY|\[已隐藏\]|<[^>]+>)$/.test(value);
}

function findSecrets(file, buffer) {
  const issues = [];
  if (isSecretFile(file)) issues.push({ file, line: 1, reason: '本机凭据文件不可提交' });
  if (buffer.includes(0)) return issues;
  const text = buffer.toString('utf8');
  const patterns = [
    { regex: /\bsk-(?:proj-|ant-api\d+-)?[A-Za-z0-9_-]{20,}\b/g, reason: '疑似 AI API Key' },
    { regex: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/g, reason: '疑似 GitHub Token' },
    { regex: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, reason: '疑似云服务访问密钥' },
    { regex: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/g, reason: '私钥内容' },
  ];
  const add = (index, reason) => issues.push({ file, line: text.slice(0, index).split('\n').length, reason });
  for (const { regex, reason } of patterns) for (const match of text.matchAll(regex)) add(match.index, reason);
  const assignments = /["']?\b(?:[a-z0-9]+[_-])*(api[_-]?key|encryptedKey|access[_-]?token|auth[_-]?token|client[_-]?secret|secret[_-]?access[_-]?key|password)\b["']?\s*[:=]\s*(["'`])([^\r\n]*?)\2/gi;
  for (const match of text.matchAll(assignments)) {
    if (!isPlaceholder(match[3]) && !match[3].includes('${')) add(match.index, '凭据字段含非空固定值');
  }
  for (const match of text.matchAll(/\bBearer\s+([A-Za-z0-9_.-]{8,})/g)) {
    if (!isPlaceholder(match[1])) add(match.index, '固定的 Bearer 凭据');
  }
  return issues;
}

module.exports = { isSecretFile, findSecrets };
