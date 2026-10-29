
const svg = d3.select("#chart");

// Draw three circles
svg.selectAll("circle")
    .data(["red", "orange", "blue"])
    .join("circle")
    .attr("cx", (d, i) => 100 + i * 150)
    .attr("cy", 150)
    .attr("r", 40)
    .attr("fill", d => d);

console.log("D3 successfully loaded!");
