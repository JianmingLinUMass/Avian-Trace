import { getFilterEntries } from "../filters/filter-definitions.js";
import { createSearchableSelect } from "./searchable-select.js";

let nextHeaderId = 0;

/** Render shared, local, or both sets of controls against an injected store.
 * options contains { value, label } arrays for stateCode, countyCode, and taxonId.
 * No chart code, network access, or global store is required.
 */
export function createFilterHeader({ container, store, chartId, scope = "all", options = {} }) {
  const target = typeof container === "string" ? document.querySelector(container) : container;
  if (!target) throw new Error("Filter header container was not found");
  const entries = getFilterEntries({ chartId, scope }).filter(entry => entry.definition.control !== null);
  const root = document.createElement("div");
  root.className = "filter-header";
  const controls = new Map();
  const cleanups = [];
  const headerId = ++nextHeaderId;
  let currentOptions = { ...options };
  let destroyed = false;

  const errorMessage = document.createElement("p");
  errorMessage.className = "filter-header__error";
  errorMessage.id = "filter-header-" + headerId + "-error";
  errorMessage.setAttribute("role", "alert");
  errorMessage.hidden = true;

  entries.forEach(({ key, path, definition }) => {
    const group = document.createElement("div");
    group.className = "filter-header__group";
    const label = document.createElement("label");
    const control = document.createElement(definition.control === "select" ? "select" : "input");
    control.id = "filter-header-" + headerId + "-" + key;
    control.dataset.filterPath = path;
    label.htmlFor = control.id;
    label.textContent = definition.label;
    if (definition.control === "number") {
      const { min, max } = store.getYearBounds();
      control.type = "number";
      control.min = String(min);
      control.max = String(max);
      control.step = "1";
    }
    function onChange() {
      try {
        let value;
        if (definition.control === "number") {
          value = control.value === "" ? NaN : Number(control.value);
        } else {
          const choice = controls.get(path).choices.find(item => String(item.value ?? "") === control.value);
          if (!choice) throw new Error("Invalid selection for " + definition.label);
          value = choice.value;
        }
        if (path.startsWith("shared.")) store.setShared({ [key]: value });
        else store.setChart(chartId, { [key]: value });
        clearError();
      } catch (error) {
        sync();
        errorMessage.textContent = error.message;
        errorMessage.hidden = false;
        control.setAttribute("aria-invalid", "true");
        control.setAttribute("aria-describedby", errorMessage.id);
        controls.get(path).search?.sync();
      }
    }
    control.addEventListener("change", onChange);
    cleanups.push(() => control.removeEventListener("change", onChange));
    controls.set(path, { control, choices: [] });
    group.append(label, control);
    if (key === "countyCode" || key === "taxonId") {
      const search = createSearchableSelect({ select: control, label });
      controls.get(path).search = search;
      cleanups.push(() => search.destroy());
    }
    root.append(group);
  });
  root.append(errorMessage);
  target.append(root);

  function clearError() {
    errorMessage.hidden = true;
    errorMessage.textContent = "";
    controls.forEach(({ control, search }) => {
      control.removeAttribute("aria-invalid");
      control.removeAttribute("aria-describedby");
      search?.sync();
    });
  }

  function sync() {
    const state = store.getState();
    entries.forEach(({ key, path, definition }) => {
      const item = controls.get(path);
      const value = path.startsWith("shared.") ? state.shared[key] : state.charts[chartId][key];
      if (definition.control === "select") {
        let choices = definition.options || currentOptions[key] || [];
        if (key === "countyCode") {
          choices = choices.filter(choice => state.shared.stateCode && choice.value.startsWith(state.shared.stateCode + "-"));
          item.control.disabled = !state.shared.stateCode;
        }
        if (definition.default === null) choices = [{ value: null, label: "Select " + definition.label.toLowerCase() }, ...choices];
        // Preserve valid programmatic values while option labels are loading.
        if (!choices.some(choice => choice.value === value)) choices = [...choices, { value, label: String(value) }];
        item.choices = choices;
        item.control.replaceChildren(...choices.map(choice => {
          const option = document.createElement("option");
          option.value = String(choice.value ?? "");
          option.textContent = choice.label;
          return option;
        }));
      }
      item.control.value = value === null ? "" : String(value);
      item.search?.sync();
    });
  }

  const keys = [...new Set(entries.map(entry => entry.path))];
  const unsubscribe = store.subscribe({ keys }, () => { clearError(); sync(); });
  sync();
  return {
    setOptions(nextOptions) {
      if (destroyed) return;
      currentOptions = { ...currentOptions, ...nextOptions };
      sync();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      unsubscribe();
      cleanups.forEach(cleanup => cleanup());
      root.remove();
    }
  };
}
