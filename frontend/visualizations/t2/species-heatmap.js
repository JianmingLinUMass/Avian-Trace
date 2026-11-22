import { formatFrequency, formatChecklistCounts } from "../../helpers/reporting-frequency.js";
import { MONTH_NAMES } from "./species-heatmap-data.js";

export function createSpeciesHeatmap({ d3 = globalThis.d3, sizing = {}, presentation = "standalone", container, tooltip }) {
  const compact = presentation === "compact";
  const root = d3.select(container);
  const months = compact ? root.append("div").attr("class","visualization-heatmap__months") : null;
  const monthSvg = months?.append("svg").attr("height",28).attr("aria-hidden","true");
  const body = compact ? root.append("div").attr("class","visualization-heatmap__body").attr("tabindex",0).attr("role","region").attr("aria-label","Species rows. Scroll vertically for every species and horizontally if needed.") : root;
  const legendViewport = compact ? root.append("div").attr("class","visualization-heatmap__legend") : null;
  const legendSvg = legendViewport?.append("svg").attr("height",40).attr("aria-hidden","true");
  if (compact) body.on("scroll.compact", () => { months.node().scrollLeft=body.node().scrollLeft; });
  const svg = body.append("svg").attr("class", "species-heatmap__plot")
    .attr("role", "group").attr("aria-label", "Monthly reporting frequency by species")
    .attr("width", 0).attr("height", 0);
  let current;
  const hideTooltip = () => { tooltip.hidden = true; };

  function positionTooltip(event, node) {
    const box = node.getBoundingClientRect();
    const pointer = event.type.startsWith("pointer");
    const left = pointer ? event.clientX + 12 : box.right + 8;
    const top = pointer ? event.clientY + 12 : box.top;
    tooltip.style.left = Math.max(8, Math.min(left, innerWidth - tooltip.offsetWidth - 8)) + "px";
    tooltip.style.top = Math.max(8, Math.min(top, innerHeight - tooltip.offsetHeight - 8)) + "px";
  }

  function showTooltip(event, cell) {
    const species = document.createElement("strong");
    const month = document.createElement("div");
    const records = document.createElement("div");
    species.textContent = cell.speciesName;
    month.textContent = MONTH_NAMES[cell.month - 1];
    records.textContent = cell.frequency ? formatFrequency(cell.frequency.rate) + " · " + formatChecklistCounts(cell.frequency) : "No eligible complete checklists";
    tooltip.replaceChildren(species, month, records);
    tooltip.hidden = false;
    positionTooltip(event, event.currentTarget);
  }

  function render(model) {
    const { species, startYear, endYear } = model;
    current = { ...model, viewportWidth: container.clientWidth, viewportHeight:container.clientHeight, bodyWidth:body.node().clientWidth };
    hideTooltip();
    const left = compact ? 174 : Math.max(180, (d3.max(species, item => item.speciesName.length * 7.5) || 0) + 36);
    const top = compact ? 0 : 94;
    const rowHeight = compact ? 18 : 30;
    const width = Math.max(compact ? body.node().clientWidth : container.clientWidth, left + 12 * (compact ? 28 : 64) + 24);
    const height = compact ? species.length * rowHeight : top + species.length * rowHeight + 104;
    svg.attr("width", width).attr("height", height).selectAll("*").remove();
    if (compact) { monthSvg.attr("width",width).selectAll("*").remove(); legendSvg.attr("width",Math.max(360,container.clientWidth)).selectAll("*").remove(); }
    const x = d3.scaleBand().domain(d3.range(1, 13)).range([left, width - 24]).padding(0.03);
    const y = d3.scaleBand().domain(species.map(item => item.taxonId)).range([top, top + species.length * rowHeight]).padding(0.06);
    const cells = species.flatMap(item => item.cells);
    const color = d3.scaleSequential(d3.interpolateRgb("#ffff00", "#ff0000")).domain([0, 1]);
    (compact ? monthSvg : svg).append("g").attr("class", "species-heatmap__month-axis").attr("aria-hidden", "true")
      .attr("transform", "translate(0," + (compact ? 24 : top - 8) + ")")
      .call(d3.axisTop(x).tickSize(0).tickFormat(month => compact ? MONTH_NAMES[month-1].slice(0,3) : MONTH_NAMES[month-1]))
      .call(axis => axis.select(".domain").remove())
      .selectAll("text").attr("transform", compact ? null : "rotate(-45)").attr("text-anchor", compact ? "middle" : "start").attr("dx", compact ? 0 : "0.3em");
    const names = new Map(species.map(item => [item.taxonId, item.speciesName]));
    svg.append("g").attr("class", "species-heatmap__species-axis").attr("aria-hidden", "true")
      .attr("transform", "translate(" + (left - 8) + ",0)")
      .call(d3.axisLeft(y).tickSize(0).tickFormat(id => { const name=names.get(id); return compact && name.length>24 ? name.slice(0,23)+"…" : name; }))
      .call(axis => axis.select(".domain").remove());
    (compact ? monthSvg : svg).append("text").attr("x", 14).attr("y", compact ? 18 : top - 14).text("Bird species");
    svg.append("g").selectAll(".species-heatmap__cell").data(cells, cell => cell.taxonId + ":" + cell.month)
      .join("rect").attr("class", "species-heatmap__cell")
      .attr("x", cell => x(cell.month)).attr("y", cell => y(cell.taxonId))
      .attr("width", x.bandwidth()).attr("height", y.bandwidth())
      .attr("fill", cell => cell.frequency ? color(cell.frequency.rate) : "#d1d5db")
      .attr("data-taxon-id", cell => cell.taxonId).attr("data-month", cell => cell.month)
      .attr("tabindex", 0).attr("role", "img").attr("aria-describedby", tooltip.id)
      .attr("aria-label", cell => cell.speciesName + ", " + MONTH_NAMES[cell.month - 1] + ": " +
        (cell.frequency ? formatFrequency(cell.frequency.rate) + ", " + formatChecklistCounts(cell.frequency) : "no eligible complete checklists") +
        " across " + startYear + "–" + endYear)
      .on("pointerenter focus", showTooltip)
      .on("pointermove", function(event) { positionTooltip(event, this); })
      .on("pointerleave blur", hideTooltip)
      .on("keydown", event => { if (event.key === "Escape") hideTooltip(); });
    const legendStart=compact?Math.min(300,Math.max(160,container.clientWidth-280)):0;
    const legendSpan=compact?Math.min(256,Math.max(120,container.clientWidth-legendStart-40)):256;
    const legend = (compact ? legendSvg : svg).append("g").attr("class", "species-heatmap__legend")
      .attr("transform", "translate(" + (compact?8:left) + "," + (compact?0:height-72) + ")");
    legend.append("text").attr("y", compact?14:0).text("Reporting frequency");
    legend.selectAll("rect").data(d3.range(64)).join("rect")
      .attr("x", index => legendStart + index * legendSpan/64).attr("y", compact?4:12).attr("width", legendSpan/64+0.1).attr("height", 12)
      .attr("fill", index => color(index / 63));
    legend.append("g").attr("transform", "translate(0,"+(compact?16:24)+")")
      .call(d3.axisBottom(d3.scaleLinear().domain([0, 1]).range([legendStart,legendStart+legendSpan]))
        .tickValues([0, 0.5, 1]).tickFormat(formatFrequency));
    if (cells.some(cell => !cell.frequency)) {
      legend.append("rect").attr("x", compact?8:292).attr("y", compact?24:12).attr("width", 12).attr("height", 12).attr("fill", "#d1d5db");
      legend.append("text").attr("x", compact?26:312).attr("y", compact?34:23).text("Unavailable");
    }
  }
  const resize = new ResizeObserver(() => { if (current && (current.viewportWidth !== container.clientWidth || (compact && (current.viewportHeight !== container.clientHeight || current.bodyWidth !== body.node().clientWidth)))) render(current); });
  resize.observe(container);
  if(compact)resize.observe(body.node());
  return {
    render,
    clear() { current = null; hideTooltip(); svg.selectAll("*").remove(); svg.attr("width", 0).attr("height", 0); monthSvg?.selectAll("*").remove(); legendSvg?.selectAll("*").remove(); },
    destroy() { resize.disconnect(); hideTooltip(); svg.remove(); if(compact) { body.on("scroll.compact",null).remove(); months.remove(); legendViewport.remove(); } }
  };
}
