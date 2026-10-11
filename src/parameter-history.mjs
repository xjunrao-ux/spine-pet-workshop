// One pointer gesture is one undo step. Values contain parameters, never model/audio assets.
export function createHistory(initial, limit = 80) {
  let entries = [initial], index = 0, gesture = false;
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  return {
    get: () => entries[index],
    canUndo: () => index > 0, canRedo: () => index < entries.length - 1,
    begin() { gesture = false; },
    push(value, grouped = false) {
      if (equal(entries[index], value)) return;
      if (grouped && gesture) entries[index] = value;
      else { entries = entries.slice(0, index + 1); entries.push(value); index++; gesture = grouped;
        if (entries.length > limit) { entries.shift(); index--; } }
    },
    end() { gesture = false; },
    undo() { gesture = false; if (index > 0) index--; return entries[index]; },
    redo() { gesture = false; if (index < entries.length - 1) index++; return entries[index]; },
    reset(value) { entries = [value]; index = 0; gesture = false; }
  };
}
