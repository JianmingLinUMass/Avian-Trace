const alphabetical = new Intl.Collator("en", { sensitivity: "base", numeric: true });

export function rankSearchOptions(options, query) {
  const term = query.trim().toLocaleLowerCase();
  if (!term) return options.filter(option => !option.disabled);
  function score(text) {
    const value = text.toLocaleLowerCase();
    if (value === term) return 0;
    if (value.startsWith(term)) return 1;
    for (let index = value.indexOf(term); index !== -1; index = value.indexOf(term, index + 1)) {
      if (!/[\p{L}\p{N}]/u.test(value[index - 1])) return 2;
    }
    return value.includes(term) ? 3 : Infinity;
  }
  return options.filter(option => !option.disabled && option.value)
    .map(option => ({ option, rank: Math.min(score(option.textContent), score(option.value)) }))
    .filter(item => Number.isFinite(item.rank))
    .sort((a, b) => a.rank - b.rank || alphabetical.compare(a.option.textContent, b.option.textContent) || alphabetical.compare(a.option.value, b.option.value))
    .map(item => item.option);
}

/** Add a searchable combobox while retaining the select's canonical values/change events. */
export function createSearchableSelect({ select, label }) {
  const input = document.createElement("input");
  input.type = "search";
  input.id = select.id + "-search";
  input.className = "filter-header__search";
  input.dataset.searchFor = select.dataset.filterPath;
  input.autocomplete = "off";
  input.placeholder = "Search " + label.textContent.toLowerCase();
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-expanded", "false");
  const list = document.createElement("div");
  list.id = input.id + "-options";
  list.className = "filter-search-options";
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", label.textContent);
  list.hidden = true;
  input.setAttribute("aria-controls", list.id);
  select.hidden = true;
  label.htmlFor = input.id;
  select.after(input);
  document.body.append(list);
  let open = false;
  let active = -1;
  let matches = [];
  let previousValue;
  let previousDisabled;
  const listeners = [];
  function on(target, event, handler, options) {
    target.addEventListener(event, handler, options);
    listeners.push(() => target.removeEventListener(event, handler, options));
  }
  function restore() {
    input.value = select.value ? select.selectedOptions[0]?.textContent || select.value : "";
  }
  function close() {
    open = false;
    list.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    restore();
  }
  function position() {
    const rect = input.getBoundingClientRect();
    const width = Math.min(Math.max(rect.width, 280), window.innerWidth - 16);
    const below = window.innerHeight - rect.bottom - 8;
    const above = rect.top - 8;
    const upwards = below < 180 && above > below;
    const available = Math.max(40, Math.min(260, upwards ? above : below));
    Object.assign(list.style, {
      width: width + "px", left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)) + "px",
      maxHeight: available + "px", top: upwards ? "auto" : rect.bottom + 4 + "px",
      bottom: upwards ? window.innerHeight - rect.top + 4 + "px" : "auto"
    });
  }
  function highlight() {
    [...list.querySelectorAll('[role="option"]')].forEach((node, i) => {
      node.classList.toggle("is-active", i === active);
    });
    const node = list.children[active];
    if (node && active >= 0) {
      input.setAttribute("aria-activedescendant", node.id);
      node.scrollIntoView({ block: "nearest" });
    } else input.removeAttribute("aria-activedescendant");
  }
  function choose(index) {
    const choice = matches[index];
    if (!choice) return;
    select.value = choice.value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    close();
  }
  function show(query = "") {
    if (input.disabled) return;
    const term = query.trim().toLocaleLowerCase();
    const options = [...select.options];
    matches = rankSearchOptions(options, term);
    list.replaceChildren();
    const counts = new Map();
    options.forEach(option => counts.set(option.textContent, (counts.get(option.textContent) || 0) + 1));
    matches.forEach((option, index) => {
      const node = document.createElement("div");
      node.id = list.id + "-" + index;
      node.setAttribute("role", "option");
      node.setAttribute("aria-selected", String(option.value === select.value));
      node.textContent = option.value ? option.textContent : "Clear selection";
      if (option.value && counts.get(option.textContent) > 1) node.textContent += " [" + option.value + "]";
      node.dataset.index = String(index);
      list.append(node);
    });
    if (!matches.length) {
      const empty = document.createElement("div");
      empty.className = "filter-search-options__empty";
      empty.setAttribute("role", "status");
      empty.textContent = "No matches";
      list.append(empty);
    }
    active = term ? (matches.length ? 0 : -1) : matches.findIndex(option => option.value === select.value);
    open = true;
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
    position();
    highlight();
  }
  on(input, "focus", () => { show(); input.select(); });
  on(input, "click", () => { if (!open) { show(); input.select(); } });
  on(input, "input", () => show(input.value));
  on(input, "blur", close);
  on(input, "keydown", event => {
    if (event.key === "Escape") { event.preventDefault(); if (open) event.stopPropagation(); close(); }
    else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) show();
      else { active = Math.max(0, Math.min(matches.length - 1, active + (event.key === "ArrowDown" ? 1 : -1))); highlight(); }
    } else if (event.key === "Enter" && open) { event.preventDefault(); choose(active); }
  });
  on(list, "pointerdown", event => event.preventDefault());
  on(list, "click", event => {
    const node = event.target.closest('[role="option"]');
    if (node) choose(Number(node.dataset.index));
  });
  on(window, "resize", () => { if (open) position(); });
  on(document, "scroll", event => { if (open && !list.contains(event.target)) position(); }, true);
  function sync() {
    input.disabled = select.disabled;
    const changed = previousValue !== select.value || previousDisabled !== select.disabled;
    previousValue = select.value;
    previousDisabled = select.disabled;
    if (changed || !open) close();
    else show(input.value);
    for (const name of ["aria-invalid", "aria-describedby"]) {
      if (select.hasAttribute(name)) input.setAttribute(name, select.getAttribute(name));
      else input.removeAttribute(name);
    }
  }
  sync();
  return { sync, destroy() { listeners.forEach(remove => remove()); list.remove(); input.remove(); select.hidden = false; label.htmlFor = select.id; } };
}
