import { loadTaxonNameMap } from "../api/taxon-converter.js";
import { createFilterOptions } from "../helpers/filter-options.js";
import { createFilterStore } from "../filters/filter-store.js";
import { createFilterHeader } from "../components/filter-header.js";
import * as data from "../api/info-loader.js";
import { mountHotspotFrequency } from "../visualizations/t4/hotspot-frequency-view.js";
import { parseHotspotOverlapSelection } from "../visualizations/t4/hotspot-overlap-selection.js";

const store = createFilterStore();
const container = document.querySelector("#visualization");
let disposed = false, header, view;
async function initialize() {
  try {
    const [geography, taxa] = await Promise.all([data.loadGeographicOptions(), loadTaxonNameMap()]);
    if (disposed) return;
    let linkError;
    try {
      const link = parseHotspotOverlapSelection(location.search, geography);
      if (link) {
        await data.loadHotspotSpecies(link.countyCode, link.locationIds);
        if (disposed) return;
        store.setShared({ stateCode: link.stateCode, countyCode: link.countyCode });
        store.setChart("t4", { candidateLocationIds: link.locationIds });
      }
    } catch (error) { linkError = "Unable to restore hotspots from this link. Choose a county and hotspots below."; }
    if (disposed) return;
    header = createFilterHeader({ container: "#filters", store, chartId: "t4Frequency", options: createFilterOptions(geography) });
    container.replaceChildren();
    if (linkError) {
      const notice = document.createElement("p");
      notice.textContent = linkError;
      container.append(notice);
    }
    view = mountHotspotFrequency({ container, store, data, taxa });
    await view.ready;
  } catch (error) {
    if (!disposed) container.textContent = "Unable to initialize the itinerary planner: " + error.message;
  }
}
initialize();
window.addEventListener("pagehide", event => {
  if (event.persisted) return;
  disposed = true;
  view?.destroy();
  header?.destroy();
});
