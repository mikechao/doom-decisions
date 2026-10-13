// Presentation only: observe the history viewport without touching game state.
for (const panel of document.querySelectorAll<HTMLElement>('.history-panel')) {
  const history = panel.querySelector<HTMLOListElement>('#history');
  if (!history || !panel.querySelector('.history-scroll-cue')) continue;
  let scheduled = false;
  const update = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      panel.dataset.historyMore = String(
        history.clientHeight > 0 &&
          history.scrollHeight - history.clientHeight - history.scrollTop > 1,
      );
    });
  };
  const resize = new ResizeObserver(update);
  resize.observe(history);
  const observed = new Set<Element>();
  const observeRows = () => {
    for (const row of observed) {
      if (row.parentElement !== history) {
        resize.unobserve(row);
        observed.delete(row);
      }
    }
    for (const row of history.children) {
      if (!observed.has(row)) {
        observed.add(row);
        resize.observe(row);
      }
    }
    update();
  };
  new MutationObserver(observeRows).observe(history, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['open', 'hidden'],
  });
  history.addEventListener('scroll', update, { passive: true });
  observeRows();
}
