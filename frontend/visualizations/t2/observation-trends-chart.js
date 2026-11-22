import { COLORS, MARGIN } from "../../charts/constants.js";
/** Responsive standalone adaptation of the existing yearly line and point chart. */
export function createObservationTrendsChart({ d3 = globalThis.d3, sizing = {}, presentation = "standalone", container, tooltip }) {
  const compact = presentation === "compact";
  const svg = d3.select(container).append("svg").attr("class", "observation-trends__plot")
    .attr("role", "group").attr("aria-label", "Yearly observation records for the selected species")
    .attr("width", 0).attr("height", 0);
  let current = null;
  const format = d3.format(",");
  const hideTooltip = () => { tooltip.hidden = true; };

  function positionTooltip(event, node) {
    const bounds = node.getBoundingClientRect();
    const pointer = event.type.startsWith("pointer");
    const left = pointer ? event.clientX + 12 : bounds.right + 8;
    const top = pointer ? event.clientY + 12 : bounds.top;
    tooltip.style.left = Math.max(8, Math.min(left, innerWidth - tooltip.offsetWidth - 8)) + "px";
    tooltip.style.top = Math.max(8, Math.min(top, innerHeight - tooltip.offsetHeight - 8)) + "px";
  }

  function showTooltip(event, point) {
    const year = document.createElement("strong");
    const records = document.createElement("div");
    year.textContent = "Year: " + point.year;
    records.textContent = "Observation records: " + format(point.observationRecords);
    tooltip.replaceChildren(year, records);
    tooltip.hidden = false;
    positionTooltip(event, event.currentTarget);
  }

  function render(model) {
    const width = Math.max(compact ? 320 : 720, container.clientWidth);
    const height = compact ? Math.max(95, container.clientHeight) : (sizing.height ?? 480);
    const margin = compact ? { left:79, right:16, top:12, bottom:34 } : { ...MARGIN, top:24, bottom:60 };
    const { series, startYear, endYear } = model;
    current = { ...model, viewportWidth: container.clientWidth, viewportHeight: container.clientHeight };
    hideTooltip();
    svg.attr("width", width).attr("height", height).selectAll("*").remove();
    // A one-year range has one centered point, with an integer year tick.
    const x = d3.scaleLinear().domain(startYear === endYear ? [startYear - 0.5, endYear + 0.5] : [startYear, endYear])
      .range([margin.left, width - margin.right]);
    const y = d3.scaleLinear().domain([0, Math.max(1, d3.max(series, point => point.observationRecords) || 0)])
      .nice().range([height - margin.bottom, margin.top]);
    const tickCount = Math.min(compact && height < 145 ? 3 : 6, y.domain()[1]);
    const grid = svg.append("g").attr("class", "observation-trends__grid").attr("aria-hidden", "true")
      .attr("transform", "translate(" + margin.left + ",0)")
      .call(d3.axisLeft(y).ticks(tickCount).tickSize(-(width - margin.left - margin.right)).tickFormat(""));
    grid.select(".domain").remove();
    svg.append("g").attr("class", "observation-trends__axis").attr("aria-hidden", "true")
      .attr("transform", "translate(0," + (height - margin.bottom) + ")")
      .call(d3.axisBottom(x).tickValues(series.filter((point,index) => !compact || index % Math.max(1, Math.ceil(series.length / Math.max(2, Math.floor((width-margin.left-margin.right)/75)))) === 0 || index === series.length-1).map(point => point.year)).tickFormat(d3.format("d")));
    svg.append("g").attr("class", "observation-trends__axis").attr("aria-hidden", "true")
      .attr("transform", "translate(" + margin.left + ",0)")
      .call(d3.axisLeft(y).ticks(tickCount).tickFormat(format));
    svg.append("text").attr("class", "observation-trends__axis-label")
      .attr("x", margin.left + (width - margin.left - margin.right) / 2).attr("y", height - (compact ? 5 : 14))
      .attr("text-anchor", "middle").text("Year");
    svg.append("text").attr("class", "observation-trends__axis-label")
      .attr("transform", "rotate(-90)").attr("x", -(height - margin.bottom + margin.top) / 2)
      .attr("y", compact ? 12 : 20).attr("text-anchor", "middle").text(compact ? "Observation records" : "Number of observation records");
    const line = d3.line().defined(point => point.observationRecords !== null)
      .x(point => x(point.year)).y(point => y(point.observationRecords));
    svg.append("path").datum(series).attr("class", "observation-trends__line")
      .attr("d", line).attr("fill", "none").attr("stroke", COLORS.selected).attr("stroke-width", 2.5);
    const points = svg.append("g").selectAll(".observation-trends__point")
      .data(series.filter(point => point.observationRecords !== null), point => point.year)
      .join("g").attr("class", "observation-trends__point")
      .attr("data-year", point => point.year)
      .attr("transform", point => "translate(" + x(point.year) + "," + y(point.observationRecords) + ")")
      .attr("tabindex", 0).attr("role", "img")
      .attr("aria-label", point => point.year + ": " + format(point.observationRecords) + " observation records")
      .attr("aria-describedby", tooltip.id)
      .on("pointerenter focus", showTooltip)
      .on("pointermove", function(event) { positionTooltip(event, this); })
      .on("pointerleave blur", hideTooltip)
      .on("keydown", event => { if (event.key === "Escape") hideTooltip(); });
    points.append("circle").attr("r", 11).attr("fill", "transparent");
    points.append("circle").attr("class", "observation-trends__dot").attr("r", 4)
      .attr("fill", COLORS.selected).attr("pointer-events", "none");
    if (!series.some(point => point.observationRecords !== null)) {
      svg.append("text").attr("x", (width + margin.left) / 2).attr("y", height / 2)
        .attr("text-anchor", "middle").text("No processed observation summaries available");
    }
  }

  const resize = new ResizeObserver(() => {
    if (current && (current.viewportWidth !== container.clientWidth || (compact && current.viewportHeight !== container.clientHeight))) render(current);
  });
  resize.observe(container);
  return {
    render,
    clear() { current = null; hideTooltip(); svg.selectAll("*").remove(); svg.attr("width", 0).attr("height", 0); },
    destroy() { resize.disconnect(); hideTooltip(); svg.remove(); }
  };
}
