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
  const axisRow = text(document, "div", "", "itinerary-bars__axis-row");
  axisRow.setAttribute("aria-hidden", "true");
  const axis = text(document, "div", "", "itinerary-bars__axis");
  for (const value of scale.ticks) {
    const tick = text(document, "span", number.format(value));
    tick.style.left = 100 * value / scale.max + "%";
    axis.append(tick);
  }
  axisRow.append(axis);
  const rows = text(document, "div", "", "itinerary-bars__rows");
  for (const [index, plan] of plans.entries()) {
    const active = selected === plan;
    const label = countyWide ? index + 1 + (index === 0 ? " stop" : " stops") : "Combo " + (index + 1);
    const names = plan.hotspots.map(hotspot => hotspot.name).join(" · ");
    const score = precise.format(plan.expectedSpecies);
    const row = text(document, "button", "", "itinerary-bars__row");
    row.type = "button";
    row.setAttribute("aria-pressed", String(active));
    row.setAttribute("aria-label", label + ", " + score + " expected distinct species. " + names);
    row.title = names;
    const track = text(document, "span", "", "itinerary-bars__track");
    const bar = text(document, "span", "", "itinerary-bars__bar");
    bar.style.width = 100 * plan.expectedSpecies / scale.max + "%";
    track.append(bar);
    row.append(text(document, "span", label), track, text(document, "span", score, "itinerary-bars__value"));
    row.addEventListener("click", () => onSelect(plan, index));
    rows.append(row);
  }
  chart.append(heading, axisRow, rows);
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
