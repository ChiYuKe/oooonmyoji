/*
 * 标题栏工具条：实例/工作流选择器、面包屑、按钮事件与按 name 搜索卡片。
 * 主文件通过 window.StudioEditorToolbar({ ... }) 注入依赖；工厂会设置 window.__topbar。
 */
(() => {
  'use strict';

  window.StudioEditorToolbar = function StudioEditorToolbar(deps) {
    const { state, $, el, UI, vscode, showMenu, zoomAt, setDirty, toast, nodes, focusNode } = deps;

    function renderInstancePicker() {
      const slot = $('instance-select');
      slot.innerHTML = '';
      const instances = Array.isArray(state.instances) ? state.instances : [];
      if (!instances.length) {
        state.instanceId = '';
        const dropdown = UI.dropdown({
          value: '',
          options: [{ value: '', label: '未检测到运行实例' }],
          onChange: () => {},
          className: 'instance-slot-control',
        });
        dropdown.title = '请先启动 MuMu 或连接 Android 设备';
        slot.appendChild(dropdown);
        $('btn-run').title = '未检测到运行实例';
        return;
      }
      if (!instances.some((instance) => instance.id === state.instanceId)) state.instanceId = instances[0].id;
      const options = instances.map((instance) => {
        const label = instance.displayName
          || (instance.backend === 'mumu' && Number.isInteger(instance.mumuIndex) ? `MuMu ${instance.mumuIndex}` : instance.id);
        return {
          value: instance.id,
          label,
          title: [instance.displayName, instance.id, instance.backend, instance.adbSerial].filter(Boolean).join(' · '),
        };
      });
      const dropdown = UI.dropdown({
        value: state.instanceId,
        options,
        onChange: (value) => {
          state.instanceId = value;
          vscode.postMessage({ type: 'selectInstance', instanceId: state.instanceId });
        },
        className: 'instance-slot-control',
      });
      const selected = instances.find((instance) => instance.id === state.instanceId);
      dropdown.title = selected
        ? [selected.id, selected.displayName, selected.adbSerial].filter(Boolean).join(' · ')
        : '请先启动 MuMu 或连接 Android 设备';
      slot.appendChild(dropdown);
      $('btn-run').title = `在 ${state.instanceId} 执行当前工作流`;
    }

    function renderWorkflowPicker() {
      const slot = $('workflow-select');
      slot.innerHTML = '';
      const workflows = Array.isArray(state.workflows) ? state.workflows : [];
      const all = workflows.slice();
      if (state.docUri && !all.some((item) => item.uri === state.docUri)) {
        // 当前文件不在已发现列表（如新建未保存）时仍保留为可切换项。
        const current = state.documentName || '当前工作流';
        all.unshift({ uri: state.docUri, name: current, rel: '' });
      }
      const dropdown = UI.dropdown({
        value: state.docUri || '',
        options: all.map((item) => ({ value: item.uri, label: item.name, title: item.rel || item.uri })),
        onChange: (uri) => {
          if (!uri || uri === state.docUri) return;
          const switchTo = (saveText) => {
            state.docUri = uri; // 乐观更新，切换失败由 init 纠正
            vscode.postMessage({ type: 'switchWorkflow', uri, saveText });
          };
          if (state.dirty) {
            const rect = slot.querySelector('.ui-dropdown-button')?.getBoundingClientRect();
            showMenu(rect ? rect.left : 8, (rect ? rect.bottom : 40) + 4, [
              { label: '保存并切换', run: () => switchTo(JSON.stringify(state.raw, null, 2) + '\n') },
              { label: '放弃修改并切换', run: () => switchTo(undefined) },
              'separator',
              { label: '取消', run: () => slot.querySelector('.ui-dropdown')?.set(state.docUri) },
            ]);
          } else {
            switchTo(undefined);
          }
        },
        className: 'workflow-slot-control',
      });
      dropdown.title = '切换工作流（无需重新打开）';
      slot.appendChild(dropdown);
    }

    function navigateWorkflowTrail(index) {
      const send = (saveText) => vscode.postMessage({ type: 'navigateWorkflowTrail', index, saveText });
      if (!state.dirty) { send(undefined); return; }
      const rect = $('workflow-breadcrumb').getBoundingClientRect();
      showMenu(rect.left, rect.bottom + 4, [
        { label: '保存并跳转', run: () => send(JSON.stringify(state.raw, null, 2) + '\n') },
        { label: '放弃修改并跳转', run: () => send(undefined) },
        'separator',
        { label: '取消', run: () => {} },
      ]);
    }

    function renderWorkflowBreadcrumb() {
      const nav = $('workflow-breadcrumb');
      if (!nav) return;
      nav.innerHTML = '';
      const trail = Array.isArray(state.workflowTrail) ? state.workflowTrail : [];
      if (!trail.length) { nav.classList.add('hidden'); return; }
      nav.classList.remove('hidden');
      nav.appendChild(el('span', 'workflow-breadcrumb-mark', '◆'));
      trail.forEach((item, index) => {
        if (index > 0) nav.appendChild(el('span', 'workflow-breadcrumb-separator', '›'));
        const current = index === trail.length - 1;
        const button = el('button', `workflow-crumb${current ? ' current' : ''}`, item.name || '工作流');
        button.type = 'button';
        button.title = item.uri || item.name || '工作流';
        if (current) {
          button.disabled = true;
          button.setAttribute('aria-current', 'page');
        } else button.addEventListener('click', () => navigateWorkflowTrail(index));
        nav.appendChild(button);
      });
    }

    function bindToolbar() {
      $('btn-zoom-in').addEventListener('click', () => zoomAt(1.2));
      $('btn-zoom-out').addEventListener('click', () => zoomAt(1 / 1.2));
      $('btn-back').addEventListener('click', () => {
        const goBack = (saveText) => vscode.postMessage({ type: 'goBackWorkflow', saveText });
        if (state.dirty) {
          const rect = $('btn-back').getBoundingClientRect();
          showMenu(rect.left, rect.bottom + 4, [
            { label: '保存并返回', run: () => goBack(JSON.stringify(state.raw, null, 2) + '\n') },
            { label: '放弃修改并返回', run: () => goBack(undefined) },
            'separator',
            { label: '取消', run: () => {} },
          ]);
        } else {
          goBack(undefined);
        }
      });
      $('btn-run').addEventListener('click', () => vscode.postMessage({
        type: 'runWorkflow',
        uri: state.docUri,
        instanceId: state.instanceId,
        text: JSON.stringify(state.raw, null, 2) + '\n',
      }));
      $('btn-stop').addEventListener('click', () => vscode.postMessage({ type: 'stopWorkflow' }));
      $('btn-save').addEventListener('click', () => { vscode.postMessage({ type: 'save', text: JSON.stringify(state.raw, null, 2) + '\n' }); setDirty(false); });
      $('btn-more').addEventListener('click', () => {
        const rect = $('btn-more').getBoundingClientRect();
        showMenu(rect.right, rect.bottom + 4, [
          { label: '新建工作流', run: () => vscode.postMessage({ type: 'newWorkflow' }) },
          { label: '选择其他工作流…', run: () => vscode.postMessage({ type: 'openWorkflowPicker' }) },
          { label: '打开 JSON', run: () => vscode.postMessage({ type: 'openFile' }) },
          'separator',
          { label: '在结构树窗口查看', run: () => vscode.postMessage({ type: 'openWorkflowTree' }) },
          'separator',
          { label: '查看引用', run: () => vscode.postMessage({ type: 'openReferences' }) },
          'separator',
          { label: '重新加载', run: () => vscode.postMessage({ type: 'reloadRequest' }) },
        ], { align: 'end' });
      });
    }

    function searchNodeByName(value) {
      const query = String(value || '').trim();
      if (!query) { toast('请输入卡片 name', true); return; }
      const normalized = query.toLocaleLowerCase();
      const matches = nodes().filter((node) => String(node && node.name || '').trim().toLocaleLowerCase().includes(normalized));
      if (matches.length === 0) {
        state.nodeSearch = { query: normalized, ids: [], index: -1 };
        toast(`没有找到 name 包含“${query}”的卡片`, true);
        return;
      }
      const ids = matches.map((node) => node.id);
      const sameResults = state.nodeSearch.query === normalized
        && ids.length === state.nodeSearch.ids.length
        && ids.every((id, index) => id === state.nodeSearch.ids[index]);
      const index = sameResults ? (state.nodeSearch.index + 1) % matches.length : 0;
      const target = matches[index];
      state.nodeSearch = { query: normalized, ids, index };
      state.selected = new Set([target.id]);
      state.selectedEdge = null;
      state.selectedRun = null;
      state.inspector = 'node';
      focusNode(target.id);
      toast(`卡片 ${index + 1}/${matches.length}：${String(target.name).trim()}`);
    }

    window.__topbar = {
      setWorkflow(uri) {
        state.docUri = String(uri || '');
        renderWorkflowPicker();
      },
      setInstance(instanceId) {
        state.instanceId = String(instanceId || '');
        renderInstancePicker();
        vscode.postMessage({ type: 'selectInstance', instanceId: state.instanceId });
      },
    };

    return { renderInstancePicker, renderWorkflowPicker, renderWorkflowBreadcrumb, bindToolbar, searchNodeByName };
  };
})();
