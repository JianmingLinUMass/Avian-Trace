import { rankSearchOptions } from "../../components/searchable-select.js";
import { formatChecklistCounts, formatFrequency } from "../../helpers/reporting-frequency.js";
import { listItinerarySpecies } from "./itinerary-data.js";

const PREVIEW_COUNT = 8;
let nextPanelId = 0;

function element(document, tag, value, className) {
  const node = document.createElement(tag);
  node.textContent = value;
  if (className) node.className = className;
  return node;
}

export function createItinerarySpeciesPanel(document, hotspots, taxa, period, query, onQuery) {
  const species = listItinerarySpecies(hotspots, taxa);
  const section = element(document, "section", "", "itinerary-species");
  const id = "itinerary-species-" + (++nextPanelId);
  const title = element(document, "h3", "Birds you might see");
  title.id = id;
  section.setAttribute("aria-labelledby", id);
  section.append(title, element(document, "p", "Estimated chance of encountering each species at least once · " + period, "itinerary-species__description"));

  const search = document.createElement("input");
  search.id = id + "-search";
  search.type = "search";
  search.autocomplete = "off";
  search.placeholder = "e.g. Blue Jay";
  search.value = query;
  const label = element(document, "label", "Search birds");
  label.htmlFor = search.id;
  const toolbar = element(document, "div", "", "itinerary-species__search");
  toolbar.append(label, search);
  const toggle = element(document, "button", "Show all " + species.length);
  toggle.type = "button";
  const list = element(document, "div", "", "itinerary-species__list");
  list.id = id + "-results";
  toggle.setAttribute("aria-controls", list.id);
  toolbar.append(toggle);
  const count = element(document, "p", "", "itinerary-species__count");
  count.setAttribute("role", "status");
  section.append(toolbar, count, list);
  const searchOptions = species.map(bird => ({ value: bird.taxonId, textContent: bird.name, bird }));
  let expanded = false;

  function render() {
    const term = search.value.trim();
    const matches = term ? rankSearchOptions(searchOptions, term).map(result => result.bird) : species;
    const visible = term || expanded ? matches : matches.slice(0, PREVIEW_COUNT);
    toggle.hidden = Boolean(term) || species.length <= PREVIEW_COUNT;
    toggle.textContent = expanded ? "Show top " + PREVIEW_COUNT : "Show all " + species.length;
    toggle.setAttribute("aria-expanded", String(expanded));
    count.textContent = visible.length
      ? (term ? matches.length + " matching species" : "Showing " + visible.length + " of " + species.length + " reported species")
      : term ? "No birds match this search in the selected itinerary." : "No species were reported on eligible checklists at these stops.";

    list.replaceChildren(...visible.map(bird => {
      const details = document.createElement("details");
      const summary = document.createElement("summary");
      const name = element(document, "span", bird.name, "itinerary-species__name");
      const highest = element(document, "span", "Highest rate · " + bird.sites[0].name, "itinerary-species__site");
      const value = element(document, "span", formatFrequency(bird.probability), "itinerary-species__probability");
      const bar = element(document, "span", "", "itinerary-species__bar");
      const fill = document.createElement("span");
      fill.style.width = 100 * bird.probability + "%";
      bar.setAttribute("aria-hidden", "true");
      bar.append(fill);
      summary.append(name, highest, value, bar);

      const breakdown = element(document, "ul", "", "itinerary-species__breakdown");
      breakdown.setAttribute("aria-label", "Historical reporting rates by hotspot");
      for (const site of bird.sites) {
        const row = document.createElement("li");
        row.append(element(document, "span", site.name),
          element(document, "span", formatFrequency(site.rate) + " · " + formatChecklistCounts(site)));
        breakdown.append(row);
      }
      details.append(summary, breakdown);
      return details;
    }));
  }
  search.addEventListener("input", () => { onQuery(search.value); render(); });
  toggle.addEventListener("click", () => { expanded = !expanded; render(); });
  render();
  return section;
}
