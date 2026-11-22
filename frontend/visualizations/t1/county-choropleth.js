// Uses the same GeoJSON, Albers fitting, and county click-selection pattern as us-map.js.
export function createCountyChoropleth({ d3 = globalThis.d3, sizing = {}, presentation = "standalone", container, tooltip, onCountySelect }) {
  const compact = presentation === "compact";
  let width = 960;
  let height = sizing.height ?? 560;
  let current;
  const root = d3.select(container);
  const svg = root.append("svg")
    .attr("class", "county-choropleth__map")
    .attr("viewBox", [0, 0, width, height])
    .attr("role", "group")
    .attr("aria-label", "County species richness map. Select a county by clicking or pressing Enter or Space.");
  const polygons = svg.append("g");
  const zoom = d3.zoom()
    .scaleExtent([1, 8])
    .on("zoom", (event) => {
      polygons.attr("transform", event.transform);
    });
  svg.call(zoom);

  function resetZoom() {
    svg.transition()
      .duration(250)
      .call(zoom.transform, d3.zoomIdentity);
  }

  const legend = root.append("svg")
    .attr("class", "county-choropleth__legend")
    .attr("viewBox", [0, 0, 480, compact ? 60 : 76])
    .attr("role", "img");
  const format = d3.format(",");

  function describe(feature) {
    const { countyName, speciesRichness, observationRecords } = feature.properties;
    return speciesRichness === null
      ? countyName + ": no matching county summary"
      : countyName + ": " + format(speciesRichness) + " distinct species; " + format(observationRecords) + " observation records";
  }

  function hideTooltip() { tooltip.hidden = true; }

  function positionTooltip(event, node) {
    const bounds = node.getBoundingClientRect();
    const x = event.type.startsWith("pointer") ? event.clientX + 14 : bounds.right + 12;
    const y = event.type.startsWith("pointer") ? event.clientY + 14 : bounds.top;
    tooltip.style.left = Math.max(8, Math.min(x, window.innerWidth - tooltip.offsetWidth - 8)) + "px";
    tooltip.style.top = Math.max(8, Math.min(y, window.innerHeight - tooltip.offsetHeight - 8)) + "px";
  }

  function showTooltip(event, feature) {
    const { countyName, speciesRichness, observationRecords } = feature.properties;
    const title = document.createElement("strong");
    title.textContent = countyName;
    const richness = document.createElement("div");
    const observations = document.createElement("div");
    richness.textContent = speciesRichness === null ? "No matching county summary" : "Distinct species: " + format(speciesRichness);
    observations.textContent = observationRecords === null ? "Observation records: unavailable" : "Observation records: " + format(observationRecords);
    tooltip.replaceChildren(title, richness, observations);
    tooltip.hidden = false;
    positionTooltip(event, event.currentTarget);
  }

  function setSelectedCounty(countyCode) {
    if (current) current.selectedCounty = countyCode;
    polygons.selectAll(".county")
      .classed("is-selected", feature => feature.properties.regionCode === countyCode)
      .attr("aria-pressed", feature => String(feature.properties.regionCode === countyCode));
    polygons.selectAll(".is-selected").raise();
  }

  function render({ counties, selectedCounty, stateName }) {
    current = { counties, selectedCounty, stateName };
    if (compact) {
      width = Math.max(240, svg.node().clientWidth);
      height = Math.max(40, svg.node().clientHeight);
      svg.attr("viewBox", [0, 0, width, height]);
    }
    hideTooltip();
    const maxRichness = Math.max(1, d3.max(counties.features, feature => feature.properties.speciesRichness) || 0);
    const color = d3.scaleSequential(d3.interpolateBlues).domain([0, maxRichness]);
    // Fit the existing county geometry, centering the projection on the selected state.
    const [longitude, latitude] = d3.geoCentroid(counties);
    const padding = compact ? Math.min(12, height * 0.1) : 18;
    const projection = d3.geoAlbers().rotate([-longitude, 0]).center([0, latitude])
      .fitExtent([[padding, padding], [width - padding, height - padding]], counties);
    const path = d3.geoPath().projection(projection);
    polygons.selectAll(".county")
      .data(counties.features, feature => feature.properties.regionCode)
      .join("path")
      .attr("class", "county")
      .attr("d", path)
      .attr("data-county-code", feature => feature.properties.regionCode)
      .attr("fill", feature => feature.properties.speciesRichness === null ? "#d1d5db" : color(feature.properties.speciesRichness))
      .attr("tabindex", 0)
      .attr("role", "button")
      .attr("aria-label", describe)
      .attr("aria-describedby", tooltip.id)
      .on("pointerenter focus", showTooltip)
      .on("pointermove", function(event) { positionTooltip(event, this); })
      .on("pointerleave blur", hideTooltip)
      .on("click", (event, feature) => onCountySelect(feature.properties.regionCode))
      .on("keydown", (event, feature) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onCountySelect(feature.properties.regionCode);
        }
        if (event.key === "Escape") hideTooltip();
      });
    setSelectedCounty(selectedCounty);

    legend.selectAll("*").remove();
    legend.attr("aria-label", stateName + ": distinct species from 0 to " + maxRichness + "; darker blue means greater richness; gray means no matching summary");
    legend.append("text").attr("x", 12).attr("y", 14).text("Distinct species · darker means greater richness");
    legend.selectAll("rect.scale-step").data(d3.range(64)).join("rect")
      .attr("class", "scale-step").attr("x", index => 12 + index * 4).attr("y", 24)
      .attr("width", 4.1).attr("height", 12).attr("fill", index => color(index / 63 * maxRichness));
    const scale = d3.scaleLinear().domain([0, maxRichness]).range([12, 268]);
    legend.append("g").attr("transform", "translate(0,36)")
      .call(d3.axisBottom(scale)
        .tickValues([...new Set([0, Math.round(maxRichness / 2), maxRichness])])
        .tickFormat(d3.format("d")));
    if (counties.features.some(feature => feature.properties.speciesRichness === null)) {
      legend.append("rect").attr("x", 296).attr("y", 24).attr("width", 12).attr("height", 12).attr("fill", "#d1d5db");
      legend.append("text").attr("x", 314).attr("y", 35).text("No matching summary");
    }
  }

  const resize = compact ? new ResizeObserver(() => { if (current) render(current); }) : null;
  resize?.observe(container);
  return {
    render,
    setSelectedCounty,
    resetZoom,
    clear() {
      current = null;
      hideTooltip();
      polygons.selectAll("*").remove();
      legend.selectAll("*").remove();
    },
    destroy() {
      resize?.disconnect();
      current = null;
      hideTooltip();
      svg.remove();
      legend.remove();
    }
  };
}
