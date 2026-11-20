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

The supplied dashboard mockup establishes placement and visual hierarchy, using illustrative geometry/data. The seasonal and overlap configurations share five common panels and one interchangeable panel. At a 1920 × 1080 CSS viewport, the implemented envelope is 16px outer padding, an 88px branding/filter area containing the compact shared toolbar, a 12px gap before the panels, and 12px row/16px column gaps. The dashboard uses flexible grid proportions based on these targets rather than fixed chart dimensions.

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
- County bars: retain every county, the fixed Y-axis and highlight behavior. Compact labels are shortened to fit a smaller label band; full names/counts remain in tooltips and accessible column descriptions. Large states scroll horizontally, with at least a readable slot for each county.
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

Run `npm start`, then open [Avian Trace dashboard](http://127.0.0.1:3000/dashboard.html). Both configurations use this one URL and page. The View selector switches between **Dashboard A — Seasonal Analysis** (default) and **Dashboard B — Species Overlap**. No additional backend route is needed: Express serves dashboard.html alongside the unchanged standalone pages in the centralized table below.

### Composition and navigation

- frontend/dashboard.html loads the existing chart styles, compact frame, D3 and TopoJSON CDN dependencies, plus the dashboard stylesheet.
- frontend/pages/dashboard.js creates exactly one filter store, loads geography/taxon labels and supplies the existing API helpers. Geometry is loaded once per dashboard instance. Lookup failures show a retry-by-reload message; individual views retain their existing loading, unavailable-data and error feedback.
- frontend/dashboard/dashboard.js owns the shared header, panel-local headers and mounted-view lifecycle. mountDashboard receives its container, store, data, geography, taxa, d3 and topojson; it returns root, ready, setConfiguration and idempotent destroy. No reusable view imports the dashboard or creates a store.
- frontend/dashboard/configurations.js defines the two choices and the read-only selected-combination binding. Configuration keys are seasonal and overlap; unsupported keys are rejected.
- frontend/dashboard/dashboard.css owns only the dashboard shell and grid. It is not loaded by standalone pages.

The five common views are the county choropleth, county richness bars, observation trends, holiday patterns and hotspot combination bars. They remain mounted throughout configuration switching. Only the bottom-left heatmap/UpSet view and its local header are destroyed and replaced. Removal destroys the old subscription, resize observers, tooltips and dialogs; pending results cannot recreate it. Switching retains the store and its shared/local values, T4 candidate search/page state in the common picker, and the selected combination. Heatmap species-count/sort controls are restored from the store when remounted. A selected UpSet intersection is retained by stable participating locality IDs across swaps while the county/combination remains the same; incompatible context clears that highlight.

The View selector changes configuration within the page without navigating or rewriting browser history. The selected configuration and filters are session-local to the mounted page; reload restores store defaults and Dashboard A. Initial geography/species values are unselected, years remain 2012–2025, and no candidate hotspots or combinations are chosen automatically. Choose a state, county and species in the shared header, then explicitly choose T4 candidates in its Hotspots overlay. The existing Explore this combination link in T4 Details switches the interchangeable panel to Dashboard B rather than opening a separate page. All original standalone URLs and their URL-based T4 linking remain available.

### Layout and sizing

The arrangement follows docs/assets/avian_trace_dashboard_mockup.png; its illustrative chart data is not used. At a **1920 × 1080 CSS content viewport, 100% zoom**, the six panel allocations match the Compact presentation target table above: prominent map/adjacent richness ranking, trends/holiday pair in the middle, interchangeable analysis bottom-left and combination ranking bottom-right. The shell uses 16px outer padding, an 88px branding/shared-filter area, 12px vertical gaps and 16px horizontal gaps. Both configurations have exactly six compact mounted views and no horizontal or vertical page scrolling. Each view receives its actual container dimensions; row/column proportions respond to the available viewport.

Dense content retains internal scrolling: county/combination rankings and many UpSet intersections scroll horizontally, and heatmap species scroll vertically under fixed month labels/legend. T4 retains 50 combinations per page. The existing compact selector is a modal overlay, so it does not change panel height. Portaled tooltips and top-layer dialogs escape panel clipping; Escape, native modal focus navigation, focus restoration and existing chart keyboard commands remain intact.

This is a desktop layout targeting 1920 × 1080, not a separate mobile layout. Smaller windows still confine content to panels, but labels/controls can require more internal scrolling and the compact planning minimums above still apply. At target size, 15/20 heatmap rows do not all fit at once, 31 nonempty UpSet intersections require horizontal scrolling, and long names remain shortened visually with full accessible descriptions/tooltips/Details. Higher browser zoom reduces the effective CSS viewport. Data availability, fixed 2012–2025 T1/T4 coverage, hotspot access uncertainty and reporting-effort limitations are unchanged.

### Shared filters and linked interactions

One shared-scope reusable header renders state, county, single species and start/end year controls. The existing relevance subscriptions determine updates:

- T1 map/bars retain every county in the selected state. County changes only highlight the corresponding polygon/bar and synchronize the shared header; they do not narrow or refetch the statewide comparison. Map and bar keyboard/click selections write the same county value used by other relevant views.
- Trends use shared area/species/years and their local season. Holiday patterns use shared county/species/years. The heatmap uses shared area/years plus its own species count and sorting; shared species and trend season do not restrict it.
- T1 bar sorting, T2 season, heatmap count/sorting and T4 combination size/sorting remain in their owning panels. Local changes do not notify unrelated visualizations.
- T4 candidate hotspots (maximum ten), exact combination size (3/4/5), ranking and selected combination use the unchanged T4 store state. Candidate selection is available through the combination panel's compact overlay in both configurations. Sorting retains the selected combination; incompatible candidate/size/county changes clear it using existing validation.
- Dashboard B's UpSet reads charts.t4.selectedCombinationIds directly, rather than the full candidate pool, and has no second picker or mirrored store. Clicking/keyboard-selecting a combination updates its 3–5 hotspot sets and their exclusive intersections; a selection made in Dashboard A is used immediately on switching to B. Before a combination is chosen, UpSet shows selection guidance. Geographic changes atomically clear incompatible T4 candidates/selection and clear the overlap plot.

No calculations or API contracts change. In particular, UpSet still partitions distinct taxon IDs into exclusive membership masks whose sum equals union richness; interactive T4 requests use existing precomputed memberships, not the original observation files. eBird hotspot status still does not guarantee public accessibility.

### Dashboard verification

`npm test` runs 52 tests, including configuration validation, the live read-only combination binding/atomic geographic reset, browser-free composition imports and existing standalone/data/filter checks. Start `npm start` plus `node tests/browser/server.js`, set a 1920 × 1080 browser content viewport, and open `http://127.0.0.1:3001/dashboard-regression.html` for the real-DOM integration harness. It checks both layouts, exact target bounds, six views/one shared header, no page overflow, T1 keyboard linking without statewide refetching, relevant data requests, twelve switches with stable common roots/subscription/portal counts, local/shared value preservation, linked 3/4/5-hotspot UpSet unions, 50-bar internal scrolling and intersection restoration, geographic clearing, late swap results and destruction during geometry success/failure. Existing compact-regression.html and view-lifecycle.html remain available for individual compact and standalone lifecycle checks. Browser verification also exercises the actual dashboard's shared controls, candidate overlay, tooltips, keyboard focus/Escape and chart interactions.

## Reusable filtering

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
| T4 | Location Combination Bar Chart | [Hotspot Combination Species Coverage](http://127.0.0.1:3000/location-combinations.html) | Implemented | `bd0f0b5` |
| T4 | Hotspot Species Overlap (UpSet Chart) | [Hotspot Species Overlap](http://127.0.0.1:3000/hotspot-species-overlap.html) | Implemented | `4dde427` |

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

**County-label readability:** the plot reserves at least 42 px per county, displays complete county names at a 65-degree angle, and calculates margins from the longest name. States with many counties use horizontal scrolling instead of hiding counties or shrinking labels. The separate Y-axis remains visible while the plot scrolls. The scrolling region and county columns support keyboard focus; zero-height bars have full-column interaction targets and a baseline marker so zero-record counties remain selectable. A visible selection summary repeats the tooltip metrics. Resizing recalculates layout without changing the filter state.

**Data calculations:** the chart requests the same fixed 2012–2025 inclusive period and species-category record counts documented for the choropleth. It converts serialized integer counts to numbers and sorts a copy of the returned data; it does not sum annual richness or recalculate observation records. Tooltip fields are county name, distinct-species richness, and observation-record count. Unavailable reference names fall back to the county code. No geometry join, top-N limit, pagination, or county-selection restriction is applied to the returned rows.

**Verification and limitations:** focused tests cover numeric/alphabetical sorting, deterministic ties, default sorting and subscription isolation, zero counts, preservation of all API rows (including unmatched polygons), and large-state label spacing. The existing DuckDB calculation tests continue to verify the reused endpoint's cross-year distinct counts and observation totals. Browser checks cover sorting, pointer/keyboard selection, metric tooltips, all 254 Texas counties, counties without polygons, rapid state changes, and narrow/desktop rendering. Large states intentionally require substantial horizontal scrolling; the county selector brings an individual county into view. The display excludes partial-year 2026, and observation effort affects recorded richness. D3 follows the existing CDN convention and requires network access. Reload the page to refresh cached data.


### T2 — Long-Term Observation Trends

The standalone page uses the existing t2 filter definition, store, header, taxon-name loader, geography API, loadSpeciesTrend helper, and /api/species-trend endpoint. The visualizations/t2/observation-trends-chart.js module exports createObservationTrendsChart, a responsive adaptation of its yearly line/point rendering using the existing margins and colors. The original renderSpeciesTrendChart export and annual API behavior remain available for existing pages.

**Filters:** standalone mode renders shared stateCode, countyCode, taxonId, startYear, and endYear, plus local charts.t2.season. A county narrows the geographic query; clearing it returns to the selected state. Changing state clears county through the store's existing rule. Species remains a single taxon ID. The default range is 2012–2025, inclusive. Season is T2-specific and uses the existing definitions directly: All = months 1–12, Spring = 3–5, Summer = 6–8, Fall = 9–11, Winter = 12/1/2. Winter totals combine January, February, and December within the same labeled calendar year, not a December-to-February season spanning two years. Season changes do not notify T3 or T1.

**API and calculations:** supplying season to /api/species-trend uses species_region_month. The query filters region_code, region_level, the selected species-category taxon, inclusive year bounds, and the approved month set, then groups by calendar year and SUMs observation_rows. These are the COUNT(*)-derived observation records documented above, not bird counts, checklist counts, or population estimates. The backend reads month sets from the existing plain filter definitions so the API and header share one source of truth. All must agree with the existing annual totals. Requests without season retain the original sparse annual species_region_year query and response fields; existing pages do not opt into the new contract. The seasonal contract is restricted to complete-calendar-year bounds 2012–2025, excluding partial 2026, and validates the region code/level and season. Unknown reference regions or non-species/unknown taxa return no fabricated series.

**Missing observations:** the seasonal response explicitly includes each requested year and summary_available, based on summary_completed_years. A valid processed year with no matching species/month rows returns observation_records = 0. A year without a completion marker returns null, even if partial monthly rows exist. The frontend keeps explicit zero points at the baseline, retains null/omitted years as gaps, and never fills unknown values with zero or interpolates across unavailable years. A coverage message identifies unavailable years. Processing completeness is distinct from birdwatching effort or ecological absence: a recorded zero establishes neither adequate survey effort nor species absence.

**Interaction and rendering:** relevant filter changes request an updated yearly series and clear the previous chart while loading. Request IDs prevent older responses from replacing newer selections. The X-axis shows integer calendar years; the Y-axis shows observation-record counts starting at zero. A single-year range produces a centered point, and an all-zero range remains a valid baseline series. Hovering or focusing yearly points exposes year and observation count; Escape dismisses the tooltip. The chart recalculates on resize and uses horizontal scrolling on narrow screens to preserve year/axis readability. Invalid year inputs are handled by the existing header/store validation and leave the last committed filters unchanged.

**Verification and limitations:** focused in-memory DuckDB tests cover all five season totals, same-calendar-year winter boundaries, state/county and taxon isolation, year restrictions, processed zeros, unavailable/partially processed years, and invalid requests. Series tests cover missing years, explicit zeros, invalid/duplicate values, and a one-year range. Existing filter and T1 tests remain part of npm test. Real-data checks compare every season with independent monthly aggregations and All with the legacy annual endpoint; browser checks cover each filter, tooltips, zero/single-year ranges, invalid ranges, rapid changes, and narrow/desktop rendering. One species is displayed at a time. Available years remain 2012–2025; counts reflect recording activity and current taxonomy. D3 follows the existing CDN convention and requires network access. Its season remains independent of the heatmap in both standalone and dashboard composition.


### T2 — Seasonal Species Heatmap

The standalone heatmap reuses species_region_month, the geography API, fetchAPI/load helpers, the reusable standalone header, and the existing filter-store API. A new t2Heatmap definition registers only shared stateCode, countyCode, startYear, and endYear. Local speciesCount accepts 10/15/20 (default 15), and local sortOrder accepts total (default, descending total observations) or alpha. Shared taxonId and charts.t2.season are neither rendered nor subscribed to. Existing visualization definitions, stores, and backend route behavior are retained; the default-state test includes the additional view namespace.

**Aggregation and ranking:** /api/species-heatmap accepts regionCode, regionLevel, startYear, endYear, and speciesCount. It first verifies that every requested year has a summary_completed_years marker. It then filters species_region_month by area, inclusive years, months 1–12, and taxa.category = 'species'. SUM(observation_rows) across all selected years and twelve months determines the top species, with name/taxon-code tie breaks. Only species with a positive total qualify, so areas with fewer than the requested count show the available species. The query selects this cohort before cross-joining all twelve month columns and summing each selected species/month across the chosen years. Absent matching rows in a processed range return an explicit zero. Values are observation totals, not averages, distinct species counts, individual birds, or checklist counts.

**Display and interactions:** rows are bird species and columns are January–December. Sequential blue fill represents monthly observation totals aggregated across the selected years; darker means more records. The labeled color legend ranges from zero to the largest visible monthly total and is recomputed for each filtered cohort. Alphabetical sorting rearranges the same selected top-species cohort locally without refetching or changing membership. Changing species count, area, county, or years requests a new cohort and monthly totals. County clearing returns to the selected state; state changes clear county through existing validation. Request IDs prevent stale results from replacing newer selections. Hovering or focusing a cell displays species name, full month name, and observation total; Escape dismisses the tooltip. Full species/month labels are retained and narrow screens scroll horizontally.

**Missing data:** completed months with no matching observations are light-blue zeros. If any selected year lacks a completion marker, no partial totals or incomplete ranking are shown; a coverage message lists unavailable years. The frontend also keeps any unexpected missing/null cell unavailable (gray), rather than converting it into zero. An empty completed range produces a no-records message instead of inventing zero-valued species. Processing completeness does not establish sampling effort or ecological absence.

**Verification and limitations:** focused tests cover cross-year monthly sums, ranking before alphabetical display, 10/15/20 species, state/county isolation, taxonomy/year/month exclusions, explicit zero months, missing years, and independent filter notifications. Real-data checks compare top species, totals, and monthly cells with independent database queries. Browser checks cover all controls, monthly labels, cell tooltips, sequential colors/legend, rapid filter changes, narrow screens, and existing trends behavior. The available range is 2012–2025, excluding partial 2026. Counts reflect observation activity and current taxonomy; the heatmap does not adjust for reporting effort or the different number of days per month. D3 uses the existing CDN convention. The dashboard reuses this same view.


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


### T4 — Hotspot Combination Species Coverage

**Eligibility and access:** include only production records with locality_type = H, category = species, a canonical species taxon ID, a known county code, a valid stable locality ID, and an observation date from 2012-01-01 through 2025-12-31. Personal (P), town (T), postal-code (PC), county (C), state (S), null, and unknown locality types are excluded. Names are display labels, never identity keys; duplicate names remain separate locations. The catalog uses the lexicographically smallest nonempty name recorded for each county/locality ID during the coverage period, falling back to the ID.

Hotspot status does **not** guarantee public accessibility. H includes private and restricted-access hotspots; these remain eligible under the approved hotspot-only policy. The page displays an access notice asking visitors to check current rules and obtain any required permission. The dataset has no access-status field, and name-based exclusions cannot establish public access. See the [eBird Hotspot FAQs](https://support.ebird.org/en/support/solutions/articles/48001009443-ebird-hotspot-faqs) and [Hotspot access documentation](https://support.ebird.org/en/support/solutions/articles/48001281732-ebird-hotspot-about-pages). This is recorded species coverage at eBird hotspot IDs, not an inventory of publicly accessible birdwatching sites.

**Offline preparation:** from the repository root, run:

~~~sh
node scripts/build_location_summaries.js
npm start
~~~

The builder uses the existing @duckdb/node-api dependency and reads all production Parquet files outside HTTP requests. It stages unique county/locality/taxon memberships per file, commits each file with its size/mtime marker, then deduplicates across files and produces the catalog. The final tables are ordered by county/locality for selective reads. A completed source manifest and metadata record declare fixed 2012–2025/H coverage. It rechecks source identities before publishing database/ebird_locations.duckdb by renaming the closed staging database. Interrupted staging resumes with the same command; changed or removed processed source files are rejected. Preparation uses four threads, a 4 GB DuckDB memory limit, and ignored database/duckdb_temp spill space. Large source scans and intermediate storage are expected. Generated databases are ignored by Git.

The existing serving databases and their build scripts are unchanged. The new API opens the location database read-only and rejects absent/incomplete/incompatible snapshots with HTTP 503; the page explains how to prepare it. An existing final database is never overwritten automatically. For a new source release, stop the server and explicitly move the previous output aside before rebuilding. An active browser retries location loading with Search; restart the server after replacing an already-open snapshot.

**Candidate controls and state:** the existing standalone t4 header renders state, county, locations per combination (3/4/5, default 3), and sorting (alphabetical/ascending/descending, default descending). State narrows county choices. A separate labeled component below the header searches hotspot names or locality IDs within that county, 50 locations per result page, and shows individual recorded richness. It starts with no selected candidates, supports removal, retains choices across searches/pages, and disables additional choices at 10. Candidate count is independent of combination size; fewer candidates than that size show guidance. T4 uses fixed 2012–2025 coverage and ignores shared year/species and T2 season changes.

The existing store is extended with charts.t4.candidateLocationIds and charts.t4.selectedCombinationIds, both immutable canonical ID arrays. Generic location-ID validation and array-content change detection preserve silent equivalent updates. Definitions with control: null participate in state/subscriptions but are omitted from header rendering in every scope. County changes atomically clear candidates and the selected combination. Candidate or combination-size changes clear selections that are no longer valid; sorting retains selection. The selected IDs now supply the Step 7 UpSet navigation link. Each standalone page still has one injected store; URL parameters transfer the chosen combination between pages rather than manually synchronizing independent shared stores. The dashboard reads the same selected-combination IDs.

**API and calculations:** /api/hotspots accepts countyCode, search, and page, returning a catalog page and matching count. /api/hotspot-species accepts countyCode and 1–10 distinct locationIds; every requested ID must belong to that county snapshot. Both use parameterized queries. The browser fetches memberships when candidates change and reuses them for size/sort changes. For each unordered subset of exactly k candidate IDs, richness = size of the union of its taxon-ID sets. Repeated species within or across hotspots count once. All eligible combinations are enumerated before deterministic sorting and pagination. Ten candidates produce 120 size-3, 210 size-4, or 252 size-5 combinations.

**Interactions and rendering:** X is the combination of hotspot names; Y is distinct recorded species. The vertical bars adapt the existing county chart approach: fixed Y-axis, horizontal scrolling, full-column hit targets, keyboard selection, and readable space per combination. Display pages contain at most 50 combinations and share a Y scale based on the global maximum. Each name gets a separate shortened label line; hover/focus tooltips and selected-combination details expose full names and stable IDs. Orange marks every tied global maximum independently of sorting/page. A dark outline marks the selected combination. Click, Enter, or Space selects; Escape dismisses tooltips. Rapid county/candidate changes discard stale results.

**Verification and limitations:** fixture tests cover H-only eligibility (including restricted H hotspots), date/taxonomy/geography exclusions, duplicate names and records, cross-file deduplication, exact overlapping/disjoint unions, zero-species inputs, deterministic sorts/ties, 3/4/5 sizes, 10-candidate limits, 50-row pages, immutable/no-op updates, selection invalidation, and unrelated subscriptions. The completed production snapshot contains 153,966 county/hotspot entries and 13,728,170 memberships from all 998 files; its generated database occupies approximately 5.18 GB including staging-era reusable storage. Independent raw-Parquet COUNT(DISTINCT taxon_id) queries matched all 582 combinations for ten selected Middlesex County hotspots (120 size-3, 210 size-4, and 252 size-5). Browser checks cover candidate search/paging/removal/limits, all sizes/sorts, global maximum highlighting, selection, full tooltips, county resets, missing-summary feedback, and narrow screens. Richness reflects reporting history and current taxonomy; it is not adjusted for effort, hotspot boundaries can overlap, and access conditions may change. D3 follows the existing CDN convention.


### T4 — Hotspot Species Overlap (UpSet)

The standalone UpSet page reuses the Step 6 hotspot catalog, precomputed location-species memberships, /api/hotspots, /api/hotspot-species, and candidate picker. No backend routes, source scans during interactive requests, database changes, or dependencies are added. The fixed coverage is 2012–2025 and locality_type = H. Hotspot status does not establish public accessibility; the page repeats the access notice and includes private/restricted H hotspots under the approved policy. Its actual page link appears only in the centralized URL table above.

**Filters and shared state:** the standalone header uses chartId t4UpSet, with shared state/county controls and no irrelevant sorting or combination-size controls. The existing charts.t4.candidateLocationIds array holds the 3–5 compared hotspot IDs; the reusable picker takes a five-candidate limit on this page while retaining Step 6’s default limit of ten. Zero, one, or two choices show guidance without a chart. County/state changes clear incompatible candidates through the existing atomic store rule. Shared species/year range, T2 season, and T4 combination-size/sort changes do not restrict this view. Membership rows are cached by county and canonical IDs, and request IDs prevent stale responses from replacing later selections. Missing/null/incompatible memberships are unavailable data, never fabricated empty sets.

**Connection to Step 6 and URL validation:** selecting any Step 6 bar exposes an Explore this combination in the UpSet chart link. It carries stateCode, countyCode, and locationIds (comma-separated stable locality IDs), using exactly that bar’s selectedCombinationIds, not the entire candidate pool. The UpSet page accepts three, four, or five IDs. It rejects duplicate parameters, unknown parameter names, malformed or duplicate IDs, unsupported set counts, unknown counties/states, and mismatched state/county prefixes. An omitted stateCode is derived from countyCode. It calls the existing membership endpoint to reject unknown or out-of-county IDs, and validates the complete returned ID set and memberships before committing any URL selection. Rejected links select nothing and show an explanatory message. The page updates its URL after a valid selection, so reloads and copied links restore the same hotspot IDs; incomplete selections clear the URL selection. Intersection highlights are local view state and are not serialized as filters.

**Exclusive intersection calculation:** first deduplicate taxon IDs within each selected hotspot. Order hotspot rows deterministically by display name, with stable IDs breaking ties. Give each selected hotspot a distinct bit in an integer membership mask. For each distinct taxon ID, OR together the bits for the selected hotspots that contain it. Increment exactly one count for that resulting nonzero mask. A mask counts species present at every participating hotspot and absent from all other selected hotspots; observations at unselected hotspots do not affect the partition. No species is counted twice across intersections. Total union richness is the number of distinct taxon IDs, which is checked against the sum of all intersection counts. Three to five hotspots have at most 7, 15, or 31 nonempty membership patterns. Zero-count patterns are omitted; known empty memberships yield a true zero union, whereas missing memberships produce an error message.

**Rendering and interactions:** vertical bars show exclusive intersection species counts. The aligned matrix beneath them has one row per hotspot; filled dots joined by a vertical line show the participating sets, and pale dots show absence. Hotspot labels include stable IDs and individual set richness. Long names are shortened in the fixed label column, with complete names in tooltips and the selected-hotspot list below. Columns sort by descending count with deterministic mask ties; all nonempty intersections remain available through horizontal scrolling, including five-set comparisons. Total distinct-species richness and the sum of intersection counts are displayed together. Hover/focus shows the exact count and full participating hotspot names/IDs. Click, Enter, or Space highlights a column, its bar, connector, and filled dots, and shows complete selection details. Left/Right, Home, and End navigate between columns; Escape dismisses the tooltip. Labels and Y-axis remain aligned while the desktop plot scrolls; narrow screens use one horizontal scroll area for the complete labeled plot.

**Verification and limitations:** all 3/4/5-set membership patterns, duplicate taxon records, overlapping/disjoint/identical/empty sets, union consistency, strict URL validation, incomplete response IDs, and existing store/header scopes are covered by focused tests. Independent SQL groups production memberships by taxon and sums distinct location weights to form exclusive masks: real 3/4/5-hotspot checks matched every intersection and union (184, 200, and 201 species for the tested selections). Browser checks cover valid links, Step 6 navigation, selection limits, 3/4/5-set changes, guidance below three, invalid/out-of-county IDs, geographic resets, missing-summary feedback, highlighted bars/dots, full tooltips, keyboard navigation, and responsive layout. The plot describes recorded coverage and uses the existing offline snapshot and taxonomy; lack of a record is not ecological absence, hotspot footprints may overlap, and observation effort is not normalized. Independent standalone pages retain URL-based selection transfer; the dashboard uses one injected store instead.
