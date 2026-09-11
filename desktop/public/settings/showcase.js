(async () => {
  const mount = document.getElementById('settings-preview');
  try {
    // Import only the inert settings fragment from the actual workbench shell.
    const response = await fetch('/index.html');
    if (!response.ok) throw new Error('无法读取工作台布局');
    const page = new DOMParser().parseFromString(await response.text(), 'text/html');
    const settings = page.getElementById('module-settings');
    if (!settings) throw new Error('未找到设置界面');
    mount.replaceChildren(document.importNode(settings, true));
    document.getElementById('settings-project-root').textContent = '当前项目 · 仅预览';
    document.getElementById('settings-auto-refresh').checked = true;
    document.getElementById('settings-default-workflow').checked = true;
    document.getElementById('settings-debug-annotate').disabled = true;
    document.getElementById('settings-debug-enabled').addEventListener('change', event => {
      document.getElementById('settings-debug-annotate').disabled = !event.target.checked;
    });
    const script = document.createElement('script'); script.src = './settings.js'; document.body.appendChild(script);
  } catch (error) { mount.textContent = `预览未能加载：${error.message}`; }
})();
