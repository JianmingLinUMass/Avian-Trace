const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const precise = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

function text(document, tag, value, className) {
  const element = document.createElement(tag);
  element.textContent = value;
  if (className) element.className = className;
  return element;
}

function chartScale(maximum) {
  const target = Math.max(1, maximum / 4);
  const magnitude = 10 ** Math.floor(Math.log10(target));
  const step = [1, 2, 2.5, 5, 10].find(factor => factor * magnitude >= target) * magnitude;
  const count = Math.max(1, Math.ceil(maximum / step));
  return { max: step * count, ticks: Array.from({ length: count + 1 }, (_, index) => step * index) };
}

export function renderItineraryBars(document, { plans, selected, countyWide, onSelect }) {
  const chart = text(document, "div", "", "itinerary-bars");
  chart.setAttribute("role", "group");
  chart.setAttribute("aria-label", "Expected distinct species by " + (countyWide ? "number of stops" : "hotspot combination"));
  const scale = chartScale(Math.max(...plans.map(plan => plan.expectedSpecies)));
  const heading = text(document, "div", "Expected distinct species", "itinerary-bars__metric");
  const plot = text(document, "div", "", "itinerary-bars__plot");
  const yAxis = text(document, "div", "", "itinerary-bars__yaxis");
  yAxis.setAttribute("aria-hidden", "true");
  for (const [index, value] of scale.ticks.entries()) {
    const tick = text(document, "span", number.format(value));
    tick.style.bottom = 100 * value / scale.max + "%";
    if (index % 2 === 1) tick.className = "itinerary-bars__tick--minor";
    yAxis.append(tick);
  }
  const columns = text(document, "div", "", "itinerary-bars__rows");
  for (const [index, plan] of plans.entries()) {
    const active = selected === plan;
    const label = countyWide ? index + 1 + (index === 0 ? " stop" : " stops") : "Combo " + (index + 1);
    const names = plan.hotspots.map(hotspot => hotspot.name).join(" · ");
    const score = precise.format(plan.expectedSpecies);
    const column = text(document, "button", "", "itinerary-bars__row");
    column.type = "button";
    column.setAttribute("aria-pressed", String(active));
    column.setAttribute("aria-label", label + ", " + score + " expected distinct species. " + names);
    column.title = names;
    const track = text(document, "span", "", "itinerary-bars__track");
    const bar = text(document, "span", "", "itinerary-bars__bar");
    bar.style.height = 100 * plan.expectedSpecies / scale.max + "%";
    track.append(bar);
    column.append(text(document, "span", score, "itinerary-bars__value"), track, text(document, "span", label, "itinerary-bars__caption"));
    column.addEventListener("click", () => onSelect(plan, index));
    columns.append(column);
  }
  plot.append(yAxis, columns);
  chart.append(heading, plot, text(document, "div", countyWide ? "Number of stops" : "Hotspot combination", "itinerary-bars__xaxis"));
  return chart;
}

export function renderItineraryStops(document, plan) {
  const list = text(document, "ul", "", "itinerary-stop-list");
  for (const hotspot of plan.hotspots) {
    const item = document.createElement("li");
    item.append(text(document, "strong", hotspot.name),
      text(document, "span", number.format(hotspot.complete) + (hotspot.complete === 1 ? " complete checklist" : " complete checklists")));
    list.append(item);
  }
  const section = text(document, "section", "", "itinerary-stop-details");
  section.append(text(document, "h3", "Selected hotspots"), list);
  return section;
}
