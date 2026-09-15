/*
 * 工作台统一 tooltip。
 *
 * 把 HTML 控件的原生 title 提示迁移成统一的 .app-tooltip 浮层，并支持三种角色：
 * - host：顶层窗口，接收子 iframe 通过 postMessage 发来的提示并渲染（main.ts / popout.ts）。
 * - embedded sender：位于 iframe 内，把提示位置转发给父窗口（workflow-editor.js / run-log.js）。
 * - standalone：不在 iframe 内，直接本地渲染（直接在浏览器打开这些页面时）。
 *
 * 位置常量、事件顺序与 .app-tooltip 类名与迁移前的各处实现保持一致。
 */
(() => {
  'use strict';

  const SOURCE = 'onmyoji-tooltip';
  const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';
  const MARGIN = 8;
  const GAP = 7;

  function rectPayload(rect) {
    return {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    };
  }

  function install(options = {}) {
    const attribute = options.attribute || 'data-tooltip';
    const scanTitles = options.scanTitles !== false;
    const ariaLabelTags = options.ariaLabelTags === undefined ? /^(BUTTON|INPUT|SELECT)$/ : options.ariaLabelTags;
    const assetPreview = Boolean(options.assetPreview);
    const bridge = options.bridge || 'none';
    const embedded = options.embedded === 'embedded'
      ? true
      : options.embedded === 'host'
        ? false
        : window.parent !== window;
    const repositionOnResize = Boolean(options.repositionOnResize);
    const hideOnScroll = Boolean(options.hideOnScroll);
    const suppressSelector = options.suppressSelector || null;
    const trimText = Boolean(options.trimText);
    const receiverFrames = typeof options.receiverFrames === 'function'
      ? options.receiverFrames
      : () => Array.from(document.querySelectorAll('iframe'));

    let tooltipNode = null;
    let activeTarget = null;
    let activeRect = null;

    const ensureTooltip = () => {
      if (!tooltipNode) {
        tooltipNode = document.createElement('div');
        tooltipNode.className = 'app-tooltip hidden';
        tooltipNode.setAttribute('role', 'tooltip');
        document.body.appendChild(tooltipNode);
      }
      return tooltipNode;
    };

    const sendToParent = (message) => {
      window.parent.postMessage(Object.assign({ source: SOURCE }, message), '*');
    };

    const position = (rect) => {
      const node = ensureTooltip();
      node.style.left = '0px';
      node.style.top = '0px';
      const width = node.offsetWidth;
      const height = node.offsetHeight;
      const x = Math.max(MARGIN, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - MARGIN));
      let y = rect.bottom + GAP;
      if (y + height > window.innerHeight - MARGIN) y = rect.top - height - GAP;
      y = Math.max(MARGIN, Math.min(y, window.innerHeight - height - MARGIN));
      node.style.left = `${Math.round(x)}px`;
      node.style.top = `${Math.round(y)}px`;
    };

    const hide = () => {
      activeTarget = null;
      activeRect = null;
      if (bridge === 'send' && embedded) sendToParent({ type: 'hide' });
      else if (tooltipNode) tooltipNode.classList.add('hidden');
    };

    const showText = (text, rect, target) => {
      const value = typeof text === 'string' ? text : '';
      if (!(trimText ? value.trim() : value)) return hide();
      activeTarget = target || null;
      activeRect = rect;
      if (bridge === 'send' && embedded) {
        sendToParent({ type: 'show', text: value, rect: rectPayload(rect) });
        return;
      }
      const node = ensureTooltip();
      node.classList.remove('asset-preview');
      node.textContent = value;
      node.classList.remove('hidden');
      position(rect);
    };

    const showAsset = (preview, rect) => {
      const uri = preview && typeof preview.uri === 'string' ? preview.uri.trim() : '';
      if (!uri) return hide();
      activeTarget = null;
      activeRect = rect;
      const node = ensureTooltip();
      node.replaceChildren();
      node.classList.add('asset-preview');
      const image = document.createElement('img');
      image.src = uri;
      image.alt = '';
      image.decoding = 'async';
      const path = document.createElement('span');
      path.className = 'app-tooltip-preview-path';
      path.textContent = preview && typeof preview.path === 'string' ? preview.path : '';
      node.append(image, path);
      node.classList.remove('hidden');
      position(rect);
      image.addEventListener('load', () => {
        if (activeRect === rect && node.classList.contains('asset-preview')) position(rect);
      }, { once: true });
      image.addEventListener('error', () => {
        if (activeRect !== rect || !node.classList.contains('asset-preview')) return;
        image.remove();
        const missing = document.createElement('div');
        missing.className = 'app-tooltip-preview-missing';
        missing.textContent = '图片无法预览';
        node.insertBefore(missing, path);
        position(rect);
      }, { once: true });
    };

    const targetForEvent = (event) => {
      const target = event.target;
      return target instanceof Element ? target.closest(`[${attribute}]`) : null;
    };

    const showElement = (target) => {
      showText(target.getAttribute(attribute) || '', rectPayload(target.getBoundingClientRect()), target);
    };

    const scan = () => {
      document.querySelectorAll('[title]').forEach((element) => {
        if (element.namespaceURI !== HTML_NAMESPACE || element.tagName === 'IFRAME') return;
        const raw = element.getAttribute('title');
        const label = raw && raw.trim();
        if (!label) return;
        element.setAttribute(attribute, label);
        element.removeAttribute('title');
        if (ariaLabelTags && !element.getAttribute('aria-label') && ariaLabelTags.test(element.tagName)) {
          element.setAttribute('aria-label', label.replace(/\s+/g, ' '));
        }
      });
    };

    if (scanTitles) {
      scan();
      const observer = new MutationObserver(scan);
      observer.observe(document.body, { attributes: true, attributeFilter: ['title'], childList: true, subtree: true });
    }

    document.addEventListener('mouseover', (event) => {
      const target = targetForEvent(event);
      if (target) {
        showElement(target);
        return;
      }
      if (suppressSelector) {
        const element = event.target instanceof Element ? event.target : null;
        if (element && element.closest(suppressSelector)) return;
      }
      hide();
    });
    document.addEventListener('mouseout', (event) => {
      if (!activeTarget || event.target !== activeTarget) return;
      const related = event.relatedTarget;
      if (!(related instanceof Node) || !activeTarget.contains(related)) hide();
    });
    document.addEventListener('focusin', (event) => {
      const target = targetForEvent(event);
      if (target) showElement(target);
    });
    document.addEventListener('focusout', (event) => {
      if (activeTarget && event.target === activeTarget) hide();
    });
    document.addEventListener('pointerdown', hide, true);
    window.addEventListener('blur', hide);
    if (repositionOnResize) {
      window.addEventListener('resize', () => {
        if (activeRect && tooltipNode && !tooltipNode.classList.contains('hidden')) position(activeRect);
      });
    }
    if (hideOnScroll) window.addEventListener('scroll', hide, true);

    if (bridge === 'receive') {
      window.addEventListener('message', (event) => {
        const message = event.data;
        if (!message || message.source !== SOURCE) return;
        if (message.type === 'hide') {
          hide();
          return;
        }
        if ((message.type !== 'show' && message.type !== 'showAsset') || !message.rect) return;
        const frame = receiverFrames().find((candidate) => candidate && candidate.contentWindow === event.source);
        if (!frame) return;
        const frameRect = frame.getBoundingClientRect();
        const rect = {
          left: frameRect.left + Number(message.rect.left || 0),
          top: frameRect.top + Number(message.rect.top || 0),
          right: frameRect.left + Number(message.rect.right || 0),
          bottom: frameRect.top + Number(message.rect.bottom || 0),
          width: Number(message.rect.width || 0),
          height: Number(message.rect.height || 0),
        };
        if (message.type === 'showAsset' && assetPreview && message.preview) showAsset(message.preview, rect);
        else if (message.type === 'show') showText(message.text || '', rect);
      });
    }

    return { show: showText, showAsset, hide, scan };
  }

  window.StudioTooltip = { install };
})();
