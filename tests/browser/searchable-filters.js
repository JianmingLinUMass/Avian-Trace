import { createFilterHeader } from "/components/filter-header.js";
import { createFilterStore } from "/filters/filter-store.js";
const assert = (value, message) => { if (!value) throw new Error(message); };
const container = document.querySelector("#fixture"), results = document.querySelector("#results");
const store = createFilterStore();
const options = {
  stateCode: [{ value: "US-MA", label: "Massachusetts" }, { value: "US-NY", label: "New York" }],
  countyCode: [{ value: "US-MA-017", label: "Middlesex County" }, { value: "US-MA-025", label: "Suffolk County" }, { value: "US-NY-061", label: "New York County" }],
  taxonId: [{ value: "bird-1", label: "Blue Jay" }, { value: "bird-2", label: "Northern Cardinal" }, { value: "bird-3", label: "Blue Jay" }]
};
const header = createFilterHeader({ container, store, scope: "shared", options });
const county = container.querySelector('[data-search-for="shared.countyCode"]');
const species = container.querySelector('[data-search-for="shared.taxonId"]');
const list = input => document.getElementById(input.getAttribute("aria-controls"));
function search(input, text) { input.focus(); input.value = text; input.dispatchEvent(new Event("input", { bubbles: true })); }
function key(input, value) { input.dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true })); }
try {
  assert(county.disabled, "County disabled without state");
  store.setShared({ stateCode: "US-MA" });
  search(county, "MiDdLe");
  assert(list(county).querySelectorAll('[role="option"]').length === 1, "Case-insensitive substring matching");
  assert(store.getState().shared.countyCode === null, "Typing must not commit");
  key(county, "Enter");
  assert(store.getState().shared.countyCode === "US-MA-017" && county.value === "Middlesex County", "Enter commits ID and displays label");
  search(county, "no such county");
  assert(list(county).textContent === "No matches", "No matches feedback");
  key(county, "Enter");
  assert(store.getState().shared.countyCode === "US-MA-017", "Unmatched input must not change selection");
  key(county, "Escape");
  assert(county.value === "Middlesex County" && list(county).hidden, "Escape restores selection");
  search(county, "025"); list(county).querySelector('[role="option"]').click();
  assert(store.getState().shared.countyCode === "US-MA-025", "ID search and mouse selection");
  store.setShared({ countyCode: "US-MA-017" });
  assert(county.value === "Middlesex County", "External selection sync");
  search(county, "Suffolk"); store.setShared({ stateCode: "US-NY" });
  assert(county.value === "" && list(county).hidden, "State change clears stale search");
  search(county, "Middlesex");
  assert(!list(county).querySelector('[role="option"]'), "Counties respect state");
  key(county, "Escape");
  search(species, "blue");
  assert(list(species).textContent.includes("[bird-1]") && list(species).textContent.includes("[bird-3]"), "Duplicate names disambiguated");
  key(species, "ArrowDown"); key(species, "Enter");
  assert(store.getState().shared.taxonId === "bird-3", "Arrow navigation selects canonical ID");
  search(species, "cardinal");
  header.setOptions({ taxonId: [...options.taxonId, { value: "bird-4", label: "Other bird" }] });
  assert(species.value === "cardinal", "Option refresh preserves search");
  key(species, "Enter");
  assert(store.getState().shared.taxonId === "bird-2", "Refreshed choices work");
  search(species, "uncommitted"); species.blur();
  assert(species.value === "Northern Cardinal", "Blur restores committed value");
  search(species, ""); list(species).querySelector('[role="option"]').click();
  assert(store.getState().shared.taxonId === null, "Clear selection");
  const second = createFilterHeader({ container, store, scope: "shared", options });
  const ids = [...document.querySelectorAll('[id]')].map(node => node.id);
  assert(ids.length === new Set(ids).size, "Multiple headers have unique IDs");
  second.destroy(); header.destroy(); header.destroy();
  assert(!document.querySelector('.filter-search-options') && !container.children.length, "Teardown removes controls and portals");
  results.textContent = "PASS — search, keyboard/mouse selection, duplicate names, state filtering, external sync, option refresh, clearing and teardown";
  document.title = "PASS — Searchable filter regression checks";
} catch (error) { results.textContent = "FAIL\n" + error.stack; document.title = "FAIL — Searchable filter regression checks"; throw error; }
