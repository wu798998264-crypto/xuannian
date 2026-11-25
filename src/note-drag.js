// The list owns the gesture because its virtual rows can disappear while scrolling.
function bindFavoriteRowDrag(list, { rowHeight, rowGap, rowAttribute = 'data-note-card', items, project, onStart, onEnd, onDrop }) {
  let drag = null;
  let frame = 0;
  let blockClick = false;

  function queueFrame() {
    if (drag?.ghost && !frame) frame = requestAnimationFrame(paint);
  }

  function targetAt(x, y) {
    const hit = document.elementFromPoint(x, y);
    const category = hit?.closest('#noteProjectList [data-project-id]');
    if (category && category.dataset.projectId !== drag.projectId) return { category };
    if (!hit || !list.contains(hit)) return {};
    const rect = list.getBoundingClientRect();
    const offset = y - rect.top - list.clientTop + list.scrollTop;
    const slot = Math.max(0, Math.min(items().length, Math.round((offset - drag.firstGap) / rowHeight)));
    return { slot, rect };
  }

  function paint(time) {
    frame = 0;
    if (!drag?.ghost) return;
    const { x, y, ghost, line } = drag;
    if (project() !== drag.projectId || !list.getClientRects().length) { cancel(); return; }
    ghost.style.transform = `translate3d(${x + 12}px,${y + 12}px,0)`;
    const target = targetAt(x, y);
    if (target.category !== drag.category) {
      drag.category?.classList.remove('drag-target');
      target.category?.classList.add('drag-target');
      drag.category = target.category;
    }
    line.hidden = !target.rect;
    if (target.rect) {
      const rect = target.rect;
      const lineY = rect.top + list.clientTop + target.slot * rowHeight + drag.firstGap - list.scrollTop;
      line.style.width = Math.max(0, list.clientWidth - 8) + 'px';
      line.style.transform = `translate3d(${rect.left + list.clientLeft + 4}px,${Math.min(rect.bottom - 3, Math.max(rect.top, lineY - 1))}px,0)`;
      const edge = Math.min(64, rect.height / 4);
      const speed = Math.max(0, 1 - (rect.bottom - y) / edge) - Math.max(0, 1 - (y - rect.top) / edge);
      const elapsed = Math.min(32, Math.max(1, time - (drag.lastPaint || time - 16)));
      if ((speed < 0 && list.scrollTop > 0) || (speed > 0 && list.scrollTop < list.scrollHeight - list.clientHeight - 1)) {
        list.scrollTop += Math.sign(speed) * Math.max(1, Math.abs(speed) * elapsed * 1.15);
        queueFrame();
      }
    }
    drag.lastPaint = time;
  }

  function cancel() {
    if (!drag) return;
    const previous = drag;
    drag = null;
    cancelAnimationFrame(frame);
    frame = 0;
    if (list.hasPointerCapture(previous.pointerId)) list.releasePointerCapture(previous.pointerId);
    if (!previous.ghost) return;
    previous.ghost.remove();
    previous.line.remove();
    previous.category?.classList.remove('drag-target');
    list.querySelector('.dragging')?.classList.remove('dragging');
    document.body.classList.remove('note-sorting');
    onEnd();
  }

  list.addEventListener('pointerdown', event => {
    if (drag || event.button !== 0 || !event.isPrimary) return;
    blockClick = false;
    const card = event.target.closest('[' + rowAttribute + ']');
    if (!card || event.target.closest('button,a,input,textarea,select,[contenteditable="true"]')) return;
    drag = { id: card.getAttribute(rowAttribute), card, pointerId: event.pointerId, projectId: project(),
      startX: event.clientX, startY: event.clientY };
  });
  // Images have a native browser drag of their own. Single clicks still reach the preview.
  list.addEventListener('dragstart', event => { if (drag) event.preventDefault(); });
  window.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (!(event.buttons & 1)) { cancel(); return; }
    drag.x = event.clientX;
    drag.y = event.clientY;
    if (!drag.ghost) {
      if (Math.hypot(drag.x - drag.startX, drag.y - drag.startY) < 4) return;
      if (!drag.card.isConnected) {
        drag.card = list.querySelector('[' + rowAttribute + '="' + CSS.escape(drag.id) + '"]');
        if (!drag.card || project() !== drag.projectId) { cancel(); return; }
      }
      list.setPointerCapture(event.pointerId);
      // Main and quick lists space their rows with different padding and margins.
      drag.firstGap = parseFloat(getComputedStyle(list).paddingTop) + parseFloat(getComputedStyle(drag.card).marginTop) - rowGap / 2;
      drag.ghost = document.createElement('div');
      drag.ghost.className = 'note-sort-ghost';
      drag.ghost.style.transform = `translate3d(${drag.x + 12}px,${drag.y + 12}px,0)`;
      drag.ghost.setAttribute('aria-hidden', 'true');
      drag.ghost.textContent = (drag.card.querySelector('.note-card-title,.record-title,.item-main .title,.item-main .text')?.textContent
        || drag.card.querySelector('.bubble-attachment,.note-thumb-name')?.textContent.trim()
        || drag.card.querySelector('img')?.alt || '收藏').slice(0, 80);
      drag.line = document.createElement('div');
      drag.line.className = 'note-sort-line';
      drag.line.hidden = true;
      document.body.append(drag.ghost, drag.line);
      document.body.classList.add('note-sorting');
      drag.card.classList.add('dragging');
      blockClick = true;
      onStart(drag.id);
    }
    queueFrame();
  });
  window.addEventListener('pointerup', event => {
    if (event.pointerId !== drag?.pointerId) return;
    const { id, projectId, ghost } = drag;
    const target = ghost && project() === projectId ? targetAt(event.clientX, event.clientY) : {};
    cancel();
    if (target.category || target.slot !== undefined) onDrop(id, projectId, target.slot, target.category?.dataset.projectId);
  });
  list.addEventListener('click', event => {
    if (!blockClick || !event.detail) return;
    blockClick = false;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
  window.addEventListener('pointercancel', event => { if (event.pointerId === drag?.pointerId) cancel(); });
  window.addEventListener('blur', cancel);
  window.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !drag?.ghost) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    cancel();
  }, true);
  list.addEventListener('scroll', queueFrame, { passive: true });
}

async function reorderFavoriteRow(draggedId, projectId, slot, { items, state, api, render, toast }) {
  const ids = items.map(item => item.id);
  const from = ids.indexOf(draggedId);
  const to = slot > from ? slot - 1 : slot;
  if (from < 0 || from === to) return;
  ids.splice(from, 1);
  ids.splice(to, 0, draggedId);
  const previous = state.notes;
  const reordered = applyNoteOrder(previous, projectId, ids);
  state.notes = reordered;
  render();
  try {
    const saved = await api.reorderNotes(projectId, ids);
    if (state.notes === reordered) state.notes = saved;
  } catch {
    if (state.notes === reordered) { state.notes = previous; render(); }
    toast('收藏顺序保存失败，请重试');
  }
}
