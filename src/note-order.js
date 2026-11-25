function compareNoteOrder(a, b) {
  return Number(a.order || 9999) - Number(b.order || 9999) || Number(b.createdAt || 0) - Number(a.createdAt || 0);
}

// Keep hidden or newly added notes in their slots when a filtered subset moves.
function applyNoteOrder(notes, projectId, orderedIds) {
  const project = notes.filter(note => note.projectId === projectId).sort(compareNoteOrder);
  const known = new Set(project.map(note => note.id));
  const moved = new Set(orderedIds.filter(id => known.has(id)));
  const next = moved.values();
  const ranks = new Map(project.map((note, i) => [moved.has(note.id) ? next.next().value : note.id, i + 1]));
  return notes.map(note => note.projectId === projectId && note.order !== ranks.get(note.id)
    ? { ...note, order: ranks.get(note.id) } : note);
}

if (typeof module !== 'undefined') module.exports = { applyNoteOrder, compareNoteOrder };
