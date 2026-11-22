import { MARGIN } from "../../charts/constants.js";
/** Responsive standalone adaptation of the existing yearly line and point chart. */
export function createObservationTrendsChart({ d3 = globalThis.d3, sizing = {}, presentation = "standalone", container, tooltip, onSelectSeason = () => {} }) {
  const compact = presentation === "compact";
  const svg = d3.select(container).append("svg").attr("class", "observation-trends__plot")
    .attr("role", "group").attr("aria-label", "Yearly observation records for the selected species")
    .attr("width", 0).attr("height", 0);
  let current = null;
  let selectedSeason = "all";

  function selectSeason(season) {
    selectedSeason = season;
    svg.selectAll(".observation-trends__series")
      .attr("opacity", trend => trend.id === season ? 1 : 0.65);
    svg.selectAll(".observation-trends__line")
      .attr("stroke-width", trend => trend.id === season ? 3.5 : 2);
    svg.selectAll(".observation-trends__legend-item")
      .attr("aria-pressed", trend => String(trend.id === season))
      .classed("is-selected", trend => trend.id === season);
    svg.selectAll(".observation-trends__point")
      .attr("aria-pressed", point => String(point.season === season));
    svg.selectAll(".observation-trends__series").filter(trend => trend.id === season).raise();
  }

  function select(event, season) {
    if (event.type === "keydown" && !["Enter", " "].includes(event.key)) return;
    event.preventDefault();
    selectSeason(season);
    onSelectSeason(season);
  }
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
    year.textContent = point.label + " - Year: " + point.year;
    records.textContent = "Observation records: " + format(point.observationRecords);
    tooltip.replaceChildren(year, records);
    tooltip.hidden = false;
    positionTooltip(event, event.currentTarget);
  }

  function render(model) {
    const width = Math.max(compact ? 320 : 720, container.clientWidth);
    const height = compact ? Math.max(150, container.clientHeight) : (sizing.height ?? 480);
    const legendWidth = 76;
    const margin = compact ? { left:68, right:100, top:12, bottom:34 } : { ...MARGIN, right:100, top:24, bottom:60 };
    const { trends, startYear, endYear } = model;
    const series = trends[0].series;
    current = { ...model, viewportWidth: container.clientWidth, viewportHeight: container.clientHeight };
    hideTooltip();
    svg.attr("width", width).attr("height", height).selectAll("*").remove();
    // A one-year range has one centered point, with an integer year tick.
    const x = d3.scaleLinear().domain(startYear === endYear ? [startYear - 0.5, endYear + 0.5] : [startYear, endYear])
      .range([margin.left, width - margin.right]);
    const y = d3.scaleLinear().domain([0, Math.max(1, d3.max(trends.flatMap(trend => trend.series), point => point.observationRecords) || 0)])
      .nice().range([height - margin.bottom, margin.top]);
    const tickCount = Math.min(6, y.domain()[1]);
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
      .attr("x", margin.left + (width - margin.left - margin.right) / 2).attr("y", height - 14)
      .attr("text-anchor", "middle").text("Year");
    svg.append("text").attr("class", "observation-trends__axis-label")
      .attr("transform", "rotate(-90)").attr("x", -(height - margin.bottom + margin.top) / 2)
      .attr("y", 20).attr("text-anchor", "middle").text(compact ? "Observation records" : "Number of observation records");
    const line = d3.line().defined(point => point.observationRecords !== null)
      .x(point => x(point.year)).y(point => y(point.observationRecords));
    const legendTop = Math.max(8, margin.top + (height - margin.top - margin.bottom - trends.length * 24) / 2);
    const legend = svg.append("g").attr("class", "observation-trends__legend")
      .attr("aria-label", "Select highlighted seasonal trend")
      .selectAll("g").data(trends).join("g")
      .attr("class", "observation-trends__legend-item")
      .attr("data-season", trend => trend.id)
      .attr("transform", (_, index) => `translate(${width - margin.right + 16},${legendTop + index * 24})`)
      .attr("tabindex", 0).attr("role", "button")
      .attr("aria-label", trend => "Highlight " + trend.label)
      .on("click keydown", (event, trend) => select(event, trend.id));
    legend.append("rect").attr("class", "observation-trends__legend-target")
      .attr("width", legendWidth).attr("height", 24).attr("rx", 3);
    legend.append("line").attr("x1", 4).attr("x2", 15).attr("y1", 12).attr("y2", 12)
      .attr("stroke", trend => trend.color).attr("stroke-width", 3);
    legend.append("text").attr("x", 19).attr("y", 16).text(trend => trend.label.split(" (")[0]);
    legend.append("title").text(trend => trend.label);

    const groups = svg.selectAll(".observation-trends__series").data(trends).join("g")
      .attr("class", "observation-trends__series").attr("data-season", trend => trend.id);
    groups.each(function(trend) {
      const group = d3.select(this);
      // A broad transparent stroke makes thin lines clickable without changing their appearance.
      group.append("path").datum(trend.series).attr("d", line).attr("fill", "none")
        .attr("stroke", "transparent").attr("stroke-width", 12).attr("pointer-events", "stroke")
        .on("click", event => select(event, trend.id));
      group.append("path").datum(trend).attr("class", "observation-trends__line")
        .attr("d", line(trend.series)).attr("fill", "none").attr("stroke", trend.color)
        .on("click", event => select(event, trend.id));
      const points = group.selectAll(".observation-trends__point")
        .data(trend.series.filter(point => point.observationRecords !== null)
          .map(point => ({ ...point, season: trend.id, label: trend.label })), point => point.year)
        .join("g").attr("class", "observation-trends__point")
        .attr("data-year", point => point.year).attr("data-season", trend.id)
        .attr("transform", point => "translate(" + x(point.year) + "," + y(point.observationRecords) + ")")
        .attr("tabindex", 0).attr("role", "button")
        .attr("aria-label", point => trend.label + ", " + point.year + ": " + format(point.observationRecords) + " observation records; select to highlight")
        .attr("aria-describedby", tooltip.id)
        .on("pointerenter focus", showTooltip)
        .on("pointermove", function(event) { positionTooltip(event, this); })
        .on("pointerleave blur", hideTooltip)
        .on("click", (event, point) => select(event, point.season))
        .on("keydown", (event, point) => { if (event.key === "Escape") hideTooltip(); else select(event, point.season); });
      points.append("circle").attr("r", 8).attr("fill", "transparent");
      points.append("circle").attr("class", "observation-trends__dot").attr("r", 3)
        .attr("fill", trend.color).attr("pointer-events", "none");
    });
    selectSeason(selectedSeason);
    if (!trends.some(trend => trend.series.some(point => point.observationRecords !== null))) {
      svg.append("text").attr("x", margin.left + (width - margin.left - margin.right) / 2).attr("y", height / 2)
        .attr("text-anchor", "middle").text("No processed observation summaries available");
    }
  }

  const resize = new ResizeObserver(() => {
    if (current && (current.viewportWidth !== container.clientWidth || (compact && current.viewportHeight !== container.clientHeight))) render(current);
  });
  resize.observe(container);
  return {
    render,
    selectSeason,
    clear() { current = null; hideTooltip(); svg.selectAll("*").remove(); svg.attr("width", 0).attr("height", 0); },
    destroy() { resize.disconnect(); hideTooltip(); svg.remove(); }
  };
}
