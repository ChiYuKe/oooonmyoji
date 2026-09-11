(() => {
  'use strict';
  const root = document.getElementById('module-settings');
  if (!root) return;
  const tabs = [...root.querySelectorAll('[data-settings-page]')];
  function select(tab) {
    tabs.forEach(item => {
      const active = item === tab;
      item.classList.toggle('active', active); item.setAttribute('aria-selected', String(active)); item.tabIndex = active ? 0 : -1;
      root.querySelector(`#settings-page-${item.dataset.settingsPage}`).classList.toggle('hidden', !active);
    });
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => select(tab));
    tab.addEventListener('keydown', event => {
      if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + tabs.length) % tabs.length;
      select(tabs[next]); tabs[next].focus();
    });
  });
  const choices = [...root.querySelectorAll('[name="appearance-theme"]')];
  const theme = window.StudioTheme;
  function sync(value) { choices.forEach(choice => { choice.checked = choice.value === value; }); }
  theme.subscribe(sync);
  choices.forEach(choice => choice.addEventListener('change', () => {
    if (!choice.checked) return;
    const saved = theme.set(choice.value);
    sync(theme.get());
    root.querySelector('#settings-theme-feedback').textContent = saved ? `已切换到${theme.get() === 'light' ? '浅色' : '深色'}，下次启动沿用。` : '主题保存失败，已保留原设置。';
  }));
})();
