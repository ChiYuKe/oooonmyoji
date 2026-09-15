const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DEBUG_URL = process.env.ONMYOJI_CDP_URL || 'http://127.0.0.1:9333';
const ARTIFACT = path.join(__dirname, '..', 'artifacts', 'workflow-tabs-verification.png');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class CdpClient {
  constructor(url) {
    this.nextId = 1;
    this.pending = new Map();
    this.socket = new WebSocket(url);
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    }
    return result.result.value;
  }

  close() {
    this.socket.close();
  }
}

async function poll(client, expression, message, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await client.evaluate(expression);
    if (value) return value;
    await wait(100);
  }
  throw new Error(message);
}

async function clickAt(client, point) {
  await client.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: point.x,
    y: point.y,
    button: 'left',
    buttons: 1,
    clickCount: 1,
  });
  await client.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: point.x,
    y: point.y,
    button: 'left',
    buttons: 0,
    clickCount: 1,
  });
}

async function main() {
  const targets = await fetch(`${DEBUG_URL}/json`).then((response) => response.json());
  const target = targets.find((item) => item.type === 'page' && item.title === 'Onmyoji Studio');
  assert.ok(target?.webSocketDebuggerUrl, '未找到 Onmyoji Studio 调试页面');

  const client = new CdpClient(target.webSocketDebuggerUrl);
  await client.open();
  await client.send('Runtime.enable');
  await client.send('Page.enable');
  await client.send('Page.reload', { ignoreCache: true });
  await wait(1000);

  try {
    await poll(
      client,
      "document.querySelectorAll('.workflow-document-tab').length >= 1",
      '初始工作流标签未渲染',
    );

    const workflowWorkbenchPoint = await client.evaluate(`(() => {
      const visible = (node) => {
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight;
      };
      const tab = [...document.querySelectorAll('.onmyoji-workbench-dockview .dv-tab')]
        .find((node) => visible(node) && node.textContent.trim().startsWith('工作流编辑器'));
      if (!tab) return null;
      const rect = tab.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`);
    if (!workflowWorkbenchPoint) {
      const tabDiagnostics = await client.evaluate(`(() => ({
        innerHeight,
        tabs: [...document.querySelectorAll('.dv-tab')].map((node) => {
          const rect = node.getBoundingClientRect();
          return { text: node.textContent.trim(), className: node.className, left: rect.left, top: rect.top, width: rect.width, height: rect.height };
        }),
      }))()`);
      throw new Error(`未找到可见的工作流编辑器标签：${JSON.stringify(tabDiagnostics)}`);
    }
    await clickAt(client, workflowWorkbenchPoint);
    await poll(
      client,
      `(() => {
        const tab = document.querySelector('.workflow-document-tab');
        if (!tab) return false;
        const rect = tab.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight;
      })()`,
      '工作流编辑器未切换到可见状态',
    );

    const openedByDrop = await client.evaluate(`(async () => {
      const visible = (node) => {
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      let item = [...document.querySelectorAll('.content-item.workflow')].find(visible);
      if (!item) {
        const workflows = [...document.querySelectorAll('.content-item.folder')]
          .find((node) => visible(node) && node.textContent.trim().startsWith('workflows'));
        if (!workflows) throw new Error('内容浏览器中未找到 workflows 文件夹');
        workflows.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window }));
        await new Promise((resolve) => setTimeout(resolve, 300));
        item = [...document.querySelectorAll('.content-item.workflow')].find(visible);
      }
      if (!item) throw new Error('workflows 文件夹中未找到可拖动工作流');
      const transfer = new DataTransfer();
      item.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: transfer }));
      const target = document.querySelector('#workflow-document-tabs');
      if (!target) throw new Error('未找到工作流标签拖放区');
      target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }));
      target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
      item.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: transfer }));
      return transfer.getData('application/x-onmyoji-workflow');
    })()`);
    assert.ok(openedByDrop, '拖动源没有写入工作流 URI');

    await poll(
      client,
      "document.querySelectorAll('.workflow-document-tab').length >= 2",
      '拖放后没有新增工作流标签',
    );

    const firstTabPoint = await client.evaluate(`(() => {
      const tab = [...document.querySelectorAll('.workflow-document-tab')].find((node) => {
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight;
      });
      const rect = tab.getBoundingClientRect();
      return { x: rect.left + Math.min(rect.width / 2, 42), y: rect.top + rect.height / 2 };
    })()`);
    await clickAt(client, firstTabPoint);
    await poll(
      client,
      "document.querySelector('.workflow-document-tab')?.getAttribute('aria-selected') === 'true'",
      '真实坐标点击工作流标签后没有切换',
    );

    const secondTabPoint = await client.evaluate(`(() => {
      const tabs = document.querySelectorAll('.workflow-document-tab');
      const rect = tabs[tabs.length - 1].getBoundingClientRect();
      return { x: rect.left + Math.min(rect.width / 2, 42), y: rect.top + rect.height / 2 };
    })()`);
    await clickAt(client, secondTabPoint);
    await poll(
      client,
      "[...document.querySelectorAll('.workflow-document-tab')].at(-1)?.getAttribute('aria-selected') === 'true'",
      '第二个工作流标签无法通过真实坐标激活',
    );

    const visual = await client.evaluate(`(() => {
      const nativeTab = document.querySelector('.workflow-editor-tab-header .dv-tabs-container > .dv-tab');
      const documentTab = [...document.querySelectorAll('.workflow-document-tab')].find((tab) => tab.getAttribute('aria-selected') === 'true');
      const properties = ['height', 'backgroundColor', 'color', 'borderRadius', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'fontSize'];
      const styles = (node) => {
        const computed = getComputedStyle(node);
        return Object.fromEntries(properties.map((property) => [property, computed[property]]));
      };
      return {
        nativeContainerDisplay: getComputedStyle(nativeTab).display,
        native: styles(nativeTab),
        document: styles(documentTab),
        nativeClosePath: nativeTab.querySelector('.dv-default-tab-action path')?.getAttribute('d'),
        documentClosePath: documentTab.querySelector('.dv-default-tab-action path')?.getAttribute('d'),
        labels: [...document.querySelectorAll('.workflow-document-tab')].map((tab) => ({
          label: tab.querySelector('.workflow-document-tab-label')?.textContent,
          selected: tab.getAttribute('aria-selected'),
        })),
      };
    })()`);
    assert.equal(visual.nativeContainerDisplay, 'none', '重复的 Dockview 容器标签仍然可见');
    assert.deepEqual(visual.document, visual.native, '工作流文档标签与 Dockview 原生标签样式不一致');
    assert.equal(visual.documentClosePath, visual.nativeClosePath, '关闭图标与 Dockview 原生标签不一致');

    await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 800, y: 500 });
    await wait(800);
    fs.mkdirSync(path.dirname(ARTIFACT), { recursive: true });
    const capture = await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    fs.writeFileSync(ARTIFACT, Buffer.from(capture.data, 'base64'));

    const closePoint = await client.evaluate(`(() => {
      const active = [...document.querySelectorAll('.workflow-document-tab')].find((tab) => tab.getAttribute('aria-selected') === 'true');
      const close = active.querySelector('.workflow-document-tab-close');
      const rect = close.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`);
    await clickAt(client, closePoint);
    await poll(
      client,
      "document.querySelectorAll('.workflow-document-tab').length === 1",
      '真实坐标点击关闭按钮后标签没有关闭',
    );

    console.log(JSON.stringify({
      openedByDrop,
      clickedBothTabs: true,
      closedActiveTab: true,
      matchingStyles: visual.document,
      labels: visual.labels,
      screenshot: ARTIFACT,
    }, null, 2));
  } finally {
    client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
