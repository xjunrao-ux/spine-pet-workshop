import { PARAMETER_FIELDS, normalizeParameters } from "../electron/character-parameters.mjs";
import { createHistory } from "./parameter-history.mjs";

let activeEditor: HTMLElement | undefined;

export function createParameterEditor(host: HTMLElement, initial: unknown, onChange: (value: PetParameters) => void, historyHost: HTMLElement = host) {
  let value = normalizeParameters(initial);
  const history = createHistory(value);
  let dragging = false;
  host.replaceChildren();
  const controls = new Map<string, Array<HTMLInputElement | HTMLSelectElement>>();
  const toolbar = document.createElement('div'); toolbar.className = 'parameter-history';
  const undo = document.createElement('button'), redo = document.createElement('button');
  undo.type = redo.type = 'button';
  const arrow = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4 4 9l5 5M4 9h9a6 6 0 0 1 0 12"/></svg>';
  undo.innerHTML = arrow; redo.innerHTML = arrow;
  undo.setAttribute('aria-label', '撤销'); redo.setAttribute('aria-label', '重做');
  undo.dataset.history = 'undo'; redo.dataset.history = 'redo';
  undo.title = '撤销 · Ctrl+Z'; redo.title = '重做 · Ctrl+Shift+Z / Ctrl+Y';
  toolbar.append(undo, redo); historyHost.replaceChildren(toolbar);
  toolbar.addEventListener('pointerdown', () => { activeEditor = host; });
  const displayed = (element: HTMLInputElement | HTMLSelectElement, key: string) =>
    element.dataset.reverse ? Number(element.getAttribute('min')) + Number(element.getAttribute('max')) - Number(value[key]) : value[key];
  const refresh = () => {
    for (const [key, elements] of controls) for (const element of elements) element.value = String(displayed(element, key));
    undo.disabled = !history.canUndo(); redo.disabled = !history.canRedo();
  };
  const restore = (next: PetParameters) => { value = next; refresh(); onChange(value); };
  undo.addEventListener('click', () => restore(history.undo()));
  redo.addEventListener('click', () => restore(history.redo()));
  host.addEventListener('pointerdown', () => { activeEditor = host; });
  host.addEventListener('focusin', () => { activeEditor = host; });
  window.addEventListener('keydown', event => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || host.getClientRects().length === 0) return;
    if (activeEditor !== host && activeEditor?.getClientRects().length) return;
    const target = event.target as HTMLElement;
    // Preserve native text undo in names, subtitles and unrelated inputs.
    if (target instanceof HTMLTextAreaElement || target.isContentEditable ||
      (target instanceof HTMLInputElement && !target.dataset.parameter)) return;
    const key = event.key.toLowerCase();
    if (key !== 'z' && key !== 'y') return;
    event.preventDefault(); event.stopPropagation(); activeEditor = host;
    restore(key === 'y' || event.shiftKey ? history.redo() : history.undo());
  });
  for (const field of PARAMETER_FIELDS) {
    const row = document.createElement("div");
    row.className = "parameter-row";
    const label = document.createElement("label");
    label.textContent = `${field.label}${field.unit ? `（${field.unit}）` : ""}`;
    const group = document.createElement("div");
    group.className = "parameter-controls";
    const elements: Array<HTMLInputElement | HTMLSelectElement> = [];
    if (field.options) {
      const select = document.createElement("select");
      for (const option of field.options) select.add(new Option(option.label, option.value));
      elements.push(select);
    } else {
      for (const type of ["range", "number"]) {
        const input = document.createElement("input");
        input.type = type;
        input.min = String(field.min); input.max = String(field.max); input.step = String(field.step);
        if (type === 'range' && field.reverse) { input.dataset.reverse = 'true'; input.title = '向右提高气泡（偏移值减小）'; }
        if (type === 'range') {
          input.addEventListener('pointerdown', () => { dragging = true; history.begin(); });
          const finish = () => { dragging = false; history.end(); };
          window.addEventListener('pointerup', finish); window.addEventListener('pointercancel', finish);
        }
        elements.push(input);
      }
    }
    for (const element of elements) {
      element.value = String(displayed(element, field.key));
      element.setAttribute("aria-label", field.label);
      element.dataset.parameter = field.key;
      element.addEventListener("input", () => {
        if (element instanceof HTMLInputElement && (element.value === "" || !element.validity.valid)) return;
        const next = element.dataset.reverse ? Number(element.getAttribute('min')) + Number(element.getAttribute('max')) - Number(element.value) : Number(element.value);
        value = normalizeParameters({ ...value, [field.key]: field.options ? element.value : next });
        history.push(value, dragging);
        for (const sibling of elements) if (sibling !== element) sibling.value = String(displayed(sibling, field.key));
        onChange(value);
        refresh();
      });
      element.addEventListener("change", () => { element.value = String(displayed(element, field.key)); });
      group.append(element);
    }
    controls.set(field.key, elements);
    const hint = document.createElement("p"); hint.className = "hint"; hint.textContent = field.hint;
    label.append(group); row.append(label, hint); host.append(row);
  }
  refresh();
  return {
    get: () => value,
    set: (next: unknown, resetHistory = false) => {
      value = normalizeParameters(next);
      if (resetHistory) history.reset(value); else history.push(value);
      refresh();
      onChange(value);
    }
  };
}
