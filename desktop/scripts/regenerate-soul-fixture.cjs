// 重新生成 soul-calculator.html fixture（与 soul-ui-smoke.cjs 相同的提取逻辑），
// 让 smoke 页面带上最新的 styles.css（含御魂配装面板样式）。
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..'), project = path.dirname(root), artifacts = path.join(project, 'artifacts/soul-ui');
const source = fs.readFileSync(path.join(root, 'src/renderer/index.html'), 'utf8');
const panel = source.match(/<div id="team-builder-soul-calculator"[\s\S]*?\n            <\/div>/)[0];
const css = fs.readFileSync(path.join(root, 'src/renderer/styles.css'), 'utf8').replace(/^@import[^;]*;/, '');
const palette = ['workbench-light.css', 'theme.css'].map(name => fs.readFileSync(path.join(root, 'public/theme', name), 'utf8')).join('\n');
const font = pathToFileURL(path.join(root, 'public/fonts/harmonyos-sans-sc/Regular.css')).href;
const html = `<!doctype html><html lang="zh-CN" data-theme="dark"><meta charset="UTF-8"><link rel="stylesheet" href="${font}"><style>${css}\n${palette}</style><body><section class="team-builder-content" style="height:100vh"><header class="team-builder-pane-header">御魂计算</header>${panel}</section></body></html>`;
fs.writeFileSync(path.join(artifacts, 'soul-calculator.html'), html);
console.log(`fixture regenerated: ${html.length} bytes`);
