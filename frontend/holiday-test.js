
const svg = d3.select("#chart");
const tooltip = d3.select("#tooltip");
const status = d3.select("#status");

const width = 1000;
const height = 550;

const margin = {
  top: 55,
  right: 45,
  bottom: 70,
  left: 90
};

const innerWidth = width - margin.left - margin.right;
const innerHeight = height - margin.top - margin.bottom;

const colors = {
  average: "#377eb8",
  holiday: "#e68625"
};

const formatCount = d3.format(",.2f");
const formatInteger = d3.format(",.0f");

const plot = svg.append("g")
  .attr("transform", `translate(${margin.left},${margin.top})`);

const x = d3.scaleLinear()
  .domain([2012, 2025])
  .range([0, innerWidth]);

const y = d3.scaleLinear()
  .range([innerHeight, 0]);

const xAxis = plot.append("g")
  .attr("transform", `translate(0,${innerHeight})`);

const yAxis = plot.append("g");

const grid = plot.append("g");
const seriesGroup = plot.append("g");

svg.append("text")
  .attr("x", width / 2)
  .attr("y", height - 12)
  .attr("text-anchor", "middle")
  .attr("font-size", 15)
  .text("Year");

svg.append("text")
  .attr("transform", "rotate(-90)")
  .attr("x", -height / 2)
  .attr("y", 23)
  .attr("text-anchor", "middle")
  .attr("font-size", 15)
  .text("Reported birds");

const title = svg.append("text")
  .attr("x", width / 2)
  .attr("y", 25)
  .attr("text-anchor", "middle")
  .attr("font-size", 19)
  .attr("font-weight", "bold");

const legend = svg.append("g")
  .attr("transform", `translate(${margin.left + 10},43)`);

[
  { label: "Annual daily average", color: colors.average },
  { label: "Holiday count", color: colors.holiday }
].forEach((item, index) => {
  const g = legend.append("g")
    .attr("transform", `translate(${index * 235},0)`);

  g.append("line")
    .attr("x1", 0)
    .attr("x2", 28)
    .attr("stroke", item.color)
    .attr("stroke-width", 3);

  g.append("text")
    .attr("x", 36)
    .attr("y", 4)
    .attr("font-size", 13)
    .text(item.label);
});

function drawChart(data, species, holiday, region) {
  seriesGroup.selectAll("*").remove();

  const values = data.flatMap(d => [
    d.avg_daily_birds,
    d.holiday_birds
  ]).filter(v => v !== null && Number.isFinite(v));

  if (!values.length) {
    status.text("No completed summary data available.");
    title.text("");
    grid.selectAll("*").remove();
    xAxis.selectAll("*").remove();
    yAxis.selectAll("*").remove();
    return;
  }

  const maxValue = d3.max(values);

  y.domain([0, Math.max(maxValue, 1)]).nice();

  xAxis.call(
    d3.axisBottom(x)
      .tickValues(d3.range(2012, 2026))
      .tickFormat(d3.format("d"))
  );

  yAxis.call(
    d3.axisLeft(y)
      .ticks(7)
      .tickFormat(d3.format(","))
  );

  grid.call(
    d3.axisLeft(y)
      .ticks(7)
      .tickSize(-innerWidth)
      .tickFormat("")
  );

  grid.select(".domain").remove();

  grid.selectAll("line")
    .attr("stroke", "#e1e5ec")
    .attr("stroke-dasharray", "3,4");

  title.text(`${species} — ${holiday}`);

  const series = [
    {
      key: "avg_daily_birds",
      label: "Annual daily average",
      color: colors.average
    },
    {
      key: "holiday_birds",
      label: holiday,
      color: colors.holiday
    }
  ];

  series.forEach(item => {
    const line = d3.line()
      .defined(d => d[item.key] !== null)
      .x(d => x(d.year))
      .y(d => y(d[item.key]));

    seriesGroup.append("path")
      .datum(data)
      .attr("fill", "none")
      .attr("stroke", item.color)
      .attr("stroke-width", 3)
      .attr("stroke-linejoin", "round")
      .attr("stroke-linecap", "round")
      .attr("d", line);

    seriesGroup.selectAll(`.point-${item.key}`)
      .data(data.filter(d => d[item.key] !== null))
      .enter()
      .append("circle")
      .attr("cx", d => x(d.year))
      .attr("cy", d => y(d[item.key]))
      .attr("r", 5)
      .attr("fill", item.color)
      .attr("stroke", "white")
      .attr("stroke-width", 1.5)
      .on("mouseover", function(event, d) {
        d3.select(this).attr("r", 8);

        const count = item.key === "avg_daily_birds"
          ? formatCount(d[item.key])
          : formatInteger(d[item.key]);

        tooltip
          .style("display", "block")
          .html(`
            <strong>${d.year} — ${item.label}</strong>
            <div>${count} reported birds</div>
            ${item.key === "holiday_birds" && d.holiday_date
              ? `<div>${d.holiday_date}</div>`
              : ""}
          `);
      })
      .on("mousemove", function(event) {
        tooltip
          .style("left", `${event.pageX + 15}px`)
          .style("top", `${event.pageY - 20}px`);
      })
      .on("mouseout", function() {
        d3.select(this).attr("r", 5);
        tooltip.style("display", "none");
      });
  });

  status.text(
    `${region} · ${data[0].year}–${data[data.length - 1].year}`
  );
}

let requestId = 0;

async function loadData() {
  const currentRequest = ++requestId;

  const species = document.getElementById("species").value;
  const regionSelect = document.getElementById("region");
  const region = regionSelect.value;

  const level = regionSelect.selectedOptions[0].dataset.level;
  const regionName = regionSelect.selectedOptions[0].textContent.trim();

  const holiday = document.getElementById("holiday").value;

  const params = new URLSearchParams({
    species,
    region,
    level,
    holiday
  });

  status.text("Loading data...");

  try {
    const response = await fetch(
      `/api/holiday-comparison?${params}`
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "API request failed");
    }

    const result = await response.json();

    if (currentRequest !== requestId) return;

    drawChart(
      result.data,
      result.species,
      result.holiday,
      regionName
    );
  } catch (error) {
    if (currentRequest !== requestId) return;

    status.text(`Error: ${error.message}`);
    seriesGroup.selectAll("*").remove();
  }
}

document.querySelectorAll(".controls select")
  .forEach(select => {
    select.addEventListener("change", loadData);
  });

loadData();
