import { COLORS } from "../../charts/constants.js";

export function createCountyRichnessBarChart({ d3 = globalThis.d3, container, tooltip, onCountySelect }) {
  const root = d3.select(container).append("div").attr("class", "county-bars__layout");
  const viewport = root.append("div").attr("class", "county-bars__viewport")
    .attr("tabindex", 0).attr("role", "region")
    .attr("aria-label", "County species richness. Scroll vertically to explore every county.");
  const header = viewport.append("div").attr("class", "county-bars__header").attr("aria-hidden", "true");
  header.append("span").text("County");
  const scale = header.append("div").attr("class", "county-bars__scale");
  const axis = scale.append("div").attr("class", "county-bars__x-axis");
  header.append("span").attr("class", "county-bars__unit").text("Species");
  const bars = viewport.append("div").attr("class", "county-bars__plot");
  const format = d3.format(",");

  function hideTooltip() { tooltip.hidden = true; }

  function positionTooltip(event, node) {
    const bounds = node.getBoundingClientRect();
    const pointer = event.type.startsWith("pointer");
    const left = pointer ? event.clientX + 12 : bounds.right + 8;
    const top = pointer ? event.clientY + 12 : Math.max(8, bounds.top);
    tooltip.style.left = Math.max(8, Math.min(left, innerWidth - tooltip.offsetWidth - 8)) + "px";
    tooltip.style.top = Math.max(8, Math.min(top, innerHeight - tooltip.offsetHeight - 8)) + "px";
  }

  function showTooltip(event, county) {
    const title = document.createElement("strong");
    const richness = document.createElement("div");
    const records = document.createElement("div");
    title.textContent = county.countyName;
    richness.textContent = "Distinct species: " + format(county.speciesRichness);
    records.textContent = "Observation records: " + format(county.observationRecords);
    tooltip.replaceChildren(title, richness, records);
    tooltip.hidden = false;
    positionTooltip(event, event.currentTarget);
  }

  function setSelectedCounty(countyCode) {
    const counties = bars.selectAll(".county-bars__county");
    counties.classed("is-selected", county => county.regionCode === countyCode)
      .attr("aria-pressed", county => String(county.regionCode === countyCode));
    counties.select(".county-bars__bar")
      .style("background", county => county.regionCode === countyCode ? COLORS.selected : COLORS.default);
    const selected = counties.filter(county => county.regionCode === countyCode).node();
    if (!selected) return;
    const scroller = viewport.node();
    const row = selected.getBoundingClientRect();
    const top = header.node().getBoundingClientRect().bottom;
    const bottom = scroller.getBoundingClientRect().top + scroller.clientHeight;
    if (row.top < top) scroller.scrollTop += row.top - top;
    else if (row.bottom > bottom) scroller.scrollTop += row.bottom - bottom;
  }

  function render({ rows, selectedCounty }) {
    hideTooltip();
    header.attr("hidden", rows.length ? null : true);
    const x = d3.scaleLinear().domain([0, Math.max(1, d3.max(rows, row => row.speciesRichness) || 0)])
      .nice(4).range([0, 100]);
    const maximum = x.domain()[1];
    const ticks = [...new Set([0, ...x.ticks(4).filter(Number.isInteger), maximum])];
    axis.selectAll("span").data(ticks).join("span")
      .style("left", value => x(value) + "%").text(format);
    const counties = bars.selectAll(".county-bars__county").data(rows, county => county.regionCode)
      .join(enter => {
        const row = enter.append("button").attr("type", "button").attr("class", "county-bars__county");
        row.append("span").attr("class", "county-bars__name");
        row.append("span").attr("class", "county-bars__track").attr("aria-hidden", "true")
          .append("span").attr("class", "county-bars__bar");
        row.append("span").attr("class", "county-bars__value").attr("aria-hidden", "true");
        return row;
      }).order()
      .attr("data-county-code", county => county.regionCode)
      .attr("aria-label", county => county.countyName + ": " + format(county.speciesRichness) + " distinct species; " + format(county.observationRecords) + " observation records")
      .attr("aria-describedby", tooltip.id)
      .on("pointerenter focus", showTooltip)
      .on("pointermove", function(event) { positionTooltip(event, this); })
      .on("pointerleave blur", hideTooltip)
      .on("click", (event, county) => onCountySelect(county.regionCode))
      .on("keydown", (event, county) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onCountySelect(county.regionCode);
        }
        if (event.key === "Escape") hideTooltip();
      });
    counties.select(".county-bars__name").text(county => county.countyName);
    counties.select(".county-bars__value").text(county => format(county.speciesRichness));
    counties.select(".county-bars__bar")
      .style("width", county => x(county.speciesRichness) + "%")
      .classed("county-bars__bar--zero", county => county.speciesRichness === 0);
    setSelectedCounty(selectedCounty);
  }

  return {
    render,
    setSelectedCounty,
    clear() {
      hideTooltip();
      bars.selectAll("*").remove();
      axis.selectAll("*").remove();
      header.attr("hidden", true);
      viewport.node().scrollTop = 0;
    },
    destroy() { hideTooltip(); root.remove(); }
  };
}
