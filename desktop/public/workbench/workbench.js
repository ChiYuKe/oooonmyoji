(() => {
  const menus = [...document.querySelectorAll('.tool-overflow')];
  menus.forEach(menu => {
    const trigger = menu.querySelector('summary');
    const entries = [...menu.querySelectorAll('button')];
    menu.addEventListener('toggle', () => {
      if (menu.open) menus.forEach(other => { if (other !== menu) other.open = false; });
    });
    menu.addEventListener('click', event => { if (event.target.closest('button')) { menu.open = false; trigger.focus(); } });
    menu.addEventListener('keydown', event => {
      if (event.key === 'Escape') { menu.open = false; trigger.focus(); }
      if (!['ArrowDown','ArrowUp','Home','End'].includes(event.key)) return;
      event.preventDefault(); menu.open = true;
      const current = entries.indexOf(event.target);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? entries.length-1 : current < 0 ? (event.key === 'ArrowDown' ? 0 : entries.length-1) : (current+(event.key==='ArrowDown'?1:-1)+entries.length)%entries.length;
      entries[next]?.focus();
    });
    menu.addEventListener('focusout', event => { if (!menu.contains(event.relatedTarget)) menu.open = false; });
  });
  document.addEventListener('pointerdown', event => menus.forEach(menu => { if (!menu.contains(event.target)) menu.open = false; }));
})();
