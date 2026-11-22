import { createItinerarySpeciesPanel } from "./itinerary-species.js";
import { MONTH_NAMES } from "../t2/species-heatmap-data.js";
import { renderItineraryBars, renderItineraryStops } from "./itinerary-chart.js";
import { createHotspotPicker } from "../../components/hotspot-picker.js";
import { createVisualizationFrame } from "../../components/visualization-frame.js";
import { organizeHotspotFrequencies, rankItineraries } from "./itinerary-data.js";

const HTML = `
  <h2>Birding itinerary</h2>
  <div class="itinerary-controls" id="itinerary-controls">
    <div><label for="frequency-month">Trip month</label><select id="frequency-month"></select></div>
    <div><label for="itinerary-stops">Stops</label><select id="itinerary-stops"></select></div>
    <div class="itinerary-scope"><input type="checkbox" id="all-hotspots"><label for="all-hotspots">All county hotspots</label></div>
  </div>
  <p id="frequency-status" role="status"></p>
  <section>
    <div id="hotspot-picker"></div>
  </section>
  <div data-plot id="frequency-plot" tabindex="0" role="region" aria-label="Ranked birding itineraries"></div>
  <p>Each itinerary assumes one visit per hotspot, with detection probabilities estimated from complete eBird checklists in the selected month over the ten latest complete years of data. For each species, the model assumes independent detection across stops and estimates the chance of seeing it at least once. Adding those chances gives the expected number of distinct species.</p>
  <p>For county-wide recommendations, the planner adds the hotspot with the highest additional expected species count at each step. This gives an approximate recommendation. For a custom list, it compares every combination.</p>
  <p>Historical reporting frequencies can differ from conditions on your trip. Check season, access, and travel time when planning your route. The planner recommends a set of hotspots.</p>
`;

const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

export function mountHotspotFrequency({ container, store, data, taxa = new Map(), presentation = "standalone", initialCountyScope = false, detailsHost: providedDetailsHost }) {
  const frame = createVisualizationFrame({ container, html: HTML, presentation, className: "hotspot-frequency" });
  const { elements, pickerTrigger } = frame;
  const plot = elements["frequency-plot"];
  const detailsHost = providedDetailsHost ?? plot;
  const document = plot.ownerDocument;
  const status = elements["frequency-status"];
  const monthSelect = elements["frequency-month"];
  const stopSelect = elements["itinerary-stops"];
  const allHotspots = elements["all-hotspots"];
  allHotspots.checked = initialCountyScope;
  if (frame.controls) frame.controls.append(elements["itinerary-controls"]);

  function addOption(select, value, label = String(value)) {
    const option = document.createElement("option");
    option.value = String(value);
    option.textContent = label;
    select.append(option);
  }
  MONTH_NAMES.forEach((name, index) => addOption(monthSelect, index + 1, name));
  monthSelect.value = String(new Date().getMonth() + 1);
  for (let stops = 1; stops <= 5; stops++) addOption(stopSelect, stops);
  stopSelect.value = "3";
  const picker = createHotspotPicker({ container: elements["hotspot-picker"], store, loadLocations: data.loadHotspots });
  let request = 0;
  let hotspots, countyPlan, referenceYears, countySpecies;
  let previewKey, speciesQuery = "";

  function render() {
    if (!hotspots && !countyPlan) return;
    const stops = Number(stopSelect.value);
    const month = MONTH_NAMES[Number(monthSelect.value) - 1];
    const firstYear = referenceYears[0];
    const lastYear = referenceYears.at(-1);
    const coverage = lastYear - firstYear === referenceYears.length - 1
      ? firstYear + "–" + lastYear : referenceYears.join(", ");
    const period = month + " · " + coverage;
    const eligible = countyPlan?.eligibleHotspots ?? hotspots.filter(hotspot => hotspot.complete !== null).length;
    const excluded = hotspots?.filter(hotspot => hotspot.complete === null) ?? [];
    const plans = countyPlan?.itineraries ?? rankItineraries(hotspots, stops);
    const selected = countyPlan ? plans[stops - 1] : plans.find(itinerary => itinerary.key === previewKey) ?? plans[0];
    plot.replaceChildren();
    detailsHost.replaceChildren();
    if (!selected) {
      status.textContent = eligible + " hotspots have data for " + period + ". Choose fewer stops or another month.";
      return;
    }
    status.textContent = countyPlan
      ? "County-wide (approx.) · " + number.format(eligible) + " eligible hotspots · " + period
      : plans.length + (plans.length === 1 ? " combination" : " combinations") + " · " + stops + (stops === 1 ? " stop" : " stops") + " · " + period;
    plot.append(renderItineraryBars(document, { plans, selected, countyWide: Boolean(countyPlan), onSelect(plan, index) {
      const scroller = plot.querySelector(".itinerary-bars__rows");
      const scrollLeft = scroller.scrollLeft;
      if (countyPlan) stopSelect.value = String(index + 1);
      else previewKey = plan.key;
      render();
      plot.querySelector(".itinerary-bars__rows").scrollLeft = scrollLeft;
      plot.querySelector('.itinerary-bars__row[aria-pressed="true"]')?.focus({ preventScroll: true });
    } }));

    const details = document.createElement("section");
    details.className = "itinerary-result-details";
    details.setAttribute("aria-label", "Itinerary details");
    details.append(renderItineraryStops(document, selected));
    if (excluded.length || (countyPlan && countyPlan.totalHotspots > eligible)) {
      const note = document.createElement("p");
      note.className = "itinerary-note";
      note.textContent = excluded.length
        ? "No complete checklists for " + month + ": " + excluded.map(hotspot => hotspot.name).join(", ") + "."
        : number.format(countyPlan.totalHotspots - eligible) + " county hotspots had no complete checklists for this period.";
      details.append(note);
    }
    const speciesHotspots = countyPlan ? selected.hotspots.map(hotspot => countySpecies.get(hotspot.id)) : selected.hotspots;
    details.append(createItinerarySpeciesPanel(document, speciesHotspots, taxa, period, speciesQuery, query => { speciesQuery = query; }));
    detailsHost.append(details);
  }

  async function update() {
    const token = ++request;
    const { countyCode, candidateLocationIds: ids } = store.getFilters("t4");
    const month = Number(monthSelect.value);
    const useCounty = allHotspots.checked;
    allHotspots.disabled = !countyCode;
    elements["hotspot-picker"].hidden = useCounty;
    if (pickerTrigger) {
      pickerTrigger.textContent = useCounty ? "Hotspots · All" : "Hotspots · " + ids.length + "/10";
      pickerTrigger.hidden = useCounty;
      pickerTrigger.title = "Choose individual hotspots";
    }
    hotspots = undefined;
    countyPlan = undefined;
    previewKey = undefined;
    plot.replaceChildren();
    detailsHost.replaceChildren();
    plot.setAttribute("aria-busy", "false");
    if (!countyCode || (!useCounty && !ids.length)) {
      status.textContent = countyCode ? "Select up to ten hotspots or turn on All county hotspots." : "Select a county to find hotspots.";
      return;
    }
    status.textContent = "Loading hotspot checklist summaries…";
    plot.setAttribute("aria-busy", "true");
    try {
      if (useCounty) {
        const plan = await data.loadCountyItineraries(countyCode, month);
        if (token !== request) return;
        countySpecies = new Map(organizeHotspotFrequencies(plan.speciesRows).map(hotspot => [hotspot.id, hotspot]));
        countyPlan = plan;
        referenceYears = plan.referenceYears;
      } else {
        const result = await data.loadHotspotReportingFrequency(countyCode, ids, month);
        if (token !== request) return;
        hotspots = organizeHotspotFrequencies(result.rows);
        referenceYears = result.referenceYears;
      }
      render();
    } catch (error) {
      if (token === request) status.textContent = "Unable to rank itineraries: " + error.message;
    } finally {
      if (token === request) plot.setAttribute("aria-busy", "false");
    }
  }

  const unsubscribe = store.subscribe({ keys: ["shared.countyCode", "charts.t4.candidateLocationIds"] }, update);
  monthSelect.addEventListener("change", update);
  allHotspots.addEventListener("change", update);
  stopSelect.addEventListener("change", render);
  const ready = update();
  let disposed = false;
  return { root: frame.root, ready, destroy() {
    if (disposed) return;
    disposed = true;
    request++;
    unsubscribe();
    monthSelect.removeEventListener("change", update);
    allHotspots.removeEventListener("change", update);
    stopSelect.removeEventListener("change", render);
    picker.destroy();
    if (providedDetailsHost) providedDetailsHost.replaceChildren();
    frame.destroy();
  } };
}
