// Presentation only. The history element owns observer/listener cleanup.
export function observeHistoryScroll(
  panel: HTMLElement,
  history: HTMLOListElement,
) {
  let scheduled = false;
  let frame = 0;
  let active = true;
  const update = () => {
    if (scheduled) return;
    scheduled = true;
    frame = requestAnimationFrame(() => {
      scheduled = false;
      if (!active) return;
      panel.dataset.historyMore = String(
        panel.dataset.historyView !== 'detail' &&
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
  const mutations = new MutationObserver(observeRows);
  mutations.observe(panel, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['hidden', 'data-history-view'],
  });
  history.addEventListener('scroll', update, { passive: true });
  observeRows();
  return () => {
    active = false;
    cancelAnimationFrame(frame);
    resize.disconnect();
    mutations.disconnect();
    history.removeEventListener('scroll', update);
  };
}
