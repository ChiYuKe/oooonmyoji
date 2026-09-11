/**
 * Studio UI：紧凑桌面控件库。纯 DOM，无框架依赖。
 * 供 workflow-editor.js 与各框架页共用；样式见 ui.css。
 *
 * 维护约定：新增或修改本库的组件/图标/行为时，必须同步更新
 * ui-showcase.html（组件展示页），保证展示页始终与库保持一致。
 */
(() => {
  'use strict';

  const ICON_SVG = {
    trash: '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 4.5h11M6.5 4.5V3.2c0-.4.3-.7.7-.7h1.6c.4 0 .7.3.7.7v1.3M4.2 4.5l.5 8.3c0 .7.6 1.2 1.3 1.2h4c.7 0 1.3-.5 1.3-1.2l.5-8.3M6.6 7.2v4.3M9.4 7.2v4.3"/></svg>',
    plus: '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="8" r="6.2"/><path d="M8 5.2v5.6M5.2 8h5.6"/></svg>',
    'arrow-up': '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 13V3.5M4.5 7L8 3.5 11.5 7"/></svg>',
    'arrow-down': '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3v9.5M4.5 9L8 12.5 11.5 9"/></svg>',
    chevron: '<svg viewBox="0 0 16 16" width="11" height="11" fill="currentColor" aria-hidden="true"><path d="M4.2 6.2L8 10l3.8-3.8z"/></svg>',
    unlink: '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" aria-hidden="true"><path d="M6.2 9.8l3.6-3.6M7.6 4.6l1.2-1.2a2.4 2.4 0 013.4 3.4L11 8M8.4 11.4l-1.2 1.2a2.4 2.4 0 01-3.4-3.4L5 8M12.5 3.5l-9 9"/></svg>',
    crop: '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 1.8V11h9.2M11 14.2V5H1.8"/></svg>',
  };

  function make(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function icon(name) {
    const span = make('span', 'svg-icon');
    span.innerHTML = ICON_SVG[name] || '';
    return span;
  }

  function iconButton(className, tip, textOrIcon, onClick) {
    const button = make('button', `ui-button ${ICON_SVG[textOrIcon] ? 'ui-icon-button' : ''} ${className || ''}`);
    button.type = 'button';
    if (tip) { button.dataset.tip = tip; button.setAttribute('aria-label', tip); }
    if (ICON_SVG[textOrIcon]) button.appendChild(icon(textOrIcon));
    else button.textContent = textOrIcon;
    button.addEventListener('click', onClick);
    return button;
  }

  function button({ label = '', icon: iconName, onClick, disabled = false, variant = 'default', className = '', tip } = {}) {
    const node = make('button', `ui-button ui-button-${variant} ${className}`);
    node.type = 'button';
    node.disabled = disabled;
    if (iconName) node.appendChild(icon(iconName));
    if (label) node.appendChild(make('span', '', label));
    if (tip) { node.dataset.tip = tip; node.setAttribute('aria-label', tip); }
    if (onClick) node.addEventListener('click', onClick);
    return node;
  }

  function input({ value = '', onChange, type = 'text', className = '', label, ...options } = {}) {
    const node = make('input', `ui-input ${className}`);
    node.type = type;
    node.value = value == null ? '' : String(value);
    for (const key of ['min', 'max', 'step', 'placeholder', 'disabled', 'readOnly']) {
      if (options[key] !== undefined) node[key] = options[key];
    }
    if (label) node.setAttribute('aria-label', label);
    if (onChange) node.addEventListener('change', () => onChange(node.value));
    return node;
  }

  function checkbox({ checked = false, onChange, label, disabled = false } = {}) {
    const node = make('input', 'ui-checkbox');
    node.type = 'checkbox'; node.checked = !!checked; node.disabled = disabled;
    if (label) node.setAttribute('aria-label', label);
    if (onChange) node.addEventListener('change', () => onChange(node.checked));
    return node;
  }

  function checkField(options = {}) {
    const node = make('label', 'ui-check-field');
    node.appendChild(checkbox(options));
    node.appendChild(make('span', '', options.label || '开启'));
    return node;
  }

  function segmented({ value, options, onChange, label = '参数值来源' }) {
    const shell = make('div', 'ui-segmented');
    shell.setAttribute('role', 'group'); shell.setAttribute('aria-label', label);
    let current = String(value);
    const entries = options.map(option => {
      const node = button({ label: option.label, disabled: option.disabled, className: 'ui-segment', tip: option.title });
      node.dataset.value = String(option.value);
      node.addEventListener('click', () => {
        if (node.disabled || current === node.dataset.value) return;
        // Returning false rejects a change without leaving a misleading selected state.
        if (onChange?.(node.dataset.value) === false) return;
        current = node.dataset.value; sync();
      });
      shell.appendChild(node); return node;
    });
    function sync() {
      entries.forEach(node => {
        const selected = node.dataset.value === current;
        node.classList.toggle('active', selected);
        node.setAttribute('aria-pressed', String(selected));
      });
    }
    shell.set = next => { current = String(next); sync(); };
    sync();
    return shell;
  }

  function sectionHeader({ title, action, className = '' }) {
    const node = make('div', `ui-section-header ${className}`);
    node.appendChild(make('span', '', title));
    if (action) node.appendChild(action);
    return node;
  }

  function rect({ value, onChange, onPick, label = '区域', disabled = false }) {
    const shell = make('div', 'ui-rect');
    let values = Array.isArray(value) && value.length === 4 ? value.slice() : [0, 0, 100, 100];
    ['X', 'Y', '宽', '高'].forEach((name, index) => {
      const field = make('label', 'ui-coordinate');
      field.appendChild(make('span', '', name));
      field.appendChild(input({ value: values[index], type: 'number', step: 1, disabled, label: `${label} ${name}`, onChange: next => {
        values = values.slice(); values[index] = parseInt(next || '0', 10); onChange?.(values.slice());
      } }));
      shell.appendChild(field);
    });
    if (onPick) shell.appendChild(button({ label: '框选', disabled, onClick: onPick, tip: `框选${label}` }));
    return shell;
  }

  /* ---- 自绘 tooltip（固定定位最上层，边缘避让） ---- */
  let tooltipNode = null;
  const embedded = window.parent !== window;
  function showTip(target) {
    const text = target.dataset.tip || '';
    if (!text) return hideTip();
    const rect = target.getBoundingClientRect();
    if (embedded) {
      window.parent.postMessage({
        source: 'onmyoji-tooltip',
        type: 'show',
        text,
        rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height },
      }, '*');
      return;
    }
    if (!tooltipNode) {
      tooltipNode = make('div', 'app-tooltip hidden');
      document.body.appendChild(tooltipNode);
    }
    tooltipNode.textContent = text;
    tooltipNode.classList.remove('hidden');
    const margin = 8;
    const gap = 7;
    tooltipNode.style.left = '0px';
    tooltipNode.style.top = '0px';
    const width = tooltipNode.offsetWidth;
    const height = tooltipNode.offsetHeight;
    const x = Math.max(margin, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - margin));
    let y = rect.bottom + gap;
    if (y + height > window.innerHeight - margin) y = rect.top - height - gap;
    y = Math.max(margin, Math.min(y, window.innerHeight - height - margin));
    tooltipNode.style.left = `${Math.round(x)}px`;
    tooltipNode.style.top = `${Math.round(y)}px`;
  }
  function hideTip() {
    if (embedded) window.parent.postMessage({ source: 'onmyoji-tooltip', type: 'hide' }, '*');
    else if (tooltipNode) tooltipNode.classList.add('hidden');
  }
  function initTooltips() {
    if (initTooltips.done) return;
    initTooltips.done = true;
    document.addEventListener('mouseover', (event) => {
      const target = event.target instanceof Element ? event.target.closest('[data-tip]') : null;
      if (target) showTip(target);
      else hideTip();
    });
    document.addEventListener('mouseout', (event) => {
      if (event.target instanceof Element && event.target.closest('[data-tip]')) hideTip();
    });
    document.addEventListener('mousedown', hideTip, true);
    document.addEventListener('focusin', event => {
      const target = event.target instanceof Element ? event.target.closest('[data-tip]') : null;
      if (target) showTip(target); else hideTip();
    });
    document.addEventListener('focusout', hideTip);
    document.addEventListener('scroll', hideTip, true);
    document.addEventListener('keydown', event => { if (event.key === 'Escape') hideTip(); });
    window.addEventListener('blur', hideTip);
  }

  /* ---- 自绘下拉 ---- */
  let closeActiveDropdown = null;

  function dropdown({ value, options, onChange, searchable = false, placeholder = '搜索…', emptyText = '没有匹配项', className = '', label = '选择选项', disabled = false }) {
    const shell = make('div', `ui-dropdown${className ? ` ${className}` : ''}`);
    const entries = (options || []).map((option) => ({ ...option, value: String(option.value), label: String(option.label) }));
    let current = String(value);

    const button = make('button', 'ui-dropdown-button');
    button.type = 'button';
    button.disabled = disabled;
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-haspopup', 'listbox');
    button.setAttribute('aria-expanded', 'false');
    const renderButton = () => {
      button.innerHTML = '';
      const selected = entries.find((entry) => entry.value === current);
      button.appendChild(make('span', 'ui-dropdown-label', selected ? selected.label : current));
      if (selected && selected.detail) button.appendChild(make('span', 'ui-dropdown-detail', selected.detail));
    };
    renderButton();

    let listNode = null;
    let positionList = null;
    const close = () => {
      listNode?.remove();
      listNode = null;
      shell.classList.remove('open');
      button.setAttribute('aria-expanded', 'false');
      document.removeEventListener('mousedown', onOutside, true);
      document.removeEventListener('scroll', onScroll, true);
      document.removeEventListener('focusin', onFocus);
      window.removeEventListener('resize', onResize);
      if (closeActiveDropdown === close) closeActiveDropdown = null;
    };
    function onOutside(event) {
      if (listNode && !listNode.contains(event.target) && !shell.contains(event.target)) close();
    }
    function onFocus(event) {
      if (listNode && !listNode.contains(event.target) && !shell.contains(event.target)) close();
    }
    function onScroll(event) {
      // 允许选项列表自身滚动。否则打开时为了显示当前选项而设置
      // scrollTop，也会被误判成外部滚动，导致部分下拉框刚展开就关闭。
      const target = event.target;
      if (listNode && target instanceof Node && listNode.contains(target)) return;
      // 面板/页面滚动后 fixed 定位不再对齐，直接收起
      close();
    }
    function onResize() {
      if (listNode) positionList();
    }
    const open = () => {
      if (button.disabled) return;
      closeActiveDropdown?.();
      closeActiveDropdown = close;
      const list = make('div', 'ui-dropdown-list ui-dropdown-fixed');
      listNode = list;
      let search = null;
      let itemsBox = null;
      const renderItems = () => {
        itemsBox.innerHTML = '';
        const query = search ? search.value.trim().toLowerCase() : '';
        const visible = entries.filter((entry) => !query
          || entry.label.toLowerCase().includes(query)
          || entry.value.toLowerCase().includes(query)
          || (entry.detail || '').toLowerCase().includes(query));
        if (!visible.length) itemsBox.appendChild(make('div', 'ui-dropdown-empty', emptyText));
        for (const entry of visible) {
          const item = make('button', `ui-dropdown-item${entry.value === current ? ' selected' : ''}`);
          item.type = 'button';
          item.disabled = !!entry.disabled;
          item.setAttribute('role', 'option');
          item.setAttribute('aria-selected', String(entry.value === current));
          item.appendChild(make('span', 'ui-dropdown-item-label', entry.label));
          if (entry.detail) item.appendChild(make('span', 'ui-dropdown-item-detail', entry.detail));
          if (entry.title) item.title = entry.title;
          item.addEventListener('click', () => {
            if (item.disabled) return;
            const changed = current !== entry.value;
            close();
            current = entry.value;
            renderButton();
            button.focus();
            if (changed) onChange?.(entry.value);
          });
          itemsBox.appendChild(item);
        }
      };
      if (searchable) {
        search = make('input', 'ui-dropdown-search');
        search.type = 'text';
        search.placeholder = placeholder;
        search.setAttribute('aria-label', `搜索${label}`);
        search.addEventListener('input', renderItems);
        search.addEventListener('keydown', (event) => {
          event.stopPropagation();
          if (event.key === 'Escape') { event.preventDefault(); close(); button.focus(); }
          else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') navigate(event);
          else if (event.key === 'Enter' && !event.isComposing) {
            event.preventDefault();
            const items = enabledItems();
            (items.find(item => item.classList.contains('selected')) || items[0])?.click();
          }
        });
        list.appendChild(search);
      }
      itemsBox = make('div', 'ui-dropdown-items');
      itemsBox.setAttribute('role', 'listbox');
      itemsBox.setAttribute('aria-label', label);
      renderItems();
      list.appendChild(itemsBox);
      const enabledItems = () => [...itemsBox.querySelectorAll('.ui-dropdown-item')].filter(item => !item.disabled);
      function navigate(event) {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); button.focus(); return; }
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation();
        const items = enabledItems();
        if (!items.length) return;
        let index = items.indexOf(document.activeElement);
        if (event.key === 'Home') index = 0;
        else if (event.key === 'End') index = items.length - 1;
        else if (index < 0) index = event.key === 'ArrowDown' ? 0 : items.length - 1;
        else index = (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[index].focus();
      }
      list.addEventListener('keydown', navigate);
      document.body.appendChild(list);
      shell.classList.add('open');
      button.setAttribute('aria-expanded', 'true');
      // 挂载后测量：空间不足时向上弹出，并压低列表高度避免被视口裁剪
      positionList = () => {
        const rect = button.getBoundingClientRect();
        const availableBelow = window.innerHeight - rect.bottom - 8;
        const availableAbove = rect.top - 8;
        const chromeHeight = search ? 27 : 0;
        const space = Math.max(availableBelow, availableAbove) - chromeHeight;
        itemsBox.style.maxHeight = `${Math.max(24, Math.min(236, space))}px`;
        const width = Math.min(Math.max(rect.width, 160), window.innerWidth - 8);
        list.style.left = `${Math.round(Math.max(4, Math.min(rect.left, window.innerWidth - width - 4)))}px`;
        list.style.width = `${Math.round(width)}px`;
        if (availableBelow < Math.min(236, space) + chromeHeight && availableAbove > availableBelow) {
          list.classList.add('open-up');
          const height = list.offsetHeight;
          list.style.top = `${Math.round(Math.max(4, rect.top - height - 2))}px`;
        } else {
          list.classList.remove('open-up');
          list.style.top = `${Math.round(rect.bottom + 2)}px`;
        }
      };
      positionList();
      search?.focus();
      const selectedItem = itemsBox.querySelector('.selected');
      if (selectedItem) {
        const itemsRect = itemsBox.getBoundingClientRect();
        const selectedRect = selectedItem.getBoundingClientRect();
        itemsBox.scrollTop += selectedRect.top - itemsRect.top
          - (itemsBox.clientHeight - selectedRect.height) / 2;
      }
      document.addEventListener('scroll', onScroll, true);
      document.addEventListener('focusin', onFocus);
      window.addEventListener('resize', onResize);
      setTimeout(() => { if (listNode === list) document.addEventListener('mousedown', onOutside, true); }, 0);
    };
    button.addEventListener('click', () => {
      if (listNode) close();
      else open();
    });
    button.addEventListener('keydown', event => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault(); event.stopPropagation();
      if (!listNode) open();
      const items = [...(listNode?.querySelectorAll('.ui-dropdown-item') || [])].filter(item => !item.disabled);
      if (items?.length) items[event.key === 'ArrowUp' ? items.length - 1 : 0].focus();
    });
    shell.appendChild(button);
    // 外部同步值（如宿主控制、取消切换时恢复显示）
    shell.set = (next) => { close(); current = String(next); renderButton(); };
    return shell;
  }

  // 统一关闭：面板重建（如切换节点）或窗口失焦时清理残留弹层
  function closeDropdowns() {
    closeActiveDropdown?.();
    document.querySelectorAll('body > .ui-dropdown-list').forEach((list) => list.remove());
  }
  window.addEventListener('blur', closeDropdowns);

  window.UI = { ICON_SVG, icon, iconButton, button, input, checkbox, checkField, segmented, sectionHeader, rect,
    setTip: (node, text) => { node.dataset.tip = text; }, initTooltips, dropdown, closeDropdowns };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initTooltips);
  else initTooltips();
})();
