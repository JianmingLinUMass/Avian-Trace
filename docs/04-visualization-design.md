# Visualization Design

## Reporting-frequency preparation for T2 and T4

A separate EBD-derived metric is prepared for 2012-2025:
`100 * distinct complete checklists reporting a species / distinct complete checklists represented in EBD`.
Completeness is `complete_checklist = '1'`; species numerators use
`category = 'species'`, while denominators retain all taxon categories. Checklists
absent from EBD, including zero-observation checklists, are excluded. This is not
an exact SED-based denominator or a measure of bird abundance.

This preparation does not switch current charts or APIs to frequency. Existing
T2 observation counts, T4 richness/UpSet calculations, filters, subscriptions,
URLs and dashboard layout remain unchanged. Raw dates are preserved and annual
counts are independently distinct, never sums of monthly counts. Exact pooled
seasons/periods/hotspot combinations need aggregation at the requested grain.

Schemas, SQL, build/validation procedures and limitations are maintained once in
[Reporting-frequency data](05-reporting-frequency-data.md). The centralized
standalone visualization URL table below remains authoritative.

## Frontend composition and reusable views

Each visualization has one reusable mounted view, used by its existing standalone page and the combined dashboard with an injected shared store. There are no separate standalone/dashboard chart implementations. The refactor preserves the existing chart appearance, defaults, calculations, APIs, filter semantics, and HTML page URLs. Standalone presentation remains the default; compact presentation is opt-in. The combined dashboard composes these same views.

### Directory ownership

~~~text
frontend/
  *.html                         standalone, legacy and dashboard page URLs
  pages/                         thin standalone and dashboard initializers
    county-choropleth.js
    county-richness-bar.js
    observation-trends.js
    seasonal-species-heatmap.js
    holiday-observation-patterns.js
    location-combinations.js
    hotspot-species-overlap.js
    dashboard.js
  dashboard/
    dashboard.js, configurations.js, dashboard.css
  visualizations/
    t1/
      county-choropleth-view.js, county-choropleth.js, county-choropleth-data.js
      county-richness-bar-view.js, county-richness-bar.js, county-richness-bar-data.js
      county-choropleth.css, county-richness-bar.css
    t2/
      observation-trends-view.js, observation-trends-chart.js, observation-trends-data.js
      seasonal-species-heatmap-view.js, species-heatmap.js, species-heatmap-data.js
      observation-trends.css, seasonal-species-heatmap.css
    t3/
      holiday-observation-patterns-view.js, holiday-observations-chart.js
      holiday-observations-data.js, holiday-observation-patterns.css
    t4/
      location-combinations-view.js, location-combinations-chart.js, location-combinations-data.js
      hotspot-species-overlap-view.js, hotspot-overlap-chart.js, hotspot-overlap-data.js
      hotspot-overlap-selection.js, hotspot-common.css
      location-combinations.css, hotspot-species-overlap.css
  api/
    api.js, info-loader.js, taxon-converter.js
  components/
    filter-header.js, filter-header.css
    hotspot-picker.js, hotspot-picker.css
    visualization-frame.js, visualization-frame.css, compact-frame.js
  filters/
    filter-store.js, filter-definitions.js
  helpers/
    filter-options.js, geographic-codes.js, location-converter.js
    taxon-converter.js            compatibility re-export for the legacy map
    ...                          other existing legacy helpers
  styles/standalone.css          page-shell layout and headings
  charts/                        legacy task1/task2 renderers and shared constants
~~~

Rendering factories only render supplied models and expose their existing render/clear/destroy methods. The data modules retain pure transformations. Network access remains in api/ and is supplied to views through the data object. The choropleth additionally receives data.loadCountyGeometry; TopoJSON conversion and geometry matching retain their existing behavior. Geography and optional taxon-name Maps are supplied as lookups, rather than loaded or globally managed by the view. filter-options.js maps those lookups to header choices without owning state or fetching.

### Mounted view contract

The exports are mountCountyChoropleth, mountCountyRichnessBar, mountObservationTrends, mountSeasonalSpeciesHeatmap, mountHolidayObservationPatterns, mountLocationCombinations, and mountHotspotSpeciesOverlap. Their common interface is:

~~~js
import { mountCountyRichnessBar } from "./visualizations/t1/county-richness-bar-view.js";
import * as data from "./api/info-loader.js";

const view = mountCountyRichnessBar({
  container,                  // a caller-owned HTMLElement
  store,                      // an existing createFilterStore() instance
  data,                       // existing API loaders; injectable for tests/composition
  geography,                  // geographic options already loaded by the caller
  d3,                         // existing D3 library, also defaults to globalThis.d3
  sizing: {}                  // optional renderer-specific sizing; existing defaults retained
});
await view.ready;             // initial initialization/update has settled
view.destroy();              // immediate and idempotent
~~~

A view creates only its own subtree, subscribes to relevant store paths, and owns its loading/status, coverage, selection, tooltip, and chart-specific controls. It neither creates a filter store nor searches the standalone document for chart elements. root exposes the owned DOM subtree; destroy removes that subtree without clearing unrelated content in the supplied container. The visualization-frame helper only creates scoped supporting markup, indexes elements by role, and assigns instance-specific IDs/accessibility references. It is not a chart framework and contains no data or filter policy.

ready represents the initial update, not every subsequent store change. Destruction unsubscribes, invalidates pending request versions, disconnects renderer resize observers, removes owned controls/listeners, and prevents late success or failure from recreating or updating DOM. The choropleth also checks destruction after pending geometry initialization. In-flight network/database work is not aborted; its results are ignored after destruction. Repeated destruction is safe.

The existing responsive width behavior and minimum-width scrolling remain. Sizing overrides preserve defaults: the county bars and T4 bars accept sizing.plotHeight, the line charts and map accept sizing.height, and UpSet accepts sizing.plotHeight/rowHeight. Heatmap height follows its displayed row count. Compact layout is applied only when presentation: "compact" is explicitly requested.

### Standalone versus dashboard composition

Each pages/ initializer creates its standalone store, loads lookups, creates the reusable header in all/standalone scope, and mounts the corresponding view. Page-specific introduction/access text and page-shell layout remain outside the mounted chart. The initializer owns pagehide handling and stops initialization safely if the page disappears while lookups are loading. The dashboard supplies the same store to several mount functions, creates one shared-scope header, and renders local-scope controls as appropriate. The view functions and renderers are unchanged between those contexts; no global store or manual synchronization is required.

Only pages/hotspot-species-overlap.js reads location.search or writes browser history. It parses and validates link selections, checks the membership API, then supplies accepted store state/initialRows or an initialMessage to the reusable UpSet view. The view emits optional onSelectionChange notifications instead of changing a browser URL. The combination view preserves its existing standalone exploration link; an optional onExploreOverlap callback lets a host handle that action without navigation.

T4's standalone behavior is retained: combination bars use up to ten candidate IDs, while standalone UpSet compares up to five candidates. UpSet additionally accepts a selection binding with getIds and scoped store keys; an optional setIds enables its picker. A host can bind it to charts.t4.selectedCombinationIds while the bar chart retains the larger candidate pool. A read-only binding omits the redundant picker. The dashboard uses this read-only binding; store validation is unchanged.

The existing legacy us-map.html, holiday-test.html, and test.html files remain in place. charts/task2-chart.js retains renderSpeciesTrendChart for the legacy map; the newer factory lives in visualizations/t2/observation-trends-chart.js. The old helper taxon-converter.js forwards to the relocated API loader. Legacy map and holiday rendering were checked. test.html currently reports no valid data because its unchanged request uses obsolete parameter names (region/taxon_id/from/to); the same request returns zero rows while the canonical existing API parameters return 14. Both its script and the backend are unchanged from the pre-refactor commit. That pre-existing example issue is outside this structural refactor.

### Refactor regression checks

npm test retains the original 43 calculation/state tests and adds filter-option, browser-free view-import, unchanged-page-path and relative-import checks (52 tests total, including compact-layout and dashboard-composition checks). Calculations and API contracts are unchanged. For real-DOM lifecycle checks, start npm start, then run node tests/browser/server.js in another terminal and open /view-lifecycle.html on that test server's port 3001. This test-only server is not an application dashboard or a production route.

The browser harness mounts every view repeatedly at different widths, resizes mounted containers, destroys views during pending successful/failed requests, destroys a map during geometry initialization, checks unsubscription and stale DOM writes, mounts all seven with one store, checks unique IDs and CSS appearance isolation, verifies relevant-filter notifications and county highlighting/reset, and exercises the T4 selected-combination input binding. Standalone pages retain their existing appearance and interactions. Frontend structural documentation stays here; the database/geography documents retain their separate domain responsibilities. The centralized URL table below remains the only visualization URL inventory.



## Compact presentation contract

All seven existing mount functions accept presentation: "compact". Omission or presentation: "standalone" retains the existing standalone layout and metrics. Invalid presentation values are rejected. There are no separate compact renderers: the same models, callbacks, subscriptions, and render functions use presentation-specific layout metrics. API requests, data calculations, and filter semantics are unchanged.

~~~js
const view = mountSeasonalSpeciesHeatmap({
  container, store, data, geography, d3,
  presentation: "compact"
});
// The host allocates a bounded CSS width and height; e.g. 768px × 324px.
// Render local controls in the view's compact toolbar when appropriate:
const controls = createFilterHeader({
  container: view.controls, store, chartId: "t2Heatmap", scope: "chart"
});
await view.ready;
// Destroy host-owned controls and the view when removing the panel:
controls.destroy();
view.destroy();
~~~

view.controls is the compact toolbar slot (undefined in standalone mode). Header ownership stays with composition, and shared controls remain outside the visualization. The existing shared header keeps its approximately 52px toolbar/34px controls. Compact local controls share the panel's title row. Mounting does not set document-level overflow or build a dashboard: the host supplies bounded panel dimensions and its application layout. The view confines dense content to internal scroll regions. The dimensions below are targets, not hard-coded card dimensions in the renderers.

### Target panel allocations

The combined dashboard defaults to Fit to screen at content sizes of 1180 × 720 or larger. The desktop Layout selector also offers Scroll for detail. Smaller windows use vertical page scrolling. Shared filters remain at the top and both layouts use the same chart instances and store. Geography and trends use two columns on wider screens; the heatmap and planner stack earlier to give their controls and labels more room. Chart panels reserve vertical space independently of the browser viewport height.

| Position | View | Target width × height |
| --- | --- | --- |
| Upper-left | County choropleth | 1088 × 360px |
| Upper-right | County richness bars | 784 × 360px |
| Middle-left | Observation trends | 936 × 240px |
| Middle-right | Holiday patterns | 936 × 240px |
| Bottom-left, interchangeable | Seasonal heatmap or UpSet | 768 × 324px |
| Bottom-right | Hotspot combination bars | 1104 × 324px |

### Compact layout and overflow

The supporting frame is a bounded flex layout with title/local-controls, a short live status, and available plot space. Existing explanatory paragraphs and complete selection details remain in a Details dialog rather than consuming plot height. Dynamic status text remains accessible and its full text is available as a title when visually shortened. Hotspot views retain an Access varies reminder and the full private/restricted-access notice in the selector overlay. Empty, loading, unavailable and error states remain distinct from recorded zeros.

- Choropleth: refits geometry to the current plot width/height and retains its sequential legend and county selection. The standalone viewBox is unchanged.
- County bars: horizontal bars with complete, wrapping labels, a sticky species scale, and internal vertical scrolling. Selecting a county brings its row into view.
- Trends/holiday lines: use the available height and smaller margins, preserve every data point, reduce only displayed X-axis tick density, and retain full tooltip values. The holiday series legend remains visible.
- Combination bars: preserve all ranking results and 50-item pagination. Compact label lines and a smaller plot/label budget fit the panel; dense pages scroll horizontally. Global-best highlighting and selection are unchanged.
- Heatmap: uses abbreviated month labels, a bounded species-name column and 18px species rows. Month labels and the numeric sequential legend remain fixed while species rows scroll. A narrow body can also scroll horizontally, with month positions synchronized. Typical 15/20-species selections require vertical scrolling at the target height; exact visible row count depends on controls and scrollbar space. Full species names/months/counts remain available in cell tooltips and accessible labels. The standalone 30px rows and original legend are unchanged.
- UpSet: retains bars, exclusive counts, connected membership dots, selection and keyboard navigation. Compact mode uses 200px hotspot labels, 24px matrix rows and 28px intersection slots. Up to 31 nonempty five-set patterns remain available through internal horizontal scrolling; long names are shortened visually, with full names/IDs in tooltips, label titles and Details. Union richness and the intersection sum remain visible together.

Practical planning minimums remain approximately 720 × 300px for a heatmap with row scrolling and 720 × 320px for a five-hotspot UpSet with column scrolling. A heatmap showing 15 or 20 rows without vertical scrolling needs more height than the target panel. Showing all 31 UpSet patterns without horizontal scrolling needs roughly 1,100px total width with the implemented 28px slots and label column. At smaller sizes the views retain readable minimum plot dimensions and internal scrolling; they do not scale labels down indefinitely. Compact line plots use a minimum 150px SVG height. Container resizing is observed in both dimensions, while standalone dimensions retain their prior defaults.

### Overlays, tooltips and lifecycle

The compact hotspot selector is a native dialog in the browser's top layer. Opening it never expands the chart card. It retains the existing search, selection limits, 50-result pagination, validation, and single-store writes. It receives focus, contains native modal keyboard navigation, closes with Escape or its Close button, and restores focus to the trigger. Closing preserves selections and search/page state. Removing a selected chip while the overlay is open returns focus to search. The standalone picker remains inline and retains its previous default behavior.

Compact tooltips are portaled to document.body with their existing IDs, classes and content, so transformed/overflow-clipped chart containers cannot clip them. The existing renderers clamp positions to the viewport. Details and selector dialogs own their content without duplicating dynamic IDs. destroy removes owned portals and dialogs as well as the normal view subtree, unsubscribes, disconnects observers, and invalidates pending requests; late success/failure cannot recreate the removed view.

UpSet exposes optional initialIntersectionIds and onIntersectionSelect hooks using stable participating locality IDs. A host can retain an intersection highlight across destroy/remount without persisting a bitmask or creating a second filter store. Restoration selects only a matching nonempty pattern in the current model; incompatible IDs remain unselected. These hooks do not implement configuration switching or URL ownership, which stays outside reusable views.

### Development-only verification

Start npm start, then node tests/browser/server.js in another terminal. On that test server (127.0.0.1:3001), compact-preview.html renders one selectable compact visualization at a time, with target dimensions, existing shared/local filters and width/height controls. It is not a combined dashboard and adds no production visualization URL. compact-regression.html runs real-DOM checks for all seven compact views, unchanged standalone heights/mark counts, target panel bounds, no page-level overflow at 1920 × 1080, resizing, viewport-clamped tooltips, legend clipping, dense internal scrolling (254 counties, 252 combinations/50 per page, 20 species, all 31 UpSet patterns), modal focus, portal/ID cleanup, pending resolve/reject destruction, stable-ID intersection restoration and simultaneous compact instances sharing one store. view-lifecycle.html retains the original standalone/shared-store lifecycle checks. npm test runs all existing calculation/filter tests plus compact geometry and architecture checks (52 tests total).

The compact preview remains a one-view development tool. The separate dashboard composition and its integration harness are described below. Standalone URLs and the centralized URL table below are retained.

## Combined dashboard

Run `npm start` and open [Avian Trace dashboard](http://127.0.0.1:3000/dashboard.html). Six views share one filter store: county choropleth and richness ranking, observation trends and holiday patterns, monthly species reporting frequency and birding itineraries ranked using annual hotspot reporting frequency. The former Dashboard A/B switch is superseded by this combined view.

The dashboard initially selects Massachusetts, Middlesex County and Blue Jay when present. The shared year range controls trends, holidays and the heatmap. T4 uses its own trip-month selector with the latest ten fully processed complete years. Changing county clears the selected hotspots. Use the Hotspots button to choose candidates and Stops to set the visit budget.

Run `npm test` for automated checks. With the updated MA databases and the local server running, start `node tests/browser/server.js` and open `/dashboard-regression.html` on port 3001 to check the six views, exact frequency counts, county linking and teardown.

## Reusable filtering

County and Species controls use searchable comboboxes in the shared filter header, on both standalone pages and the dashboard. Search matches names or stable IDs without case sensitivity. Typing only filters suggestions; click or Enter commits a selection, arrow keys navigate, and Escape or blur restores the committed label. The empty-query list includes Clear selection. Counties remain restricted to the selected state, and external map/bar selections update the displayed county. Duplicate labels show IDs in the suggestions. Popup lists render outside the horizontally scrolling header and are removed with the header. Run `node tests/browser/server.js` and open `/searchable-filters.html` on port 3001 for the focused browser regression checks.

The filter infrastructure uses browser ES modules and has no added dependencies.
It does not import charts, fetch data, generate combinations, or modify existing pages or routes.

### Modules

- frontend/filters/filter-definitions.js: immutable shared/local definitions, defaults, options, month sets, task applicability, and T1/T3 selection roles.
- frontend/filters/filter-store.js: store factory, typed validation, snapshots, atomic patches, and relevant-change subscriptions.
- frontend/components/filter-header.js and .css: reusable labeled controls bound to an injected store.
- frontend/filter-demo.html and .js: standalone task selector with snapshots and notification counters. One store is used throughout this small demonstration; it renders no charts or combined dashboard.

### State contract

~~~js
{
  shared: {
    stateCode: null,
    countyCode: null,
    taxonId: null,
    startYear: 2012,
    endYear: 2025
  },
  charts: {
    t1Map: {},
    t1: { sortOrder: "desc" },
    t2: { season: "all" },
    t2Heatmap: { speciesCount: 15, sortOrder: "total" },
    t3: {},
    t4UpSet: {},
    t4: { candidateLocationIds: [], selectedCombinationIds: [], numberOfLocations: 3, sortOrder: "desc" }
  }
}
~~~

State and county codes use eBird region codes, such as US-MA and US-MA-017.
Species selections use taxon IDs, not display names. Null means unset, not a query for all species or a fabricated county.
Years and location counts are numbers; the store rejects numeric strings.
State/county validation checks code structure and their matching state prefix; existence is the caller's option/data responsibility.
A county requires a matching state. Changing or clearing state clears the county in the same transaction unless the patch explicitly provides a compatible county.

| Task | Shared values | Local values |
| --- | --- | --- |
| T1 choropleth (`t1Map`) | State, county | None |
| T1 bar chart (`t1`) | State, county | Sorting |
| T2 trends (`t2`) | State, county, species, start/end year | Season |
| T2 heatmap (`t2Heatmap`) | State, county, start/end year | Species count, sorting |
| T3 | State (county context), county, species, start/end year | None |
| T4 | State, county | Candidate hotspot IDs, selected combination IDs, locations per combination, sorting |

T1 uses stateCode as the statewide comparison context and countyCode solely to highlight an entry. A county selection does not replace or clear stateCode. Both implemented T1 pages use the state for the comparison query.
T3 uses state to narrow county choices; its implemented standalone chart requires a county and a single species before loading the comparison.

Sorting values are alpha (alphabetical), asc (ascending), and desc (descending), separately stored for T1 and T4.
Season belongs only to T2: all (Jan–Dec), spring (Mar–May), summer (Jun–Aug), fall (Sep–Nov), winter (Dec–Feb). Definitions expose numeric month sets. The implemented trends chart groups these months within each labeled calendar year: Winter combines January, February, and December of that year.

T4 numberOfLocations defaults to 3 and accepts exactly the numbers 3, 4, or 5. It means exactly that many locations per combination within the selected county. A combination's richness is the count of distinct species in the union of its locations. Candidate selection accepts at most 10 distinct locality IDs. Selected combinations contain exactly numberOfLocations IDs from those candidates. The store contains no combination-generation algorithm.

### Standalone use

~~~js
import { createFilterStore } from "./filters/filter-store.js";
import { createFilterHeader } from "./components/filter-header.js";

const store = createFilterStore();
const header = createFilterHeader({
  container: "#filters",
  store,
  chartId: "t2", // scope defaults to "all": relevant shared + local controls
  options: {
    stateCode: [{ value: "US-MA", label: "Massachusetts" }],
    countyCode: [{ value: "US-MA-017", label: "Middlesex County" }],
    taxonId: [{ value: "avibase-4E74AE22", label: "Northern Cardinal" }]
  }
});

const unsubscribe = store.subscribe({ chartId: "t2" }, ({ filters, changedKeys }) => {
  console.log("T2 update", filters, changedKeys);
});
store.setShared({ stateCode: "US-MA", countyCode: "US-MA-017" });
store.setShared({ startYear: 2015, endYear: 2020 });
store.setChart("t2", { season: "spring" });

// Read initial values explicitly: subscribe does not invoke an initial callback.
console.log(store.getFilters("t2"));
// On teardown:
unsubscribe();
header.destroy();
~~~

Include components/filter-header.css in the page. Headers require an existing container.
The header uses inline labels and 34 px controls in a horizontal toolbar targeting 52 px tall. Narrow containers scroll horizontally to keep controls on one row; visible validation errors can increase its height.
Multiple instances have distinct label/control IDs. Controls commit on change; invalid input displays an inline error and restores the committed value. County controls are disabled until a state is chosen and list only counties from that state.
Use header.setOptions({ taxonId: [...] }) to supply asynchronously loaded labels/options. Values already in the store remain visible while labels are loading.
Option loading remains outside the header; existing taxon helpers can supply species labels. Do not import us-map.js into this infrastructure: it initializes a visualization.

### Shared-store header wiring

~~~js
const store = createFilterStore(); // one shared owner, passed to every consumer
const sharedHeader = createFilterHeader({ container: "#shared", store, scope: "shared", options });
const t2Controls = createFilterHeader({ container: "#t2-controls", store, chartId: "t2", scope: "chart" });
const t4Controls = createFilterHeader({ container: "#t4-controls", store, chartId: "t4", scope: "chart" });
~~~

A shared header without chartId displays all shared definitions. With chartId it displays only that task's relevant shared definitions. scope: "chart" renders only that task's local controls; T3 currently has none.
Each visualization subscribes by chartId to the same store. Do not create a second shared store per visualization or synchronize independent stores manually. Independent standalone pages can each create their own store.

### Subscription and update guarantees

- setShared(patch) and setChart(chartId, patch) validate the entire patch before committing. Unknown filters/tasks and invalid values throw without state changes or notifications.
- Each affected subscriber receives one callback per patch, even when several relevant values change. Unchanged values and unrelated filters produce no callback.
- Task callbacks receive a flat filters snapshot containing relevant shared values and that task's local values. changedKeys contains only relevant scoped paths, e.g. shared.taxonId or charts.t2.season.
- getState(), getFilters(chartId), and callback data are immutable copies. Read them rather than mutating them; all changes go through setters.
- subscribe({ keys: ["shared.taxonId"] }, callback) supports narrower subscriptions, including header bindings. Its filters snapshot is keyed by the supplied scoped paths. Choose keys or chartId, not both.
- The returned unsubscribe function is idempotent. header.destroy() removes its subscription, listeners, and DOM; it does not unsubscribe chart consumers.
- Notifications are synchronous. Nested updates are queued so all subscribers receive transaction snapshots in order. Listener failures do not prevent delivery to others; setters throw an AggregateError after delivery, with state already committed. Keep data-loading errors inside the visualization's own handler.

The default year bounds are 2012–2025, matching existing complete-year controls. To use another known available range, createFilterStore({ yearBounds: { min: 2012, max: 2026 } }); both initial years and number controls follow those bounds. This does not change backend capabilities.
Mounted views translate canonical filters through the existing API helpers. The original holiday example route still accepts its legacy common-name parameters; the standalone holiday view uses the separate existing /api/holiday-observations endpoint. Neither API contract changes during composition.

### Run and verify

Run npm test for focused Node built-in tests (no database or server needed).
Run `npm start`, then open the filter demo listed in the centralized URL table below.

1. Change species or years under T2: only T2/T3 counters advance.
2. Change T2 season: only T2 advances.
3. Switch to T1 and change county: state stays selected; all tasks receive the county change.
4. Change T1 sorting: only T1 advances.
5. Switch to T4: choose 3, 4, or 5 and any sorting option; only T4 advances.
6. Unsubscribe T3, then change shared species/years: T3's counter stays fixed. Resubscribe to receive future changes.
7. Change state: county clears and its options narrow to that state. Try a reversed year range: the store stays unchanged and the header displays an error.

Switching the displayed task destroys the old header and creates the next one against the same store; state values persist and no filter-change notification is generated merely by switching controls. This is a notification demonstration, not a chart integration.

## Standalone Visualization URLs

Start the application from the repository root:

~~~sh
npm start
~~~

The Express server serves the following implemented pages at http://127.0.0.1:3000.
Future visualization URLs will be added only when their pages are implemented.

| Task | Visualization | URL | Implementation status | Implementation commit |
| --- | --- | --- | --- | --- |
| Infrastructure | Filter demo | [Filter demo](http://127.0.0.1:3000/filter-demo.html) | Implemented | `66afa35` |
| T1 | County Choropleth | [County Choropleth](http://127.0.0.1:3000/county-choropleth.html) | Implemented | `e2492ab` |
| T1 | County Richness Bar Chart | [County Richness Bar Chart](http://127.0.0.1:3000/county-richness-bar.html) | Implemented | `d8f4a74` |
| T2 | Observation Trends Line Chart | [Observation Trends](http://127.0.0.1:3000/observation-trends.html) | Implemented | `fe0bcbf` |
| T2 | Seasonal Species Heatmap | [Seasonal Species Heatmap](http://127.0.0.1:3000/seasonal-species-heatmap.html) | Implemented | `5b2d7e4` |
| T3 | Holiday Observation Patterns (comparison line chart) | [Holiday Observation Patterns](http://127.0.0.1:3000/holiday-observation-patterns.html) | Implemented | `b41a613` |
| T4 | Birding Itinerary Planner | [Birding Itinerary Planner](http://127.0.0.1:3000/location-combinations.html) | Implemented | — |
| T4 | Birding Itinerary Planner (legacy URL) | [Birding Itinerary Planner](http://127.0.0.1:3000/hotspot-species-overlap.html) | Implemented | — |

### T1 — County Choropleth

The standalone choropleth reuses the bundled counties-10m.json TopoJSON boundaries, existing state-FIPS lookup, getCountiesByStateId filtering, and the Albers fitting/county-selection pattern from the existing map. The lookup now lives in the side-effect-free geographic-codes.js helper; us-map.js retains its original export for compatibility. Existing map and chart examples remain usable.

**Filters:** the reusable header renders in standalone mode with chartId: "t1Map". Its shared stateCode selects the statewide comparison, and countyCode selects a highlight. This view has no local sorting control. It displays the fixed complete-year period 2012–2025; year/species/season changes used by other charts do not notify it. The shared filter-store API and validation are unchanged.

**Interactions:** selecting a state loads all its county boundaries and summary metrics. County clicks, Enter/Space on a focused polygon, and the county dropdown all write the same countyCode to the store. Selection adds an outline while preserving the richness fill, every other county, and the statewide scale. County-only changes never refetch or restrict statewide data. Clearing the county removes the highlight; changing state clears county through the existing store rule. Cached state results and request IDs prevent stale responses from replacing the current state. Hovering or focusing a county shows its name, distinct-species richness, and observation-record count. The visible selection summary repeats these metrics. A readable sequential blue legend is recomputed for each state's range; darker indicates greater richness, so colors are relative to the currently selected state.

**Data calculations:** /api/county-richness accepts stateCode, startYear, and endYear. The page requests 2012–2025 inclusive. It aggregates species_region_year rows where region_level = 'county', state_code matches the selected state, observation_rows > 0, and the joined taxa.category = 'species'. Richness is COUNT(DISTINCT taxon_id) across the full period, not the sum of annual richness. Observation records are SUM(observation_rows) across the same rows: record counts, not summed reported bird counts, checklists, or unique observers. The existing build_summaries.py generates observation_rows using COUNT(*) of production observation rows and sums those counts into annual summaries; no additional checklist/group deduplication is applied here. The query left-joins metrics to the county reference table so a known county with no qualifying records returns zero. It has no top-N limit. /api/geography supplies existing state/county labels for the header.

**Coverage and limitations:** the page displays every bundled polygon for the selected state. A polygon without a matching county reference/summary is gray and explicitly marked unavailable, not zero. County summaries without matching bundled boundaries are listed with both metrics in a coverage note rather than silently assigned to another polygon. These currently include Alaska codes 063/066/270, South Dakota code 113, and an unnamed Hawaii code 010; unavailable reference names fall back to the county code. Selecting one still shows its metrics, but cannot outline a missing boundary. Invalid/unidentified geographic reference codes are excluded from filter options. The included boundaries may differ from historical reporting geographies. Data is limited to species-category records and the displayed complete-year period; observation effort varies, so richness is recorded coverage rather than a population estimate. D3 and TopoJSON browser scripts follow the existing CDN convention and require network access. Statewide summary results are cached for the page session; reloading refreshes them.

**Verification:** npm test includes synthetic DuckDB calculation tests covering cross-year distinct counting, taxonomy exclusions, geographic/year restrictions, zero-record counties, and missing geometry joins, alongside the existing filter tests. Geometry tests confirm all 14 Massachusetts counties and 254 Texas counties are retained. Browser checks cover selection through the header and keyboard, tooltips, color legend, state changes, clear selection, and stale-state behavior. Real-data API results are compared with independent database aggregations before committing.


### T1 — County Richness Bar Chart

The standalone vertical bar chart adapts the existing task1-chart.js keyed joins and selection colors. It reuses loadCountyRichness and /api/county-richness without adding or changing backend queries. X is County; Y is Number of distinct recorded species. Every county returned by the endpoint is retained, including counties with no matching map polygon and known counties with zero qualifying records. County codes key the bars so repeated display names do not merge entries.

**Filters and selection:** the reusable header runs in standalone mode with the existing chartId: "t1". stateCode selects the statewide comparison; countyCode selects a highlight; local sortOrder defaults to desc and accepts alpha, asc, and desc. Numeric sorts use recorded richness, with alphabetical name/code tie breaks. Neither sorting nor county highlighting refetches or filters statewide data. Header selection, bar clicks, and Enter/Space on focused columns update the same shared countyCode. Selection changes the bar color/outline and scrolls the selected county into view while retaining all other counties. Clearing county removes the highlight; changing state clears county through the existing store rule. Other visualizations' local filters remain independent. Results are cached by state for the page session, and stale requests cannot replace the current state's data.

**County-label readability:** horizontal bars start from zero and show exact counts. Full county names wrap if needed. Long rankings scroll vertically below a sticky species scale.

**Data calculations:** the chart requests the same fixed 2012–2025 inclusive period and species-category record counts documented for the choropleth. It converts serialized integer counts to numbers and sorts a copy of the returned data; it does not sum annual richness or recalculate observation records. Tooltip fields are county name, distinct-species richness, and observation-record count. Unavailable reference names fall back to the county code. No geometry join, top-N limit, pagination, or county-selection restriction is applied to the returned rows.

**Verification and limitations:** focused tests cover numeric/alphabetical sorting, deterministic ties, default sorting and subscription isolation, zero counts, preservation of all API rows (including unmatched polygons), and full labels and vertical scrolling in a large-state browser fixture. The existing DuckDB calculation tests continue to verify the reused endpoint's cross-year distinct counts and observation totals. Browser checks cover sorting, pointer/keyboard selection, metric tooltips, all 254 Texas counties, counties without polygons, rapid state changes, and narrow/desktop rendering. Large states intentionally require substantial horizontal scrolling; the county selector brings an individual county into view. The display excludes partial-year 2026, and observation effort affects recorded richness. D3 follows the existing CDN convention and requires network access. Reload the page to refresh cached data.


### T2 — Long-Term Observation Trends

The standalone page uses the existing t2 filter definition, store, header, taxon-name loader, geography API, loadSpeciesTrend helper, and /api/species-trend endpoint. The visualizations/t2/observation-trends-chart.js module exports createObservationTrendsChart, a responsive adaptation of its yearly line/point rendering using the existing margins and colors. The original renderSpeciesTrendChart export and annual API behavior remain available for existing pages.

**Filters:** standalone mode renders shared stateCode, countyCode, taxonId, startYear, and endYear, plus local charts.t2.season. A county narrows the geographic query; clearing it returns to the selected state. Changing state clears county through the store's existing rule. Species remains a single taxon ID. The default range is 2012–2025, inclusive. Season is T2-specific and uses the existing definitions directly: All = months 1–12, Spring = 3–5, Summer = 6–8, Fall = 9–11, Winter = 12/1/2. Winter totals combine January, February, and December within the same labeled calendar year, not a December-to-February season spanning two years. Season changes do not notify T3 or T1.

**API and calculations:** supplying season to /api/species-trend uses species_region_month. The query filters region_code, region_level, the selected species-category taxon, inclusive year bounds, and the approved month set, then groups by calendar year and SUMs observation_rows. These are the COUNT(*)-derived observation records documented above, not bird counts, checklist counts, or population estimates. The backend reads month sets from the existing plain filter definitions so the API and header share one source of truth. All must agree with the existing annual totals. Requests without season retain the original sparse annual species_region_year query and response fields; existing pages do not opt into the new contract. The seasonal contract is restricted to complete-calendar-year bounds 2012–2025, excluding partial 2026, and validates the region code/level and season. Unknown reference regions or non-species/unknown taxa return no fabricated series.

**Missing observations:** the seasonal response explicitly includes each requested year and summary_available, based on summary_completed_years. A valid processed year with no matching species/month rows returns observation_records = 0. A year without a completion marker returns null, even if partial monthly rows exist. The frontend keeps explicit zero points at the baseline, retains null/omitted years as gaps, and never fills unknown values with zero or interpolates across unavailable years. A coverage message identifies unavailable years. Processing completeness is distinct from birdwatching effort or ecological absence: a recorded zero establishes neither adequate survey effort nor species absence.

**Interaction and rendering:** relevant filter changes request an updated yearly series and clear the previous chart while loading. Request IDs prevent older responses from replacing newer selections. The X-axis shows integer calendar years; the Y-axis shows observation-record counts starting at zero. A single-year range produces a centered point, and an all-zero range remains a valid baseline series. Hovering or focusing yearly points exposes year and observation count; Escape dismisses the tooltip. The chart recalculates on resize and uses horizontal scrolling on narrow screens to preserve year/axis readability. Invalid year inputs are handled by the existing header/store validation and leave the last committed filters unchanged.

**Verification and limitations:** focused in-memory DuckDB tests cover all five season totals, same-calendar-year winter boundaries, state/county and taxon isolation, year restrictions, processed zeros, unavailable/partially processed years, and invalid requests. Series tests cover missing years, explicit zeros, invalid/duplicate values, and a one-year range. Existing filter and T1 tests remain part of npm test. Real-data checks compare every season with independent monthly aggregations and All with the legacy annual endpoint; browser checks cover each filter, tooltips, zero/single-year ranges, invalid ranges, rapid changes, and narrow/desktop rendering. One species is displayed at a time. Available years remain 2012–2025; counts reflect recording activity and current taxonomy. D3 follows the existing CDN convention and requires network access. Its season remains independent of the heatmap in both standalone and dashboard composition.


### T2 — Seasonal Species Heatmap

The dashboard and standalone page use `/api/species-reporting-frequency`. The API checks completed frequency coverage and joins monthly regional complete-checklist counts with species reporting-checklist counts. For each calendar month, it sums each count over the selected years and divides the pooled reporting count by the pooled complete-checklist count. This is a ratio of monthly counts, not an annual distinct-checklist total. Species are ranked by pooled reporting count (equivalent to ranking by pooled frequency with the same denominator) before alphabetical display sorting.

Cells and legend use a fixed 0–100% yellow-to-red scale. Hovering or focusing a cell shows both counts. A zero requires a positive denominator; gray indicates no denominator. Shared species and season do not restrict this top-species view.

### T3 — Holiday Observation Patterns

Step 5 was implemented in commit b41a613. The page title is Holiday Observation Patterns, and its implemented URL/status are recorded in the centralized table above. The standalone chart adapts the existing holiday example's yearly scales, grid, dual-line rendering, legend, and blue/orange palette. It uses the existing t3 standalone filter definitions, geography and taxon loaders, and shared county/species/year subscriptions. State narrows county choices; a county and single species are required. T2 season and heatmap controls do not affect this view. No filter-store or definition changes are needed. The original holiday-test page and /api/holiday-comparison behavior are preserved. The existing read-only holiday connection is exposed for reuse by the new /api/holiday-observations endpoint.

**Verified record semantics:** build_daily_summaries.py stores observation_rows as COUNT(*) of production species-category observation rows, including records with unknown reported bird counts. These are not SUM(count_raw), unique checklists, or population estimates; observer/group reports are not additionally deduplicated. Before implementing this view, all 998 production filenames were matched to daily_processed_files markers. A raw Parquet sample's 245 records and 531 reported birds matched its staging counts, confirming the distinction. Middlesex/Northern Cardinal daily annual record totals also matched the main annual summaries for every year 2012–2025. The new calculation never uses avg_daily_birds or reported_birds.

**Calendar and calculations:** the query uses SELECT DISTINCT date from the existing daily_db.holidays calendar where is_observed = FALSE. Each distinct actual date belongs to Holidays exactly once, regardless of holiday names. All other calendar dates, including observed-only substitute dates, belong to Non-holidays. It counts actual dates per year and calculates calendar-year length with date arithmetic (365 or 366). For each county/species/year:

- Holiday records = SUM(observation_rows) from species_region_holiday joined to distinct actual dates.
- Annual records = species_region_year_avg.observation_rows, reconciled with the main species_region_year record total.
- Non-holiday records = annual records minus holiday records.
- Holiday days = number of distinct actual holiday dates; non-holiday days = calendar-year days minus holiday days.
- Each daily average = its group's records divided by its group's calendar days, including zero-observation days.

The endpoint accepts countyCode, taxonId, startYear, and endYear and returns both unrounded averages, underlying record totals, day counts, and per-year availability. The chart derives its point values from the returned exact counts/day counts and rounds only the displayed tooltip averages to three decimal places. Known processed years with no matching records return zeros. Missing annual completion markers, missing calendar coverage, null record totals, annual totals that disagree across databases, or holiday totals exceeding annual totals make that year unavailable. Neither line interpolates across unavailable years. Calendar-day counts do not depend on how many days have observations.

**Interactions and rendering:** X is calendar year; Y is average daily observation records. Holidays is an orange solid line and Non-holidays is blue/dashed. Hovering or focusing either yearly point shows year, both averages, both observation totals, and both day counts; Escape dismisses the tooltip. Single-year and all-zero series remain inspectable, including overlapping zero points. Relevant filter changes reload the comparison, and request IDs prevent stale responses from replacing current selections. Invalid ranges retain the committed state. Narrow screens scroll horizontally to preserve year labels.

**Verification and limitations:** tests cover duplicate actual dates, observed-only dates, leap/non-leap denominators, different holiday dates/counts, disjoint record groups, zero records, missing calendar/processing metadata, null summaries, annual disagreement, and inconsistent totals. Independent database queries verify selected county/species/year results, and a direct raw-record sample verifies observation semantics. Browser checks cover both lines, legends, complete tooltips, county/species/year changes, zero/single-year series, missing-data gaps, mobile rendering, and the original holiday example. The available complete-year range is 2012–2025. Calendar definitions are exactly those stored in the existing calendar; this view does not add regional holidays or substitute observed dates. These rates describe reporting activity per calendar day, without effort adjustment. D3 follows the existing CDN convention. The dashboard reuses this same view.


### T4 — Birding Itinerary Planner

Select a county, a trip month and one to five stops. Choose all county hotspots or select up to ten candidates manually. For manual candidates, the planner evaluates every subset of the requested size with eligible complete checklists. County-wide search uses a greedy recommendation, adding the hotspot with the greatest marginal increase in expected species at each step. The endpoint returns a recommendation for each available stop count and includes species counts only for the stops selected by the county recommendation. It ranks sets, with route order and travel time left to the user. Candidates without complete checklists for that year are listed separately. The shared species filter does not restrict the planner.

For species $s$ and hotspot $h$, sum reporting checklist counts and complete checklist counts from the selected month across the latest ten complete years of available data. Divide those pooled counts to obtain $p_{s,h}$, a proxy for detection on one visit. Each recommended hotspot displays the pooled denominator. Assume detection across the selected hotspots is independent for each species, then sum $1-\prod_h(1-p_{s,h})$ over species. Species that were never reported at a hotspot with eligible checklists have a zero estimate there. The model uses historical eBird frequencies and does not account for travel, weather, correlated observations, or differences in visit effort. Both old standalone T4 URLs open this planner and restore valid saved hotspot groups.

The itinerary species preview lists birds by estimated chance of at least one detection on the current itinerary. Users can search all reported species and expand a result to see complete and reporting checklist counts for each stop. In manual mode, selecting a ranked combination updates the preview.
