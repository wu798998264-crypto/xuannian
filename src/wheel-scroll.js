(function installXuanNianWheelScroll(global) {
  const boundDocuments = new WeakSet();

  function normalizedDelta(event, surface) {
    if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return event.deltaY * 40;
    if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return event.deltaY * Math.max(120, surface.clientHeight * 0.9);
    return event.deltaY;
  }

  function canScroll(element, direction) {
    if (!(element instanceof Element) || element.scrollHeight <= element.clientHeight + 1) return false;
    const overflowY = getComputedStyle(element).overflowY;
    if (!['auto', 'scroll', 'overlay'].includes(overflowY)) return false;
    if (direction < 0) return element.scrollTop > 0;
    return element.scrollTop < element.scrollHeight - element.clientHeight - 1;
  }

  function scrollableAncestor(target, direction) {
    let element = target instanceof Element ? target : target?.parentElement;
    while (element && element !== document.documentElement) {
      if (canScroll(element, direction)) return element;
      element = element.parentElement;
    }
    return null;
  }

  function bind(options = {}) {
    if (boundDocuments.has(document)) return;
    boundDocuments.add(document);
    const fallbackSelectors = Array.isArray(options.fallbackSelectors) ? options.fallbackSelectors : [];
    const pendingBySurface = new WeakMap();

    document.addEventListener('wheel', (event) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || !event.deltaY) return;
      if (event.target?.closest?.('[data-wheel-native-only]')) return;
      const direction = Math.sign(event.deltaY);
      let surface = scrollableAncestor(event.target, direction);
      if (!surface) {
        surface = fallbackSelectors
          .map((selector) => document.querySelector(selector))
          .find((candidate) => canScroll(candidate, direction));
      }
      if (!surface) return;

      const delta = normalizedDelta(event, surface);
      const existing = pendingBySurface.get(surface);
      if (existing) {
        existing.delta += delta;
        return;
      }

      const pending = { before: surface.scrollTop, delta };
      pendingBySurface.set(surface, pending);
      requestAnimationFrame(() => {
        pendingBySurface.delete(surface);
        if (!surface.isConnected || surface.scrollTop !== pending.before) return;
        const maxScrollTop = Math.max(0, surface.scrollHeight - surface.clientHeight);
        surface.scrollTop = Math.max(0, Math.min(maxScrollTop, pending.before + pending.delta));
      });
    }, { passive: true });
  }

  global.XuanNianWheelScroll = Object.freeze({ bind });
})(window);
