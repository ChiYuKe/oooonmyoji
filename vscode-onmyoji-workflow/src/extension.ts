/**
 * Onmyoji Workflow Helper 扩展入口。
 * 提供：工作流 JSON 智能补全/悬停/诊断、可视化流程图编辑器、引擎 CLI 校验。
 */
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ActionCatalog, discoverProjectRoot, loadActionCatalog } from './catalog';
import { WorkflowIntelligence } from './jsonProviders';
import { WebviewManager } from './webviewManager';

let intelligence: WorkflowIntelligence;
let webviewManager: WebviewManager;
let catalog: ActionCatalog;
let projectRoot: string;

function refreshCatalog(): void {
  catalog = loadActionCatalog(projectRoot);
  if (catalog.clashes().length > 0) {
    void vscode.window.showWarningMessage(`自定义 Action 与内置 Action 重名，已忽略自定义版本：${catalog.clashes().join(', ')}`);
  }
}

function getCatalog(): ActionCatalog {
  return catalog;
}

function updateWorkflowFileContext(): void {
  const editor = vscode.window.activeTextEditor;
  const isWorkflowFile = Boolean(editor && intelligence.isWorkflowFile(editor.document.uri));
  void vscode.commands.executeCommand('setContext', 'onmyoji.workflowFile', isWorkflowFile);
}

export function activate(context: vscode.ExtensionContext): void {
  const configuredRoot = vscode.workspace.getConfiguration('onmyoji').get<string>('projectRoot', '');
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? context.extensionUri.fsPath;
  if (configuredRoot) {
    projectRoot = path.resolve(configuredRoot);
  } else {
    projectRoot = discoverProjectRoot(workspaceRoot).root;
  }
  refreshCatalog();

  intelligence = new WorkflowIntelligence(getCatalog);
  context.subscriptions.push(intelligence, ...intelligence.registerProviders());

  webviewManager = new WebviewManager(context, intelligence, getCatalog, () => projectRoot);

  context.subscriptions.push(
    vscode.commands.registerCommand('onmyoji.openWorkflowEditor', (uri?: vscode.Uri) => webviewManager.open(uri)),
    vscode.commands.registerCommand('onmyoji.validateCurrentWorkflow', () => validateCurrentWorkflow()),
    vscode.commands.registerCommand('onmyoji.reloadActionCatalog', () => {
      refreshCatalog();
      void vscode.window.showInformationMessage(`已重新加载 Action 目录（共 ${catalog.all().length} 个：内置 + 自定义）`);
    }),
    vscode.commands.registerCommand('onmyoji.runEngineValidate', () => runEngineValidate()),
    vscode.workspace.onDidChangeTextDocument((event) => {
      void webviewManager.notifyExternalChange(event.document.uri);
    }),
    vscode.window.onDidChangeActiveTextEditor(() => updateWorkflowFileContext()),
  );
  updateWorkflowFileContext();
}

function validateCurrentWorkflow(): void {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !intelligence.isWorkflowFile(editor.document.uri)) {
    void vscode.window.showInformationMessage('请先打开一个 workflows/*.json 文件');
    return;
  }
  void (async () => {
    await intelligence.refreshDocument(editor.document);
    const doc = editor.document;
    const diags = vscode.languages.getDiagnostics(doc.uri);
    const errors = diags.filter((d) => d.severity === vscode.DiagnosticSeverity.Error);
    const warnings = diags.filter((d) => d.severity === vscode.DiagnosticSeverity.Warning);
    const messages = [`校验完成：${errors.length} 个错误，${warnings.length} 个警告。`];
    for (const d of [...errors, ...warnings].slice(0, 5)) {
      messages.push(`${d.severity === vscode.DiagnosticSeverity.Error ? '错误' : '警告'}：${d.message}`);
    }
    void vscode.window.showInformationMessage(messages.join('\n'));
    if (errors.length > 0) {
      void vscode.commands.executeCommand('workbench.actions.view.problems');
    }
  })();
}

async function runEngineValidate(): Promise<void> {
  const config = vscode.workspace.getConfiguration('onmyoji');
  let python = config.get<string>('pythonExecutable', '');
  const configPath = config.get<string>('configPath', 'config/config.json');
  if (!python) {
    const venv = path.join(projectRoot, '.venv', 'Scripts', 'python.exe');
    python = fs.existsSync(venv) ? venv : 'python';
  }
  const cli = path.join('src', 'oooonmyoji', 'cli.py');
  if (!fs.existsSync(path.join(projectRoot, cli))) {
    void vscode.window.showErrorMessage(`未找到引擎 CLI：${path.join(projectRoot, cli)}`);
    return;
  }
  const terminal = vscode.window.createTerminal({ name: 'Onmyoji 引擎校验', cwd: projectRoot });
  terminal.show();
  terminal.sendText(`${JSON.stringify(python)} -m src.oooonmyoji.cli --config ${JSON.stringify(configPath)} validate`);
}

export function deactivate(): void {
  // nothing persistent to clean up; subscriptions are disposed by VS Code
}
