
const API_URL =
  "/api/species-trend" +
  "?region=US-MA" +
  "&taxon_id=avibase-4E74AE22" +
  "&from=2012" +
  "&to=2025";

const svg = d3.select("#chart");
const status = document.querySelector("#status");

const width = 900;
const height = 480;

const margin = {
  top: 30,
  right: 35,
  bottom: 65,
  left: 90
};

const innerWidth = width - margin.left - margin.right;
const innerHeight = height - margin.top - margin.bottom;

async function drawChart() {
  try {
    status.textContent = "Loading observation data...";

    const response = await fetch(API_URL);

    if (!response.ok) {
      throw new Error(`API returned HTTP ${response.status}`);
    }

    const result = await response.json();

    if (!Array.isArray(result.data)) {
      throw new Error("Unexpected API response");
    }

    // DuckDB BIGINT values arrive as JSON strings.
    const data = result.data.map(d => ({
      year: Number(d.year),
      observations: Number(d.observation_records)
    }));

    if (
      data.length === 0 ||
      data.some(d =>
        !Number.isFinite(d.year) ||
        !Number.isFinite(d.observations)
      )
    ) {
      throw new Error("No valid chart data returned");
    }

    data.sort((a, b) => a.year - b.year);

    svg.selectAll("*").remove();

    const chart = svg.append("g")
      .attr(
        "transform",
        `translate(${margin.left},${margin.top})`
      );

    // X scale: observation year
    const x = d3.scaleLinear()
      .domain(d3.extent(data, d => d.year))
      .range([0, innerWidth]);

    // Y scale: number of observation records
    const y = d3.scaleLinear()
      .domain([0, d3.max(data, d => d.observations)])
      .nice()
      .range([innerHeight, 0]);

    // Horizontal grid lines
    chart.append("g")
      .attr("class", "grid")
      .call(
        d3.axisLeft(y)
          .tickSize(-innerWidth)
          .tickFormat("")
      )
      .call(g => g.select(".domain").remove());

    // X axis
    chart.append("g")
      .attr("class", "axis")
      .attr("transform", `translate(0,${innerHeight})`)
      .call(
        d3.axisBottom(x)
          .ticks(data.length - 1)
          .tickFormat(d3.format("d"))
      );

    // Y axis
    chart.append("g")
      .attr("class", "axis")
      .call(
        d3.axisLeft(y)
          .ticks(7)
          .tickFormat(d3.format("~s"))
      );

    // Line generator
    const line = d3.line()
      .x(d => x(d.year))
      .y(d => y(d.observations));

    // Draw line
    chart.append("path")
      .datum(data)
      .attr("fill", "none")
      .attr("stroke", "steelblue")
      .attr("stroke-width", 3)
      .attr("stroke-linejoin", "round")
      .attr("stroke-linecap", "round")
      .attr("d", line);

    // Draw circles for yearly values
    chart.selectAll(".data-point")
      .data(data)
      .join("circle")
      .attr("class", "data-point")
      .attr("cx", d => x(d.year))
      .attr("cy", d => y(d.observations))
      .attr("r", 4)
      .attr("fill", "steelblue")
      .append("title")
      .text(
        d => `${d.year}: ${d.observations.toLocaleString()} records`
      );

    // X axis label
    svg.append("text")
      .attr("x", margin.left + innerWidth / 2)
      .attr("y", height - 10)
      .attr("text-anchor", "middle")
      .attr("fill", "#334155")
      .text("Year");

    // Y axis label
    svg.append("text")
      .attr("transform", "rotate(-90)")
      .attr("x", -(margin.top + innerHeight / 2))
      .attr("y", 20)
      .attr("text-anchor", "middle")
      .attr("fill", "#334155")
      .text("Observation records");

    status.textContent =
      `Loaded ${data.length} years · ` +
      `DuckDB query: ${result.queryTimeMs} ms`;

    console.log("D3 chart data:", data);

  } catch (error) {
    console.error(error);
    status.textContent = `Error: ${error.message}`;
  }
}

drawChart();
